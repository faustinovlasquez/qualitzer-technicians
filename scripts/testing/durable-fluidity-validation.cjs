const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
const output = path.join(root, "artifacts/logs/durable-fluidity", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const focused = [
  ...readdirSync(path.join(root, "tests")).filter(name => /^(durable-|timer-reconciliation|agenda-load-lifecycle|assignment-checklist|checklist-assignment|checklist-progress|file-confirmation|device-security-integration).*\.test\.ts$/.test(name)).map(name => `tests/${name}`),
  ...readdirSync(path.join(root, "src/offline/tests")).filter(name => name.endsWith(".test.ts")).map(name => `src/offline/tests/${name}`),
  ...readdirSync(path.join(root, "src/screens/offline/tests")).filter(name => name.endsWith(".test.ts")).map(name => `src/screens/offline/tests/${name}`),
];
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram([...new Set([...parsed.fileNames, ...focused.map(file => path.join(root, file))])], parsed.options);
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
writeFileSync(path.join(output, "types.log"), ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" }));
const phases = [{ name: "app-and-focused-test-types", exitCode: diagnostics.length ? 1 : 0, diagnostics: diagnostics.length }];
function counts(log) {
  const result = {};
  for (const key of ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
    result[key] = matches.length ? Number(matches.at(-1)[1]) : null;
  }
  return result;
}
for (const [name, args] of [
  ["focused-tests", ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=spec", ...focused]],
  ["mobile-official-suite", ["scripts/test.cjs"]],
]) {
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 48 * 1024 * 1024 });
  const log = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  writeFileSync(path.join(output, `${name}.log`), log);
  phases.push({ name, exitCode: run.status ?? 1, signal: run.signal, counts: counts(log), ...(run.error ? { error: run.error.message } : {}) });
}
const report = { passed: phases.every(phase => phase.exitCode === 0), nodeVersion: process.version, focusedFiles: focused, phases,
  backendExecuted: false, gatewayTypecheckExecuted: false, buildExecuted: false, realApiTested: false, output };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;