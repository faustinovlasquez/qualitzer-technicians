"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gunzipSync, inflateRawSync } = require("node:zlib");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
const validationFolder = "artifacts/logs/time-sync/2026-09-14T18-59-55-831Z";
const uiFolder = "artifacts/logs/time-sync-ui/2026-09-14T19-14-37-286Z";
const priorFolder = "artifacts/logs/time-sync-audit/2026-09-14T19-07-19-044Z-5EuPxD";
const buildFolder = "artifacts/logs/2026-09-14T19-04-20-866Z";
const nativeFolder = "artifacts/logs/native-release-1.0.14";
const apkFile = "artifacts/qualitzer-tecnicos-1.0.14-android.apk";
const apkSha = "e1ff7482d8e8b35f9d4159b55aa8810feb8328c938d568af0fbded74dc55a24c";
const oldSha = "a2c2d1f52394499230f12b4ed2f3a195d71d48a43a007cb1a06e8fec570ec3cf";
const certificate = "06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510";
const gatewayName = "qualitzer-mobile-gateway-1.0.4.tgz";
const gatewaySha = "b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae";
const ownFile = "scripts/testing/time-sync-release-audit.cjs";
const observed = new Map();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const normalize = file => file.replaceAll("\\", "/");
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const runtime = file => file === "App.tsx" || /^(?:src|server)\/.+\.(?:tsx?|js)$/.test(file) && !file.includes("/tests/");
const backendFiles = new Set(["package.json", "package-lock.json", "node_modules/@qualitzer/mobile-gateway/package.json", "node_modules/@qualitzer/mobile-gateway/index.cjs",
  "scripts/check-mobile-sync-deployment.cjs", "docs/diagnostics/mobile-sync-deployment.md",
  ...["", ".sha256", ".source-manifest.json"].map(suffix => `infrastructure/mobile-gateway/${gatewayName}${suffix}`),
  ...["mobileSync/domain/MobileSyncValidation", "mobileSync/infrastructure/MobileSyncOperations", "mobileSync/infrastructure/MobileSync.dependencies", "mobileSync/infrastructure/MobileSync.controller", "mobileSync/infrastructure/MobileSync.routes", "app.routes"]
    .flatMap(file => [`src/${file}.ts`, `build/src/${file}.js`])]);
const report = { startedAt: new Date().toISOString(), completed: false, passed: false, scope: "READ_ONLY_PUBLISHED_MOBILE_1_0_14", checks: [], findings: [],
  effects: { writes: "NEW_AUDIT_REPORTS_ONLY", testsExecuted: false, typesExecuted: false, buildExecuted: false, backendExecuted: false,
    diagnosticExecuted: false, applicationImported: false, subprocessStarted: false, networkExecuted: false, nativeExecuted: false,
    privateFilesRead: false, environmentRead: false, sqlExecuted: false, queueReadOrWritten: false, downloadServerStarted: false },
  limitations: ["Historical tests and native observations are not rerun. This audit is not physical-device or remote-deployment proof.",
    "Signature evidence is bound to freshly hashed identical APK bytes; no new cryptographic signature verification is executed.",
    "The generated source map is bound by publication hashes and the actual APK bundle; source maps are not themselves embedded in the APK.",
    "UI runner scripts have no historical hash record in the UI report; current hashes alone cannot establish their historical identity.",
    "Full validation did not hash test files. Current test scripts are recorded, not falsely certified identical to their historical execution.",
    "No real pending UUID, payload, account, database, environment or private storage is inspected. Pending operations are not claimed remotely applied.",
    "Before/after observations cannot detect transient edits. Counts describe different overlapping inventories, not additive test totals."] };
let output;

function safePath(base, relative, directory = false) {
  ensure([root, backend].includes(base) && typeof relative === "string" && /^[a-zA-Z0-9_@/ .+()-]+$/.test(relative)
    && !relative.split("/").some(part => !part || part.startsWith("."))
    && !/(?:^|\/)(?:private|credentials|sessions)(?:\/|$)|\.(?:env|enc|key|pem|p12|jks|keystore)$/i.test(relative), "UNSAFE_PATH");
  let current = path.parse(base).root;
  const absolute = path.join(base, ...relative.split("/"));
  const parts = path.relative(current, absolute).split(path.sep);
  parts.forEach((part, index) => {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    ensure(!stat.isSymbolicLink(), "SYMLINK_FORBIDDEN");
    ensure(index < parts.length - 1 || directory ? stat.isDirectory() : stat.isFile() && stat.size <= 128 * 1024 * 1024, "INVALID_FILE_TYPE_OR_SIZE");
  });
  return absolute;
}

