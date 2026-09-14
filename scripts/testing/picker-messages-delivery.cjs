const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gunzipSync } = require("node:zlib");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
const validationId = "2026-09-14T15-46-30-235Z";
const uiId = "2026-09-14T15-52-21-525Z";
const buildId = "2026-09-14T15-55-19-791Z";
const validationFolder = `artifacts/logs/picker-messages/${validationId}`;
const uiFolder = `artifacts/logs/picker-messages-ui/${uiId}`;
const buildFolder = `artifacts/logs/${buildId}`;
const archiveName = "qualitzer-mobile-gateway-1.0.4.tgz";
const expectedGatewaySha = "b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae";
const observations = new Map();
const report = {
  startedAt: new Date().toISOString(), passed: false,
  scope: "READ_ONLY_EXISTING_PICKER_MESSAGES_EVIDENCE",
  nativePending: true, nativeExecuted: false, apkRequired: false,
  testsExecuted: false, typesExecuted: false, buildExecuted: false,
  packExecuted: false, serverLaunched: false, backendExecuted: false,
  backendWritten: false, privateFilesRead: false, checks: [],
  limitations: [
    "Existing test/UI logs are verified, never rerun; simulated OS boundaries are not physical-device evidence",
    "Build source capture proves current bytes match captured inputs, not APK embedding, signature, install or startup",
    "No release policy, protocol, runtime, environment, application data or existing artifact is modified",
    "Optional Backend observations cover only the named archive/sidecars and dependency references, not installation or deployment",
    "Hashes are point-in-time evidence, not protection against subsequent external edits",
  ],
};
let output;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const ensure = (condition, code) => { if (!condition) throw new Error(code); };

function safePath(base, relative, directory = false) {
  ensure(typeof relative === "string" && /^[a-zA-Z0-9_@/ .+()-]+$/.test(relative) &&
    !relative.split("/").some(part => !part || part.startsWith(".")) &&
    !/(?:^|\/)(?:private|credentials|sessions)(?:\/|$)|\.(?:env|enc|key|pem|p12|jks|keystore)$/i.test(relative), "UNSAFE_PATH");
  ensure(fs.lstatSync(base).isDirectory() && !fs.lstatSync(base).isSymbolicLink(), "UNSAFE_ROOT");
  let current = base;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    ensure(!stat.isSymbolicLink(), "SYMLINK_FORBIDDEN");
    ensure(i < parts.length - 1 || directory ? stat.isDirectory() : stat.isFile() && stat.size <= 32 * 1024 * 1024, "INVALID_FILE_TYPE_OR_SIZE");
  }
  return current;
}

function read(base, relative) {
  if (base === backend) ensure([
    `infrastructure/mobile-gateway/${archiveName}`,
    `infrastructure/mobile-gateway/${archiveName}.sha256`,
    `infrastructure/mobile-gateway/${archiveName}.source-manifest.json`,
    "package.json", "package-lock.json",
  ].includes(relative), "BACKEND_READ_NOT_ALLOWED");
  const bytes = fs.readFileSync(safePath(base, relative));
  const key = `${base}\n${relative}`;
  const digest = sha(bytes);
  if (observations.has(key)) ensure(observations.get(key).sha256 === digest, "OBSERVED_INPUT_CHANGED");
  else observations.set(key, { repository: base === root ? "Mobile" : "Backend", path: relative, sha256: digest });
  return bytes;
}

const json = (base, relative) => JSON.parse(read(base, relative).toString("utf8"));
function optionalRead(base, relative) {
  try { return read(base, relative); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function check(name, action) {
  try { report.checks.push({ name, passed: true, ...action() }); }
  catch (error) {
    report.checks.push({ name, passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "EVIDENCE_CHECK_FAILED" });
  }
}

function assertLatest(folder, expected) {
  const candidates = fs.readdirSync(safePath(root, folder, true)).filter(name => /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(name)).sort();
  ensure(candidates.at(-1) === expected, "NEWER_OR_MISSING_EVIDENCE");
}

function runtimeFiles(folder = "src") {
  return fs.readdirSync(safePath(root, folder, true), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "tests") return [];
    ensure(!entry.isSymbolicLink(), "RUNTIME_SYMLINK_FORBIDDEN");
    if (entry.name.startsWith(".")) return [];
    const relative = `${folder}/${entry.name}`;
    return entry.isDirectory() ? runtimeFiles(relative) : /\.(?:tsx?|js)$/.test(entry.name) ? [relative] : [];
  });
}

