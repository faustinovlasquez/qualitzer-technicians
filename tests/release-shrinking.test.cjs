const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { applyRules, RULES } = require("../plugins/withReleaseShrinking.js");
const { saveReleaseMapping } = require("../scripts/android/release-mapping.cjs");

const root = path.resolve(__dirname, "..");

test("la compilación release activa la ofuscación", () => {
  const plugins = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo.plugins;
  assert.ok(plugins.includes("./plugins/withReleaseShrinking.js"));
});

test("las reglas de ofuscación se agregan una sola vez", () => {
  const once = applyRules("# reglas de la plantilla\n");
  assert.equal(applyRules(once), once);
  assert.ok(once.startsWith("# reglas de la plantilla"));
  for (const rule of RULES) assert.equal(once.split(rule).length, 2);
});

test("sin archivo de desofuscación la compilación falla", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qz-mapping-"));
  try {
    assert.throws(() => saveReleaseMapping(temporary, path.join(temporary, "out.txt")), /RELEASE_OBFUSCATION_MAPPING_MISSING/);
    const source = path.join(temporary, "android/app/build/outputs/mapping/release");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "mapping.txt"), "a -> b:\n");
    const saved = saveReleaseMapping(temporary, path.join(temporary, "artifacts/x-mapping.txt"));
    assert.equal(saved.mappingBytes, 8);
    assert.match(saved.mappingSha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
