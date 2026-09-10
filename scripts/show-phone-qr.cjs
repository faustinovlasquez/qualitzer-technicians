const QRCode = require("qrcode");
const { mkdir } = require("node:fs/promises");
const { resolve } = require("node:path");

async function main() {
  const address = process.argv[2];
  if (!address) throw new Error("Indica la dirección exp:// que muestra el arranque de Expo.");
  const url = new URL(address);
  if (url.protocol !== "exp:" || url.username || url.password || url.search || url.hash) throw new Error("La dirección debe ser un enlace de Expo Go sin credenciales.");
  const directory = resolve(__dirname, "../.expo");
  const imagePath = resolve(directory, "phone-qr.png");
  await mkdir(directory, { recursive: true });
  await QRCode.toFile(imagePath, url.href, { type: "png", width: 520, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  console.log(`Abre Expo Go en tu teléfono y escanea el QR: ${imagePath}`);
  console.log(`Enlace nativo: ${url.href}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });