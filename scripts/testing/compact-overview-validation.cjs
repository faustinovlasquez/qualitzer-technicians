const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
process.chdir(root);
const output = path.join(root, "artifacts/logs/compact-overview-validation", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram([...parsed.fileNames, path.join(root, "tests/e2e/compact-overview-fixture.tsx")], parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
writeFileSync(path.join(output, "types.log"), ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" }));
const results = [{ name: "app-and-fixture-types", exitCode: diagnostics.length ? 1 : 0 }];
for (const [name, args] of [
  ["gateway-types", ["node_modules/typescript/bin/tsc", "--project", "server/tsconfig.json"]],
  ["mobile-tests", ["scripts/test.cjs"]],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 24 * 1024 * 1024, env: { ...process.env, EXPO_NO_DOTENV: "1" } });
  writeFileSync(path.join(output, `${name}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  results.push({ name, exitCode: result.status ?? 1 });
}
const report = { passed: results.every(result => result.exitCode === 0), results, backendExecuted: false, dataMutations: false };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, output }, null, 2));
process.exitCode = report.passed ? 0 : 1;