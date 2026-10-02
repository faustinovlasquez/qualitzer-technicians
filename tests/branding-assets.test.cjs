const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtemp, readFile, rm, readdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const { generateBrand, SOURCE_SHA256 } = require("../scripts/generate-qualitzer-brand.cjs");

const assets = path.resolve(__dirname, "../assets");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("bundled source is byte-identical to the approved mobile logo", async () => {
  const bytes = await readFile(path.join(assets, "qualitzer-source.png"));
  assert.equal(hash(bytes), SOURCE_SHA256);
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 1254);
  assert.equal(meta.height, 1254);
});

test("all four assets regenerate deterministically without touching original assets", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "qualitzer-brand-assets-"));
  try {
    await writeFile(path.join(output, "original.png"), "keep");
    const report = await generateBrand({ output });
    for (const asset of report.assets) {
      const generated = await readFile(path.join(output, asset.file));
      assert.equal(hash(generated), asset.sha256);
      assert.deepEqual(generated, await readFile(path.join(assets, asset.file)));
      const metadata = await sharp(generated).metadata();
      assert.equal(metadata.width, asset.width);
      assert.equal(metadata.height, asset.height);
      assert.equal(metadata.format, "png");
    }
    assert.equal(await readFile(path.join(output, "original.png"), "utf8"), "keep");
    assert.equal((await readdir(output)).length, 6);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("launcher images are opaque on a pure white background, also on Android's adaptive layer", async () => {
  for (const file of ["qualitzer-icon.png", "qualitzer-adaptive.png"]) {
    const image = sharp(await readFile(path.join(assets, file)));
    assert.equal((await image.metadata()).hasAlpha, false);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    for (let row = 0; row < info.height; row++) {
      for (let column = 0; column < info.width; column++) {
        if (row !== 0 && row !== info.height - 1 && column !== 0 && column !== info.width - 1) continue;
        const offset = (row * info.width + column) * info.channels;
        assert.deepEqual([data[offset], data[offset + 1], data[offset + 2]], [255, 255, 255], `${file} perimeter is pure white`);
      }
    }
  }
  const config = JSON.parse(await readFile(path.resolve(assets, "../app.json"), "utf8"));
  assert.equal(config.expo.android.adaptiveIcon.backgroundColor, "#FFFFFF");
});

test("the Q and its complete wrench badge stay within Android's guaranteed circle", async () => {
  const { data, info } = await sharp(await readFile(path.join(assets, "qualitzer-adaptive.png"))).raw().toBuffer({ resolveWithObject: true });
  const radius = info.width * 33 / 108;
  let farthest = 0; let minX = info.width; let maxX = 0;
  for (let row = 0; row < info.height; row++) {
    for (let column = 0; column < info.width; column++) {
      const offset = (row * info.width + column) * info.channels;
      if (Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 232) continue;
      farthest = Math.max(farthest, Math.hypot(column - info.width / 2, row - info.height / 2));
      minX = Math.min(minX, column); maxX = Math.max(maxX, column);
    }
  }
  assert.ok(farthest < radius, `artwork reaches ${farthest.toFixed(1)}px, beyond the ${radius.toFixed(1)}px safe circle`);
  assert.ok(maxX - minX > 500, "the subject keeps a visible size inside the adaptive icon");
});

test("unapproved artwork fails before any generated output is replaced", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "qualitzer-brand-rejected-"));
  try {
    const source = path.join(output, "wrong.png");
    await writeFile(source, "unapproved");
    await assert.rejects(generateBrand({ source, output }), /QUALITZER_SOURCE_SHA256_MISMATCH/);
    assert.deepEqual(await readdir(output), ["wrong.png"]);
  } finally { await rm(output, { recursive: true, force: true }); }
});