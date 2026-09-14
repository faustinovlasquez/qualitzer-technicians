const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
process.chdir(root);
const version = "1.0.4";
const archiveName = `qualitzer-mobile-gateway-${version}.tgz`;
const packageName = "@qualitzer/mobile-gateway";
const expectedSha = "b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae";
const previousSha = "61e4e0aa9a257cd0ddcd2fbf28990b7239608014625640608b17c59643c1d361";
const focused = ["tests/creation-auto-advance.test.ts", "tests/offline-card-callers.test.ts"];
const snapshots = new Map();
const report = { startedAt: new Date().toISOString(), passed: false, scope: "MOBILE_SOURCE_AND_LOCAL_PACKAGE_ONLY",
  nodeVersion: process.version, checks: [], backendExecuted: false, backendTypesExecuted: false,
  buildExecuted: false, packExecuted: false, installationExecuted: false, nativeExecuted: false,
  apkPublished: false, remoteDeployment: "PENDING", finalApkReport: "NOT_READ_OR_WRITTEN",
  limitations: ["Only Mobile app/test/server types and two focused Mobile test files execute",
    "Prior full-suite and UI evidence is checked, not rerun; full-suite report has no complete source fingerprint",
    "No backend runtime, tests, types, build, lint, SQL, installed package loading, API or device operations",
    "No environment files, private keys or application data read; no source, artifact or consumer writes",
    "Only new audit reports/logs are written; hashes do not lock sources against later edits",
    "Native validation and APK publication remain outside this audit"] };
