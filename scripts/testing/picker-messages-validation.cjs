const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
process.chdir(root);
const startedAt = new Date().toISOString();
const output = path.join(root, "artifacts/logs/picker-messages", startedAt.replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
function files(folder) {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const relative = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(relative) : [relative];
  });
}
const clientRoots = [...files("tests"), ...files("src").filter(file => /\/tests\//.test(file))].filter(file => /\.tsx?$/.test(file));
const clientTests = [...files("tests"), ...files("src").filter(file => /\/tests\//.test(file))].filter(file => /\.test\.(?:tsx?|cjs)$/.test(file));
const focused = clientTests.filter(file => /(?:trusted-native-picker|picker-messages|sync-user-presentation|device-lock-controller|device-security-integration|durable-queue-ui|notification-app-navigation)/.test(file));
const officialFolders = ["server/tests", "tests", "src/offline/tests", "src/screens/offline/tests"];
const official = officialFolders.flatMap(folder => readdirSync(path.join(root, folder)).filter(name => name.endsWith(".test.ts")).map(name => `${folder}/${name}`));
const supplemental = clientTests.filter(file => !official.includes(file));
function sources() {
  return Object.fromEntries(["App.tsx", ...files("src").filter(file => /\.(?:tsx?|js)$/.test(file) && !/\/tests\//.test(file))].map(file => [file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")]));
}
const before = sources();
const phases = [];
const formatHost = { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" };
function typecheck(name, configPath, extra = []) {
  const filename = path.join(root, configPath);
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(filename));
  const roots = [...new Set([...parsed.fileNames, ...extra.map(file => path.join(root, file))])];
  const program = ts.createProgram(roots, { ...parsed.options, noEmit: true });
  const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  writeFileSync(path.join(output, `${name}.log`), ts.formatDiagnostics(diagnostics, formatHost));
  phases.push({ name, exitCode: diagnostics.length ? 1 : 0, diagnostics: diagnostics.length, roots: roots.length, explicitClientRoots: extra.length });
}
function counts(log) {
  return Object.fromEntries(["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const matches = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
    return [key, matches.length ? Number(matches.at(-1)[1]) : null];
  }));
}
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(path.join(output, `${name}.log`), log);
  const totals = counts(log);
  phases.push({ name, exitCode: result.status ?? 1, signal: result.signal, counts: totals, complete: totals.tests !== null && totals.cancelled === 0, ...(result.error ? { error: result.error.message } : {}) });
}
let error = null;
try {
  typecheck("app-types", "tsconfig.json");
  typecheck("all-client-types", "tsconfig.json", clientRoots);
  typecheck("mobile-server-types", "server/tsconfig.json");
  const testArgs = ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=spec"];
  run("focused-tests", [...testArgs, ...focused]);
  run("mobile-official-suite", ["scripts/test.cjs"]);
  if (supplemental.length) run("supplemental-client-tests", [...testArgs, ...supplemental]);
} catch (caught) { error = caught.stack ?? String(caught); }
const after = sources();
const changedSources = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
const report = { startedAt, completedAt: new Date().toISOString(), passed: !error && phases.every(phase => phase.exitCode === 0 && phase.complete !== false) && changedSources.length === 0,
  nodeVersion: process.version, clientRoots, focusedFiles: focused, supplementalFiles: supplemental, officialFiles: official, phases, changedSources, sourceHashes: after,
  backendExecuted: false, buildExecuted: false, lintExecuted: false, sqlExecuted: false, realApiTested: false, nativeDeviceTested: false, error, output };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, passed: report.passed, phases, changedSources, error }, null, 2));
process.exitCode = report.passed ? 0 : 1;