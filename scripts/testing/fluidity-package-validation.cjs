const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
const version = "1.0.25";
const archiveName = `qualitzer-mobile-gateway-${version}.tgz`;
const packageName = "@qualitzer/mobile-gateway";
const files = ["LICENSE", "README.md", "SOURCE-MANIFEST.json", "THIRD-PARTY-LICENSES.md", "embedded-contract.d.ts", "index.cjs", "index.d.ts", "package.json"];
const snapshots = new Map();
const report = { startedAt: new Date().toISOString(), version, passed: false, checks: [], limitations: [
  "No factory invocation, server startup, HTTP route execution, credentials, API, SQL or push delivery",
  "No backend installation or package/lock edits; no app version edits, APK build, installation or inspection",
  "Hashes prove observed correspondence, not authenticity or a lock against concurrent source edits",
  "Default mode performs no build or pack; --repro builds and packs only in an isolated directory",
  "Writes are limited to this validation report/scratch and, with --copy, the fixed versioned backend artifact paths",
] };
let output;
let temporary;
let node20;
let npmCli;
let tar;
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function ensure(value, code) { if (!value) throw new Error(code); }
function contained(base, target) {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function safeFile(base, relative, limit = 256 * 1024 * 1024) {
  ensure(typeof relative === "string" && !relative.includes("\\") && !relative.includes(":") && !relative.split("/").some((part) => !part || part.startsWith(".")), "UNSAFE_READ_PATH");
  ensure(!/(?:^|\/)(?:private|credentials|sessions)(?:\/|$)|\.(?:enc|key|pem|p12|jks|keystore)$/i.test(relative), "PRIVATE_READ_FORBIDDEN");
  const file = path.resolve(base, relative);
  ensure(contained(base, file) && contained(fs.realpathSync(base), fs.realpathSync(file)), "READ_OUTSIDE_BOUNDARY");
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, "READ_SIZE_OR_TYPE_INVALID");
  return file;
}
function tracked(base, relative) {
  const file = safeFile(base, relative);
  const bytes = fs.readFileSync(file);
  const digest = hash(bytes);
  if (snapshots.has(file)) ensure(snapshots.get(file).sha256 === digest, "INPUT_CHANGED_DURING_VALIDATION");
  else snapshots.set(file, { base, relative, sha256: digest });
  return bytes;
}
function stable() {
  for (const snapshot of snapshots.values()) tracked(snapshot.base, snapshot.relative);
  return { hashedFiles: snapshots.size, checkedAt: new Date().toISOString(), sourceFreezeClaimed: false };
}
async function check(name, action) {
  try { report.checks.push({ name, passed: true, ...await action() }); }
  catch (error) {
    report.checks.push({ name, passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "VALIDATION_STEP_FAILED" });
    throw error;
  }
}
function env() {
  return { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: `${path.dirname(node20)};C:\\Windows\\System32`,
    TEMP: temporary, TMP: temporary, HOME: temporary, USERPROFILE: temporary, APPDATA: temporary, LOCALAPPDATA: temporary,
    NODE_ENV: "test", EXPO_NO_DOTENV: "1", NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_USERCONFIG: path.join(temporary, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(temporary, "global.npmrc") };
}
function run(executable, args, cwd = temporary, binary = false) {
  const result = spawnSync(executable, args, { cwd, env: env(), encoding: binary ? undefined : "utf8", shell: false,
    windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  ensure(!result.error && result.status === 0, "ISOLATED_COMMAND_FAILED");
  return result.stdout;
}
function archiveEntries(archive) {
  const entries = run(tar, ["-tzf", archive]).trim().split(/\r?\n/).sort();
  ensure(JSON.stringify(entries) === JSON.stringify(files.map((file) => `package/${file}`).sort()), "ARCHIVE_ENTRY_ALLOWLIST_MISMATCH");
  const verbose = run(tar, ["-tvzf", archive]).trim().split(/\r?\n/);
  ensure(verbose.length === files.length && verbose.every((line) => line.startsWith("-")), "ARCHIVE_NON_REGULAR_ENTRY");
  return entries;
}
function sourceAllowed(relative) {
  return typeof relative === "string" && !/(?:^|\/)(?:tests|expo(?:-[^/]*)?|@expo|react-native(?:-[^/]*)?|sharp|qrcode)(?:\/|$)|^server\/(?:index|development|app)\.ts$/i.test(relative)
    && (/^(?:node_modules\/|server\/|src\/domain\/)/.test(relative) || ["config/gatewayPolicy.js", "scripts/pack-mobile-gateway.cjs", "docs/EMBEDDED-GATEWAY.md", "LICENSE"].includes(relative));
}
function options() {
  const result = { copy: false, repro: false, node20: "C:/Users/faust/AppData/Local/nvm/v20.12.2/node.exe", tar: "C:/Windows/System32/tar.exe" };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--copy") result.copy = true;
    else if (arg === "--repro") result.repro = true;
    else if (["--node20", "--npm-cli", "--tar"].includes(arg)) {
      const value = args[++index];
      ensure(value && path.isAbsolute(value), "ABSOLUTE_TOOL_PATH_REQUIRED");
      result[arg === "--npm-cli" ? "npmCli" : arg.slice(2)] = value;
    } else throw new Error("UNKNOWN_ARGUMENT");
  }
  return result;
}
function preserveArtifacts() {
  const preserved = [];
  for (const [base, directory, pattern] of [
    [root, "artifacts", /\.apk$/i],
    [root, "artifacts/mobile-gateway", /\.(?:tgz|sha256)$/i],
    [backend, "infrastructure/mobile-gateway", /\.(?:tgz|sha256|json)$/i],
  ]) {
    const location = path.join(base, directory);
    if (!fs.existsSync(location)) continue;
    for (const entry of fs.readdirSync(location, { withFileTypes: true })) {
      if (!pattern.test(entry.name)) continue;
      const relative = `${directory}/${entry.name}`;
      const bytes = tracked(base, relative);
      preserved.push({ repository: base === root ? "Mobile" : "Backend", path: relative, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  for (const [base, relative] of [[root, "app.json"], [root, "app.config.ts"], [root, "package.json"], [root, "package-lock.json"], [backend, "package.json"], [backend, "package-lock.json"]]) {
    if (fs.existsSync(path.join(base, relative))) tracked(base, relative);
  }
  report.preservedArtifacts = preserved;
  return { existingArtifacts: preserved.length, apkContentsInspected: false };
}
function backendCopies(archiveBytes, manifestBytes, allowCopy) {
  const relativeDirectory = "infrastructure/mobile-gateway";
  const directory = path.join(backend, relativeDirectory);
  ensure(contained(fs.realpathSync(backend), fs.realpathSync(directory)) && !fs.lstatSync(directory).isSymbolicLink(), "COPY_DIRECTORY_INVALID");
  const planned = [
    { name: archiveName, bytes: archiveBytes },
    { name: `${archiveName}.sha256`, bytes: Buffer.from(`${hash(archiveBytes)}  ${archiveName}\n`) },
    { name: `${archiveName}.source-manifest.json`, bytes: manifestBytes },
  ];
  const manifest = planned.map((item) => {
    const target = path.join(directory, item.name);
    const exists = fs.existsSync(target);
    if (exists) ensure(hash(tracked(backend, `${relativeDirectory}/${item.name}`)) === hash(item.bytes), "EXISTING_BACKEND_ARTIFACT_DIFFERS");
    return { path: `${relativeDirectory}/${item.name}`, bytes: item.bytes.length, sha256: hash(item.bytes), existed: exists, copied: false };
  });
  report.backendCopy = { requested: allowCopy, files: manifest, packageAndLockNotUpdated: true, installed: false };
  if (allowCopy) {
    stable();
    for (let index = 0; index < planned.length; index++) {
      const item = planned[index];
      if (!manifest[index].existed) {
        fs.writeFileSync(path.join(directory, item.name), item.bytes, { flag: "wx" });
        manifest[index].copied = true;
      }
      ensure(hash(tracked(backend, `${relativeDirectory}/${item.name}`)) === manifest[index].sha256, "BACKEND_COPY_VERIFICATION_FAILED");
    }
  }
  return { requested: allowCopy, complete: manifest.every((item) => item.existed || item.copied), absentCopiesArePending: !allowCopy };
}

async function main() {
  try {
    const flags = options();
    node20 = flags.node20;
    npmCli = flags.npmCli ?? path.join(path.dirname(node20), "node_modules/npm/bin/npm-cli.js");
    tar = flags.tar;
    const outputBase = path.join(root, "artifacts/logs/fluidity-package");
    fs.mkdirSync(outputBase, { recursive: true });
    ensure(contained(fs.realpathSync(root), fs.realpathSync(outputBase)), "OUTPUT_OUTSIDE_BOUNDARY");
    output = fs.mkdtempSync(path.join(outputBase, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
    temporary = fs.mkdtempSync(path.join(output, "isolated-"));
    for (const file of ["user.npmrc", "global.npmrc"]) fs.writeFileSync(path.join(temporary, file), "", { flag: "wx" });
    await check("preserve-existing-artifacts-and-consumer-config", preserveArtifacts);
    await check("exact-node20-available", () => {
      ensure(run(node20, ["--version"]).trim() === "v20.12.2", "EXACT_NODE20_UNAVAILABLE");
      return { node: "v20.12.2" };
    });
    let archiveBytes;
    let archive;
    await check("generated-package-hash", () => {
      archiveBytes = tracked(root, `artifacts/mobile-gateway/${archiveName}`);
      archive = path.join(temporary, archiveName);
      fs.writeFileSync(archive, archiveBytes, { flag: "wx" });
      report.package = { path: `artifacts/mobile-gateway/${archiveName}`, bytes: archiveBytes.length, sha256: hash(archiveBytes),
        integrity: `sha512-${crypto.createHash("sha512").update(archiveBytes).digest("base64")}` };
      return report.package;
    });
    let manifest;
    let manifestBytes;
    let bundle;
    const packageDirectory = path.join(temporary, "package");
    await check("archive-structure-and-manifest", () => {
      const entries = archiveEntries(archive);
      fs.mkdirSync(packageDirectory);
      for (const file of files) fs.writeFileSync(path.join(packageDirectory, file), run(tar, ["-xOf", archive, `package/${file}`], temporary, true), { flag: "wx" });
      const pkg = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
      ensure(pkg.name === packageName && pkg.version === version && pkg.type === "commonjs" && pkg.main === "./index.cjs", "PACKAGE_IDENTITY_INVALID");
      ensure(pkg.engines?.node === ">=20.12.2" && pkg.exports?.["."]?.require === "./index.cjs" && pkg.types === "./index.d.ts", "PACKAGE_EXPORT_OR_ENGINE_INVALID");
      ensure(Object.keys(pkg.dependencies ?? {}).length === 0 && !pkg.scripts && !pkg.optionalDependencies && !pkg.peerDependencies && !pkg.devDependencies, "PACKAGE_NOT_SELF_CONTAINED");
      manifestBytes = fs.readFileSync(path.join(packageDirectory, "SOURCE-MANIFEST.json"));
      manifest = JSON.parse(manifestBytes);
      const bundleBytes = fs.readFileSync(path.join(packageDirectory, "index.cjs"));
      bundle = bundleBytes.toString("utf8");
      ensure(manifest.name === packageName && manifest.version === version && manifest.target === "node20.12.2" && manifest.bundleSha256 === hash(bundleBytes), "BUNDLE_MANIFEST_MISMATCH");
      return { entries, target: manifest.target, bundleSha256: manifest.bundleSha256, manifestSha256: hash(manifestBytes) };
    });
    await check("all-source-and-dependency-provenance", () => {
      ensure(Array.isArray(manifest.sources) && manifest.sources.length > 0 && Array.isArray(manifest.dependencies), "SOURCE_MANIFEST_INVALID");
      const seen = new Set();
      const mismatches = [];
      for (const source of manifest.sources) {
        ensure(sourceAllowed(source.path) && !seen.has(source.path) && /^[a-f0-9]{64}$/.test(source.sha256), "SOURCE_ENTRY_INVALID");
        seen.add(source.path);
        if (hash(tracked(root, source.path)) !== source.sha256) mismatches.push(source.path);
      }
      report.sourceMismatches = mismatches;
      ensure(mismatches.length === 0, "SOURCE_HASH_MISMATCH");
      for (const dependency of manifest.dependencies) {
        ensure(typeof dependency.location === "string" && dependency.location.startsWith("node_modules/"), "DEPENDENCY_LOCATION_INVALID");
        const bytes = tracked(root, `${dependency.location}/package.json`);
        const pkg = JSON.parse(bytes);
        ensure(hash(bytes) === dependency.manifestSha256 && pkg.name === dependency.name && pkg.version === dependency.version, "DEPENDENCY_MANIFEST_MISMATCH");
      }
      for (const [name, major] of [["express", "5"], ["multer", "2"]]) ensure(manifest.dependencies.some((item) => item.name === name && item.version.split(".")[0] === major), "BUNDLED_DEPENDENCY_REQUIRED");
      const required = ["server/embedded.ts", "server/embedded-contract.ts", "server/gateway-runtime.ts", "server/offline/routes.ts", "server/upstream.ts",
        "server/assignments/workActions.ts", "src/domain/workActivities.ts",
        "server/checklists/routes.ts", "server/notifications/routes.ts", "src/domain/offlineProtocol.ts", "src/domain/notifications.ts", "src/domain/assignmentSchedule.ts", "scripts/pack-mobile-gateway.cjs", "docs/EMBEDDED-GATEWAY.md"];
      for (const file of required) ensure(seen.has(file), "CRITICAL_SOURCE_MISSING");
      return { sourcesVerified: seen.size, dependenciesVerified: manifest.dependencies.length, criticalSources: required };
    });
    await check("timer-checklist-and-retained-notifications-static", () => {
      const groups = {
        commands: ['literal("timer")', 'literal("checklist")', 'enum(["in_progress", "paused"])', 'enum(["pending", "in_progress", "paused"])', "baseStatus:", "checklistId:",
          "MOBILE_SYNC_STATUS_CONFLICT", "MOBILE_SYNC_INVALID_STATUS", "MOBILE_SYNC_INVALID_CHECKLIST", 'literal("comment")', 'literal("answer")',
          'router.post("/commands"', '"/mobile-sync/commands"', 'router.get("/receipts/:operationId"', 'router.post("/documents"', "MOBILE_SYNC_OPERATION_REUSED"],
        notifications: ['router.delete("/inbox/:id"', 'enum(["true", "false"]).optional()', 'query.set("unreadOnly", "true")', "notificationDeleteResultSchema", "unreadCount:", "total:", "canDelete:"],
      };
      report.missingBundleMarkers = Object.values(groups).flat().filter((marker) => !bundle.includes(marker));
      ensure(report.missingBundleMarkers.length === 0, "CRITICAL_BUNDLE_MARKER_MISSING");
      const protocol = tracked(root, "src/domain/offlineProtocol.ts").toString("utf8");
      ensure(protocol.includes('value.kind === "comment" || value.scope.workId !== undefined'), "COMMAND_WORK_SCOPE_GUARD_MISSING");
      const legacyBytes = tracked(root, "artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.2.tgz");
      const legacy = path.join(temporary, "legacy-1.0.2.tgz");
      fs.writeFileSync(legacy, legacyBytes, { flag: "wx" });
      archiveEntries(legacy);
      const legacyBundle = run(tar, ["-xOf", legacy, "package/index.cjs"]);
      for (const marker of groups.notifications) ensure(legacyBundle.includes(marker), "LEGACY_NOTIFICATION_BASELINE_MISMATCH");
      return { markers: groups, legacySha256: hash(legacyBytes), notificationMarkersRetained: true, httpTestedOnBundle: false, schemaExecuted: false };
    });
    await check("actual-isolated-commonjs-node20-load", () => {
      const consumer = path.join(temporary, "consumer");
      fs.mkdirSync(consumer);
      fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "isolated-fluidity-package-validation", version: "1.0.0", private: true }), { flag: "wx" });
      run(node20, [npmCli, "install", "--prefix", consumer, archive, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--cache", path.join(temporary, "npm-cache")], consumer);
      const installed = path.join(consumer, "node_modules/@qualitzer/mobile-gateway");
      for (const file of files) ensure(hash(fs.readFileSync(safeFile(installed, file))) === hash(fs.readFileSync(path.join(packageDirectory, file))), "INSTALLED_ARTIFACT_BYTES_MISMATCH");
      const child = `const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const deny = () => { throw new Error("IO_FORBIDDEN"); };
globalThis.fetch = deny;
for (const name of ["node:http", "node:https"]) { const api = require(name); api.request = deny; api.get = deny; api.Server.prototype.listen = deny; }
const net = require("node:net"); net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;
require("node:tls").connect = deny;
for (const key of ["writeFileSync", "mkdirSync", "appendFileSync", "unlinkSync", "rmSync", "writeFile", "mkdir", "appendFile", "unlink", "rm", "createWriteStream"]) fs[key] = deny;
for (const key of ["writeFile", "mkdir", "appendFile", "unlink", "rm", "open"]) fs.promises[key] = deny;
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) require("node:child_process")[key] = deny;
const originalRead = fs.readFileSync;
fs.readFileSync = function(file, ...args) { assert.equal(typeof file, "string"); const relative = path.relative(process.cwd(), file); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); assert.ok(!/(?:^|[\\\\/])\\.(?:env|data)|\\.(?:key|pem|jks|keystore)$/i.test(file)); return originalRead.call(fs, file, ...args); };
const before = new Set(Object.keys(require.cache));
const api = require("@qualitzer/mobile-gateway");
assert.deepEqual(Object.keys(api), ["createEmbeddedGateway"]);
assert.equal(typeof api.createEmbeddedGateway, "function");
const loaded = Object.keys(require.cache).filter(file => !before.has(file));
assert.ok(loaded.every(file => file.startsWith(path.join(process.cwd(), "node_modules", "@qualitzer", "mobile-gateway") + path.sep)));
process.stdout.write(JSON.stringify({ node: process.version, exports: Object.keys(api), factoryCalled: false, dependencyFilesLoaded: loaded.length }));`;
      const result = JSON.parse(run(node20, ["-e", child], consumer));
      ensure(result.node === "v20.12.2" && result.factoryCalled === false, "LOAD_RESULT_INVALID");
      return { ...result, offlineInstall: true, installedFilesMatchArchive: true };
    });
    if (flags.repro) await check("optional-two-build-two-pack-reproducibility", async () => {
      const { build } = require("../pack-mobile-gateway.cjs");
      const archives = [];
      for (const name of ["first", "second"]) {
        const directory = path.join(temporary, name);
        await build(directory);
        for (const file of files) ensure(hash(fs.readFileSync(path.join(directory, file))) === hash(fs.readFileSync(path.join(packageDirectory, file))), "REBUILD_FILE_MISMATCH");
        const packed = JSON.parse(run(node20, [npmCli, "pack", "--ignore-scripts", "--json", "--offline", "--cache", path.join(temporary, "npm-cache")], directory));
        ensure(packed.length === 1 && packed[0].filename === archiveName, "REBUILD_ARCHIVE_NAME_INVALID");
        const rebuilt = safeFile(directory, archiveName);
        archiveEntries(rebuilt);
        const digest = hash(fs.readFileSync(rebuilt));
        ensure(digest === report.package.sha256, "REBUILD_ARCHIVE_HASH_MISMATCH");
        archives.push({ build: name, sha256: digest });
      }
      return { archives, matchesGeneratedArchive: true, publishedFilesReplaced: false };
    });
    else report.reproducibility = { requested: false, verifiedByThisRun: false };
    await check("source-only-documentation", () => {
      for (const relative of ["docs/EMBEDDED-GATEWAY.md", "docs/ACTUALIZACION-FLUIDEZ-MOVIL.md"]) {
        const text = tracked(root, relative).toString("utf8");
        ensure(text.includes(version) && text.includes("timer") && text.includes("checklist"), "DOCUMENT_CONTRACT_REFERENCE_MISSING");
      }
      ensure(hash(tracked(root, "docs/EMBEDDED-GATEWAY.md")) === hash(fs.readFileSync(path.join(packageDirectory, "README.md"))), "PACKAGED_README_MISMATCH");
      return { version, hardcodedExpectedArchiveHash: false };
    });
    await check("inputs-stable-before-copy", stable);
    await check("fixed-backend-copy-manifest", () => backendCopies(archiveBytes, manifestBytes, flags.copy));
    await check("observed-inputs-stable-at-completion", stable);
    report.passed = true;
  } catch (error) {
    report.error = /^[A-Z0-9_]+$/.test(error.message) ? error.message : "VALIDATION_FAILED";
  } finally {
    if (temporary) {
      try { ensure(contained(output, temporary), "CLEANUP_OUTSIDE_BOUNDARY"); fs.rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = true; }
      catch { report.temporaryRemoved = false; report.passed = false; }
    }
    report.completedAt = new Date().toISOString();
    if (output) fs.writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ passed: report.passed, package: report.package, error: report.error,
      report: output ? path.relative(root, path.join(output, "report.json")).split(path.sep).join("/") : null })}\n`);
    process.exitCode = report.passed ? 0 : 1;
  }
}

if (require.main === module) void main();