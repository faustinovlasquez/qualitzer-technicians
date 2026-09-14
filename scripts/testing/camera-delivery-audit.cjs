"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gunzipSync, inflateRawSync } = require("node:zlib");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
const validationId = "2026-09-14T17-29-47-052Z";
const uiId = "2026-09-14T17-41-42-895Z";
const validationFolder = `artifacts/logs/camera-delivery/${validationId}`;
const uiFolder = `artifacts/logs/camera-delivery-ui/${uiId}`;
const buildFolder = "artifacts/logs/2026-09-14T17-36-01-474Z";
const archiveName = "qualitzer-mobile-gateway-1.0.4.tgz";
const gatewaySha = "b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae";
const apkSha = "a2c2d1f52394499230f12b4ed2f3a195d71d48a43a007cb1a06e8fec570ec3cf";
const previousSha = "fdb67eafb6f99a5e71d29f3e90ab01fb26af093c3597044437ccc298672de941";
const apkPath = "artifacts/qualitzer-tecnicos-1.0.13-android.apk";
const previousPath = "artifacts/qualitzer-tecnicos-1.0.12-android.apk";
const sourceMapPath = "android/app/build/generated/sourcemaps/react/release/index.android.bundle.map";
const bundlePath = "android/app/build/generated/assets/react/release/index.android.bundle";
const ownPath = "scripts/testing/camera-delivery-audit.cjs";
const backendAllowed = ["package.json", "package-lock.json", ...["", ".sha256", ".source-manifest.json"].map(suffix => `infrastructure/mobile-gateway/${archiveName}${suffix}`)];
const observations = new Map();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const ensure = (condition, code) => { if (!condition) throw new Error(code); };
const sameKeys = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const runtimeAllowed = file => file === "App.tsx" || /^(?:src|server)\/.+\.(?:tsx?|js)$/.test(file) && !file.includes("/tests/");
const report = {
  startedAt: new Date().toISOString(), passed: false, scope: "READ_ONLY_CAMERA_DELIVERY_1_0_13",
  testsExecuted: false, typesExecuted: false, buildExecuted: false, packExecuted: false,
  nativeExecuted: false, serverLaunched: false, networkExecuted: false,
  backendExecuted: false, backendWritten: false, backendInstalledPackageInspected: false,
  backendDeploymentVerified: false, privateFilesRead: false, checks: [],
  limitations: [
    "Historical test/UI evidence is read, not rerun; simulated OS ports do not prove physical camera or biometric behavior",
    "Published APK bytes and existing publication provenance are checked; no new signature verification, installation or native execution",
    "Only Backend package/lock and the named gateway copy/sidecars are read; local references do not prove remote deployment",
    "Byte hashes prove equality at recorded observations, not absence of transient edits between observations",
    "Current source-file inventory and actually embedded project modules are separate counts; type-only and platform-specific files need not appear in the native bundle",
    "Runtime inventory is the full validation scope: App.tsx and src/server TS/TSX/JS outside tests; other source maps are checked in full without hash exceptions",
    "Concurrent new documentation outside existing evidence inventories is not inventoried; no existing reported source hash is ignored",
  ],
};
let output;

function safePath(base, relative, directory = false) {
  ensure(typeof relative === "string" && /^[a-zA-Z0-9_@/ .+()-]+$/.test(relative) &&
    !relative.split("/").some(part => !part || part.startsWith(".")) &&
    !/(?:^|\/)(?:private|credentials|sessions)(?:\/|$)|\.(?:env|enc|key|pem|p12|jks|keystore)$/i.test(relative), "UNSAFE_PATH");
  ensure([root, backend].includes(base), "UNSAFE_BASE");
  const baseStat = fs.lstatSync(base);
  ensure(baseStat.isDirectory() && !baseStat.isSymbolicLink(), "UNSAFE_ROOT");
  let current = base;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    ensure(!stat.isSymbolicLink(), "SYMLINK_FORBIDDEN");
    ensure(i < parts.length - 1 || directory ? stat.isDirectory() : stat.isFile() && stat.size <= 128 * 1024 * 1024, "INVALID_FILE_TYPE_OR_SIZE");
  }
  return current;
}

