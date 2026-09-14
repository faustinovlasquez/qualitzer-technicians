const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const root = resolve(__dirname, "../../..");
process.chdir(root);
const sources = [
  "src/domain/assignmentRead.ts", "src/domain/TechnicianRepository.ts",
  "src/infrastructure/assignmentReadBatch.ts", "src/infrastructure/HttpTechnicianRepository.ts",
  "src/offline/OfflineTechnicianRepository.ts", "src/offline/tests/assignment-read-batch.test.ts",
];
const configPath = resolve(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(sources.map((file) => resolve(root, file)), { ...parsed.options, noEmit: true });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
for (const diagnostic of diagnostics) {
  const location = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
  console.log(JSON.stringify({ file: diagnostic.file?.fileName, line: location ? location.line + 1 : undefined, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") }));
}
const tests = ["assignment-read-batch.test.ts", "repository.test.ts", "connection-http.test.ts"].map((file) => resolve(__dirname, file));
const run = spawnSync(process.execPath, ["--import", pathToFileURL(resolve(root, "node_modules/tsx/dist/loader.mjs")).href, "--test", "--test-reporter=tap", ...tests], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (run.status !== 0) console.log(run.stdout, run.stderr);
const summary = run.stdout.split(/\r?\n/).filter((line) => /^# (tests|pass|fail|cancelled|skipped|duration_ms) /.test(line));
console.log(JSON.stringify({ scopedSources: sources.length, diagnostics: diagnostics.length, testExitCode: run.status, summary }, null, 2));
process.exitCode = diagnostics.length || run.status !== 0 ? 1 : 0;