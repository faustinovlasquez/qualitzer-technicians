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

test("bundled source is byte-identical to the approved frontend logo", async () => {
  const bytes = await readFile(path.join(assets, "qualitzer-source.png"));
  assert.equal(hash(bytes), SOURCE_SHA256);
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
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

test("legacy icon is opaque white and adaptive artwork fits the circular Android safe zone", async () => {
  const icon = sharp(await readFile(path.join(assets, "qualitzer-icon.png")));
  assert.equal((await icon.metadata()).hasAlpha, false);
  const legacy = await icon.raw().toBuffer();
  assert.deepEqual([...legacy.subarray(0, 3)], [255, 255, 255]);
  const { data, info } = await sharp(await readFile(path.join(assets, "qualitzer-adaptive.png"))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0);
  let visible = 0;
  const radius = info.width * 33 / 108;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (!data[(y * info.width + x) * 4 + 3]) continue;
      visible++;
      assert.ok(Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) <= radius, "every visible pixel survives Android's guaranteed circle");
    }
  }
  assert.ok(visible > 50000, "not an empty or tiny placeholder");
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