function read(file, base = root) {
  if (base === backend) ensure(backendFiles.has(file), "BACKEND_READ_NOT_ALLOWED");
  const bytes = fs.readFileSync(safePath(base, file));
  const key = `${base}\n${file}`;
  const sha256 = digest(bytes);
  if (observed.has(key)) ensure(observed.get(key).sha256 === sha256, "OBSERVED_INPUT_CHANGED");
  else observed.set(key, { repository: base === root ? "Mobile" : "Backend", path: file, bytes: bytes.length, sha256 });
  return bytes;
}
const text = (file, base) => read(file, base).toString("utf8");
const json = (file, base) => JSON.parse(text(file, base));
const errorCode = error => /^(?:ENOENT|ENOTDIR)$/.test(error.code) ? "MISSING_INPUT" : /^[A-Z0-9_]+$/.test(error.message) ? error.message : "EVIDENCE_CHECK_FAILED";
function check(name, action) {
  try { report.checks.push({ name, ...action(), passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, code: errorCode(error) }); }
}
function hashes(entries, base = root) {
  ensure(entries.length > 0 && new Set(entries.map(([file]) => file)).size === entries.length, "EMPTY_OR_DUPLICATE_HASH_LIST");
  const items = entries.map(([file, expected]) => {
    ensure(/^[a-f0-9]{64}$/.test(expected), "INVALID_HASH");
    try { const current = digest(read(file, base)); return { path: file, expected, current, matches: current === expected }; }
    catch (error) { return { path: file, expected, matches: false, code: errorCode(error) }; }
  });
  return { count: items.length, matched: items.filter(item => item.matches).length, differences: items.filter(item => !item.matches), items };
}
function inventory(folder) {
  return fs.readdirSync(safePath(root, folder, true), { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".") || ["tests", "node_modules", "build"].includes(entry.name)) return [];
    ensure(!entry.isSymbolicLink(), "INVENTORY_SYMLINK");
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory() ? inventory(file) : /\.(?:tsx?|js)$/.test(file) ? [file] : [];
  });
}
function latest(folder) {
  const parent = path.posix.dirname(folder);
  const names = fs.readdirSync(safePath(root, parent, true)).filter(name => /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(name)).sort();
  ensure(names.at(-1) === path.posix.basename(folder), "NEWER_EVIDENCE_EXISTS");
}

