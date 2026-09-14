const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
process.chdir(root);
const startedAt = new Date().toISOString();
const output = path.join(root, "artifacts/logs/time-sync", startedAt.replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
function files(folder) {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || /^(?:\.env(?:\..*)?|\.data|node_modules|build|\.gradle|\.cxx)$/.test(entry.name)) return [];
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
closure(clientTests);
const imported = new Set(importEdges.map(edge => edge.to));
const supplementalEntries = clientTests.filter(file => !officialCoverage.has(file) && !imported.has(file));
const focused = clientTests.filter(file => /(?:time-selectors|time-sync|sync-attempt|sync-scheduling|camera|preflight|delivery-review|device-security-integration)/.test(file) && !imported.has(file));
const packagePath = require.resolve("@react-native-community/datetimepicker/package.json");
const packageInfo = JSON.parse(readFileSync(packagePath, "utf8"));
const immutableFiles = [
  ...readdirSync(path.join(root, "artifacts")).filter(name => /\.(?:apk|tgz)$/.test(name)).map(name => `artifacts/${name}`),
  ...files("artifacts/mobile-gateway").filter(file => /\.(?:tgz|json|sha256)$/.test(file)),
  ...files("artifacts/logs/native-release-1.0.13"),
];
function snapshot() {
  const names = ["App.tsx", "index.ts", "app.config.ts", "app.json", "package.json", "package-lock.json", "tsconfig.json",
    ...files("src").filter(file => /\.(?:tsx?|js)$/.test(file) && !/\/tests\//.test(file)),
    ...files("server").filter(file => /\.(?:tsx?|js|json)$/.test(file) && !/\/tests\//.test(file)),
    ...files("modules").filter(file => /\.(?:tsx?|js|json|kt|java|xml|gradle)$/.test(file) && !/\/tests\//.test(file)), ...immutableFiles];
  return Object.fromEntries([...new Set(names)].filter(file => existsSync(path.join(root, file))).sort().map(file => [file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")]));
}
const before = snapshot();
writeFileSync(path.join(output, "source-hashes-before.json"), JSON.stringify(before, null, 2));
const phases = [];
const formatHost = { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" };
function typecheck(name, configPath, extra = []) {
  const filename = path.join(root, configPath);
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(filename));
  const roots = [...new Set([...parsed.fileNames, ...extra.map(file => path.join(root, file))])];
  const program = ts.createProgram(roots, { ...parsed.options, noEmit: true });
  const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const nativeSource = path.join(root, "src/ui/time/TimePickerPanel.native.tsx");
  const pickerTypes = path.join(path.dirname(packagePath), packageInfo.types);
  const nativeIncluded = !!program.getSourceFile(nativeSource);
  const packageTypesIncluded = !!program.getSourceFile(pickerTypes);
  const nativeRequired = name !== "mobile-server-types";
  writeFileSync(path.join(output, `${name}.log`), ts.formatDiagnostics(diagnostics, formatHost));
  phases.push({ name, exitCode: diagnostics.length || (nativeRequired && (!nativeIncluded || !packageTypesIncluded)) ? 1 : 0,
    diagnostics: diagnostics.length, roots: roots.length, explicitClientRoots: extra.length, nativeIncluded, packageTypesIncluded });
}
function counts(log) {
  return Object.fromEntries(["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const matches = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
    return [key, matches.length ? Number(matches.at(-1)[1]) : null];
  }));
}
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000,
    env: { ...process.env, EXPO_NO_DOTENV: "1", FORCE_COLOR: "0", NO_COLOR: "1" } });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(path.join(output, `${name}.log`), log);
  const totals = counts(log);
  phases.push({ name, exitCode: result.status ?? 1, signal: result.signal, counts: totals, complete: totals.tests !== null && totals.cancelled === 0,
    ...(result.error ? { error: result.error.message } : {}) });
}
let error = null;
try {
  if (packageInfo.version !== "9.1.0" || JSON.parse(readFileSync("package.json", "utf8")).dependencies[packageInfo.name] !== "9.1.0") throw new Error("PICKER_VERSION_MISMATCH");
  typecheck("app-types", "tsconfig.json");
  typecheck("all-client-types", "tsconfig.json", clientRoots);
  typecheck("mobile-server-types", "server/tsconfig.json");
  const args = ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=spec"];
  run("focused-tests", [...args, ...focused]);
  run("mobile-official-suite", ["scripts/test.cjs"]);
  if (supplementalEntries.length) run("supplemental-client-tests", [...args, ...supplementalEntries]);
} catch (caught) { error = caught.stack ?? String(caught); }
const after = snapshot();
writeFileSync(path.join(output, "source-hashes-after.json"), JSON.stringify(after, null, 2));
const changedSources = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
const full = phases.filter(phase => ["mobile-official-suite", "supplemental-client-tests"].includes(phase.name));
const uniqueFullCounts = full.length === 2 && full.every(phase => phase.complete) ? Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, full.reduce((sum, phase) => sum + phase.counts[key], 0)])) : null;
const report = { startedAt, completedAt: new Date().toISOString(), passed: !error && phases.length === 6 && phases.every(phase => phase.exitCode === 0 && phase.complete !== false) && !changedSources.length,
  nodeVersion: process.version, package: { path: packagePath, version: packageInfo.version, types: packageInfo.types }, clientRoots, focusedFiles: focused,
  supplementalFiles: supplementalEntries, officialFiles: official, importEdges, excludedDuplicateEntries: clientTests.filter(file => !official.includes(file) && officialCoverage.has(file)),
  countNote: "Official + disjoint supplements only; focused executions overlap. Native SDK boundary tests are not physical-device proof.",
  uniqueFullCounts, phases, changedSources, sourceHashesBefore: before, sourceHashesAfter: after, preservedNativeProofFiles: immutableFiles.filter(file => file.includes("native-release")),
  backendExecuted: false, buildExecuted: false, lintExecuted: false, sqlExecuted: false, realApiTested: false, nativeDeviceTested: false, error, output };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, passed: report.passed, phases, uniqueFullCounts, changedSources, error }, null, 2));
process.exitCode = report.passed ? 0 : 1;