let output;
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function ensure(value, code) { if (!value) throw new Error(code); }
function safePath(base, relative, directory = false) {
  ensure(typeof relative === "string" && !relative.includes("\\") && !relative.includes(":") &&
    !relative.split("/").some(part => !part || part.startsWith(".")) &&
    !/(?:^|\/)(?:private|credentials|sessions)(?:\/|$)|\.(?:enc|key|pem|p12|jks|keystore)$/i.test(relative), "UNSAFE_PATH");
  let current = base;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    ensure(!stat.isSymbolicLink(), "SYMLINK_NOT_ALLOWED");
    if (index < parts.length - 1 || directory) ensure(stat.isDirectory(), "DIRECTORY_REQUIRED");
    else ensure(stat.isFile() && stat.size <= 128 * 1024 * 1024, "FILE_SIZE_OR_TYPE_INVALID");
  }
  return current;
}
function read(base, relative) {
  const file = safePath(base, relative);
  const bytes = fs.readFileSync(file);
  const sha256 = hash(bytes);
  if (snapshots.has(file)) ensure(snapshots.get(file).sha256 === sha256, "OBSERVED_INPUT_CHANGED");
  else snapshots.set(file, { base, relative, sha256 });
  return bytes;
}
const json = (base, relative) => JSON.parse(read(base, relative).toString("utf8"));
function write(name, value) {
  ensure(/^[a-z0-9-]+\.(?:json|log)$/.test(name), "INVALID_REPORT_NAME");
  fs.writeFileSync(path.join(output, name), value, { flag: "wx" });
}
function check(name, action) {
  try { report.checks.push({ name, passed: true, ...action() }); }
  catch (error) {
    report.checks.push({ name, passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "AUDIT_CHECK_FAILED" });
  }
}
function sourceFiles(directory) {
  return fs.readdirSync(safePath(root, directory, true), { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".") || ["node_modules", "build", "dist"].includes(entry.name)) return [];
    ensure(!entry.isSymbolicLink(), "SOURCE_SYMLINK_NOT_ALLOWED");
    const relative = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(relative) : /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [relative] : [];
  }).sort();
}
function inventory() {
  return ["App.tsx", "index.ts", "app.config.ts", "app.json", "package.json", "package-lock.json", "tsconfig.json", "server/tsconfig.json",
    ...["src", "server", "tests", "types", "modules"].flatMap(sourceFiles)];
}
function tarFiles(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 });
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim();
    ensure(/^[0-7]+$/.test(sizeText), "TAR_SIZE_INVALID");
    const size = Number.parseInt(sizeText, 8);
    ensure((header[156] === 0 || header[156] === 48) && !entries.has(name) && offset + 512 + size <= tar.length, "TAR_ENTRY_INVALID");
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const expected = ["LICENSE", "README.md", "SOURCE-MANIFEST.json", "THIRD-PARTY-LICENSES.md", "embedded-contract.d.ts", "index.cjs", "index.d.ts", "package.json"];
  ensure(entries.size === expected.length && expected.every(name => entries.has(`package/${name}`)), "TAR_ALLOWLIST_MISMATCH");
  return entries;
}
function latest(directory, pattern) {
  const names = fs.readdirSync(safePath(root, directory, true)).filter(name => pattern.test(name)).sort();
  ensure(names.length > 0, "EVIDENCE_MISSING");
  const relative = `${directory}/${names.at(-1)}/report.json`;
  return { relative, data: json(root, relative) };
}
function counts(log) {
  const result = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
    result[key] = matches.length ? Number(matches.at(-1)[1]) : null;
  }
  return result;
}
function types(name, configRelative, extra = []) {
  const config = ts.readConfigFile(safePath(root, configRelative), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(path.join(root, configRelative)));
  const files = [...new Set([...parsed.fileNames.filter(file => !/^(?:artifacts|android|dist)\//.test(path.relative(root, file).replace(/\\/g, "/"))), ...extra.map(file => path.join(root, file))])];
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true, incremental: false });
  const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const safeDiagnostics = diagnostics.map(item => ({ code: item.code, file: item.file ? path.relative(root, item.file.fileName).replace(/\\/g, "/") : null,
    line: item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start).line + 1 : null }));
  write(`${name}.json`, JSON.stringify({ diagnostics: safeDiagnostics, roots: files.map(file => path.relative(root, file).replace(/\\/g, "/")) }, null, 2));
  ensure(diagnostics.length === 0, "TYPE_DIAGNOSTICS_PRESENT");
  return { diagnostics: 0, rootFiles: files.length, explicitTestRoots: extra.length, emitted: false };
}
function main() {
  ensure(process.argv.length === 2, "ARGUMENTS_NOT_ALLOWED");
  safePath(root, "artifacts/logs", true);
  const directory = path.join(root, "artifacts/logs/fluidity-final-audit");
  if (!fs.existsSync(directory)) fs.mkdirSync(directory);
  safePath(root, "artifacts/logs/fluidity-final-audit", true);
  output = fs.mkdtempSync(path.join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  const initial = inventory();
  for (const file of initial) read(root, file);
  check("gateway-current-bytes-copies-manifest-and-backend-lock", () => {
    const bytes = read(root, `artifacts/mobile-gateway/${archiveName}`);
    ensure(bytes.length === 585030 && hash(bytes) === expectedSha, "GATEWAY_PIN_MISMATCH");
    const integrity = `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
    ensure(bytes.equals(read(backend, `infrastructure/mobile-gateway/${archiveName}`)), "BACKEND_TGZ_DIFFERS");
    const entries = tarFiles(bytes);
    const manifestBytes = entries.get("package/SOURCE-MANIFEST.json");
    ensure(manifestBytes.equals(read(backend, `infrastructure/mobile-gateway/${archiveName}.source-manifest.json`)), "BACKEND_MANIFEST_DIFFERS");
    ensure(read(backend, `infrastructure/mobile-gateway/${archiveName}.sha256`).equals(Buffer.from(`${expectedSha}  ${archiveName}\n`)), "BACKEND_CHECKSUM_DIFFERS");
    const pkg = JSON.parse(entries.get("package/package.json"));
    const manifest = JSON.parse(manifestBytes);
    ensure(pkg.name === packageName && pkg.version === version && manifest.version === version && manifest.bundleSha256 === hash(entries.get("package/index.cjs")), "PACKAGED_IDENTITY_MISMATCH");
    ensure(manifest.sources.some(source => source.path === "src/domain/assignmentSchedule.ts"), "WEEKLY_SOURCE_MISSING");
    for (const source of manifest.sources) ensure(hash(read(root, source.path)) === source.sha256, "PACKAGED_SOURCE_CHANGED");
    for (const dependency of manifest.dependencies) {
      ensure(dependency.location.startsWith("node_modules/"), "DEPENDENCY_PATH_INVALID");
      ensure(hash(read(root, `${dependency.location}/package.json`)) === dependency.manifestSha256, "PACKAGED_DEPENDENCY_CHANGED");
    }
    const consumer = json(backend, "package.json");
    const lock = json(backend, "package-lock.json");
    const reference = `file:infrastructure/mobile-gateway/${archiveName}`;
    const installedEntry = lock.packages?.[`node_modules/${packageName}`];
    ensure(consumer.dependencies?.[packageName] === reference && lock.packages?.[""]?.dependencies?.[packageName] === reference &&
      installedEntry?.version === version && installedEntry.resolved === reference && installedEntry.integrity === integrity, "BACKEND_CONSUMER_LOCK_MISMATCH");
    return { version, bytes: bytes.length, sha256: expectedSha, integrity, copiesIdentical: true, checksumMatches: true,
      packagedManifestMatchesBackendCopy: true, sources: manifest.sources.length, dependencies: manifest.dependencies.length,
      backendManifestAndLockUpdated: true, actualBackendNodeModulesInspected: false, installedBackendVersion: "NOT_VERIFIED", remoteDeployment: "PENDING" };
  });
  check("latest-local-gateway-publication-evidence", () => {
    const { relative, data } = latest("artifacts/logs/fluidity-package", /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-zA-Z0-9]{6}$/);
    const required = ["generated-package-hash", "archive-structure-and-manifest", "all-source-and-dependency-provenance",
      "timer-checklist-and-retained-notifications-static", "actual-isolated-commonjs-node20-load", "observed-inputs-stable-at-completion"];
    ensure(data.passed === true && data.completedAt && data.version === version && data.package?.path === `artifacts/mobile-gateway/${archiveName}` &&
      data.package.sha256 === expectedSha && data.package.bytes === 585030 && required.every(name => data.checks.some(item => item.name === name && item.passed === true)), "PACKAGE_REPORT_INVALID");
    return { report: relative, completedAt: data.completedAt, rerun: false };
  });
  check("previous-apk-1-0-10-preserved", () => {
    const bytes = read(root, "artifacts/qualitzer-tecnicos-1.0.10-android.apk");
    ensure(bytes.length === 69128119 && hash(bytes) === previousSha, "PREVIOUS_APK_CHANGED");
    return { version: "1.0.10", bytes: bytes.length, sha256: previousSha, apkContentsInspected: false };
  });
  check("latest-mobile-suite-evidence-not-rerun", () => {
    const { relative, data } = latest("artifacts/logs/durable-fluidity", /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/);
    const phase = data.phases.find(item => item.name === "mobile-official-suite");
    const logCounts = counts(read(root, relative.replace("report.json", "mobile-official-suite.log")).toString("utf8"));
    ensure(data.passed === true && phase?.exitCode === 0 && phase.counts.pass === 1308 && phase.counts.skipped === 1 && phase.counts.fail === 0 &&
      Object.entries(logCounts).every(([key, value]) => value === phase.counts[key]), "FULL_SUITE_EVIDENCE_INVALID");
    return { report: relative, counts: phase.counts, rerun: false, priorFocused: data.phases.find(item => item.name === "focused-tests")?.counts };
  });
  check("latest-ui-evidence-and-current-source-hashes", () => {
    const { relative, data } = latest("artifacts/logs/durable-fluidity-ui", /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/);
    ensure(data.passed === true && data.finishedAt && data.counts?.passed === 18 && data.counts.failed === 0 && data.counts.assertions === 463 &&
      data.counts.screenshots === 44 && data.counts.typeErrors === 0 && data.errors.length === 0 && data.sourceChangesDuringRun.length === 0, "UI_EVIDENCE_INVALID");
    ensure(Object.keys(data.sources).length > 0 && data.screenshots.length === 44, "UI_PROVENANCE_MISSING");
    for (const [file, sha256] of Object.entries(data.sources)) ensure(hash(read(root, file)) === sha256, "UI_SOURCE_CHANGED");
    for (const file of data.screenshots) safePath(root, file);
    return { report: relative, finishedAt: data.finishedAt, counts: data.counts, currentSourcesMatched: Object.keys(data.sources).length, rerun: false, native: false };
  });
  check("mobile-app-types", () => types("app-types", "tsconfig.json"));
  const allTests = initial.filter(file => /\.tsx?$/.test(file) && (file.startsWith("tests/") || file.startsWith("src/") && /\/(?:tests|__tests__)\//.test(file)));
  check("mobile-app-and-all-test-types", () => {
    ensure(focused.every(file => allTests.includes(file)), "NEW_TEST_TYPE_ROOT_MISSING");
    return types("app-all-test-types", "tsconfig.json", allTests);
  });
  check("mobile-server-and-server-test-types", () => types("server-types", "server/tsconfig.json"));
  check("focused-creation-auto-and-card-callers", () => {
    const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=spec", ...focused], {
      cwd: root, encoding: "utf8", shell: false, windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
      env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: path.dirname(process.execPath), TEMP: output, TMP: output,
        NODE_ENV: "test", EXPO_NO_DOTENV: "1", TSX_DISABLE_CACHE: "1" },
    });
    const log = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    write("focused-tests.log", log);
    const result = counts(log);
    ensure(!run.error && run.status === 0 && result.pass > 0 && result.fail === 0 && result.cancelled === 0 && result.skipped === 0, "FOCUSED_TESTS_FAILED");
    return { files: focused, counts: result, exitCode: run.status, fullSuiteExecuted: false };
  });
  check("observed-inputs-unchanged-at-completion", () => {
    ensure(JSON.stringify(inventory()) === JSON.stringify(initial), "SOURCE_INVENTORY_CHANGED");
    for (const snapshot of snapshots.values()) read(snapshot.base, snapshot.relative);
    return { files: snapshots.size, sourceFreezeClaimed: false };
  });
  report.passed = report.checks.every(item => item.passed);
}
try { main(); }
catch (error) { report.checks.push({ name: "audit-completion", passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "AUDIT_FAILED" }); }
finally {
  report.completedAt = new Date().toISOString();
  if (output) {
    report.output = path.relative(root, output).replace(/\\/g, "/");
    write("source-hashes.json", JSON.stringify([...snapshots.values()].map(item => ({ repository: item.base === root ? "Mobile" : "Backend", path: item.relative, sha256: item.sha256 })), null, 2));
    write("report.json", JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}