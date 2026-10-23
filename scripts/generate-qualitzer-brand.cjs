const { createHash } = require("node:crypto");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
// Logo oficial aprobado el 2026-10-23: Q hexagonal blanca y azul con la cinta naranja de la llave, sobre un fondo azul
// en degradado de izquierda a derecha que llega hasta los bordes. Se usa la imagen tal cual.
const SOURCE_SHA256 = "5b99c1c6f1e7ae8c891820eb8dcbe18d91b45b2b55500b7cb7ea70179b71787a";
const SOURCE_SIZE = 1107;
const sourceAsset = "qualitzer-original.png";
// Color del centro del degradado (fondo del ícono adaptativo de Android, que queda tapado por la imagen).
const BACKGROUND_HEX = "#3270CF";
const ACCENT_HEX = "#353EE1";
const CORNER = 0.22; // esquinas del cuadrado redondeado (logo y favicon)
// El hexágono blanco debe quedar dentro del círculo seguro del ícono adaptativo (radio 33/108), con un poco de aire.
const SAFE_SHARE = 33 / 108 * 0.94;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
const png = (image) => image.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
const svg = (body, size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`);
const isWhite = (data, offset) => Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 225;

/** Distancia del punto blanco (hexágono) más lejano al centro, como parte del ancho de la imagen. */
async function farthestWhite(original) {
  const { data, info } = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let farthest = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (isWhite(data, (y * info.width + x) * 3)) farthest = Math.max(farthest, Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2));
  }
  return farthest / info.width;
}

/** Imagen completa en un cuadrado redondeado con esquinas transparentes (logo, favicon y versión para documentos). */
async function rounded(original, size) {
  const body = await sharp(original).resize(size, size).removeAlpha().raw().toBuffer();
  const mask = await sharp(svg(`<rect width="${size}" height="${size}" rx="${size * CORNER}" ry="${size * CORNER}" fill="#fff"/>`, size)).extractChannel(0).raw().toBuffer();
  return png(sharp(body, { raw: { width: size, height: size, channels: 3 } }).joinChannel(mask, { raw: { width: size, height: size, channels: 1 } }));
}

async function generateBrand({ source = path.join(root, "assets", sourceAsset), output = path.join(root, "assets") } = {}) {
  const original = await readFile(source);
  if (sha256(original) !== SOURCE_SHA256) throw new Error("QUALITZER_SOURCE_SHA256_MISMATCH");
  const meta = await sharp(original).metadata();
  if (meta.width !== SOURCE_SIZE || meta.height !== SOURCE_SIZE) throw new Error("QUALITZER_SOURCE_SIZE_MISMATCH");

  // Ícono (iOS y Android antiguos ponen sus esquinas): la imagen completa de borde a borde.
  const icon = await png(sharp(original).resize(1024, 1024).removeAlpha());
  // Adaptativo Android: la imagen achicada hasta que el hexágono quepa en el círculo seguro y alargada hacia los bordes
  // repitiendo su orilla. Como el degradado es solo horizontal no se nota la unión, y la cinta sigue hasta el borde de arriba.
  const span = Math.floor(1024 * SAFE_SHARE / await farthestWhite(original));
  const pad = 1024 - span;
  const adaptive = await png(sharp(await sharp(original).resize(span, span).removeAlpha().png().toBuffer())
    .extend({ left: Math.floor(pad / 2), right: Math.ceil(pad / 2), top: Math.floor(pad / 2), bottom: Math.ceil(pad / 2), extendWith: "copy" }));
  // Notificaciones Android: la silueta blanca (hexágonos y llave) sobre transparente, 80 px dentro de 96 px.
  const { data, info } = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(info.width * info.height);
  for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = isWhite(data, pixel * 3) ? 255 : 0;
  const mark = await sharp(Buffer.alloc(info.width * info.height * 3, 255), { raw: { width: info.width, height: info.height, channels: 3 } })
    .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
  const small = await sharp(mark).resize(80, 80, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  const extended = await sharp(small.data).extend({
    left: Math.floor((96 - small.info.width) / 2), right: Math.ceil((96 - small.info.width) / 2),
    top: Math.floor((96 - small.info.height) / 2), bottom: Math.ceil((96 - small.info.height) / 2), background: { r: 255, g: 255, b: 255, alpha: 0 }
  }).raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < extended.data.length; offset += 4) extended.data.fill(255, offset, offset + 3);
  const notification = await png(sharp(extended.data, { raw: extended.info }));

  const generated = [
    { file: "qualitzer-icon.png", size: 1024, bytes: icon },
    { file: "qualitzer-adaptive.png", size: 1024, bytes: adaptive },
    // Logo oficial completo (cuadrado redondeado, esquinas transparentes), para documentos y la web.
    { file: "qualitzer-source.png", size: 1024, bytes: await rounded(original, 1024) },
    { file: "qualitzer-logo.png", size: 512, bytes: await rounded(original, 512) },
    { file: "qualitzer-favicon.png", size: 64, bytes: await rounded(original, 64) },
    { file: "notification-icon.png", size: 96, bytes: notification }
  ];
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, sourceAsset), original);
  for (const asset of generated) await writeFile(path.join(output, asset.file), asset.bytes);
  return {
    source: path.resolve(source), sourceSha256: SOURCE_SHA256, background: BACKGROUND_HEX, sharp: sharp.versions.sharp,
    assets: generated.map(({ file, size, bytes }) => ({ file, width: size, height: size, sha256: sha256(bytes) })),
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--source")) {
    process.stderr.write("Usage: node scripts/generate-qualitzer-brand.cjs [--source <approved-logo.png>]\n");
    process.exitCode = 1;
  } else {
    generateBrand(args.length ? { source: path.resolve(args[1]) } : {}).then(
      (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
      (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
    );
  }
}

module.exports = { generateBrand, SOURCE_SHA256, SOURCE_SIZE, BACKGROUND_HEX, ACCENT_HEX };
