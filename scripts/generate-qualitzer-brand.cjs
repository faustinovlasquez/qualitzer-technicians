const { createHash } = require("node:crypto");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
// Logo oficial aprobado el 2026-10-22: Q hexagonal con degradado azul y el técnico con casco, sobre fondo claro.
// Se usa el dibujo tal cual (con sus degradados y sombras), centrado y con margen para que no quede pegado a los bordes.
const SOURCE_SHA256 = "263aee3da71a46cb9baae48883338dbf6c619c061a9144d0730d40004447b915";
const SOURCE_SIZE = 1024;
const sourceAsset = "qualitzer-original.png";
// Caja del dibujo en la imagen aprobada (Q y técnico), ajustada para no tomar el borde ni la sombra del cuadrado original.
const ART = { left: 99, top: 166, width: 792, height: 702 };
// Fondo claro de la imagen, de arriba hacia abajo.
const BACKGROUND = { top: "#F1F4F9", bottom: "#ECEFF4" };
const BACKGROUND_HEX = "#F1F4F9";
const ACCENT_HEX = "#353EE1";
const MARGIN = 0.66; // ancho del dibujo respecto del ícono
const CORNER = 0.22; // esquinas del cuadrado redondeado (logo y favicon)

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
const png = (image) => image.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
const svg = (body, size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`);
const backdrop = (size) => sharp(svg(`<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BACKGROUND.top}"/><stop offset="1" stop-color="${BACKGROUND.bottom}"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#b)"/>`, size)).removeAlpha();

/**
 * Dibujo recortado y separado de su fondo claro: cada píxel queda tan opaco como se aleja del fondo (por color azul o por
 * ser más oscuro, como el panel gris del centro). Así se apoya sobre cualquier fondo sin que se note un rectángulo.
 */
async function artwork(original) {
  const { width, height } = ART;
  const { data } = await sharp(original).extract({ left: ART.left, top: ART.top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(width * height * 4);
  const blueOf = (pixel) => (data[pixel * 3 + 2] - data[pixel * 3] - 10) / 30;
  // Lo gris que toca el borde del recorte es fondo o sombra del cuadrado original (no el panel del centro, que rodea el anillo azul).
  const outside = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x++) queue.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) queue.push(y * width, y * width + width - 1);
  while (queue.length > 0) {
    const pixel = queue.pop();
    if (outside[pixel] || blueOf(pixel) >= 0.5) continue;
    outside[pixel] = 1;
    const x = pixel % width;
    if (x > 0) queue.push(pixel - 1);
    if (x < width - 1) queue.push(pixel + 1);
    if (pixel >= width) queue.push(pixel - width);
    if (pixel < (height - 1) * width) queue.push(pixel + width);
  }
  for (let pixel = 0; pixel < width * height; pixel++) {
    const [r, g, b] = [data[pixel * 3], data[pixel * 3 + 1], data[pixel * 3 + 2]];
    const dark = outside[pixel] ? 0 : (236 - (r + g + b) / 3) / 22;
    const alpha = Math.max(0, Math.min(1, Math.max(blueOf(pixel), dark)));
    out[pixel * 4] = r; out[pixel * 4 + 1] = g; out[pixel * 4 + 2] = b; out[pixel * 4 + 3] = Math.round(alpha * 255);
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Silueta del dibujo (opacidad según cuán azul es cada píxel): para notificaciones y para medir la zona segura. */
async function silhouette(art) {
  const { data, info } = await sharp(art).raw().toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(info.width * info.height);
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    const o = pixel * 4;
    alpha[pixel] = Math.round(Math.max(0, Math.min(1, (data[o + 2] - data[o] - 25) / 55)) * (data[o + 3] / 255) * 255);
  }
  return { alpha, width: info.width, height: info.height };
}

/** Distancia del punto azul más lejano al centro de la caja, por cada píxel de ancho. */
function farthestRatio(shape) {
  let farthest = 0;
  for (let y = 0; y < shape.height; y++) for (let x = 0; x < shape.width; x++) {
    if (shape.alpha[y * shape.width + x] > 60) farthest = Math.max(farthest, Math.hypot(x + 0.5 - shape.width / 2, y + 0.5 - shape.height / 2));
  }
  return farthest / shape.width;
}

/** Dibujo de `span` px de ancho, centrado sobre el fondo claro de `size` px. */
async function onBackground(art, size, span) {
  const resized = await sharp(art).resize({ width: span }).png().toBuffer();
  return png(sharp(await png(backdrop(size))).composite([{ input: resized, gravity: "center" }]).removeAlpha());
}

async function rounded(art, size) {
  const body = await sharp(await onBackground(art, size, Math.round(size * MARGIN))).raw().toBuffer();
  const mask = await sharp(svg(`<rect width="${size}" height="${size}" rx="${size * CORNER}" ry="${size * CORNER}" fill="#fff"/>`, size)).extractChannel(0).raw().toBuffer();
  return png(sharp(body, { raw: { width: size, height: size, channels: 3 } }).joinChannel(mask, { raw: { width: size, height: size, channels: 1 } }));
}

async function generateBrand({ source = path.join(root, "assets", sourceAsset), output = path.join(root, "assets") } = {}) {
  const original = await readFile(source);
  if (sha256(original) !== SOURCE_SHA256) throw new Error("QUALITZER_SOURCE_SHA256_MISMATCH");
  const meta = await sharp(original).metadata();
  if (meta.width !== SOURCE_SIZE || meta.height !== SOURCE_SIZE) throw new Error("QUALITZER_SOURCE_SIZE_MISMATCH");
  const art = await artwork(original);
  const shape = await silhouette(art);

  // Ícono (iOS y Android antiguos ponen sus esquinas): dibujo centrado al 66 % del ancho.
  const icon = await onBackground(art, 1024, Math.round(1024 * MARGIN));
  // Adaptativo Android: el dibujo entero dentro del círculo seguro 66/108, lo más grande posible.
  const adaptive = await onBackground(art, 1024, Math.floor(1024 * 33 / 108 * 0.94 / farthestRatio(shape)));
  // Notificaciones Android: solo la silueta en blanco sobre transparente, 80 px dentro de 96 px.
  const mark = await sharp(Buffer.alloc(shape.width * shape.height * 3, 255), { raw: { width: shape.width, height: shape.height, channels: 3 } })
    .joinChannel(shape.alpha, { raw: { width: shape.width, height: shape.height, channels: 1 } }).png().toBuffer();
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
    { file: "qualitzer-source.png", size: 1024, bytes: await rounded(art, 1024) },
    { file: "qualitzer-logo.png", size: 512, bytes: await rounded(art, 512) },
    { file: "qualitzer-favicon.png", size: 64, bytes: await rounded(art, 64) },
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

module.exports = { generateBrand, SOURCE_SHA256, BACKGROUND_HEX, ACCENT_HEX };