function read(base, relative) {
  if (base === backend) ensure(backendAllowed.includes(relative), "BACKEND_READ_NOT_ALLOWED");
  const bytes = fs.readFileSync(safePath(base, relative));
  const key = `${base}\n${relative}`;
  const digest = sha(bytes);
  if (observations.has(key)) ensure(observations.get(key).sha256 === digest, "OBSERVED_INPUT_CHANGED");
  else observations.set(key, { repository: base === root ? "Mobile" : "Backend", path: relative, bytes: bytes.length, sha256: digest });
  return bytes;
}

const json = (base, relative) => JSON.parse(read(base, relative).toString("utf8"));

function check(name, action) {
  try { report.checks.push({ name, ...action(), passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "EVIDENCE_CHECK_FAILED" }); }
}

function runtimeFiles(folder) {
  return fs.readdirSync(safePath(root, folder, true), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "tests") return [];
    ensure(!entry.isSymbolicLink(), "RUNTIME_SYMLINK_FORBIDDEN");
    if (entry.name.startsWith(".")) return [];
    const relative = `${folder}/${entry.name}`;
    return entry.isDirectory() ? runtimeFiles(relative) : /\.(?:tsx?|js)$/.test(entry.name) ? [relative] : [];
  });
}

function assertLatest(folder, expected) {
  const ids = fs.readdirSync(safePath(root, folder, true)).filter(name => /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(name)).sort();
  ensure(ids.at(-1) === expected, "NEWER_OR_MISSING_EVIDENCE");
}

function verifyHashes(entries, allowed) {
  ensure(entries.length > 0 && new Set(entries.map(([file]) => file)).size === entries.length, "EMPTY_OR_DUPLICATE_HASH_LIST");
  const items = entries.map(([file, expected]) => {
    ensure(allowed(file) && typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected), "HASH_INPUT_OUTSIDE_ALLOWLIST");
    const current = sha(read(root, file));
    return { file, expected, current, matches: expected === current };
  });
  return { total: items.length, verified: items.filter(item => item.matches).length, differences: items.filter(item => !item.matches) };
}

function counts(log) {
  return Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const matches = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
    ensure(matches.length === 1, "LOG_SUMMARY_MISSING_OR_AMBIGUOUS");
    return [key, Number(matches[0][1])];
  }));
}

function tarEntries(bytes) {
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
  ensure(sameKeys(entries.keys(), ["LICENSE", "README.md", "SOURCE-MANIFEST.json", "THIRD-PARTY-LICENSES.md", "embedded-contract.d.ts", "index.cjs", "index.d.ts", "package.json"].map(name => `package/${name}`)), "TAR_ALLOWLIST_MISMATCH");
  return entries;
}

function apkBundle(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { eocd = i; break; }
  }
  ensure(eocd >= 0 && bytes.readUInt16LE(eocd + 4) === 0 && bytes.readUInt16LE(eocd + 6) === 0, "APK_DIRECTORY_INVALID");
  let offset = bytes.readUInt32LE(eocd + 16);
  const matches = [];
  for (let index = 0; index < bytes.readUInt16LE(eocd + 10); index++) {
    ensure(offset + 46 <= eocd && bytes.readUInt32LE(offset) === 0x02014b50, "APK_ENTRY_INVALID");
    const nameLength = bytes.readUInt16LE(offset + 28);
    const end = offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    ensure(end <= eocd, "APK_ENTRY_RANGE_INVALID");
    if (bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8") === "assets/index.android.bundle") {
      const local = bytes.readUInt32LE(offset + 42);
      ensure(local + 30 <= bytes.length && bytes.readUInt32LE(local) === 0x04034b50 && !(bytes.readUInt16LE(offset + 8) & 1), "APK_LOCAL_HEADER_INVALID");
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const size = bytes.readUInt32LE(offset + 20);
      const unpacked = bytes.readUInt32LE(offset + 24);
      const method = bytes.readUInt16LE(offset + 10);
      ensure(start + size <= bytes.length && unpacked <= 16 * 1024 * 1024 && [0, 8].includes(method), "APK_BUNDLE_RANGE_INVALID");
      const compressed = bytes.subarray(start, start + size);
      const bundle = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 16 * 1024 * 1024 });
      ensure(bundle.length === unpacked, "APK_BUNDLE_SIZE_INVALID");
      matches.push(bundle);
    }
    offset = end;
  }
  ensure(matches.length === 1, "APK_BUNDLE_MISSING_OR_DUPLICATE");
  return matches[0];
}

