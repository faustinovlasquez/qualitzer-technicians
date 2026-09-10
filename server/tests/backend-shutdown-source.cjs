const fs = require("node:fs");
const path = require("node:path");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");

const backend = path.resolve(__dirname, "../../../Qualitzer2.0-Backend");

function loadShutdown() {
  const filename = path.join(backend, "src/mobileGateway/infrastructure/MobileGateway.shutdown.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, process, setTimeout, clearTimeout }, { filename });
  return module.exports.registerMobileGatewayShutdown;
}

module.exports = { backend, loadShutdown };