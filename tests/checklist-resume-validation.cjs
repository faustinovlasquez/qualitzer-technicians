const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-checklist-resume-"));
const tests = [
  "tests/checklist-resume.test.ts",
  "tests/checklist-resume-navigation.test.ts",
  "tests/checklist-resume-ui.test.ts",
  "tests/checklist-progress.test.ts",
  "tests/assignment-checklist-progress.test.ts",
  "tests/assignment-checklist-hook.test.ts",
  "src/offline/tests/checklist-progress.test.ts",
  "src/screens/offline/tests/offline-ui.test.ts",
];
if (process.argv.includes("--include-layout")) tests.push("tests/compact-checklist-layout.test.ts");
const sources = [
  "src/domain/checklistResume.ts",
  "src/screens/workDetail/ChecklistTab.tsx",
  "src/screens/workDetail/checklist/useChecklistNavigation.ts",
  ...tests.slice(0, 3),
];
const execution = spawnSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, "--test", "--test-reporter=tap", ...tests], {
  cwd: root, encoding: "utf8", windowsHide: true,
});
const log = `${execution.stdout ?? ""}\n${execution.stderr ?? ""}`;
fs.writeFileSync(path.join(output, "tests.log"), log);
const loaded = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
const program = ts.createProgram(sources.map((file) => path.join(root, file)), {
  ...config.options, noEmit: true, types: ["node", "react"], typeRoots: [path.join(root, "node_modules/@types")],
});
const targets = new Set(sources.map((file) => path.resolve(root, file).toLowerCase()));
const diagnostics = ts.getPreEmitDiagnostics(program).filter((entry) => !entry.file || targets.has(path.resolve(entry.file.fileName).toLowerCase()));
const diagnosticLog = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => "\n",
});
fs.writeFileSync(path.join(output, "types.log"), diagnosticLog);
const counts = Object.fromEntries(["tests", "pass", "fail", "skipped"].map((name) => [name, Number(log.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? -1)]));
const report = { date: new Date().toISOString(), tests, sources, counts, testExit: execution.status, diagnostics: diagnostics.length,
  passed: execution.status === 0 && counts.tests > 0 && counts.fail === 0 && diagnostics.length === 0 };
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, output }, null, 2));
if (!report.passed) console.error(log, diagnosticLog);
process.exitCode = report.passed ? 0 : 1;