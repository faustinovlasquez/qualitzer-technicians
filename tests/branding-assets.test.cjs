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

test("launcher images are opaque with blue artwork reaching every edge", async () => {
  for (const file of ["qualitzer-icon.png", "qualitzer-adaptive.png"]) {
    const image = sharp(await readFile(path.join(assets, file)));
    assert.equal((await image.metadata()).hasAlpha, false);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    for (let row = 0; row < info.height; row++) {
      for (let column = 0; column < info.width; column++) {
        if (row !== 0 && row !== info.height - 1 && column !== 0 && column !== info.width - 1) continue;
        const offset = (row * info.width + column) * info.channels;
        assert.ok(data[offset + 2] - data[offset] > 20, `${file} has blue, not white, on its perimeter`);
      }
    }
  }
  const config = JSON.parse(await readFile(path.resolve(assets, "../app.json"), "utf8"));
  assert.equal(config.expo.android.adaptiveIcon.backgroundColor, "#7DBDF8");
});

test("enlarged Q and complete wrench badge remain within Android's guaranteed circle", async () => {
  const crop = { left: 160, top: 170, width: 960, height: 884 };
  const resized = await sharp(await readFile(path.join(assets, "qualitzer-source.png"))).extract(crop).resize(544, 544, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const horizontalOffset = Math.floor((1024 - resized.info.width) / 2);
  const verticalOffset = Math.floor((1024 - resized.info.height) / 2);
  const actual = await sharp(await readFile(path.join(assets, "qualitzer-adaptive.png"))).extract({ left: horizontalOffset, top: verticalOffset, width: resized.info.width, height: resized.info.height }).raw().toBuffer();
  assert.deepEqual(actual, resized.data, "original artwork is resized without redrawing or removing the badge");
  const scale = resized.info.width / crop.width;
  const radius = 1024 * 33 / 108;
  const outline = [[218, 589], [437, 255], [838, 255], [1001, 589], [810, 917], [390, 917]];
  for (const [column, row] of outline) {
    assert.ok(Math.hypot(horizontalOffset + (column - crop.left) * scale - 512, verticalOffset + (row - crop.top) * scale - 512) < radius);
  }
  const badgeDistance = Math.hypot(horizontalOffset + (945 - crop.left) * scale - 512, verticalOffset + (843 - crop.top) * scale - 512);
  assert.ok(badgeDistance + 166 * scale < radius, "the full circular wrench badge survives the smallest mask");
  assert.ok(890 * scale > 500, "the subject is substantially larger than the previous 312px artwork");
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