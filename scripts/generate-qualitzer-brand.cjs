const { createHash } = require("node:crypto");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const SOURCE_SHA256 = "c5e47a2c49a8fb40d4f57500a2c9ad7aff077cf9d3b7624d19972596d6a1f309";
const sourceAsset = "qualitzer-source.png";
const assets = [
  { file: "qualitzer-icon.png", size: 1024, mark: 800, opaque: true },
  { file: "qualitzer-adaptive.png", size: 1024, mark: 560, opaque: false },
  { file: "qualitzer-logo.png", size: 512, mark: 480, opaque: false },
  { file: "qualitzer-favicon.png", size: 64, mark: 60, opaque: false },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function generateBrand({ source = path.join(root, "assets", sourceAsset), output = path.join(root, "assets") } = {}) {
  const original = await readFile(source);
  if (sha256(original) !== SOURCE_SHA256) throw new Error("QUALITZER_SOURCE_SHA256_MISMATCH");
  const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const mark = await sharp(original).extract(crop).png().toBuffer();
  const generated = [];
  for (const asset of assets) {
    const resized = await sharp(mark).resize(asset.mark, asset.mark, { fit: "inside" }).png().toBuffer();
    let image = sharp({ create: { width: asset.size, height: asset.size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: asset.opaque ? 1 : 0 } } })
      .composite([{ input: resized, gravity: "centre" }]);
    if (asset.opaque) image = image.removeAlpha();
    generated.push({ ...asset, bytes: await image.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer() });
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, sourceAsset), original);
  for (const asset of generated) await writeFile(path.join(output, asset.file), asset.bytes);
  return {
    source: path.resolve(source), sourceSha256: SOURCE_SHA256, crop, sharp: sharp.versions.sharp,
    assets: [{ file: sourceAsset, width: info.width, height: info.height, sha256: SOURCE_SHA256 },
      ...generated.map(({ file, size, bytes }) => ({ file, width: size, height: size, sha256: sha256(bytes) }))],
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--source")) {
    process.stderr.write("Usage: node scripts/generate-qualitzer-brand.cjs [--source <original-public-icon-512x512.png>]\n");
    process.exitCode = 1;
  } else {
    generateBrand(args.length ? { source: path.resolve(args[1]) } : {}).then(
      (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
      (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
    );
  }
}

module.exports = { generateBrand, SOURCE_SHA256 };