const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/user-signatures", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), passed: false, phases: [] };
const recoveryTests = process.argv.includes("--sync-recovery") ? ["src/offline/tests/deployment-scheduling.test.ts", "src/offline/tests/actions-deployment.test.ts", "src/offline/tests/file-fingerprint.test.ts", "src/offline/tests/durable-intentions.test.ts", "src/offline/tests/timer-reconciliation.test.ts", "src/offline/tests/repository.test.ts", "server/tests/offline-actions-deployment.test.ts", "server/tests/offline-timer-checklist.test.ts"] : [];
if (recoveryTests.length) recoveryTests.push("src/offline/tests/storage-capacity.test.ts");
if (process.argv.includes("--offline-delivery")) recoveryTests.push("tests/delivery-review-ui.test.ts", "src/offline/tests/durable-intentions.test.ts", "src/offline/tests/repository.test.ts");
if (process.argv.includes("--creation-history")) recoveryTests.push("tests/creation-auto-advance.test.ts", "tests/durable-fluidity-hook.test.ts");
if (process.argv.includes("--action-history")) recoveryTests.push("tests/creation-auto-advance.test.ts", "tests/durable-fluidity-hook.test.ts", "tests/creation-form.test.ts");
if (process.argv.includes("--work-edit")) recoveryTests.push("tests/creation-form.test.ts", "tests/creation-equipment.test.ts", "tests/creation-auto-advance.test.ts", "tests/durable-fluidity-hook.test.ts", "server/tests/work-edit.test.ts", "server/tests/equipment-location.test.ts");
if (process.argv.includes("--maintenance-create")) recoveryTests.push("tests/creation-form.test.ts", "tests/creation-auto-advance.test.ts", "tests/durable-fluidity-hook.test.ts", "src/offline/tests/repository.test.ts", "server/tests/creation-routes.test.ts", "server/tests/panel-resources.test.ts", "server/tests/assignments-authorization.test.ts", "server/tests/work-edit.test.ts");

function clientTypes() {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const targets = ["App.tsx", "tests/user-signatures.test.ts", "src/screens/signatures/UserSignaturesPanel.tsx", "src/infrastructure/signatureImage.web.ts"];
  if (process.argv.includes("--locations")) targets.push("tests/location-tracking.test.ts", "tests/e2e/location/fixture.tsx", "src/location/GoogleMap.web.tsx");
  if (process.argv.includes("--work-edit")) targets.push("tests/e2e/location/WorkEditFixture.tsx");
  targets.push(...recoveryTests.filter(file => !file.startsWith("server/")), ...(recoveryTests.length ? ["src/offline/FileStore.web.ts"] : []));
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
  execute("tests", ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=tap", "tests/user-signatures.test.ts", "tests/order-lifecycle.test.ts", "tests/agenda-load-lifecycle.test.ts", "tests/notification-app-navigation.test.ts", "server/tests/user-signatures.test.ts", "server/tests/order-lifecycle.test.ts", ...(process.argv.includes("--locations") ? ["tests/location-tracking.test.ts", "server/tests/location-routes.test.ts", "server/tests/equipment-location.test.ts"] : []), ...recoveryTests]);
  report.passed = true;
} catch (error) { report.error = error.message; }
report.completedAt = new Date().toISOString();
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, ...report }, null, 2));
process.exitCode = report.passed ? 0 : 1;