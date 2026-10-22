const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtemp, readFile, rm, readdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const { generateBrand, SOURCE_SHA256, BACKGROUND_HEX } = require("../scripts/generate-qualitzer-brand.cjs");

const assets = path.resolve(__dirname, "../assets");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isBlue = (data, offset) => data[offset + 2] - data[offset] > 40;

test("bundled source is byte-identical to the approved official logo", async () => {
  const bytes = await readFile(path.join(assets, "qualitzer-original.png"));
  assert.equal(hash(bytes), SOURCE_SHA256);
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
});

test("all six assets regenerate deterministically without touching original assets", async () => {
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
    assert.equal((await readdir(output)).length, 8);
    assert.equal(report.assets.length, 6);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("launcher images are opaque with the light background to the edge, matching Android's adaptive background", async () => {
  for (const file of ["qualitzer-icon.png", "qualitzer-adaptive.png"]) {
    const image = sharp(await readFile(path.join(assets, file)));
    assert.equal((await image.metadata()).hasAlpha, false);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    for (let row = 0; row < info.height; row++) {
      for (let column = 0; column < info.width; column++) {
        if (row !== 0 && row !== info.height - 1 && column !== 0 && column !== info.width - 1) continue;
        const offset = (row * info.width + column) * info.channels;
        assert.ok(Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 230 && !isBlue(data, offset), `${file} perimeter is the light background`);
      }
    }
  }
  const config = JSON.parse(await readFile(path.resolve(assets, "../app.json"), "utf8"));
  assert.equal(config.expo.android.adaptiveIcon.backgroundColor, BACKGROUND_HEX);
});

test("the drawing is centered with margin and stays within Android's guaranteed circle", async () => {
  for (const [file, maxShare] of [["qualitzer-icon.png", 0.7], ["qualitzer-adaptive.png", 0.62]]) {
    const { data, info } = await sharp(await readFile(path.join(assets, file))).raw().toBuffer({ resolveWithObject: true });
    let minX = info.width; let maxX = 0; let minY = info.height; let maxY = 0; let farthest = 0;
    for (let row = 0; row < info.height; row++) for (let column = 0; column < info.width; column++) {
      if (!isBlue(data, (row * info.width + column) * info.channels)) continue;
      minX = Math.min(minX, column); maxX = Math.max(maxX, column); minY = Math.min(minY, row); maxY = Math.max(maxY, row);
      farthest = Math.max(farthest, Math.hypot(column - info.width / 2, row - info.height / 2));
    }
    assert.ok(Math.abs((minX + maxX) / 2 - info.width / 2) < 12 && Math.abs((minY + maxY) / 2 - info.height / 2) < 12, `${file} is centered`);
    assert.ok((maxX - minX) / info.width <= maxShare, `${file} keeps a margin`);
    if (file === "qualitzer-adaptive.png") {
      assert.ok(farthest < info.width * 33 / 108, "inside the safe circle");
      assert.ok(maxX - minX > 380, "the drawing keeps a visible size");
    }
  }
});

test("logo and favicon keep transparent rounded corners; the notification icon is a white silhouette", async () => {
  for (const file of ["qualitzer-source.png", "qualitzer-logo.png", "qualitzer-favicon.png"]) {
    const { data, info } = await sharp(await readFile(path.join(assets, file))).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    assert.equal(data[3], 0, `${file} corner is transparent`);
    const side = ((info.height >> 1) * info.width + 2) * 4;
    assert.equal(data[side + 3], 255, `${file} side is opaque`);
  }
  const { data } = await sharp(await readFile(path.join(assets, "notification-icon.png"))).raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    visible++;
    assert.deepEqual([data[offset], data[offset + 1], data[offset + 2]], [255, 255, 255]);
  }
  assert.ok(visible > 1500 && visible < 96 * 96 * 0.7, "silhouette, not a filled square");
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