function verifyHashes(entries, allowed) {
  ensure(entries.length > 0 && new Set(entries.map(([file]) => file)).size === entries.length, "EMPTY_OR_DUPLICATE_SOURCE_LIST");
  const results = entries.map(([file, expected]) => {
    ensure(allowed(file) && typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected), "SOURCE_OUTSIDE_ALLOWLIST");
    const current = sha(read(root, file));
    return { file, expected, current, matches: current === expected };
  });
  return { verified: results.filter(item => item.matches).length, total: results.length, differences: results.filter(item => !item.matches) };
}

function counts(log) {
  return Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const matches = [...log.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
    ensure(matches.length === 1, "LOG_SUMMARY_MISSING_OR_AMBIGUOUS");
    return [key, Number(matches[0][1])];
  }));
}

function passedNames(log) {
  return log.split(/\r?\n/).filter(line => /^\u2714 /.test(line)).map(line => line.replace(/^\u2714 /, "").replace(/ \([0-9.]+ms\)$/, ""));
}

function archiveEntries(bytes) {
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
  const names = ["LICENSE", "README.md", "SOURCE-MANIFEST.json", "THIRD-PARTY-LICENSES.md", "embedded-contract.d.ts", "index.cjs", "index.d.ts", "package.json"];
  ensure(entries.size === names.length && names.every(name => entries.has(`package/${name}`)), "TAR_ALLOWLIST_MISMATCH");
  return entries;
}

