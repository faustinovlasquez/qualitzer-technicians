const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/parent-assignments");
fs.mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), completed: false, passed: false, phases: [] };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
save();
const targets = ["src/screens/DashboardScreen.tsx", "src/screens/orders/AssignmentOrderCard.tsx", "src/application/useTechnicianApp.ts", "src/domain/notifications.ts", "src/domain/assignmentCodes.ts", "tests/parent-assignment-ui.test.ts", "tests/helpers/agenda-load-lifecycle.ts", "tests/e2e/compact-overview-fixture.tsx"];
try {
  console.log("Checking assignment types");
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(targets.map(file => path.join(root, file)), { ...parsed.options, noEmit: true, types: [...new Set([...(parsed.options.types ?? []), "node"])] });
  const diagnostics = targets.flatMap(file => {
    const source = program.getSourceFile(path.join(root, file));
    if (!source) throw new Error(`SOURCE_MISSING:${file}`);
    return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
  });
  fs.writeFileSync(path.join(output, "types.log"), ts.formatDiagnostics(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
  report.phases.push({ name: "assignment-types", passed: diagnostics.length === 0, diagnostics: diagnostics.length });
  save();
  console.log("Running assignment and notification tests");
  const files = ["tests/parent-assignment-ui.test.ts", "tests/notification-client.test.ts", "tests/notification-app-navigation.test.ts", "tests/notification-presentation.test.ts", "tests/notification-inbox-management.test.ts", "tests/device-security-integration.test.ts", "tests/durable-fluidity-hook.test.ts"];
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", ...files], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  fs.writeFileSync(path.join(output, "tests.log"), log);
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped"].map(key => [key, Number(log.match(new RegExp(`# ${key} (\\d+)`))?.[1] ?? NaN)]));
  report.phases.push({ name: "assignment-tests", passed: result.status === 0 && counts.fail === 0 && counts.cancelled === 0, exitCode: result.status, counts });
  report.passed = report.phases.every(phase => phase.passed);
} catch (error) { report.error = error.stack; }
report.completed = true;
report.completedAt = new Date().toISOString();
save();
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;