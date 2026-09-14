const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const output = path.join(os.tmpdir(), "qualitzer-checklist-progress-47952073");
fs.mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const tests = [
  "tests/assignment-checklist-progress.test.ts", "tests/assignment-checklist-hook.test.ts",
  "src/offline/tests/checklist-progress.test.ts", "tests/checklist-progress.test.ts",
  "tests/canonical-assignment-works.test.ts", "tests/weekly-schedule.test.ts",
  "src/offline/tests/repository.test.ts",
  "server/tests/assignments-schedule.test.ts",
];
const run = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href,
  "--test", "--test-concurrency=1", ...tests], { cwd: root, encoding: "utf8", windowsHide: true });
fs.writeFileSync(path.join(output, "tests.log"), (run.stdout ?? "") + (run.stderr ?? ""));
const scoped = ["src/domain/assignmentChecklistProgress.ts", "src/domain/assignmentSchedule.ts", "src/application/useTechnicianApp.ts", "src/offline/OfflineTechnicianRepository.ts",
  "tests/helpers/assignment-checklist.ts", ...tests.slice(0, 3)].map((file) => path.join(root, file));
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(scoped, { ...parsed.options, noEmit: true, types: ["node", "react"] });
const diagnostics = [...parsed.errors, ...program.getOptionsDiagnostics(), ...scoped.flatMap((file) => {
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`MISSING_SOURCE:${file}`);
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
})];
const formatted = ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => "\n" });
fs.writeFileSync(path.join(output, "types.log"), formatted);
const report = { startedAt, finishedAt: new Date().toISOString(), node: process.version, tests, testExitCode: run.status,
  typeDiagnostics: diagnostics.length, passed: run.status === 0 && diagnostics.length === 0, output };
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exitCode = report.passed ? 0 : 1;