const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
process.chdir(root);
const startedAt = new Date().toISOString();
const output = path.join(root, "artifacts/logs/camera-delivery", startedAt.replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
function files(folder) {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const relative = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(relative) : [relative];
  });
}
const clientFiles = [...files("tests"), ...files("src").filter(file => /\/tests\//.test(file))];
const clientRoots = clientFiles.filter(file => /\.tsx?$/.test(file));
const clientTests = clientFiles.filter(file => /\.test\.(?:tsx?|cjs)$/.test(file));
const officialFolders = ["server/tests", "tests", "src/offline/tests", "src/screens/offline/tests"];
const official = officialFolders.flatMap(folder => readdirSync(path.join(root, folder)).filter(name => name.endsWith(".test.ts")).map(name => `${folder}/${name}`));
const importEdges = [];
function closure(entries) {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    function inspect(node) {
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require") && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier?.startsWith(".")) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.cjs`, `${base}/index.ts`].find(candidate => existsSync(path.join(root, candidate)) && /\.(?:tsx?|cjs)$/.test(candidate));
        if (target && /\.test\.(?:tsx?|cjs)$/.test(target)) {
          if (!importEdges.some(edge => edge.from === file && edge.to === target)) importEdges.push({ from: file, to: target });
          visit(target);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  entries.forEach(visit);
  return visited;
}
const officialCoverage = closure(official);
const supplemental = clientTests.filter(file => !officialCoverage.has(file));
const focusedCandidates = clientTests.filter(file => /(?:camera|preflight|delivery-review|trusted-native-picker|device-lock-controller|device-security-integration|picker-messages|durable-queue-ui)/.test(file));
closure(focusedCandidates);
const imported = new Set(importEdges.map(edge => edge.to));
const focused = focusedCandidates.filter(file => !imported.has(file));
const supplementalEntries = supplemental.filter(file => !imported.has(file));
function sources() {
  return Object.fromEntries(["App.tsx", ...files("src").filter(file => /\.(?:tsx?|js)$/.test(file) && !/\/tests\//.test(file)), ...files("server").filter(file => /\.(?:tsx?|js)$/.test(file) && !/\/tests\//.test(file))].map(file => [file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")]));
}
const before = sources();
const phases = [];
const formatHost = { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" };
function typecheck(name, configPath, extra = []) {
  const filename = path.join(root, configPath);
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(filename));
  const roots = [...new Set([...parsed.fileNames, ...extra.map(file => path.join(root, file))])];
  const program = ts.createProgram(roots, { ...parsed.options, noEmit: true });
  const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  writeFileSync(path.join(output, `${name}.log`), ts.formatDiagnostics(diagnostics, formatHost));
  phases.push({ name, exitCode: diagnostics.length ? 1 : 0, diagnostics: diagnostics.length, roots: roots.length, explicitClientRoots: extra.length });
}
function counts(log) {
  return Object.fromEntries(["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const matches = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
    return [key, matches.length ? Number(matches.at(-1)[1]) : null];
  }));
}
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(path.join(output, `${name}.log`), log);
  const totals = counts(log);
  phases.push({ name, exitCode: result.status ?? 1, signal: result.signal, counts: totals, complete: totals.tests !== null && totals.cancelled === 0, ...(result.error ? { error: result.error.message } : {}) });
}
let error = null;
try {
  typecheck("app-types", "tsconfig.json");
  typecheck("all-client-types", "tsconfig.json", clientRoots);
  typecheck("mobile-server-types", "server/tsconfig.json");
  const testArgs = ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=spec"];
  run("focused-tests", [...testArgs, ...focused]);
  run("mobile-official-suite", ["scripts/test.cjs"]);
  if (supplementalEntries.length) run("supplemental-client-tests", [...testArgs, ...supplementalEntries]);
} catch (caught) { error = caught.stack ?? String(caught); }
const after = sources();
const changedSources = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
const suitePhases = phases.filter(phase => ["mobile-official-suite", "supplemental-client-tests"].includes(phase.name));
const uniqueFullCounts = suitePhases.length === 2 && suitePhases.every(phase => phase.complete) ? Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, suitePhases.reduce((sum, phase) => sum + phase.counts[key], 0)])) : null;
const report = { startedAt, completedAt: new Date().toISOString(), passed: !error && phases.length === 6 && phases.every(phase => phase.exitCode === 0 && phase.complete !== false) && changedSources.length === 0,
  nodeVersion: process.version, clientRoots, focusedFiles: focused, supplementalFiles: supplementalEntries, officialFiles: official, importEdges, excludedDuplicateEntries: clientTests.filter(file => !official.includes(file) && officialCoverage.has(file)),
  countNote: "Official plus supplemental excludes imported test wrappers; focused executions overlap and must not be added.", uniqueFullCounts, phases, changedSources, sourceHashes: after,
  backendExecuted: false, buildExecuted: false, lintExecuted: false, sqlExecuted: false, realApiTested: false, nativeDeviceTested: false, error, output };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, passed: report.passed, phases, uniqueFullCounts, changedSources, error }, null, 2));
process.exitCode = report.passed ? 0 : 1;