const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
const expected = "7875d88a0a80f696edabdec81130ec29adf90d5d592067f7a391c63a2a21d677";
const archiveName = "qualitzer-mobile-gateway-1.0.2.tgz";
const packageName = "@qualitzer/mobile-gateway";
const node20 = "C:/Users/faust/AppData/Local/nvm/v20.12.2/node.exe";
const npmCli = "C:/Users/faust/AppData/Local/nvm/v20.12.2/node_modules/npm/bin/npm-cli.js";
const tar = "C:/Windows/System32/tar.exe";
const files = ["LICENSE", "README.md", "SOURCE-MANIFEST.json", "THIRD-PARTY-LICENSES.md", "embedded-contract.d.ts", "index.cjs", "index.d.ts", "package.json"];
const report = { startedAt: new Date().toISOString(), passed: false, checks: [], limitations: [
  "No factory invocation, server startup, HTTP route test on the bundle, credentials, API, SQL or push delivery",
  "No backend installation, tests, lint or build; no APK inspection or build",
  "Source hashes establish correspondence at observation time, not a future source freeze or independent rebuild",
] };
let output;
let temporary;
const snapshots = new Map();
const hash = (bytes, algorithm = "sha256") => crypto.createHash(algorithm).update(bytes).digest("hex");
function ensure(value, code) { if (!value) throw new Error(code); }
function contained(base, target) {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function safeFile(base, relative, limit = 16 * 1024 * 1024) {
  ensure(typeof relative === "string" && !relative.includes("\\") && !relative.includes(":") && !relative.split("/").some((part) => !part || part.startsWith(".")), "UNSAFE_READ_PATH");
  ensure(!/(?:^|\/)(?:private|credentials|sessions)(?:\/|$)|\.(?:enc|key|pem|p12|jks|keystore)$/i.test(relative), "PRIVATE_READ_FORBIDDEN");
  const file = path.resolve(base, relative);
  ensure(contained(base, file) && contained(fs.realpathSync(base), fs.realpathSync(file)), "READ_OUTSIDE_BOUNDARY");
  const stat = fs.statSync(file);
  ensure(stat.isFile() && stat.size <= limit, "READ_SIZE_OR_TYPE_INVALID");
  return file;
}
function tracked(base, relative, limit) {
  const file = safeFile(base, relative, limit);
  const bytes = fs.readFileSync(file);
  const digest = hash(bytes);
  if (snapshots.has(file)) ensure(snapshots.get(file).sha256 === digest, "INPUT_CHANGED_DURING_VALIDATION");
  else snapshots.set(file, { base, relative, sha256: digest });
  return bytes;
}
function check(name, action) {
  try { report.checks.push({ name, passed: true, ...action() }); }
  catch (error) { report.checks.push({ name, passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "VALIDATION_STEP_FAILED" }); }
}
function env() {
  return { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: `${path.dirname(node20)};C:\\Windows\\System32`,
    TEMP: temporary, TMP: temporary, HOME: temporary, USERPROFILE: temporary, APPDATA: temporary, LOCALAPPDATA: temporary,
    NODE_ENV: "test", EXPO_NO_DOTENV: "1", NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_USERCONFIG: path.join(temporary, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(temporary, "global.npmrc") };
}
function run(executable, args, cwd = temporary) {
  const result = spawnSync(executable, args, { cwd, env: env(), encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 24 * 1024 * 1024 });
  ensure(!result.error && result.status === 0, "ISOLATED_COMMAND_FAILED");
  return result.stdout;
}
function sourceAllowed(relative) {
  return /^(?:node_modules\/|server\/|src\/domain\/)/.test(relative) || ["config/gatewayPolicy.js", "scripts/pack-mobile-gateway.cjs", "docs/EMBEDDED-GATEWAY.md", "LICENSE"].includes(relative);
}
function archiveEntries(archive) {
  const entries = run(tar, ["-tzf", archive]).trim().split(/\r?\n/).sort();
  ensure(JSON.stringify(entries) === JSON.stringify(files.map((file) => `package/${file}`).sort()), "ARCHIVE_ENTRY_ALLOWLIST_MISMATCH");
  const verbose = run(tar, ["-tvzf", archive]).trim().split(/\r?\n/);
  ensure(verbose.length === files.length && verbose.every((line) => line.startsWith("-")), "ARCHIVE_NON_REGULAR_ENTRY");
  return entries;
}
function validateDocument(base, relative) {
  const text = tracked(base, relative).toString("utf8").replace(/```[^\n]*\n[\s\S]*?```/g, "");
  const results = [];
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:)/i.test(href)) continue;
    const [rawFile, rawAnchor] = href.split("#");
    const target = path.resolve(path.dirname(path.join(base, relative)), decodeURIComponent(rawFile || path.basename(relative)));
    ensure(contained(base, target), "DOC_LINK_OUTSIDE_REPOSITORY");
    const local = path.relative(base, target).split(path.sep).join("/");
    safeFile(base, local, 256 * 1024 * 1024);
    if (rawAnchor) {
      ensure(local.endsWith(".md"), "UNSUPPORTED_DOC_ANCHOR");
      const linkedText = tracked(base, local).toString("utf8");
      const anchors = [...linkedText.matchAll(/^#{1,6}\s+(.+)$/gm)].map((heading) => heading[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-"));
      ensure(anchors.includes(decodeURIComponent(rawAnchor)), "DOC_ANCHOR_MISSING");
    }
    results.push({ target: local, exists: true, anchorChecked: Boolean(rawAnchor) });
  }
  ensure(text.includes(expected) && text.includes("1.0.2"), "DOC_ARTIFACT_REFERENCE_MISMATCH");
  return { document: relative, links: results };
}

try {
  const outputBase = path.join(root, "artifacts/logs/notification-package");
  fs.mkdirSync(outputBase, { recursive: true });
  ensure(contained(fs.realpathSync(root), fs.realpathSync(outputBase)), "OUTPUT_OUTSIDE_BOUNDARY");
  output = fs.mkdtempSync(path.join(outputBase, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  temporary = fs.mkdtempSync(path.join(output, "isolated-"));
  fs.writeFileSync(path.join(temporary, "user.npmrc"), "", { flag: "wx" });
  fs.writeFileSync(path.join(temporary, "global.npmrc"), "", { flag: "wx" });
  let archive;
  let packageDirectory;
  let manifest;
  let bundle;
  check("approved-archive-and-backend-copy", () => {
    const original = tracked(root, `artifacts/mobile-gateway/${archiveName}`);
    ensure(hash(original) === expected, "UNAPPROVED_ARCHIVE_HASH");
    ensure(hash(tracked(backend, `infrastructure/mobile-gateway/${archiveName}`)) === expected, "BACKEND_ARCHIVE_HASH_MISMATCH");
    archive = path.join(temporary, archiveName);
    fs.writeFileSync(archive, original, { flag: "wx" });
    return { sha256: expected, bytes: original.length, backendCopyIdentical: true };
  });
  check("archive-structure-and-manifest", () => {
    ensure(archive, "APPROVED_ARCHIVE_REQUIRED");
    const entries = archiveEntries(archive);
    packageDirectory = path.join(temporary, "package");
    fs.mkdirSync(packageDirectory);
    for (const file of files) {
      const bytes = spawnSync(tar, ["-xOf", archive, `package/${file}`], { cwd: temporary, env: env(), timeout: 30000, maxBuffer: 24 * 1024 * 1024, windowsHide: true });
      ensure(!bytes.error && bytes.status === 0, "TAR_ENTRY_READ_FAILED");
      fs.writeFileSync(path.join(packageDirectory, file), bytes.stdout, { flag: "wx" });
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
    ensure(pkg.name === packageName && pkg.version === "1.0.2" && pkg.type === "commonjs" && pkg.main === "./index.cjs", "PACKAGE_IDENTITY_INVALID");
    ensure(pkg.engines.node === ">=20.12.2" && pkg.exports["."].require === "./index.cjs", "PACKAGE_EXPORT_OR_ENGINE_INVALID");
    ensure(Object.keys(pkg.dependencies ?? {}).length === 0 && !pkg.scripts && !pkg.optionalDependencies && !pkg.peerDependencies && !pkg.devDependencies, "PACKAGE_NOT_SELF_CONTAINED");
    manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, "SOURCE-MANIFEST.json"), "utf8"));
    bundle = fs.readFileSync(path.join(packageDirectory, "index.cjs"), "utf8");
    ensure(manifest.name === packageName && manifest.version === "1.0.2" && manifest.target === "node20.12.2" && manifest.bundleSha256 === hash(Buffer.from(bundle)), "BUNDLE_MANIFEST_MISMATCH");
    return { entries, target: manifest.target, bundleSha256: manifest.bundleSha256 };
  });
  check("source-provenance", () => {
    ensure(manifest && Array.isArray(manifest.sources), "SOURCE_MANIFEST_REQUIRED");
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
      ensure(dependency.location.startsWith("node_modules/"), "DEPENDENCY_LOCATION_INVALID");
      const bytes = tracked(root, `${dependency.location}/package.json`);
      const pkg = JSON.parse(bytes);
      ensure(hash(bytes) === dependency.manifestSha256 && pkg.name === dependency.name && pkg.version === dependency.version, "DEPENDENCY_MANIFEST_MISMATCH");
    }
    report.gatewayVersionInputs = { appJsonIncluded: seen.has("app.json"), appConfigIncluded: seen.has("app.config.ts"), packerIncluded: seen.has("scripts/pack-mobile-gateway.cjs"), apkVersionNotValidated: true };
    ensure(!seen.has("app.json") && !seen.has("app.config.ts"), "UNEXPECTED_APP_CONFIG_INPUT");
    return { sourcesVerified: seen.size, dependencyManifestsVerified: manifest.dependencies.length, verifiedAt: new Date().toISOString() };
  });
  check("notification-contract-static-presence", () => {
    ensure(manifest && bundle, "BUNDLE_REQUIRED");
    const required = ["server/notifications/routes.ts", "src/domain/notifications.ts"];
    for (const file of required) {
      const entry = manifest.sources.find((source) => source.path === file);
      ensure(entry && hash(tracked(root, file)) === entry.sha256, "NOTIFICATION_SOURCE_NOT_CURRENT");
    }
    const routes = tracked(root, required[0]).toString("utf8");
    ensure(/z\.enum\(\["true", "false"\]\)/.test(routes) && /branchQuery = z\.object\([\s\S]*?\.strict\(\)/.test(routes), "STRICT_FILTER_SOURCE_MISSING");
    ensure(/unreadOnly: \w+\.enum\(\["true", "false"\]\)\.optional\(\)/.test(bundle), "BUNDLE_STRICT_FILTER_MISSING");
    const markers = ['router.delete("/inbox/:id"', 'enum(["true", "false"]).optional()', 'query.set("unreadOnly", "true")', "notificationDeleteResultSchema", "unreadCount:", "total:", "canDelete:"];
    ensure(markers.every((marker) => bundle.includes(marker)), "BUNDLE_NOTIFICATION_MARKER_MISSING");
    const oldArchive = safeFile(root, "artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz");
    tracked(root, "artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz");
    archiveEntries(oldArchive);
    const oldBundle = run(tar, ["-xOf", oldArchive, "package/index.cjs"]);
    return { sourceRefs: required, markers: markers.map((marker) => ({ marker, present: true, presentInOldBundle: oldBundle.includes(marker) })), httpTestedOnBundle: false };
  });
  check("backend-package-lock-local-reference", () => {
    const pkg = JSON.parse(tracked(backend, "package.json"));
    const lock = JSON.parse(tracked(backend, "package-lock.json"));
    const reference = `file:infrastructure/mobile-gateway/${archiveName}`;
    const entry = lock.packages?.[`node_modules/${packageName}`];
    ensure(pkg.dependencies?.[packageName] === reference && lock.packages?.[""].dependencies?.[packageName] === reference, "BACKEND_REFERENCE_MISMATCH");
    ensure(entry?.version === "1.0.2" && entry.resolved === reference, "BACKEND_LOCK_PACKAGE_MISMATCH");
    const integrity = `sha512-${crypto.createHash("sha512").update(fs.readFileSync(archive)).digest("base64")}`;
    ensure(entry.integrity === integrity, "BACKEND_LOCK_INTEGRITY_MISMATCH");
    return { version: entry.version, localReference: reference, integrityMatches: true, installedBackendNotInspected: true };
  });
  check("actual-node20-commonjs-package-load", () => {
    ensure(packageDirectory && manifest && archive && report.checks.find((item) => item.name === "archive-structure-and-manifest")?.passed, "VERIFIED_PACKAGE_REQUIRED");
    ensure(run(node20, ["--version"]).trim() === "v20.12.2", "EXACT_NODE20_UNAVAILABLE");
    const consumer = path.join(temporary, "consumer");
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "isolated-notification-package-validation", version: "1.0.0", private: true }), { flag: "wx" });
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
for (const key of ["writeFileSync", "mkdirSync", "appendFileSync", "unlinkSync", "rmSync"]) fs[key] = deny;
const originalRead = fs.readFileSync;
fs.readFileSync = function(file, ...args) { assert.equal(typeof file, "string"); const relative = path.relative(process.cwd(), file); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); assert.ok(!/(?:^|[\\\\/])\\.(?:env|data)|\\.(?:key|pem|jks|keystore)$/i.test(file)); return originalRead.call(fs, file, ...args); };
const before = new Set(Object.keys(require.cache));
const api = require("@qualitzer/mobile-gateway");
assert.deepEqual(Object.keys(api), ["createEmbeddedGateway"]);
assert.equal(typeof api.createEmbeddedGateway, "function");
const loaded = Object.keys(require.cache).filter(file => !before.has(file));
assert.ok(loaded.every(file => file.startsWith(path.join(process.cwd(), "node_modules", "@qualitzer", "mobile-gateway") + path.sep)));
process.stdout.write(JSON.stringify({ node: process.version, exports: Object.keys(api), factoryType: typeof api.createEmbeddedGateway, factoryCalled: false, dependencyFilesLoaded: loaded.length }));`;
    const result = JSON.parse(run(node20, ["-e", child], consumer));
    ensure(result.node === "v20.12.2" && result.factoryCalled === false, "LOAD_RESULT_INVALID");
    return { ...result, offlineInstall: true, ignoreScripts: true, installedFilesMatchArchive: true };
  });
  check("backend-document-links", () => validateDocument(backend, "docs/ACTUALIZACION-NOTIFICACIONES-MOVILES.md"));
  check("mobile-document-links", () => validateDocument(root, "docs/ACTUALIZACION-1.0.8.md"));
  check("observed-inputs-stable-at-completion", () => {
    const changed = [];
    for (const [file, snapshot] of snapshots) {
      safeFile(snapshot.base, snapshot.relative);
      if (hash(fs.readFileSync(file)) !== snapshot.sha256) changed.push(`${snapshot.base === root ? "Mobile" : "Backend"}/${snapshot.relative}`);
    }
    report.changedInputs = changed;
    ensure(changed.length === 0, "INPUTS_CHANGED_RECHECK_REQUIRED");
    return { hashedFiles: snapshots.size, checkedAt: new Date().toISOString(), sourceFreezeClaimed: false };
  });
  report.passed = report.checks.every((item) => item.passed);
} catch (error) {
  report.error = /^[A-Z0-9_]+$/.test(error.message) ? error.message : "VALIDATION_SETUP_FAILED";
} finally {
  if (temporary) {
    try { ensure(contained(output, temporary), "CLEANUP_OUTSIDE_BOUNDARY"); fs.rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = true; }
    catch { report.temporaryRemoved = false; report.passed = false; }
  }
  report.completedAt = new Date().toISOString();
  if (output) fs.writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ passed: report.passed, checks: report.checks.map(({ name, passed, code }) => ({ name, passed, code })), report: output ? path.relative(root, path.join(output, "report.json")).split(path.sep).join("/") : null })}\n`);
  process.exitCode = report.passed ? 0 : 1;
}