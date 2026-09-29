const { createHash } = require("node:crypto");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const SOURCE_SHA256 = "97f2a2a50a7e18f7b35b7df9e4b687b52883776ab4ef405a7c23f5897a267746";
const sourceAsset = "qualitzer-source.png";
const assets = [
  { file: "qualitzer-icon.png", size: 1024, mark: 816 },
  { file: "qualitzer-adaptive.png", size: 1024, mark: 544 },
  { file: "qualitzer-logo.png", size: 512, mark: 408 },
  { file: "qualitzer-favicon.png", size: 64, mark: 51 },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function generateBrand({ source = path.join(root, "assets", sourceAsset), output = path.join(root, "assets") } = {}) {
  const original = await readFile(source);
  if (sha256(original) !== SOURCE_SHA256) throw new Error("QUALITZER_SOURCE_SHA256_MISMATCH");
  const info = await sharp(original).metadata();
  const crop = { left: 160, top: 170, width: 960, height: 884 };
  const mark = await sharp(original).extract(crop).png().toBuffer();
  const generated = [];
  for (const asset of assets) {
    const resized = await sharp(mark).resize(asset.mark, asset.mark, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    const horizontalSpace = asset.size - resized.info.width;
    const verticalSpace = asset.size - resized.info.height;
    const image = sharp(resized.data).extend({
      left: Math.floor(horizontalSpace / 2), right: Math.ceil(horizontalSpace / 2),
      top: Math.floor(verticalSpace / 2), bottom: Math.ceil(verticalSpace / 2),
      extendWith: "copy",
    }).removeAlpha();
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
    process.stderr.write("Usage: node scripts/generate-qualitzer-brand.cjs [--source <approved-logo.png>]\n");
    process.exitCode = 1;
  } else {
    generateBrand(args.length ? { source: path.resolve(args[1]) } : {}).then(
      (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
      (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
    );
  }
}

module.exports = { generateBrand, SOURCE_SHA256 };