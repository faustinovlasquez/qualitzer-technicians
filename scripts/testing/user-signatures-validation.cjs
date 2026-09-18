const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/user-signatures", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), passed: false, phases: [] };

function clientTypes() {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const targets = ["App.tsx", "tests/user-signatures.test.ts", "src/screens/signatures/UserSignaturesPanel.tsx", "src/infrastructure/signatureImage.web.ts"];
  const program = ts.createProgram(targets.map(file => path.join(root, file)), {
    ...parsed.options, noEmit: true, types: [...new Set([...(parsed.options.types ?? []), "node"])],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  fs.writeFileSync(path.join(output, "client-types.log"), ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  report.phases.push({ name: "client-types", passed: diagnostics.length === 0, diagnostics: diagnostics.length });
  if (diagnostics.length) throw new Error("SIGNATURE_CLIENT_TYPES_FAILED");
}

function execute(name, args) {
  const result = spawnSync(process.execPath, ["--max-old-space-size=8192", ...args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  fs.writeFileSync(path.join(output, `${name}.log`), log);
  const counts = name === "tests" ? Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped"].map(key => [key, Number(log.match(new RegExp(`# ${key} (\\d+)`))?.[1] ?? NaN)])) : undefined;
  report.phases.push({ name, passed: result.status === 0, exitCode: result.status, counts });
  if (result.status !== 0) throw new Error(`SIGNATURE_${name.toUpperCase()}_FAILED`);
}

try {
  clientTypes();
  execute("server-types", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "server/tsconfig.json"]);
  execute("tests", ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=tap", "tests/user-signatures.test.ts", "tests/order-lifecycle.test.ts", "tests/agenda-load-lifecycle.test.ts", "tests/notification-app-navigation.test.ts", "server/tests/user-signatures.test.ts", "server/tests/order-lifecycle.test.ts"]);
  report.passed = true;
} catch (error) { report.error = error.message; }
report.completedAt = new Date().toISOString();
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, ...report }, null, 2));
process.exitCode = report.passed ? 0 : 1;