function main() {
  ensure(process.argv.length === 2, "ARGUMENTS_NOT_ALLOWED");
  safePath(root, "artifacts/logs", true);
  const destination = path.join(root, "artifacts/logs/picker-messages-delivery");
  if (!fs.existsSync(destination)) fs.mkdirSync(destination);
  safePath(root, "artifacts/logs/picker-messages-delivery", true);
  output = fs.mkdtempSync(path.join(destination, `${report.startedAt.replace(/[:.]/g, "-")}-`));
  const initialRuntime = ["App.tsx", ...runtimeFiles()].sort();
  const validation = json(root, `${validationFolder}/report.json`);
  const ui = json(root, `${uiFolder}/report.json`);

  check("latest-validation-and-complete-runtime-hashes", () => {
    assertLatest("artifacts/logs/picker-messages", validationId);
    ensure(validation.passed === true && validation.completedAt && validation.changedSources.length === 0, "VALIDATION_REPORT_INVALID");
    ensure(JSON.stringify(Object.keys(validation.sourceHashes).sort()) === JSON.stringify(initialRuntime), "RUNTIME_INVENTORY_DIFFERS_FROM_VALIDATION");
    report.runtimeSources = verifyHashes(Object.entries(validation.sourceHashes), file => file === "App.tsx" || /^src\/.+\.(?:tsx?|js)$/.test(file));
    ensure(report.runtimeSources.differences.length === 0, "RUNTIME_SOURCE_HASH_MISMATCH");
    report.profileVersionException = { used: false, reason: "Exact latest-validation hash required, including ProfileScreen; no unknown changes waived" };
    return { report: `${validationFolder}/report.json`, verifiedSources: report.runtimeSources.verified, exclusions: [] };
  });

  check("latest-ui-report-and-current-hashes", () => {
    assertLatest("artifacts/logs/picker-messages-ui", uiId);
    ensure(ui.passed === true && ui.errors.length === 0 && ui.types.length === 0 && ui.sourceChanges.length === 0 &&
      ui.tests.length === 30 && ui.tests.every(test => test.passed === true) && ui.counts.passed === 30 && ui.counts.failed === 0 &&
      ui.counts.assertionsExecuted === 1361 && ui.assertionCount === 1361 && ui.screenshots.length === 92 &&
      ui.counts.screenshots === 92 && ui.counts.pageOrRunnerErrors === 0 && ui.counts.typeErrors === 0, "UI_REPORT_INVALID");
    report.uiSources = verifyHashes(Object.entries(ui.sources), file => /^src\/.+\.(?:tsx?|js)$/.test(file) || file === "tests/e2e/picker-messages-fixture.tsx");
    ensure(report.uiSources.differences.length === 0, "UI_SOURCE_HASH_MISMATCH");
    for (const file of ui.screenshots) {
      ensure(file.startsWith(`${uiFolder}/`) && file.endsWith(".png"), "UI_SCREENSHOT_OUTSIDE_ALLOWLIST");
      safePath(root, file);
    }
    return { report: `${uiFolder}/report.json`, counts: ui.counts, verifiedSources: report.uiSources.verified, rerun: false, native: false };
  });

  check("existing-build-capture-current-sources-not-native-proof", () => {
    const phases = json(root, `${buildFolder}/phases.json`);
    ensure(["prebuild", "assemble-release", "apk-manifest"].every(name => phases.some(phase => phase.name === name && phase.exitCode === 0)), "BUILD_PHASE_EVIDENCE_INVALID");
    const capture = json(root, `${buildFolder}/source-capture.json`);
    report.buildSources = verifyHashes(capture.map(item => [item.file, item.sha256]), file => file === "App.tsx" || /^src\/.+\.(?:tsx?|js)$/.test(file));
    ensure(report.buildSources.differences.length === 0, "BUILD_CAPTURE_SOURCE_HASH_MISMATCH");
    report.verifiedSourceCount = report.buildSources.verified;
    return { capture: `${buildFolder}/source-capture.json`, verifiedSourceCount: report.verifiedSourceCount, apkEmbeddedSourcesVerified: false, nativePending: true };
  });

  check("existing-test-counts-deduplicated-and-neutral-cover-proof", () => {
    const evidence = {};
    for (const name of ["mobile-official-suite", "supplemental-client-tests", "focused-tests"]) {
      const logPath = `${validationFolder}/${name}.log`;
      const log = read(root, logPath).toString("utf8");
      const phase = validation.phases.find(item => item.name === name);
      const totals = counts(log);
      ensure(phase?.exitCode === 0 && phase.complete === true && Object.entries(totals).every(([key, value]) => phase.counts[key] === value) &&
        totals.fail === 0 && totals.cancelled === 0 && totals.todo === 0, "TEST_LOG_REPORT_MISMATCH");
      const names = passedNames(log);
      ensure(names.length === totals.pass, "PASS_LINES_DO_NOT_MATCH_TOTAL");
      evidence[name] = { log: logPath, counts: totals, names };
    }
    const wrapper = read(root, "tests/sync-user-presentation.test.ts").toString("utf8").trim();
    ensure(wrapper === 'import "./sync-user-presentation-ui.test";', "DUPLICATE_WRAPPER_CHANGED");
    const source = read(root, "tests/sync-user-presentation-ui.test.tsx").toString("utf8");
    const duplicateNames = [...source.matchAll(/^test\("([^"\n]+)"/gm)].map(match => match[1]);
    ensure(duplicateNames.length === 8 && new Set(duplicateNames).size === 8, "DUPLICATE_CASES_NOT_PROVEN");
    const official = evidence["mobile-official-suite"];
    const supplemental = evidence["supplemental-client-tests"];
    const focused = evidence["focused-tests"];
    ensure(official.counts.pass === 1386 && official.counts.skipped === 1 && supplemental.counts.pass === 89 && supplemental.counts.skipped === 0 &&
      focused.counts.pass === 228 && focused.counts.skipped === 0, "UNEXPECTED_HISTORICAL_COUNTS");
    for (const name of duplicateNames) ensure(official.names.filter(item => item === name).length === 1 && supplemental.names.filter(item => item === name).length === 1 &&
      focused.names.filter(item => item === name).length === 2, "DUPLICATE_LOG_PROOF_MISSING");
    const overlap = supplemental.names.filter(name => official.names.includes(name));
    ensure(overlap.length === duplicateNames.length && overlap.every(name => duplicateNames.includes(name)), "UNKNOWN_SUPPLEMENTAL_OVERLAP");
    ensure(focused.names.every(name => official.names.includes(name) || supplemental.names.includes(name)), "FOCUSED_NOT_CONTAINED_IN_TOTAL");
    const neutralNames = ["result-first", "active-first"].flatMap(order => [false, true].map(canceled =>
      `real lock screen ${order} canceled=${canceled}: pending picker shows only a neutral spinner, then ordinary Home still authenticates`));
    for (const name of neutralNames) ensure(official.names.filter(item => item === name).length === 1 && focused.names.filter(item => item === name).length === 1, "NEUTRAL_COVER_LOG_PROOF_MISSING");
    read(root, "tests/device-security-integration.test.ts");
    report.testEvidence = {
      logs: Object.fromEntries(Object.entries(evidence).map(([name, item]) => [name, { path: item.log, counts: item.counts }])),
      duplicateImport: { wrapper: "tests/sync-user-presentation.test.ts", target: "tests/sync-user-presentation-ui.test.tsx", names: duplicateNames },
      uniquePass: official.counts.pass + supplemental.counts.pass - duplicateNames.length,
      skipped: official.counts.skipped, failed: 0, focusedExecutions: focused.counts.pass,
      focusedUniquePass: focused.counts.pass - duplicateNames.length, focusedAlreadyIncluded: true,
      neutralCover: { tests: neutralNames, previouslyPassed: true, simulatedOsOnly: true, rerun: false },
    };
    return { uniquePass: report.testEvidence.uniquePass, skipped: 1, focusedExecutions: 228, focusedUniquePass: report.testEvidence.focusedUniquePass, neutralCoverCases: neutralNames.length, rerun: false };
  });

  check("gateway-immutable-archive-manifest-current-inputs", () => {
    const bytes = read(root, `artifacts/mobile-gateway/${archiveName}`);
    ensure(sha(bytes) === expectedGatewaySha && bytes.length === 585030, "GATEWAY_ARCHIVE_HASH_MISMATCH");
    const entries = archiveEntries(bytes);
    const manifestBytes = entries.get("package/SOURCE-MANIFEST.json");
    const manifest = JSON.parse(manifestBytes);
    const pkg = JSON.parse(entries.get("package/package.json"));
    ensure(pkg.name === "@qualitzer/mobile-gateway" && pkg.version === "1.0.4" && manifest.name === pkg.name && manifest.version === pkg.version &&
      manifest.bundleSha256 === sha(entries.get("package/index.cjs")), "GATEWAY_IDENTITY_MISMATCH");
    const allowed = file => /^(?:node_modules|server|src\/domain)\/.+\.(?:[cm]?js|tsx?|json)$/.test(file) ||
      ["config/gatewayPolicy.js", "scripts/pack-mobile-gateway.cjs", "docs/EMBEDDED-GATEWAY.md", "LICENSE"].includes(file);
    report.gatewaySources = verifyHashes(manifest.sources.map(item => [item.path, item.sha256]), allowed);
    const dependencies = verifyHashes(manifest.dependencies.map(item => [`${item.location}/package.json`, item.manifestSha256]), file => file.startsWith("node_modules/") && file.endsWith("/package.json"));
    report.gatewayDependencies = dependencies;
    ensure(report.gatewaySources.differences.length === 0 && dependencies.differences.length === 0, "GATEWAY_INPUT_CHANGED_NEW_PACKAGE_REVIEW_REQUIRED");
    ensure(manifest.sources.some(item => item.path === "src/domain/assignmentSchedule.ts"), "GATEWAY_WEEKLY_SOURCE_MISSING");
    report.gateway = { version: "1.0.4", bytes: bytes.length, sha256: sha(bytes), manifestSha256: sha(manifestBytes),
      verifiedSources: report.gatewaySources.verified, verifiedDependencyManifests: dependencies.verified, newPackageNeededForCurrentInputs: false };
    const optionalCopies = [];
    for (const [suffix, expected] of [["", bytes], [".source-manifest.json", manifestBytes], [".sha256", Buffer.from(`${expectedGatewaySha}  ${archiveName}\n`)]]) {
      const relative = `infrastructure/mobile-gateway/${archiveName}${suffix}`;
      const actual = optionalRead(backend, relative);
      const byteMatches = actual === null ? null : actual.equals(expected);
      const crlfOnly = actual !== null && suffix !== "" && !byteMatches &&
        Buffer.from(actual.toString("utf8").replace(/\r\n/g, "\n")).equals(expected);
      optionalCopies.push({ path: relative, available: actual !== null, byteMatches,
        matches: actual === null ? null : byteMatches || crlfOnly,
        difference: byteMatches === false ? crlfOnly ? "CRLF_ONLY_TEXT_SIDECAR" : "UNKNOWN_CONTENT_DIFFERENCE" : null,
        actualSha256: actual === null ? null : sha(actual), expectedSha256: sha(expected) });
    }
    report.backendCopies = optionalCopies;
    const consumerBytes = optionalRead(backend, "package.json");
    const lockBytes = optionalRead(backend, "package-lock.json");
    const reference = `file:infrastructure/mobile-gateway/${archiveName}`;
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    const consumer = consumerBytes === null ? null : JSON.parse(consumerBytes);
    const lock = lockBytes === null ? null : JSON.parse(lockBytes);
    const locked = lock?.packages?.["node_modules/@qualitzer/mobile-gateway"];
    report.backendReferences = {
      packageAvailable: consumer !== null, lockAvailable: lock !== null,
      packageMatches: consumer === null ? null : consumer.dependencies?.["@qualitzer/mobile-gateway"] === reference,
      lockMatches: lock === null ? null : lock.packages?.[""]?.dependencies?.["@qualitzer/mobile-gateway"] === reference &&
        locked?.version === "1.0.4" && locked.resolved === reference && locked.integrity === integrity,
      installedPackageInspected: false, remoteDeploymentVerified: false,
    };
    ensure(optionalCopies.every(item => item.matches !== false), "OPTIONAL_BACKEND_COPY_DIFFERS");
    ensure(report.backendReferences.packageMatches !== false && report.backendReferences.lockMatches !== false, "OPTIONAL_BACKEND_REFERENCE_DIFFERS");
    return { ...report.gateway, backendCopies: optionalCopies, backendReferences: report.backendReferences, factoryLoaded: false };
  });

  check("observed-inputs-still-unchanged", () => {
    ensure(JSON.stringify(["App.tsx", ...runtimeFiles()].sort()) === JSON.stringify(initialRuntime), "RUNTIME_INVENTORY_CHANGED_DURING_AUDIT");
    for (const item of observations.values()) read(item.repository === "Mobile" ? root : backend, item.path);
    return { observedFiles: observations.size, changed: 0 };
  });
  report.passed = report.checks.every(item => item.passed);
}

try { main(); }
catch (error) { report.checks.push({ name: "completion", passed: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "DELIVERY_AUDIT_FAILED" }); }
finally {
  report.completedAt = new Date().toISOString();
  if (output) {
    report.output = path.relative(root, output).split(path.sep).join("/");
    fs.writeFileSync(path.join(output, "observed-hashes.json"), JSON.stringify([...observations.values()], null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify({ passed: report.passed, report: report.output ? `${report.output}/report.json` : null,
    verifiedSourceCount: report.verifiedSourceCount ?? null, nativePending: true, checks: report.checks }, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}