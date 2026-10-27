// Paquete para Google Play (AAB) de la versión actual de app.json, firmado con la llave de subida.
// Reutiliza el proyecto Android generado por la última compilación del APK de la misma versión (mismo servidor).
const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { expectedRelease } = require("./release-policy.cjs");
const { releaseEnvironment, resolveReleaseConfig } = require("./release-push.cjs");
const { saveReleaseMapping } = require("./release-mapping.cjs");

const root = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const toolRoot = args[args.indexOf("--tool-root") + 1];
if (!toolRoot) throw new Error("INVALID_BUILD_ARGUMENTS");
const expected = expectedRelease(root);
const environment = releaseEnvironment(process.env);
const javaHome = path.join(toolRoot, "jdk/jdk-17.0.20.1+1");
const uploadDir = path.join(root, ".data/play-upload");
const output = path.join(root, "artifacts/play");
const target = path.join(output, `qualitzer-operaciones-${expected.version}.aab`);

function run(executable, argumentsList, extra) {
  return new Promise((resolve, reject) => {
    const batch = executable.endsWith(".bat");
    const child = spawn(batch ? process.env.ComSpec ?? "cmd.exe" : executable,
      batch ? ["/d", "/s", "/c", `"${[executable, ...argumentsList].map((value) => `"${value}"`).join(" ")}"`] : argumentsList,
      { cwd: root, env: { ...environment, ...extra }, windowsHide: true, windowsVerbatimArguments: batch, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`EXIT_${code}`)));
  });
}

async function main() {
  if (fs.existsSync(target)) throw new Error(`Ya existe ${path.relative(root, target)}; sube la versión antes de generar otro paquete.`);
  const config = resolveReleaseConfig(root, environment);
  if (config.version !== expected.version || config.android?.versionCode !== expected.versionCode || config.android?.package !== "com.qualitzer.field") throw new Error("INVALID_RELEASE_CONFIG");
  const verification = JSON.parse(fs.readFileSync(path.join(root, `artifacts/release-verification-${expected.version}.json`), "utf8"));
  if (verification.gatewayUrl !== environment.EXPO_PUBLIC_GATEWAY_URL) throw new Error("El APK de esta versión se compiló para otro servidor; compila el APK primero.");
  const credentials = JSON.parse(fs.readFileSync(path.join(uploadDir, "credentials.json"), "utf8"));
  if (credentials.alias !== "qualitzer-upload" || !/^[a-f0-9]{96}$/.test(credentials.password)) throw new Error("INVALID_UPLOAD_CREDENTIALS");
  const signing = {
    QUALITZER_SIGNING_STORE_FILE: path.join(uploadDir, "qualitzer-play-upload.p12"),
    QUALITZER_SIGNING_STORE_PASSWORD: credentials.password,
    QUALITZER_SIGNING_KEY_PASSWORD: credentials.password,
    QUALITZER_SIGNING_KEY_ALIAS: "qualitzer-upload",
    JAVA_HOME: javaHome,
  };
  await run(path.join(toolRoot, "gradle/gradle-9.3.1/bin/gradle.bat"), [
    "-p", path.join(root, "android"), "--init-script", path.join(__dirname, "release-signing.gradle"),
    ":app:bundleRelease", "-PreactNativeArchitectures=arm64-v8a,armeabi-v7a", "--no-daemon", "--no-configuration-cache", "--console=plain", "--max-workers=4",
  ], signing);
  const bundle = path.join(root, "android/app/build/outputs/bundle/release/app-release.aab");
  const verify = execFileSync(path.join(javaHome, "bin/jarsigner.exe"), ["-verify", "-verbose", "-certs", bundle], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!verify.includes("jar verified") || !verify.includes("CN=Qualitzer Operaciones Upload")) throw new Error("AAB_UPLOAD_SIGNATURE_INVALID");
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(bundle, target, fs.constants.COPYFILE_EXCL);
  const sha256 = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  fs.writeFileSync(`${target}.sha256`, `${sha256}  ${path.basename(target)}\n`);
  const { mapping } = saveReleaseMapping(root, target.replace(/\.aab$/, "-mapping.txt"));
  console.log(`PLAY_BUNDLE ${path.relative(root, target)}\nVERSION ${expected.version} CODE ${expected.versionCode}\nSERVER ${environment.EXPO_PUBLIC_GATEWAY_URL}\nSHA256 ${sha256}\nMAPPING ${mapping}`);
}

main().catch((error) => { console.error(`PLAY_BUNDLE_FAILED ${error.message}`); process.exitCode = 1; });
