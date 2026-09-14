const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../../..");
const scoped = process.argv.includes("--scoped");
const names = scoped ? ["connection", "connection-reliability", "connection-http", "foreground", "engine", "repository", "document-http", "document-recovery", "direct-document-scope"] : ["connection-reliability", "connection-http"];
const tests = names.map((name) => `src/offline/tests/${name}.test.ts`);
const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=spec", ...tests], { cwd: root, encoding: "utf8" });
const diagnostics = [];
if (scoped) {
  const ts = require("typescript");
  const configPath = resolve(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const targets = [...tests, "src/offline/engine.ts", "src/infrastructure/HttpTechnicianRepository.ts"].map((file) => resolve(root, file));
  const program = ts.createProgram(targets, { ...parsed.options, noEmit: true, types: [...new Set([...(parsed.options.types ?? []), "node"])] });
  diagnostics.push(...ts.getPreEmitDiagnostics(program).filter((item) => !item.file || targets.includes(resolve(item.file.fileName))).map((item) => ({ file: item.file?.fileName, code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, "\n") })));
}
const report = { observedAt: new Date().toISOString(), scoped, tests, exit: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr, diagnostics };
const destination = resolve(tmpdir(), `qualitzer-connection-${scoped ? "scoped" : "reproduction"}-47952073.json`);
writeFileSync(destination, JSON.stringify(report, null, 2), "utf8");
writeFileSync(destination.replace(/\.json$/, ".log"), result.stdout + result.stderr, "utf8");
console.log(destination);
console.log(`TEST_EXIT=${result.status}; SCOPED_DIAGNOSTICS=${diagnostics.length}`);
process.exitCode = result.status === 0 && diagnostics.length === 0 ? 0 : 1;