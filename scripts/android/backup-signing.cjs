// Respaldo cifrado de las llaves de firma de la app (firma de la app y llave de subida a Google Play).
// Uso: node scripts/android/backup-signing.cjs [carpeta-destino]      crea el respaldo
//      node scripts/android/backup-signing.cjs --verificar <archivo>  comprueba que se puede abrir y coincide
//      node scripts/android/backup-signing.cjs --restaurar <archivo>  restaura en .data (solo si no existen)
// La contraseña se pide por teclado y nunca se guarda. AES-256-GCM con clave derivada por scrypt.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const sources = [
  ".data/android-signing/qualitzer-field-release.p12",
  ".data/android-signing/credentials.json",
  ".data/play-upload/qualitzer-play-upload.p12",
  ".data/play-upload/credentials.json",
  ".data/play-upload/upload_certificate.pem",
];
const MAGIC = "QZSIGN1";
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function ask(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    // Cada pulsación (o texto pegado) puede llegar en un mismo bloque: se procesa letra por letra.
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode?.(false); stdin.pause(); stdin.removeListener("data", onData);
          process.stdout.write(`  (${[...value].length} caracteres)\n`); resolve(value); return;
        } else if (char === "\u0003") { process.stdout.write("\nCancelado.\n"); process.exit(1); }
        else if (char === "\u0008" || char === "\u007f") { if (value.length > 0) { value = [...value].slice(0, -1).join(""); process.stdout.write("\b \b"); } }
        else if (char >= " ") { value += char; process.stdout.write("*"); }
      }
    };
    stdin.on("data", onData);
  });
}

const deriveKey = (password, salt) => crypto.scryptSync(password.normalize("NFKC"), salt, 32, SCRYPT);

function open(file, password) {
  const data = fs.readFileSync(file);
  if (data.subarray(0, MAGIC.length).toString() !== MAGIC) throw new Error("El archivo no es un respaldo de firma de Qualitzer.");
  const salt = data.subarray(7, 39), iv = data.subarray(39, 51), tag = data.subarray(51, 67), body = data.subarray(67);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  decipher.setAuthTag(tag);
  try { return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")); }
  catch { throw new Error("Contraseña incorrecta o archivo dañado."); }
}

async function create(targetDir) {
  const present = sources.filter((relative) => fs.existsSync(path.join(root, relative)));
  if (!present.includes(sources[0]) || !present.includes(sources[1])) throw new Error("No se encontró la llave de firma de la app en este computador.");
  const files = present.map((relative) => {
    const bytes = fs.readFileSync(path.join(root, relative));
    return { path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64") };
  });
  console.log("Respaldo cifrado de las llaves de firma de Qualitzer operaciones.");
  console.log("Elige una contraseña larga (mínimo 14 caracteres). Guárdala en un lugar distinto al archivo.");
  console.log("Si la pierdes, el respaldo no se podrá abrir.\n");
  let password = "";
  for (;;) {
    password = await ask("Contraseña: ");
    if ([...password].length < 14) { console.log(`Tiene ${[...password].length} caracteres; usa al menos 14. Intenta de nuevo.\n`); continue; }
    if (await ask("Repite la contraseña: ") === password) break;
    console.log("Las contraseñas no coinciden. Intenta de nuevo.\n");
  }
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const payload = Buffer.from(JSON.stringify({ app: "com.qualitzer.field", createdAt: new Date().toISOString(), files }));
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  const output = path.join(targetDir, `qualitzer-firma-respaldo-${new Date().toISOString().slice(0, 10)}.qzkey`);
  fs.writeFileSync(output, Buffer.concat([Buffer.from(MAGIC), salt, iv, cipher.getAuthTag(), body]), { flag: "wx" });
  const check = open(output, password);
  if (check.files.length !== files.length) throw new Error("La verificación del respaldo falló.");
  console.log(`\nRespaldo creado y verificado: ${output}`);
  console.log(`Incluye: ${files.map((file) => path.basename(file.path)).join(", ")}`);
}

async function verify(file) {
  const content = open(file, await ask("Contraseña del respaldo: "));
  for (const entry of content.files) {
    const current = path.join(root, entry.path);
    const bytes = Buffer.from(entry.data, "base64");
    const okHash = crypto.createHash("sha256").update(bytes).digest("hex") === entry.sha256;
    const same = fs.existsSync(current) && crypto.createHash("sha256").update(fs.readFileSync(current)).digest("hex") === entry.sha256;
    console.log(`${okHash ? "✔" : "✖"} ${path.basename(entry.path)}${fs.existsSync(current) ? same ? " · igual al de este computador" : " · DISTINTO al de este computador" : ""}`);
  }
  console.log(`Respaldo del ${content.createdAt}: se abre correctamente.`);
}

async function restore(file) {
  const content = open(file, await ask("Contraseña del respaldo: "));
  for (const entry of content.files) {
    const target = path.join(root, entry.path);
    if (fs.existsSync(target)) { console.log(`· ${path.basename(entry.path)} ya existe; no se reemplaza.`); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(entry.data, "base64"), { flag: "wx", mode: 0o600 });
    console.log(`✔ restaurado ${entry.path}`);
  }
}

const args = process.argv.slice(2);
const job = args[0] === "--verificar" ? verify(args[1]) : args[0] === "--restaurar" ? restore(args[1]) : create(args[0] ?? path.join(os.homedir(), "Desktop"));
job.then(() => { if (process.env.QZ_PAUSE) { process.stdout.write("\nPresiona Enter para cerrar."); process.stdin.resume(); process.stdin.once("data", () => process.exit(0)); } })
  .catch((error) => { console.error(`\n✖ ${error.message}`); if (process.env.QZ_PAUSE) { process.stdout.write("Presiona Enter para cerrar."); process.stdin.resume(); process.stdin.once("data", () => process.exit(1)); } else process.exitCode = 1; });
