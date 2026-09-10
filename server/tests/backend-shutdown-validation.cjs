const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { backend } = require("./backend-shutdown-source.cjs");

const report = { testsExit: null, diagnostics: [], installedIntegrity: false };
const reportFile = path.join(os.tmpdir(), "qualitzer-backend-shutdown-validation.json");
try {
  const result = spawnSync(process.execPath, ["--test", path.join(__dirname, "backend-shutdown.test.cjs")], { encoding: "utf8", timeout: 180000, windowsHide: true });
  report.testsExit = result.status;
  report.testsOutput = result.stdout.split(/\r?\n/);
  report.testsErrors = result.stderr;
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const ts = require(path.join(backend, "node_modules/typescript"));
  const configFile = path.join(backend, "tsconfig.json");
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, backend);
  const files = ["domain/interfaces/IMobileGatewayShutdown.ts", "infrastructure/MobileGateway.shutdown.ts"].map((file) => path.join(backend, "src/mobileGateway", file));
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true, incremental: false });
  report.diagnostics = ts.getPreEmitDiagnostics(program).map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
  assert.deepEqual(report.diagnostics, []);

  const manifest = JSON.parse(fs.readFileSync(path.join(backend, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(backend, "package-lock.json"), "utf8"));
  const installedDirectory = path.join(backend, "node_modules/@qualitzer/mobile-gateway");
  const installed = JSON.parse(fs.readFileSync(path.join(installedDirectory, "package.json"), "utf8"));
  const dependency = manifest.dependencies["@qualitzer/mobile-gateway"];
  const entry = lock.packages["node_modules/@qualitzer/mobile-gateway"];
  const archive = fs.readFileSync(path.join(backend, dependency.slice(5)));
  assert.equal(lock.packages[""].dependencies["@qualitzer/mobile-gateway"], dependency);
  assert.equal(entry.resolved, dependency);
  assert.equal(entry.integrity, `sha512-${createHash("sha512").update(archive).digest("base64")}`);
  assert.equal(entry.version, installed.version);
  const source = JSON.parse(fs.readFileSync(path.join(installedDirectory, "SOURCE-MANIFEST.json"), "utf8"));
  assert.equal(source.bundleSha256, createHash("sha256").update(fs.readFileSync(path.join(installedDirectory, "index.cjs"))).digest("hex"));
  report.installedIntegrity = true;
  report.packageVersion = installed.version;
  report.tarballSha256 = createHash("sha256").update(archive).digest("hex");
  const mobile = path.resolve(__dirname, "../..");
  const apk = path.join(mobile, "artifacts/qualitzer-field-1.0.0-android.apk");
  report.apkSha256 = createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
  assert.equal(report.apkSha256, fs.readFileSync(`${apk}.sha256`, "utf8").trim().split(/\s+/)[0]);
  report.apkChecksumMatch = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ reportFile, testsExit: report.testsExit, diagnostics: report.diagnostics, installedIntegrity: report.installedIntegrity, apkChecksumMatch: report.apkChecksumMatch, exit: process.exitCode ?? 0 }) + "\n");
}