function zip(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  ensure(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0, "ZIP_DIRECTORY_INVALID");
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    ensure(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50, "ZIP_ENTRY_INVALID");
    const length = bytes.readUInt16LE(offset + 28);
    const next = offset + 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString("utf8");
    ensure(next <= end && !entries.has(name) && !(bytes.readUInt16LE(offset + 8) & 1), "ZIP_ENTRY_DUPLICATE_OR_ENCRYPTED");
    entries.set(name, { local: bytes.readUInt32LE(offset + 42), size: bytes.readUInt32LE(offset + 20), unpacked: bytes.readUInt32LE(offset + 24), method: bytes.readUInt16LE(offset + 10) });
    offset = next;
  }
  return name => {
    const entry = entries.get(name);
    ensure(entry && entry.local + 30 <= bytes.length && bytes.readUInt32LE(entry.local) === 0x04034b50, "ZIP_REQUIRED_ENTRY_MISSING");
    const start = entry.local + 30 + bytes.readUInt16LE(entry.local + 26) + bytes.readUInt16LE(entry.local + 28);
    ensure(start + entry.size <= bytes.length && entry.unpacked <= 32 * 1024 * 1024 && [0, 8].includes(entry.method), "ZIP_RANGE_INVALID");
    const compressed = bytes.subarray(start, start + entry.size);
    const result = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
    ensure(result.length === entry.unpacked, "ZIP_SIZE_INVALID");
    return result;
  };
}
function tar(bytes) {
  const unpacked = gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 });
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= unpacked.length) {
    const header = unpacked.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const encoded = header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim();
    ensure(/^[0-7]+$/.test(encoded), "TAR_SIZE_INVALID");
    const size = Number.parseInt(encoded, 8);
    ensure([0, 48].includes(header[156]) && !entries.has(name) && offset + 512 + size <= unpacked.length, "TAR_ENTRY_INVALID");
    entries.set(name, unpacked.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function main() {
  ensure(process.argv.length === 2, "ARGUMENTS_NOT_ALLOWED");
  const parent = path.join(safePath(root, "artifacts/logs", true), "time-sync-release-audit");
  if (!fs.existsSync(parent)) fs.mkdirSync(parent);
  safePath(root, "artifacts/logs/time-sync-release-audit", true);
  output = fs.mkdtempSync(path.join(parent, `${report.startedAt.replace(/[:.]/g, "-")}-`));
  read(ownFile);
  const validation = json(`${validationFolder}/report.json`);
  const ui = json(`${uiFolder}/report.json`);
  const publication = json("artifacts/release-verification-1.0.14.json");
  const prior = json(`${priorFolder}/report.json`);
  const initialInventory = ["App.tsx", ...inventory("src"), ...inventory("server")].sort();

  check("full-validation-all-recorded-inputs-and-225-runtime-sources", () => {
    latest(validationFolder);
    ensure(validation.passed && validation.completedAt && !validation.changedSources.length && JSON.stringify(validation.sourceHashesBefore) === JSON.stringify(validation.sourceHashesAfter), "VALIDATION_HISTORY_INVALID");
    report.validationInputs = hashes(Object.entries(validation.sourceHashesAfter));
    const runtimePaths = Object.keys(validation.sourceHashesAfter).filter(runtime);
    report.runtimeInventory = { count: runtimePaths.length, client: runtimePaths.filter(file => !file.startsWith("server/")).length,
      server: runtimePaths.filter(file => file.startsWith("server/")).length, paths: runtimePaths };
    ensure(runtimePaths.length === 225 && same(runtimePaths, initialInventory) && !report.validationInputs.differences.length, "VALIDATION_INPUT_CHANGED");
    return { runtime: runtimePaths.length, allRecordedInputs: report.validationInputs.count, ignoredHashes: [] };
  });

  check("recorded-tests-1663-unique-and-225-overlapping-focused", () => {
    const evidence = {};
    for (const name of ["mobile-official-suite", "supplemental-client-tests", "focused-tests"]) {
      const log = text(`${validationFolder}/${name}.log`);
      const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
        const found = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
        ensure(found.length === 1, "LOG_COUNTS_AMBIGUOUS");
        return [key, Number(found[0][1])];
      }));
      const phase = validation.phases.find(item => item.name === name);
      ensure(phase?.exitCode === 0 && phase.complete && Object.entries(counts).every(([key, value]) => phase.counts[key] === value)
        && counts.fail === 0 && counts.cancelled === 0 && counts.todo === 0, "TEST_LOG_MISMATCH");
      const names = log.split(/\r?\n/).filter(line => /^\u2714 /.test(line)).map(line => line.replace(/^\u2714 /, "").replace(/ \([0-9.]+ms\)$/, ""));
      ensure(names.length === counts.pass, "PASS_NAMES_MISMATCH");
      evidence[name] = { counts, names };
    }
    const official = evidence["mobile-official-suite"], supplemental = evidence["supplemental-client-tests"], focus = evidence["focused-tests"];
    ensure(official.counts.pass === 1582 && supplemental.counts.pass === 81 && focus.counts.pass === 225
      && supplemental.names.every(name => !official.names.includes(name)) && focus.names.every(name => official.names.includes(name) || supplemental.names.includes(name)), "TEST_OVERLAP_INVALID");
    ensure(validation.uniqueFullCounts.pass === 1663 && validation.uniqueFullCounts.skipped === 1
      && validation.excludedDuplicateEntries.includes("tests/sync-user-presentation-ui.test.tsx")
      && text("tests/sync-user-presentation.test.ts").trim() === 'import "./sync-user-presentation-ui.test";', "DEDUPLICATION_INVALID");
    const types = validation.phases.filter(phase => phase.name.endsWith("-types"));
    ensure(types.length === 3 && types.every(phase => phase.exitCode === 0 && phase.diagnostics === 0), "TYPE_HISTORY_INVALID");
    report.testEvidence = { uniquePass: 1663, skipped: 1, failed: 0, focusedAlreadyIncluded: 225, historicalTypes: types, logs: evidence, rerun: false };
    return { uniquePass: 1663, skipped: 1, focusedOverlap: 225, rerun: false };
  });

  check("ui-48-source-hashes-screenshot-hashes-and-current-runner-inventory", () => {
    latest(uiFolder);
    ensure(ui.passed && ui.finishedAt && ui.tests.length === 48 && ui.tests.every(test => test.passed) && !ui.types.length && !ui.errors.length && !ui.sourceChanges.length
      && ui.counts.passed === 48 && ui.counts.failed === 0 && ui.assertionCount === 1753 && ui.counts.assertionsExecuted === 1753
      && ui.screenshots.length === 72 && same(ui.screenshots, Object.keys(ui.screenshotHashes)), "UI_HISTORY_INVALID");
    report.uiSources = hashes(Object.entries(ui.sources));
    report.uiScreenshots = hashes(Object.entries(ui.screenshotHashes));
    ensure(!report.uiSources.differences.length && !report.uiScreenshots.differences.length, "UI_EVIDENCE_CHANGED");
    const overlap = Object.entries(ui.sources).filter(([file]) => runtime(file));
    ensure(overlap.every(([file, hash]) => validation.sourceHashesAfter[file] === hash), "UI_VALIDATION_SOURCE_MISMATCH");
    const scripts = ["tests/e2e/time-sync/smoke.cjs", "tests/e2e/time-sync/scenarios.cjs", "tests/e2e/time-sync/fixture.tsx", "tests/e2e/picker-messages-smoke.cjs", "tests/e2e/picker-messages-fixture.tsx"];
    report.uiRunnerInventory = scripts.map(file => ({ path: file, sha256: digest(read(file)), historicalSha256: ui.sources[file] ?? null,
      historicalIdentityVerified: ui.sources[file] !== undefined && ui.sources[file] === digest(read(file)) }));
    report.findings.push({ code: "UI_RUNNER_HISTORICAL_HASH_NOT_RECORDED", paths: report.uiRunnerInventory.filter(item => !item.historicalIdentityVerified).map(item => item.path), blockingApkByteAudit: false });
    report.uiEvidence = { counts: ui.counts, sourceCount: report.uiSources.count, overlapWithFullRuntime: overlap.length, runner: report.uiRunnerInventory, rerun: false };
    return { cases: 48, assertions: 1753, screenshots: 72, sources: report.uiSources.count, currentRunnerFiles: scripts.length, historicalRunnerHashGap: true };
  });

  check("published-apk-bytes-signature-record-and-retained-1-0-13", () => {
    const bytes = read(apkFile);
    const previousFile = "artifacts/qualitzer-tecnicos-1.0.13-android.apk";
    const previous = read(previousFile);
    const audit = json("artifacts/final-audit-1.0.14.json");
    ensure(bytes.length === 69703631 && digest(bytes) === apkSha && previous.length === 69180083 && digest(previous) === oldSha, "APK_BYTES_CHANGED");
    for (const item of [publication, audit]) ensure(normalize(item.apk) === apkFile && item.sha256 === apkSha && item.bytes === bytes.length, "APK_REPORT_MISMATCH");
    ensure(publication.package === "com.qualitzer.field" && publication.version === "1.0.14" && publication.versionCode === 15 && !publication.debuggable
      && publication.certificateSha256 === certificate && publication.phases.every(phase => phase.exitCode === 0)
      && audit.certificateMatchesPrevious && audit.previousApkUnchanged && audit.sourceProvenanceMatches && !audit.addedPermissions.length
      && publication.previousApk.sha256 === oldSha && publication.previousApk.signerMatches && publication.previousApk.unchanged, "PUBLICATION_INVALID");
    for (const [file, hash] of [[apkFile, apkSha], [previousFile, oldSha]]) ensure(text(`${file}.sha256`).trim() === `${hash}  ${path.posix.basename(file)}`, "CHECKSUM_SIDECAR_MISMATCH");
    const signaturePath = normalize(publication.phases.find(phase => phase.name === "verify-signature").log);
    const signature = text(signaturePath);
    ensure(signature.includes("Verified using v2 scheme (APK Signature Scheme v2): true") && signature.includes(`Signer #1 certificate SHA-256 digest: ${certificate}`)
      && signature.includes("Number of signers: 1") && signature.includes("END verify-signature EXIT=0"), "SIGNATURE_LOG_INVALID");
    const entry = zip(bytes);
    const bundle = entry("assets/index.android.bundle");
    const config = JSON.parse(entry("assets/app.config"));
    ensure(bundle.length === publication.bundleBytes && digest(bundle) === publication.bundleSha256
      && bundle.subarray(0, 8).toString("hex") === "c61fbc03c103191f" && config.version === "1.0.14" && config.android.versionCode === 15
      && config.android.package === publication.package && config.extra.gateway.standalone && config.updates.enabled === false, "APK_EMBEDDED_CONTENT_MISMATCH");
    report.apk = { path: apkFile, bytes: bytes.length, sha256: apkSha, certificateSha256: certificate, signatureLog: signaturePath,
      signatureReexecuted: false, actualBundleSha256: digest(bundle), version: "1.0.14", versionCode: 15, previousSha256: oldSha, previousUnchanged: true };
    return report.apk;
  });

  check("published-build-capture-and-all-embedded-project-sources", () => {
    const capture = json(`${buildFolder}/source-capture.json`);
    const phases = json(`${buildFolder}/phases.json`);
    ensure(["prebuild", "assemble-release", "apk-manifest"].every(name => phases.some(phase => phase.name === name && phase.exitCode === 0)), "BUILD_HISTORY_INVALID");
    report.capture = hashes(capture.map(item => [item.file, item.sha256]));
    report.publishedSources = hashes(publication.provenance.sources.map(item => [item.file, item.sha256]));
    ensure(!report.capture.differences.length && !report.publishedSources.differences.length && same(capture.map(item => item.file), publication.provenance.sources.map(item => item.file)), "CAPTURE_CHANGED");
    const mapFile = "android/app/build/generated/sourcemaps/react/release/index.android.bundle.map";
    const mapBytes = read(mapFile);
    const generated = read("android/app/build/generated/assets/react/release/index.android.bundle");
    ensure(digest(mapBytes) === publication.provenance.sourceMapSha256 && digest(generated) === publication.bundleSha256
      && publication.provenance.generatedBundleSha256 === publication.bundleSha256, "MAP_OR_GENERATED_BUNDLE_CHANGED");
    const map = JSON.parse(mapBytes);
    for (const item of publication.provenance.sources) {
      const indices = map.sources.flatMap((name, index) => [item.file, `/${item.file}`].includes(normalize(name)) ? [index] : []);
      ensure(indices.length === 1 && typeof map.sourcesContent[indices[0]] === "string" && digest(Buffer.from(map.sourcesContent[indices[0]])) === item.sha256
        && item.matches && item.embeddedSha256 === item.sha256 && validation.sourceHashesAfter[item.file] === item.sha256
        && capture.find(source => source.file === item.file)?.sha256 === item.sha256, "EMBEDDED_CRITICAL_SOURCE_MISMATCH");
    }
    const ownSources = map.sources.flatMap((name, index) => {
      const file = normalize(name).replace(/^\//, "");
      if (!/^(?:App\.tsx|index\.ts|(?:src|config|modules)\/.+\.(?:tsx?|[cm]?js|json))$/.test(file)) return [];
      ensure(typeof map.sourcesContent[index] === "string", "MAP_SOURCE_CONTENT_MISSING");
      return [[file, digest(Buffer.from(map.sourcesContent[index]))]];
    });
    report.embeddedProjectSources = hashes(ownSources);
    ensure(!report.embeddedProjectSources.differences.length && ownSources.some(([file]) => file === "src/ui/time/TimePickerPanel.native.tsx"), "EMBEDDED_PROJECT_SOURCE_CHANGED");
    report.buildEvidence = { captured: capture.length, published: publication.provenance.sources.length, allEmbeddedProjectModules: ownSources.length,
      mapSources: map.sources.length, mapPath: mapFile, mapSha256: digest(mapBytes), profileExact: validation.sourceHashesAfter["src/screens/ProfileScreen.tsx"] === digest(read("src/screens/ProfileScreen.tsx")) };
    return report.buildEvidence;
  });

  check("gateway-immutable-archive-all-manifest-sources-and-dependencies", () => {
    const bytes = read(`artifacts/mobile-gateway/${gatewayName}`);
    ensure(digest(bytes) === gatewaySha && bytes.length === 585030, "GATEWAY_ARCHIVE_CHANGED");
    const entries = tar(bytes);
    const manifest = JSON.parse(entries.get("package/SOURCE-MANIFEST.json"));
    const pkg = JSON.parse(entries.get("package/package.json"));
    ensure(pkg.version === "1.0.4" && pkg.name === "@qualitzer/mobile-gateway" && manifest.version === pkg.version && digest(entries.get("package/index.cjs")) === manifest.bundleSha256, "GATEWAY_IDENTITY_INVALID");
    report.gatewaySources = hashes(manifest.sources.map(item => [item.path, item.sha256]));
    report.gatewayDependencies = hashes(manifest.dependencies.map(item => [`${item.location}/package.json`, item.manifestSha256]));
    ensure(report.gatewaySources.count === 351 && report.gatewayDependencies.count === 91 && !report.gatewaySources.differences.length && !report.gatewayDependencies.differences.length, "GATEWAY_MANIFEST_INPUT_CHANGED");
    const installed = json("node_modules/@qualitzer/mobile-gateway/package.json", backend);
    const installedHash = digest(read("node_modules/@qualitzer/mobile-gateway/index.cjs", backend));
    report.gateway = { version: pkg.version, sha256: gatewaySha, sourceCount: 351, dependencyManifests: 91, newPackageNeededForRecordedInputs: false,
      installedLocalVersion: installed.version, installedLocalBundleSha256: installedHash, localInstalledMatchesRelease: installed.version === pkg.version && installedHash === manifest.bundleSha256, remoteVerified: false };
    if (!report.gateway.localInstalledMatchesRelease) report.findings.push({ code: "LOCAL_INSTALLED_GATEWAY_DIFFERS", expected: pkg.version, observed: installed.version, remoteStateUnknown: true });
    return report.gateway;
  });

  check("prior-read-only-audit-all-observations-current-no-reexecution", () => {
    ensure(prior.auditPassed && prior.completed, "PRIOR_AUDIT_INVALID");
    const previous = json(`${priorFolder}/observed-hashes.json`);
    const results = ["Mobile", "Backend"].map(repository => {
      const items = previous.filter(item => item.repository === repository);
      return { repository, ...hashes(items.map(item => [item.path, item.sha256]), repository === "Mobile" ? root : backend) };
    });
    report.priorAuditRevalidation = results;
    ensure(results.every(item => !item.differences.length), "PRIOR_AUDIT_INPUT_CHANGED");
    return { observations: previous.length, backendDiagnosticExecuted: false, priorAuditExecuted: false, localInstalledVersion: prior.backendInstalled.version };
  });

  check("picker-9-1-0-package-lock-native-manifest-and-dex", () => {
    const name = "@react-native-community/datetimepicker";
    const base = `node_modules/${name}`;
    const pkg = json(`${base}/package.json`);
    ensure(pkg.version === "9.1.0" && json("package.json").dependencies[name] === "9.1.0" && json("package-lock.json").packages[base].version === "9.1.0", "PICKER_VERSION_MISMATCH");
    const manifest = text(`${base}/android/src/main/AndroidManifest.xml`);
    ensure(!/uses-permission|<activity\b|<service\b|<receiver\b|<provider\b/.test(manifest), "PICKER_MANIFEST_UNEXPECTED_COMPONENT");
    const getEntry = zip(read(apkFile));
    const dexMarkers = ["Lcom/reactcommunity/rndatetimepicker/RNDateTimePickerPackage;", "Lcom/reactcommunity/rndatetimepicker/TimePickerModule;"];
    const found = new Set();
    for (let index = 1; index <= 20; index++) {
      const name = index === 1 ? "classes.dex" : `classes${index}.dex`;
      let bytes;
      try { bytes = getEntry(name); } catch (error) { if (error.message === "ZIP_REQUIRED_ENTRY_MISSING") break; throw error; }
      for (const marker of dexMarkers) if (bytes.includes(Buffer.from(marker))) found.add(marker);
    }
    report.picker = { version: pkg.version, manifestSha256: digest(Buffer.from(manifest)), declaredPermissions: 0, dexMarkers: dexMarkers.map(marker => ({ marker, present: found.has(marker) })) };
    ensure(dexMarkers.every(marker => found.has(marker)), "PICKER_NATIVE_DEX_MISSING");
    return report.picker;
  });

  check("native-recorded-install-startup-and-picker-captures", () => {
    const startup = json(`${nativeFolder}/push-client-startup.json`);
    const verified = json(`${nativeFolder}/verified-apk.json`);
    const install = json(`${nativeFolder}/2026-09-14T19-18-41-343Z-time-sync-update.json`);
    ensure(startup.apkSha256 === apkSha && startup.installedApkMatches && startup.versionCode === 15 && startup.version === "1.0.14" && !startup.fatalError
      && startup.firebaseInitializationSuccessful && startup.serial === "emulator-5580" && verified.certificate === certificate
      && verified.inspection.bundleSha256 === publication.bundleSha256 && install.result.includes("Success") && install.version.some(line => line.includes("versionName=1.0.14")), "NATIVE_HISTORY_MISMATCH");
    const examples = ["2026-09-14T19-29-53-753Z-time14-native-picker", "2026-09-14T19-31-56-241Z-time14-confirmed", "2026-09-14T19-35-12-857Z-time14-reopen", "2026-09-14T19-36-10-910Z-time14-cancelled"];
    const captures = examples.map(name => {
      const item = json(`${nativeFolder}/${name}.json`);
      ensure(item.capture.stable && item.capture.pid === startup.pid && item.capture.errorLines.length === 0 && item.serial === startup.serial, "NATIVE_CAPTURE_HISTORY_INVALID");
      const file = normalize(item.capture.screen), bytes = read(file);
      ensure(bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", "NATIVE_IMAGE_MISSING");
      return { path: file, sha256: digest(bytes), bytes: bytes.length, pid: item.capture.pid, recordedAt: item.at };
    });
    read(startup.screenshot);
    report.nativeEvidence = { version: startup.version, recordedInstalledHash: startup.apkSha256, recordedPid: startup.pid, api: startup.api,
      captures, rerun: false, physicalDeviceTested: false, screenshotExistenceIsNotBehaviorAssertion: true };
    return { captures: captures.length, recordedInstalledMatchesPublished: true, physicalDeviceTested: false, nativeRerun: false };
  });

  check("automatic-pending-fixture-evidence-and-current-test-source-inventory", () => {
    const file = "tests/time-sync-integration.test.ts";
    const source = text(file);
    ensure(source.includes("new OfflineEngine(storage.dependencies)") && source.includes("MOBILE_SYNC_ACTIONS_UNAVAILABLE")
      && source.includes("t.mock.timers.tick(59_999)") && source.includes("t.mock.timers.tick(1)")
      && source.includes("assert.deepEqual(sent[2], sent[0]") && source.includes("assert.equal(manualCalls + legacyCalls, 1"), "AUTOMATIC_FIXTURE_ASSERTIONS_MISSING");
    const log = text(`${validationFolder}/focused-tests.log`);
    ensure(["requestSync", "legacy-syncNow"].every(api => log.includes(`full hook + engine + result UI ${api}: unsupported timer does not starve legacy writes, later automatic wake drains identical chain`)), "AUTOMATIC_FIXTURE_LOG_MISSING");
    report.currentTestSources = [...new Set([...validation.focusedFiles, ...validation.supplementalFiles, "scripts/testing/time-sync-validation.cjs", "src/offline/tests/deployment-scheduling.test.ts", "src/offline/tests/actions-deployment.test.ts", "src/offline/tests/fakes.ts"])]
      .map(file => ({ path: file, sha256: digest(read(file)), historicalHashRecorded: false }));
    report.automaticPendingEvidence = { realHookAndEngine: true, syntheticMemoryPorts: true, recordedCases: 2,
      duplicateManualPressGuard: true, timerUnsupportedAllowsIndependentComment: true, automaticCooldownWake: true,
      sameUuidAndPayloadAssertionsPresent: true, userQueueInspected: false, remoteAppliedVerified: false, testsRerun: false };
    return report.automaticPendingEvidence;
  });

  check("observed-files-and-runtime-inventory-stable-at-close", () => {
    for (const item of [...observed.values()]) read(item.path, item.repository === "Mobile" ? root : backend);
    ensure(same(initialInventory, ["App.tsx", ...inventory("src"), ...inventory("server")]), "RUNTIME_INVENTORY_CHANGED");
    return { files: observed.size, changed: 0 };
  });
  report.completed = true;
  report.passed = report.checks.every(item => item.passed);
}

try { main(); }
catch (error) { report.checks.push({ name: "completion", passed: false, code: errorCode(error) }); }
finally {
  report.completedAt = new Date().toISOString();
  if (output) {
    report.output = normalize(path.relative(root, output));
    fs.writeFileSync(path.join(output, "observed-hashes.json"), JSON.stringify([...observed.values()], null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify({ report: report.output ? `${report.output}/report.json` : null, passed: report.passed, checks: report.checks, findings: report.findings }, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}