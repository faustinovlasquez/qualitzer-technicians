const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const root = path.resolve(__dirname, "..");
  const { data, info } = await sharp(path.join(root, "assets/qualitzer-logo.png")).resize(80, 80, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255;
  }
  const output = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extend({ top: 8, bottom: 96 - info.height - 8, left: 8, right: 96 - info.width - 8, background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  const destination = path.join(root, "assets/notification-icon.png");
  if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(output)) throw new Error("EXISTING_NOTIFICATION_ICON_DIFFERS");
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, output, { flag: "wx" });
  console.log("NOTIFICATION_ICON_96PX_WHITE_ALPHA_READY");
}
main().catch(() => { console.error("NOTIFICATION_ICON_GENERATION_FAILED"); process.exitCode = 1; });