function main() {
  ensure(process.argv.length === 2, "ARGUMENTS_NOT_ALLOWED");
  safePath(root, "artifacts/logs", true);
  const destination = path.join(root, "artifacts/logs/camera-delivery-audit");
  if (!fs.existsSync(destination)) fs.mkdirSync(destination);
  safePath(root, "artifacts/logs/camera-delivery-audit", true);
  output = fs.mkdtempSync(path.join(destination, `${report.startedAt.replace(/[:.]/g, "-")}-`));
  read(root, ownPath);
  const initialRuntime = ["App.tsx", ...runtimeFiles("src"), ...runtimeFiles("server")].sort();
  const validation = json(root, `${validationFolder}/report.json`);
  const ui = json(root, `${uiFolder}/report.json`);
  const capture = json(root, `${buildFolder}/source-capture.json`);
  const publication = json(root, "artifacts/release-verification-1.0.13.json");

  check("full-validation-runtime-current-exact-no-exceptions", () => {
    assertLatest("artifacts/logs/camera-delivery", validationId);
    ensure(validation.passed === true && validation.completedAt && validation.changedSources.length === 0, "VALIDATION_REPORT_INVALID");
    report.runtimeSources = verifyHashes(Object.entries(validation.sourceHashes), runtimeAllowed);
    report.runtimeInventory = { current: initialRuntime.length, client: initialRuntime.filter(file => !file.startsWith("server/")).length,
      server: initialRuntime.filter(file => file.startsWith("server/")).length,
      added: initialRuntime.filter(file => !Object.hasOwn(validation.sourceHashes, file)),
      removed: Object.keys(validation.sourceHashes).filter(file => !initialRuntime.includes(file)) };
    ensure(sameKeys(Object.keys(validation.sourceHashes), initialRuntime), "RUNTIME_INVENTORY_DIFFERS");
    ensure(report.runtimeSources.differences.length === 0, "RUNTIME_CHANGED_AFTER_FULL_VALIDATION");
    return { ...report.runtimeInventory, verified: report.runtimeSources.verified, differences: [], ignoredHashes: [], report: `${validationFolder}/report.json` };
  });

  check("ui-current-source-script-config-and-screenshot-hashes", () => {
    assertLatest("artifacts/logs/camera-delivery-ui", uiId);
    ensure(ui.passed === true && ui.finishedAt && ui.errors.length === 0 && ui.types.length === 0 && ui.sourceChanges.length === 0 &&
      ui.tests.length === 48 && ui.tests.every(test => test.passed === true) && ui.counts.passed === 48 && ui.counts.failed === 0 &&
      ui.assertionCount === 2025 && ui.counts.assertionsExecuted === 2025 && ui.screenshots.length === 100 &&
      ui.counts.screenshots === 100 && ui.counts.pageOrRunnerErrors === 0 && ui.counts.typeErrors === 0, "UI_REPORT_INVALID");
    report.uiSources = verifyHashes(Object.entries(ui.sources), file => runtimeAllowed(file) || /^tests\/e2e\/.+\.tsx$/.test(file));
    const protectedAllowed = ["app.json", "app.config.ts", "package.json", "package-lock.json", "tests/e2e/picker-messages-smoke.cjs", "tests/e2e/camera-delivery/fixture.tsx", "tests/e2e/camera-delivery/smoke.cjs", "tests/e2e/camera-delivery/scenarios.cjs"];
    ensure(sameKeys(Object.keys(ui.protectedInputs), protectedAllowed), "UI_PROTECTED_INVENTORY_INVALID");
    report.uiProtectedInputs = verifyHashes(Object.entries(ui.protectedInputs), file => protectedAllowed.includes(file));
    ensure(ui.sharedHarness === "tests/e2e/picker-messages-smoke.cjs" && ui.sharedHarnessHash === sha(read(root, ui.sharedHarness)), "UI_SHARED_SCRIPT_CHANGED");
    ensure(sameKeys(ui.screenshots, Object.keys(ui.screenshotHashes)), "SCREENSHOT_INVENTORY_INVALID");
    report.uiScreenshots = verifyHashes(Object.entries(ui.screenshotHashes), file => file.startsWith(`${uiFolder}/`) && file.endsWith(".png"));
    report.validationToUi = Object.entries(ui.sources).filter(([file]) => runtimeAllowed(file)).map(([file, digest]) => ({ file, matches: validation.sourceHashes[file] === digest }));
    ensure([report.uiSources, report.uiProtectedInputs, report.uiScreenshots].every(item => item.differences.length === 0) && report.validationToUi.every(item => item.matches), "UI_SOURCE_OR_EVIDENCE_HASH_CHANGED");
    return { report: `${uiFolder}/report.json`, counts: ui.counts, sources: report.uiSources.verified, protectedInputs: report.uiProtectedInputs.verified, screenshotsHashed: report.uiScreenshots.verified, fullValidationOverlap: report.validationToUi.length, ignoredHashes: [], rerun: false };
  });

  check("build-capture-publication-embedded-sources-and-profile-timeline", () => {
    const phases = json(root, `${buildFolder}/phases.json`);
    ensure(["prebuild", "assemble-release", "apk-manifest"].every(name => phases.some(phase => phase.name === name && phase.exitCode === 0)), "BUILD_PHASE_EVIDENCE_INVALID");
    report.buildSources = verifyHashes(capture.map(item => [item.file, item.sha256]), runtimeAllowed);
    report.publicationSources = verifyHashes(publication.provenance.sources.map(item => [item.file, item.sha256]), runtimeAllowed);
    ensure(capture.length === 93 && publication.provenance.sources.length === 93 && sameKeys(capture.map(item => item.file), publication.provenance.sources.map(item => item.file)), "CAPTURE_PUBLICATION_INVENTORY_MISMATCH");
    for (const item of publication.provenance.sources) ensure(item.matches === true && item.embeddedSha256 === item.sha256 && validation.sourceHashes[item.file] === item.sha256 && capture.find(source => source.file === item.file)?.sha256 === item.sha256, "CAPTURE_PUBLICATION_VALIDATION_HASH_MISMATCH");
    ensure(report.buildSources.differences.length === 0 && report.publicationSources.differences.length === 0, "BUILD_OR_PUBLICATION_SOURCE_CHANGED");
    const profile = "src/screens/ProfileScreen.tsx";
    const text = read(root, profile).toString("utf8");
    ensure(text.includes("1.0.13"), "PROFILE_VERSION_INVALID");
    report.profileVersion = { path: profile, version: "1.0.13", sha256: sha(Buffer.from(text)), validationSha256: validation.sourceHashes[profile],
      presentByValidationStart: validation.startedAt, validationCompletedAt: validation.completedAt,
      captureMatches: capture.some(item => item.file === profile && item.sha256 === validation.sourceHashes[profile]), exceptionUsed: false,
      basis: "Full-validation runner captured before/after hashes with zero changedSources; current exact bytes already contain 1.0.13" };
    const mapBytes = read(root, sourceMapPath);
    ensure(sha(mapBytes) === publication.provenance.sourceMapSha256, "PUBLISHED_SOURCE_MAP_CHANGED");
    const map = JSON.parse(mapBytes);
    const embedded = publication.provenance.sources.map(item => {
      const indexes = map.sources.flatMap((name, index) => name.replaceAll("\\", "/") === `/${item.file}` || name === item.file ? [index] : []);
      ensure(indexes.length === 1 && typeof map.sourcesContent[indexes[0]] === "string", "EXACT_MAP_SOURCE_MISSING_OR_AMBIGUOUS");
      return { file: item.file, matches: sha(Buffer.from(map.sourcesContent[indexes[0]])) === item.embeddedSha256 };
    });
    ensure(embedded.every(item => item.matches), "EMBEDDED_SOURCE_HASH_MISMATCH");
    const ownEmbeddedSources = map.sources.flatMap((name, index) => {
      const normalized = name.replaceAll("\\", "/").replace(/^\//, "");
      if (!/^(?:App\.tsx|index\.ts|(?:src|config|modules)\/.+\.(?:tsx?|[cm]?js|json))$/.test(normalized)) return [];
      ensure(typeof map.sourcesContent[index] === "string", "OWN_EMBEDDED_SOURCE_CONTENT_MISSING");
      return [[normalized, sha(Buffer.from(map.sourcesContent[index]))]];
    });
    report.allEmbeddedProjectSources = verifyHashes(ownEmbeddedSources, file => /^(?:App\.tsx|index\.ts|(?:src|config|modules)\/.+\.(?:tsx?|[cm]?js|json))$/.test(file));
    ensure(report.allEmbeddedProjectSources.differences.length === 0, "OWN_EMBEDDED_RUNTIME_CHANGED");
    report.embeddedSourceEvidence = { sources: embedded.length, allProjectModules: report.allEmbeddedProjectSources.verified,
      projectSourcePaths: ownEmbeddedSources.map(([file]) => file), mapPath: sourceMapPath, mapSha256: sha(mapBytes), sourceCount: map.sources.length, exactPathMatching: true };
    report.validationRunnerCurrentSha256 = sha(read(root, "scripts/testing/camera-delivery-validation.cjs"));
    return { capture: `${buildFolder}/source-capture.json`, captured: 93, published: 93, embeddedMapVerified: embedded.length,
      actualEmbeddedProjectModules: report.allEmbeddedProjectSources.verified, profile: report.profileVersion, runtimeChangedSinceValidation: false };
  });

  check("published-apk-actual-bytes-bundle-and-previous-apk-retained", () => {
    const audit = json(root, "artifacts/final-audit-1.0.13.json");
    const bytes = read(root, apkPath);
    const previous = read(root, previousPath);
    ensure(sha(bytes) === apkSha && bytes.length === 69180083 && sha(previous) === previousSha && previous.length === 69164275, "APK_BYTES_CHANGED");
    for (const item of [publication, audit]) ensure(item.apk.replaceAll("\\", "/") === apkPath && item.sha256 === apkSha && item.bytes === bytes.length, "PUBLICATION_APK_MISMATCH");
    ensure(publication.version === "1.0.13" && publication.versionCode === 14 && publication.package === "com.qualitzer.field" &&
      publication.protectedProjectFilesUnchanged === true && publication.phases.every(phase => phase.exitCode === 0) &&
      audit.sourceProvenanceMatches === true && audit.previousApkUnchanged === true && audit.certificateMatchesPrevious === true && audit.addedPermissions.length === 0, "PUBLICATION_EVIDENCE_INVALID");
    ensure(publication.previousApk.sha256 === previousSha && publication.previousApk.bytes === previous.length && publication.previousApk.unchanged === true && publication.previousApk.signerMatches === true, "PREVIOUS_APK_REPORT_INVALID");
    for (const [file, digest] of [[apkPath, apkSha], [previousPath, previousSha]]) ensure(read(root, `${file}.sha256`).toString("utf8").trim() === `${digest}  ${path.posix.basename(file)}`, "APK_CHECKSUM_SIDECAR_MISMATCH");
    const embedded = apkBundle(bytes);
    const generated = read(root, bundlePath);
    ensure(sha(embedded) === publication.bundleSha256 && sha(generated) === publication.bundleSha256 &&
      publication.provenance.generatedBundleSha256 === publication.bundleSha256 && embedded.length === publication.bundleBytes, "APK_ACTUAL_BUNDLE_MISMATCH");
    report.apk = { path: apkPath, version: publication.version, bytes: bytes.length, sha256: sha(bytes), publishedAt: publication.verifiedAt,
      finalAuditAt: audit.checkedAt, bundleSha256: sha(embedded), bundleBytes: embedded.length, signatureReverified: false, installed: false };
    report.previousApk = { path: previousPath, version: "1.0.12", bytes: previous.length, sha256: sha(previous), unchanged: true };
    return { ...report.apk, previousApk: report.previousApk };
  });

  check("historical-test-counts-deduplicated-no-execution", () => {
    const evidence = {};
    for (const name of ["mobile-official-suite", "supplemental-client-tests", "focused-tests"]) {
      const file = `${validationFolder}/${name}.log`;
      const log = read(root, file).toString("utf8");
      const totals = counts(log);
      const phase = validation.phases.find(item => item.name === name);
      ensure(phase?.exitCode === 0 && phase.complete === true && Object.entries(totals).every(([key, value]) => phase.counts[key] === value) && totals.fail === 0 && totals.cancelled === 0 && totals.todo === 0, "TEST_LOG_REPORT_MISMATCH");
      const names = log.split(/\r?\n/).filter(line => /^\u2714 /.test(line)).map(line => line.replace(/^\u2714 /, "").replace(/ \([0-9.]+ms\)$/, ""));
      ensure(names.length === totals.pass, "TEST_PASS_LINES_MISMATCH");
      evidence[name] = { file, counts: totals, names };
    }
    const official = evidence["mobile-official-suite"];
    const supplemental = evidence["supplemental-client-tests"];
    const focused = evidence["focused-tests"];
    ensure(official.counts.pass === 1488 && official.counts.skipped === 1 && supplemental.counts.pass === 81 && supplemental.counts.skipped === 0 && focused.counts.pass === 296, "UNEXPECTED_HISTORICAL_COUNTS");
    ensure(supplemental.names.every(name => !official.names.includes(name)) && focused.names.every(name => official.names.includes(name) || supplemental.names.includes(name)), "UNKNOWN_TEST_OVERLAP");
    ensure(read(root, "tests/sync-user-presentation.test.ts").toString("utf8").trim() === 'import "./sync-user-presentation-ui.test";' &&
      validation.excludedDuplicateEntries.includes("tests/sync-user-presentation-ui.test.tsx") && !validation.supplementalFiles.includes("tests/sync-user-presentation-ui.test.tsx"), "WRAPPER_DEDUPLICATION_INVALID");
    ensure(validation.uniqueFullCounts.pass === official.counts.pass + supplemental.counts.pass && validation.uniqueFullCounts.skipped === 1, "UNIQUE_FULL_COUNTS_INVALID");
    report.testEvidence = { uniquePass: 1569, skipped: 1, failed: 0, focusedExecutions: 296, focusedAlreadyIncluded: true,
      logs: Object.fromEntries(Object.entries(evidence).map(([name, item]) => [name, { path: item.file, counts: item.counts }])), rerun: false };
    const types = validation.phases.filter(phase => phase.name.endsWith("-types"));
    ensure(types.length === 3 && types.every(phase => phase.exitCode === 0 && phase.diagnostics === 0), "HISTORICAL_TYPES_INVALID");
    return { ...report.testEvidence, historicalTypes: types };
  });

  check("gateway-existing-immutable-manifest-no-new-camera-source-packed", () => {
    const bytes = read(root, `artifacts/mobile-gateway/${archiveName}`);
    ensure(sha(bytes) === gatewaySha && bytes.length === 585030, "GATEWAY_ARCHIVE_CHANGED");
    const entries = tarEntries(bytes);
    const manifestBytes = entries.get("package/SOURCE-MANIFEST.json");
    const manifest = JSON.parse(manifestBytes);
    const pkg = JSON.parse(entries.get("package/package.json"));
    ensure(pkg.name === "@qualitzer/mobile-gateway" && pkg.version === "1.0.4" && manifest.name === pkg.name && manifest.version === pkg.version && manifest.bundleSha256 === sha(entries.get("package/index.cjs")), "GATEWAY_IDENTITY_INVALID");
    const allowed = file => /^(?:node_modules|server|src\/domain)\/.+\.(?:[cm]?js|tsx?|json)$/.test(file) || ["config/gatewayPolicy.js", "scripts/pack-mobile-gateway.cjs", "docs/EMBEDDED-GATEWAY.md", "LICENSE"].includes(file);
    report.gatewaySources = verifyHashes(manifest.sources.map(item => [item.path, item.sha256]), allowed);
    report.gatewayDependencies = verifyHashes(manifest.dependencies.map(item => [`${item.location}/package.json`, item.manifestSha256]), file => file.startsWith("node_modules/") && file.endsWith("/package.json"));
    ensure(report.gatewaySources.total === 351 && report.gatewayDependencies.total === 91 && report.gatewaySources.differences.length === 0 && report.gatewayDependencies.differences.length === 0, "GATEWAY_INPUT_CHANGED");
    ensure(manifest.sources.some(item => item.path === "src/domain/assignmentSchedule.ts") && !manifest.sources.some(item => item.path === "src/domain/cameraErrors.ts"), "GATEWAY_CAMERA_OR_WEEKLY_PROVENANCE_INVALID");
    report.gateway = { version: "1.0.4", path: `artifacts/mobile-gateway/${archiveName}`, bytes: bytes.length, sha256: sha(bytes), manifestSha256: sha(manifestBytes),
      sourceCount: 351, dependencyManifests: 91, cameraErrorsPacked: false, newPackageNeededForAuditedChanges: false, factoryLoaded: false };
    const copies = [];
    for (const [suffix, expected] of [["", bytes], [".source-manifest.json", manifestBytes], [".sha256", Buffer.from(`${gatewaySha}  ${archiveName}\n`)]]) {
      const file = `infrastructure/mobile-gateway/${archiveName}${suffix}`;
      const actual = read(backend, file);
      const byteMatches = actual.equals(expected);
      const crlfOnly = suffix !== "" && !byteMatches && Buffer.from(actual.toString("utf8").replace(/\r\n/g, "\n")).equals(expected);
      copies.push({ path: file, bytes: actual.length, expectedBytes: expected.length, sha256: sha(actual), expectedSha256: sha(expected), byteMatches,
        matches: byteMatches || crlfOnly, difference: byteMatches ? null : crlfOnly ? "CRLF_ONLY_TEXT_SIDECAR" : "UNKNOWN_CONTENT_DIFFERENCE" });
    }
    report.backendCopies = copies;
    ensure(copies.every(item => item.matches), "BACKEND_COPY_DIFFERS");
    const consumer = json(backend, "package.json");
    const lock = json(backend, "package-lock.json");
    const reference = `file:infrastructure/mobile-gateway/${archiveName}`;
    const locked = lock.packages?.["node_modules/@qualitzer/mobile-gateway"];
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    report.backendReferences = { packageMatches: consumer.dependencies?.["@qualitzer/mobile-gateway"] === reference,
      lockMatches: lock.packages?.[""]?.dependencies?.["@qualitzer/mobile-gateway"] === reference && locked?.version === "1.0.4" && locked.resolved === reference && locked.integrity === integrity,
      installedPackageInspected: false, remoteDeploymentVerified: false };
    ensure(report.backendReferences.packageMatches && report.backendReferences.lockMatches, "BACKEND_LOCAL_REFERENCE_MISMATCH");
    return { ...report.gateway, backendCopies: copies, backendReferences: report.backendReferences };
  });

  check("observed-inputs-still-unchanged", () => {
    ensure(sameKeys(["App.tsx", ...runtimeFiles("src"), ...runtimeFiles("server")], initialRuntime), "RUNTIME_INVENTORY_CHANGED_DURING_AUDIT");
    for (const item of observations.values()) read(item.repository === "Mobile" ? root : backend, item.path);
    return { observedFiles: observations.size, changed: 0 };
  });
  report.passed = report.checks.every(item => item.passed);
}

try { main(); }
catch (error) { report.passed = false; report.checks.push({ name: "completion", passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CAMERA_DELIVERY_AUDIT_FAILED" }); }
finally {
  report.completedAt = new Date().toISOString();
  if (output) {
    report.output = path.relative(root, output).split(path.sep).join("/");
    fs.writeFileSync(path.join(output, "observed-hashes.json"), JSON.stringify([...observations.values()], null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify({ passed: report.passed, report: report.output ? `${report.output}/report.json` : null, checks: report.checks.map(({ name, passed, code }) => ({ name, passed, code })) }, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}