const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qzm-embedded-validation-"));
process.stdout.write(`VALIDATION_REPORT_DIRECTORY=${directory}\n`);
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(__dirname, "embedded-runtime.test.cjs")], { encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(directory, "tests.tap"), result.stdout ?? "");
fs.writeFileSync(path.join(directory, "stderr.txt"), result.stderr ?? "");
const summary = {
  node: process.version, status: result.status, signal: result.signal, error: result.error?.message,
  totals: (result.stdout ?? "").split(/\r?\n/).filter((line) => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(line)),
  directory,
};
const root = path.resolve(__dirname, "../..");
const standaloneNode = path.join(root, process.platform === "win32" ? "node_modules/node/bin/node.exe" : "node_modules/node/bin/node");
const regression = spawnSync(standaloneNode, [
  path.join(root, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", path.join(root, "server/tsconfig.json"),
  "--test", "--test-reporter=tap", ...["config", "session-persistence", "backend-directory", "web-session", "development", "gateway"].map((name) => path.join(__dirname, `${name}.test.ts`)),
], { cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(directory, "standalone-regression.tap"), regression.stdout ?? "");
fs.writeFileSync(path.join(directory, "standalone-stderr.txt"), regression.stderr ?? "");
summary.regression = { node: spawnSync(standaloneNode, ["--version"], { encoding: "utf8" }).stdout.trim(), status: regression.status, error: regression.error?.message, totals: (regression.stdout ?? "").split(/\r?\n/).filter((line) => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(line)) };
const ts = require(path.join(root, "node_modules/typescript"));
const configFile = path.join(root, "server/tsconfig.json");
const config = ts.readConfigFile(configFile, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile));
const program = ts.createProgram(["embedded.ts", "app.ts", "config.ts", "session-persistence.ts"].map((file) => path.join(root, "server", file)), { ...parsed.options, typeRoots: [path.join(root, "node_modules/@types")] });
const diagnostics = ts.getPreEmitDiagnostics(program);
const diagnosticText = ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => "\n" });
fs.writeFileSync(path.join(directory, "source-types.txt"), diagnosticText);
summary.sourceTypeErrors = diagnostics.length;
summary.archiveSha256 = createHash("sha256").update(fs.readFileSync(path.resolve(root, "../Qualitzer2.0-Backend/infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.0.tgz"))).digest("hex");
fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (result.status !== 0) process.stdout.write(`${result.stdout?.slice(-14000)}\n${result.stderr ?? ""}\n`);
if (regression.status !== 0) process.stdout.write(`${regression.stdout?.slice(-14000)}\n${regression.stderr ?? ""}\n`);
if (diagnostics.length) process.stdout.write(diagnosticText);
process.exitCode = result.status === 0 && regression.status === 0 && !diagnostics.length ? 0 : 1;