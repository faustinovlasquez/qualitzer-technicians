const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const folder = path.join(root, "artifacts/logs/device-security", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(folder, { recursive: true });
const phases = [
  ["app-types", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["server-types", ["node_modules/typescript/bin/tsc", "--project", "server/tsconfig.json"]],
  ["security-tests", ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "tests/device-lock-controller.test.ts", "tests/device-security-integration.test.ts", "tests/assignment-checklist-hook.test.ts"]],
  ["mobile-regressions", ["scripts/test.cjs"]],
];
const results = [];
const configuration = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
const extraTests = ["tests/device-lock-controller.test.ts", "tests/device-security-integration.test.ts", "tests/assignment-checklist-hook.test.ts", "tests/e2e/device-security-fixture.tsx"];
const program = ts.createProgram([...parsed.fileNames, ...extraTests.map(file => path.join(root, file))], parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
const formatHost = { getCurrentDirectory: () => root, getCanonicalFileName: value => value, getNewLine: () => "\n" };
writeFileSync(path.join(folder, "security-test-types.log"), ts.formatDiagnostics(diagnostics, formatHost));
results.push({ name: "security-test-types", exitCode: diagnostics.length === 0 ? 0 : 1 });
console.log(`security-test-types: ${diagnostics.length === 0 ? 0 : 1}`);
for (const [name, args] of phases) {
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: { ...process.env, EXPO_NO_DOTENV: "1" } });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  writeFileSync(path.join(folder, `${name}.log`), output);
  results.push({ name, exitCode: run.status ?? 1 });
  console.log(`${name}: ${run.status ?? 1}`);
}
const report = { passed: results.every(result => result.exitCode === 0), results, backendExecuted: false, nativeDeviceTested: false };
writeFileSync(path.join(folder, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`REPORT ${path.join(folder, "report.json")}`);
process.exitCode = report.passed ? 0 : 1;