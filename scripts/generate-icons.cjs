const sharp = require("sharp");
const { resolve } = require("node:path");
const root = resolve(__dirname, "..");
async function generate() {
  const svg = resolve(root, "assets/qualitzer-field.svg");
  await sharp(svg).resize(1024, 1024).png().toFile(resolve(root, "assets/field-icon.png"));
  await sharp(svg).resize(192, 192).png().toFile(resolve(root, "assets/field-favicon.png"));
  await sharp(svg).resize(620, 620).extend({ top: 202, bottom: 202, left: 202, right: 202, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(resolve(root, "assets/field-adaptive.png"));
  console.log("Iconos Qualitzer Field generados.");
}
generate().catch((error) => { console.error(error.message); process.exitCode = 1; });