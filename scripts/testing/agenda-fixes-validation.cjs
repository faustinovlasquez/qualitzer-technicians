const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
const output = path.join(root, "artifacts/logs/agenda-fixes", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const focused = ["tests/agenda-load-lifecycle.test.ts", "tests/device-security-integration.test.ts", "tests/notification-client.test.ts", "tests/notification-inbox-management.test.ts", "tests/notification-app-navigation.test.ts", "tests/assignment-checklist-hook.test.ts"];
const extras = [...focused, "tests/e2e/week-strip-fixture.tsx", ...readdirSync(path.join(root, "src/offline/tests")).filter(name => /assignment-read.*\.test\.ts$/.test(name)).map(name => `src/offline/tests/${name}`)];
const program = ts.createProgram([...parsed.fileNames, ...extras.map(file => path.join(root, file))], parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
writeFileSync(path.join(output, "types.log"), ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" }));
const phases = [{ name: "app-test-types", exitCode: diagnostics.length ? 1 : 0 }];
for (const [name, args] of [
  ["gateway-types", ["node_modules/typescript/bin/tsc", "--project", "server/tsconfig.json"]],
  ["focused-tests", ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", ...focused]],
  ["mobile-suite", ["scripts/test.cjs"]],
]) {
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 24 * 1024 * 1024, env: { ...process.env, EXPO_NO_DOTENV: "1" } });
  writeFileSync(path.join(output, `${name}.log`), `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  phases.push({ name, exitCode: run.status ?? 1 });
}
const report = { passed: phases.every(phase => phase.exitCode === 0), phases, backendExecuted: false, remoteMutations: false };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, output }, null, 2));
process.exitCode = report.passed ? 0 : 1;