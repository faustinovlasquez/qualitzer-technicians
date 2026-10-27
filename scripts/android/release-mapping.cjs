// Archivo de desofuscación (mapping.txt) de la última compilación release: sin él los errores de la app ofuscada no se pueden leer.
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function saveReleaseMapping(root, destination) {
  const source = path.join(root, "android/app/build/outputs/mapping/release/mapping.txt");
  if (!fs.existsSync(source) || fs.statSync(source).size === 0) throw new Error("RELEASE_OBFUSCATION_MAPPING_MISSING");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  const bytes = fs.readFileSync(destination);
  return { mapping: path.relative(root, destination), mappingSha256: createHash("sha256").update(bytes).digest("hex"), mappingBytes: bytes.length };
}

module.exports = { saveReleaseMapping };
