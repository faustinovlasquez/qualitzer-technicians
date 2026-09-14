const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/notification-upgrade", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const tests = ["tests/notification-client.test.ts", "tests/notification-inbox-management.test.ts", "tests/notification-presentation-dedupe.test.ts", "tests/notification-presentation.test.ts", "src/offline/tests/repository.test.ts", "src/offline/tests/checklist-progress.test.ts"];
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram([...parsed.fileNames, ...tests.map(file => path.join(root, file))], parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
writeFileSync(path.join(output, "types.log"), ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" }));
const phases = [{ name: "app-and-test-types", exitCode: diagnostics.length ? 1 : 0 }];
for (const [name, args] of [
  ["gateway-types", ["node_modules/typescript/bin/tsc", "--project", "server/tsconfig.json"]],
  ["notification-tests", ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", ...tests]],
  ["mobile-suite", ["scripts/test.cjs"]],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 24 * 1024 * 1024, env: { ...process.env, EXPO_NO_DOTENV: "1" } });
  writeFileSync(path.join(output, `${name}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  phases.push({ name, exitCode: result.status ?? 1 });
}
const report = { passed: phases.every(phase => phase.exitCode === 0), phases, backendExecuted: false, realPushSent: false };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, output }, null, 2));
process.exitCode = report.passed ? 0 : 1;