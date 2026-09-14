"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gunzipSync } = require("node:zlib");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
const ownPath = "scripts/testing/time-sync-audit.cjs";
const archive = "qualitzer-mobile-gateway-1.0.4.tgz";
const archiveSha = "b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae";
const bundleSha = "4c06a9b917c343e0162bded3ec6042b8501d31c4ea5664d1af8a29e6e615f8b8";
const validationFolder = "artifacts/logs/time-sync/2026-09-14T18-59-55-831Z";
const previousFolder = "artifacts/logs/camera-delivery/2026-09-14T17-29-47-052Z";
const installedBase = "node_modules/@qualitzer/mobile-gateway";
const observations = new Map();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const runtimeAllowed = file => file === "App.tsx" || /^(?:src|server)\/.+\.(?:tsx?|js)$/.test(file) && !file.includes("/tests/");
const sourceAllowed = file => /^(?:node_modules|server|src\/domain)\/.+\.(?:[cm]?js|tsx?|json)$/.test(file) || ["config/gatewayPolicy.js", "scripts/pack-mobile-gateway.cjs", "docs/EMBEDDED-GATEWAY.md", "LICENSE"].includes(file);
const validationAllowed = file => runtimeAllowed(file) || ["index.ts", "app.json", "app.config.ts", "package.json", "package-lock.json", "tsconfig.json", "server/tsconfig.json"].includes(file)
  || /^modules\/.+\.(?:tsx?|js|json|kt|java|xml|gradle)$/.test(file) && !/\/(?:tests|build|\.gradle|\.cxx)\//.test(file);
const backendSources = ["mobileSync/domain/MobileSyncValidation", "mobileSync/infrastructure/MobileSyncOperations", "mobileSync/infrastructure/MobileSync.dependencies", "mobileSync/infrastructure/MobileSync.controller", "mobileSync/infrastructure/MobileSync.routes", "app.routes"];
const backendAllowed = new Set(["package.json", "package-lock.json", "scripts/check-mobile-sync-deployment.cjs", "docs/diagnostics/mobile-sync-deployment.md",
  `${installedBase}/package.json`, `${installedBase}/index.cjs`, ...["", ".sha256", ".source-manifest.json"].map(suffix => `infrastructure/mobile-gateway/${archive}${suffix}`),
  ...backendSources.flatMap(file => [`src/${file}.ts`, `build/src/${file}.js`])]);
const report = { startedAt: new Date().toISOString(), scope: "READ_ONLY_TIME_SYNC_GATEWAY_1_0_4", completed: false, checks: [],
  effects: { applicationImports: false, diagnosticExecuted: false, environmentRead: false, privateFilesRead: false, networkExecuted: false,
    testsExecuted: false, typesExecuted: false, buildExecuted: false, packExecuted: false, installExecuted: false, deployExecuted: false,
    sqlExecuted: false, apkRead: false, runtimeVerified: false, remoteVerified: false, writes: "NEW_AUDIT_REPORTS_ONLY" },
  limitations: ["Static disk observations only; no application, gateway factory, diagnostic, compiler or packer is imported or executed.",
    "Manifest hashes cover recorded build inputs, not a newly resolved dependency graph or a newly rebuilt bundle.",
    "All exact differences are retained, including versions; no source hash is normalized or silently excluded.",
    "Validation evidence is historical, not rerun. APK/build outputs and native proof are intentionally outside this audit.",
    "Source and compiled markers are not proof of semantic equivalence, current process modules, remote deployment or SQL state.",
    "Before/after observations are not an atomic snapshot and cannot detect transient intervening edits.",
    "Local queue data is never read. This report does not prove seven pending operations applied or timer accuracy."] };
let output;

function safePath(base, relative, directory = false) {
  ensure([root, backend].includes(base) && typeof relative === "string" && /^[a-zA-Z0-9_@/ .+()-]+$/.test(relative)
    && !relative.split("/").some(part => !part || part.startsWith("."))
    && !/(?:^|\/)(?:private|credentials|sessions)(?:\/|$)|\.(?:env|enc|key|pem|p12|jks|keystore)$/i.test(relative), "UNSAFE_PATH");
  const absolute = path.join(base, ...relative.split("/"));
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    ensure(!stat.isSymbolicLink(), "SYMLINK_FORBIDDEN");
    ensure(current !== absolute || directory ? stat.isDirectory() : stat.isFile() && stat.size <= 32 * 1024 * 1024, "INVALID_FILE_TYPE_OR_SIZE");
  }
  return absolute;
}

function read(base, file) {
  if (base === backend) ensure(backendAllowed.has(file), "BACKEND_READ_NOT_ALLOWED");
  else ensure(sourceAllowed(file) || validationAllowed(file) || file === ownPath || file === "scripts/testing/time-sync-validation.cjs"
    || file === `artifacts/mobile-gateway/${archive}` || file.startsWith(`${validationFolder}/`) && /\.(?:json|log)$/.test(file)
    || file === `${previousFolder}/report.json`, "MOBILE_READ_NOT_ALLOWED");
  const bytes = fs.readFileSync(safePath(base, file));
  const key = `${base}\n${file}`;
  const digest = sha(bytes);
  if (!observations.has(key)) observations.set(key, { repository: base === root ? "Mobile" : "Backend", path: file, bytes: bytes.length, sha256: digest });
  return bytes;
}
const text = (base, file) => read(base, file).toString("utf8");
const json = (base, file) => JSON.parse(text(base, file));
const codeFor = error => error.code === "ENOENT" || error.code === "ENOTDIR" ? "MISSING_PATH" : /^[A-Z0-9_]+$/.test(error.message) ? error.message : "INSPECTION_FAILED";

function check(name, action) {
  try { report.checks.push({ name, ...action(), passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, code: codeFor(error) }); }
}

function compare(entries, allowed, base = root) {
  ensure(new Set(entries.map(([file]) => file)).size === entries.length, "DUPLICATE_HASH_INPUT");
  const items = entries.map(([file, expected]) => {
    ensure(allowed(file) && /^[a-f0-9]{64}$/.test(expected), "HASH_INPUT_NOT_ALLOWED");
    try { const current = sha(read(base, file)); return { path: file, expected, current, matches: current === expected }; }
    catch (error) { return { path: file, expected, current: null, matches: false, code: codeFor(error) }; }
  });
  return { count: items.length, matched: items.filter(item => item.matches).length, mismatches: items.filter(item => !item.matches), items };
}

function runtimeFiles(folder) {
  return fs.readdirSync(safePath(root, folder, true), { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".") || ["tests", "node_modules", "build"].includes(entry.name)) return [];
    ensure(!entry.isSymbolicLink(), "RUNTIME_SYMLINK_FORBIDDEN");
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory() ? runtimeFiles(file) : /\.(?:tsx?|js)$/.test(file) ? [file] : [];
  });
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
    ensure([0, 48].includes(header[156]) && !entries.has(name) && offset + 512 + size <= tar.length, "TAR_ENTRY_INVALID");
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const expected = ["LICENSE", "README.md", "SOURCE-MANIFEST.json", "THIRD-PARTY-LICENSES.md", "embedded-contract.d.ts", "index.cjs", "index.d.ts", "package.json"].map(file => `package/${file}`).sort();
  ensure(JSON.stringify([...entries.keys()].sort()) === JSON.stringify(expected), "ARCHIVE_CONTENTS_DIFFER");
  return entries;
}

function markers(base, file, patterns) {
  let value = "";
  let errorCode = null;
  try { value = text(base, file); } catch (error) { errorCode = codeFor(error); }
  return { path: file, sha256: errorCode ? null : sha(Buffer.from(value)), errorCode,
    checks: Object.entries(patterns).map(([marker, pattern]) => ({ marker, present: !errorCode && pattern.test(value) })) };
}

function backendMarkers(prefix, extension) {
  const compiled = extension === "js";
  const definitions = [
    { TIMER_BRANCH: /raw\.kind\s*===\s*["']timer["']/, CHECKLIST_BRANCH: /raw\.kind\s*===\s*["']checklist["']/,
      TIMER_BASE: /payload\.baseStatus\s*!==\s*["']pending["']/, CHECKLIST_ID: /Number\.isSafeInteger\(payload\.checklistId\)/,
      INVALID_STATUS: /["']MOBILE_SYNC_INVALID_STATUS["']/, INVALID_CHECKLIST: /["']MOBILE_SYNC_INVALID_CHECKLIST["']/,
      INVALID_KIND: /["']MOBILE_SYNC_INVALID_KIND["']/, COMMAND_EXPORT: compiled ? /exports\.syncCommand\s*=\s*syncCommand\s*;/ : /export const syncCommand\s*=/ },
    { TIMER_APPLY: /this\.applyTimer\(actor,\s*input\)/, CHECKLIST_ATTACH: /this\.checklists\(\)\.attach\(/,
      TIMER_WRITER: /this\.workStatus\(\)\.execute\(/, TIMER_LOCK: /this\.timerLock\.run\(/, TIMER_STATE: /this\.timerState\.status\(/,
      STATUS_CONFLICT: /["']MOBILE_SYNC_STATUS_CONFLICT["']/, INVALID_STATUS: /["']MOBILE_SYNC_INVALID_STATUS["']/,
      INVALID_CHECKLIST: /["']MOBILE_SYNC_INVALID_CHECKLIST["']/,
      OPERATIONS_EXPORT: compiled ? /exports\.default\s*=\s*MobileSyncOperations\s*;/ : /export default class MobileSyncOperations\b/ },
    { OPERATIONS_WIRING: /new\s+MobileSyncOperations(?:_\d+\.default)?\(/, TIMER_WRITER_WIRING: /technicianDashboardUpdateWorkStatusUseCase/,
      CHECKLIST_WRITER_WIRING: /checklistAssignmentUseCase/, TIMER_LOCK_WIRING: /new\s+MobileSyncTimerSequelizeLock(?:_\d+\.default)?\(/,
      TIMER_STATE_WIRING: /new\s+MobileSyncTimerStateSequelize_repository(?:_\d+\.default)?\(|new\s+MobileSyncTimerStateSequelizeRepository\(/ },
    { VALIDATOR_IMPORT: /["']@base\/mobileSync\/domain\/MobileSyncValidation["']/, VALIDATOR_CALL: /syncCommand(?:\))?\(body\)/, USE_CASE_CALL: /this\.useCase\.execute\(/ },
    { AUTH: /routes\.use\(authMiddleware\.verifySession\)/, COMMAND_ROUTE: /routes\.post\(["']\/commands["'],\s*(?:\w+\.)?mobileSyncController\.commands\.bind\(/, ROUTER_MOUNT: /router\.use\(["']\/mobile-sync["'],\s*routes\)/ },
    { ROUTER_IMPORT: /["']@base\/mobileSync\/infrastructure\/MobileSync\.routes["']/,
      ROUTER_REGISTRATION: compiled ? /app\.use\(prefixApi,\s*\(0,\s*MobileSync_routes_\d+\.default\)\(authMiddleware\)\)/ : /app\.use\(prefixApi,\s*getRoutesMobileSync\(authMiddleware\)\)/ },
  ];
  const files = backendSources.map((file, index) => markers(backend, `${prefix}/${file}.${extension}`, definitions[index]));
  return { files, allPresent: files.every(file => !file.errorCode && file.checks.every(item => item.present)),
    fingerprint: files.every(file => !file.errorCode) ? sha(files.map(file => `${file.path}\0${file.sha256}\n`).join("")) : null };
}

function main() {
  ensure(process.argv.length === 2, "ARGUMENTS_NOT_ALLOWED");
  const destination = path.join(safePath(root, "artifacts/logs", true), "time-sync-audit");
  if (!fs.existsSync(destination)) fs.mkdirSync(destination);
  safePath(root, "artifacts/logs/time-sync-audit", true);
  output = fs.mkdtempSync(path.join(destination, `${report.startedAt.replace(/[:.]/g, "-")}-`));
  read(root, ownPath);
  const inventory = ["App.tsx", ...runtimeFiles("src"), ...runtimeFiles("server")].sort();
  const validation = json(root, `${validationFolder}/report.json`);

  check("latest-full-validation-sources-exact-including-versions", () => {
    const latest = fs.readdirSync(safePath(root, "artifacts/logs/time-sync", true)).filter(name => /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(name)).sort().at(-1);
    report.validation = { path: `${validationFolder}/report.json`, latest, passedHistorically: validation.passed,
      startedAt: validation.startedAt, completedAt: validation.completedAt, ignoredVersionHashes: [] };
    const expected = Object.entries(validation.sourceHashesAfter).filter(([file]) => runtimeAllowed(file));
    report.runtime = compare(expected, runtimeAllowed);
    report.runtime.inventory = { current: inventory.length, client: inventory.filter(file => !file.startsWith("server/")).length,
      server: inventory.filter(file => file.startsWith("server/")).length,
      added: inventory.filter(file => !expected.some(([name]) => name === file)), removed: expected.map(([file]) => file).filter(file => !inventory.includes(file)) };
    report.validationInputs = compare(Object.entries(validation.sourceHashesAfter).filter(([file]) => validationAllowed(file) && !runtimeAllowed(file)), validationAllowed);
    report.validationExcluded = Object.keys(validation.sourceHashesAfter).filter(file => !validationAllowed(file));
    report.validation.excludedReason = "APK, historical gateway artifacts and native proof intentionally not revalidated; current gateway audited separately";
    report.validation.beforeAfterDifferences = [...new Set([...Object.keys(validation.sourceHashesBefore), ...Object.keys(validation.sourceHashesAfter)])]
      .filter(file => validation.sourceHashesBefore[file] !== validation.sourceHashesAfter[file]);
    ensure(validationFolder.endsWith(latest) && validation.passed && validation.completedAt && validation.changedSources.length === 0 && report.validation.beforeAfterDifferences.length === 0, "VALIDATION_HISTORY_INVALID");
    ensure(!report.runtime.mismatches.length && !report.validationInputs.mismatches.length && !report.runtime.inventory.added.length && !report.runtime.inventory.removed.length, "CURRENT_VALIDATION_INPUTS_DIFFER");
    return { runtime: report.runtime.count, extraInputs: report.validationInputs.count, mismatches: 0 };
  });

  check("historical-validation-logs-not-rerun", () => {
    const logs = validation.phases.filter(phase => phase.counts).map(phase => {
      const file = `${validationFolder}/${phase.name}.log`;
      ensure(["focused-tests", "mobile-official-suite", "supplemental-client-tests"].includes(phase.name), "UNKNOWN_LOG");
      const value = text(root, file);
      const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
        const matches = [...value.matchAll(new RegExp(`(?:#|\\u2139) ${key} (\\d+)`, "g"))];
        ensure(matches.length === 1, "LOG_COUNTS_AMBIGUOUS");
        return [key, Number(matches[0][1])];
      }));
      ensure(phase.exitCode === 0 && phase.complete && Object.entries(counts).every(([key, count]) => count === phase.counts[key]), "LOG_COUNTS_DIFFER");
      return { path: file, counts };
    });
    report.historicalValidation = { logs, uniqueFullCounts: validation.uniqueFullCounts, phases: validation.phases,
      excludedDuplicateEntries: validation.excludedDuplicateEntries, focusedAlreadyIncluded: true, rerun: false,
      runnerSha256: sha(read(root, "scripts/testing/time-sync-validation.cjs")) };
    ensure(logs.length === 3 && validation.phases.length === 6 && validation.phases.every(phase => phase.exitCode === 0), "HISTORICAL_PHASES_INVALID");
    return { uniquePass: validation.uniqueFullCounts.pass, skipped: validation.uniqueFullCounts.skipped, focusedAlreadyIncluded: true };
  });

  check("changes-from-previous-runtime-inventory", () => {
    const previous = json(root, `${previousFolder}/report.json`);
    report.previousRuntime = compare(Object.entries(previous.sourceHashes), runtimeAllowed);
    report.previousRuntime.added = inventory.filter(file => !Object.hasOwn(previous.sourceHashes, file)).map(file => ({ path: file, sha256: sha(read(root, file)) }));
    report.previousRuntime.basis = `${previousFolder}/report.json`;
    return { previousCount: report.previousRuntime.count, currentCount: inventory.length, changed: report.previousRuntime.mismatches.length, added: report.previousRuntime.added.length, differencesExpected: true };
  });

  let entries;
  let manifest;
  let bytes;
  check("immutable-gateway-archive-and-recorded-inputs", () => {
    bytes = read(root, `artifacts/mobile-gateway/${archive}`);
    ensure(bytes.length === 585030 && sha(bytes) === archiveSha, "GATEWAY_ARCHIVE_DIFFERS");
    entries = tarEntries(bytes);
    manifest = JSON.parse(entries.get("package/SOURCE-MANIFEST.json"));
    const pkg = JSON.parse(entries.get("package/package.json"));
    report.gateway = { version: pkg.version, bytes: bytes.length, sha256: sha(bytes), bundleSha256: sha(entries.get("package/index.cjs")),
      manifestSha256: sha(entries.get("package/SOURCE-MANIFEST.json")), recordedTools: manifest.tools, loaded: false, newPackageNeeded: null };
    ensure(pkg.name === "@qualitzer/mobile-gateway" && pkg.version === "1.0.4" && manifest.name === pkg.name && manifest.version === pkg.version
      && manifest.bundleSha256 === bundleSha && report.gateway.bundleSha256 === bundleSha, "GATEWAY_IDENTITY_DIFFERS");
    report.gatewaySources = compare(manifest.sources.map(item => [item.path, item.sha256]), sourceAllowed);
    report.gatewayDependencies = compare(manifest.dependencies.map(item => [`${item.location}/package.json`, item.manifestSha256]), file => file.startsWith("node_modules/") && file.endsWith("/package.json"));
    report.gatewayDependencyVersions = manifest.dependencies.map(item => {
      try { const current = json(root, `${item.location}/package.json`); return { location: item.location, expectedName: item.name, currentName: current.name,
        expectedVersion: item.version, currentVersion: current.version, matches: item.name === current.name && item.version === current.version }; }
      catch (error) { return { location: item.location, expectedVersion: item.version, matches: false, code: codeFor(error) }; }
    });
    report.gatewayToolVersions = Object.entries(manifest.tools).map(([name, version]) => ({ name, recorded: version, current: json(root, `node_modules/${name}/package.json`).version }));
    ensure(report.gatewaySources.count === 351 && report.gatewayDependencies.count === 91, "GATEWAY_INVENTORY_DIFFERS");
    report.gateway.newPackageNeeded = !!(report.gatewaySources.mismatches.length || report.gatewayDependencies.mismatches.length || report.gatewayDependencyVersions.some(item => !item.matches));
    ensure(!report.gateway.newPackageNeeded, "RECORDED_GATEWAY_INPUTS_DIFFER");
    return { sources: 351, dependencyManifests: 91, exactMismatches: 0 };
  });

  check("offline-types-picker-and-client-dataflow-not-gateway-inputs", () => {
    ensure(manifest, "GATEWAY_MANIFEST_UNAVAILABLE");
    const names = new Set(manifest.sources.map(item => item.path));
    const files = ["src/domain/offline.ts", "src/domain/models.ts", "src/domain/offlineProtocol.ts", "src/offline/engine.ts", "src/offline/syncScheduling.ts",
      "src/screens/offline/syncAttemptPresentation.ts", ...inventory.filter(file => file.startsWith("src/ui/time/")), "package.json", "package-lock.json"];
    report.inputMembership = [...new Set(files)].map(file => ({ path: file, includedInGatewayManifest: names.has(file), currentSha256: sha(read(root, file)) }));
    const pkg = json(root, "package.json");
    const picker = json(root, "node_modules/@react-native-community/datetimepicker/package.json");
    const lock = json(root, "package-lock.json");
    report.picker = { declared: pkg.dependencies[picker.name], installed: picker.version, locked: lock.packages?.[`node_modules/${picker.name}`]?.version,
      bundledGatewayDependency: manifest.dependencies.some(item => item.name === picker.name), sourceInGateway: manifest.sources.some(item => item.path.includes("datetimepicker")) };
    const offline = text(root, "src/domain/offline.ts");
    report.offlineDeclarations = { containsRuntimeClasses: /export class OfflineQueuedError/.test(offline), entireFileTypeOnly: false,
      additions: { OfflineDeploymentCounts: /export type OfflineDeploymentCounts\s*=/.test(offline), awaitingDeploymentByKind: /awaitingDeploymentByKind\?: OfflineDeploymentCounts/.test(offline), requestSync: /requestSync\?\(\): Promise<void>/.test(offline) },
      inManifest: names.has("src/domain/offline.ts"), wireProtocolInManifest: names.has("src/domain/offlineProtocol.ts") };
    report.gatewayOfflineReferences = manifest.sources.filter(item => !item.path.startsWith("node_modules/") && /\.(?:ts|js)$/.test(item.path)).flatMap(item => {
      const value = text(root, item.path);
      return [...value.matchAll(/(?:import|export)\s+(type\s+)?[^;]*?from\s*["']([^"']*\/offline)["']/g)].map(match => ({ path: item.path, specifier: match[2], typeOnly: !!match[1] }));
    });
    report.dataflow = { basis: "Manual static review plus exact source hashes; not a runtime trace", steps: [
      "TimeField/native picker confirms HH:mm into existing client forms; no datetimepicker dependency in the gateway manifest.",
      "Client requestManualSync selects requestSync when available, otherwise syncNow; engine manages durable per-kind deployment cooldowns.",
      "awaitingDeploymentByKind is derived locally from queue dependencies; presentation compares applied IDs before/after and retains unresolved reasons.",
      "Wire timer/checklist validation remains in unchanged src/domain/offlineProtocol.ts, already included in gateway 1.0.4.",
      "Gateway forwards existing commands to Backend MobileSync validation/operations; installed version and process deployment are separate from repository declarations." ] };
    ensure(!report.offlineDeclarations.inManifest && Object.values(report.offlineDeclarations.additions).every(Boolean) && report.offlineDeclarations.wireProtocolInManifest
      && report.picker.declared === "9.1.0" && report.picker.installed === "9.1.0" && report.picker.locked === "9.1.0" && !report.picker.bundledGatewayDependency && !report.picker.sourceInGateway, "CLIENT_GATEWAY_BOUNDARY_DIFFERS");
    return { offlineWholeFileTypeOnly: false, offlineIncluded: false, wireProtocolIncluded: true, pickerIncluded: false };
  });

  check("backend-local-declaration-artifact-and-installed-public-files", () => {
    ensure(entries && bytes, "GATEWAY_ARCHIVE_UNAVAILABLE");
    const pkg = json(backend, "package.json");
    const lock = json(backend, "package-lock.json");
    const installed = json(backend, `${installedBase}/package.json`);
    const reference = `file:infrastructure/mobile-gateway/${archive}`;
    const locked = lock.packages?.[installedBase];
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    report.backendReferences = { declared: pkg.dependencies?.["@qualitzer/mobile-gateway"], lockRoot: lock.packages?.[""]?.dependencies?.["@qualitzer/mobile-gateway"],
      lockedVersion: locked?.version, lockedResolved: locked?.resolved, lockedIntegrity: locked?.integrity, expectedIntegrity: integrity,
      matches: pkg.dependencies?.["@qualitzer/mobile-gateway"] === reference && lock.packages?.[""]?.dependencies?.["@qualitzer/mobile-gateway"] === reference && locked?.version === "1.0.4" && locked.resolved === reference && locked.integrity === integrity };
    report.backendCopies = [["", bytes], [".source-manifest.json", entries.get("package/SOURCE-MANIFEST.json")], [".sha256", Buffer.from(`${archiveSha}  ${archive}\n`)]].map(([suffix, expected]) => {
      const file = `infrastructure/mobile-gateway/${archive}${suffix}`;
      const actual = read(backend, file);
      const byteMatches = actual.equals(expected);
      const crlfOnly = suffix !== "" && !byteMatches && Buffer.from(actual.toString("utf8").replace(/\r\n/g, "\n")).equals(expected);
      return { path: file, bytes: actual.length, expectedBytes: expected.length, sha256: sha(actual), expectedSha256: sha(expected), byteMatches, matches: byteMatches || crlfOnly,
        difference: byteMatches ? null : crlfOnly ? "CRLF_ONLY_TEXT_SIDECAR" : "CONTENT_DIFFERS" };
    });
    const patterns = { TIMER_SCHEMA: /kind:\s*\w+\.literal\(["']timer["']\)/, CHECKLIST_SCHEMA: /kind:\s*\w+\.literal\(["']checklist["']\)/,
      TIMER_BASE_SCHEMA: /baseStatus:\s*\w+\.enum\(\[["']pending["'],\s*["']in_progress["'],\s*["']paused["']\]\)/,
      CHECKLIST_ID_SCHEMA: /checklistId:\s*syncPositiveIdSchema\b/, COMMAND_SCHEMA_PARSE: /syncCommandSchema\.parse\(req\.body\)/,
      BACKEND_COMMAND_PATH: /["']\/mobile-sync\/commands["']/, STATUS_CONFLICT: /["']MOBILE_SYNC_STATUS_CONFLICT["']/,
      INVALID_STATUS: /["']MOBILE_SYNC_INVALID_STATUS["']/, INVALID_CHECKLIST: /["']MOBILE_SYNC_INVALID_CHECKLIST["']/ };
    const installedMarkers = markers(backend, `${installedBase}/index.cjs`, patterns);
    report.backendInstalled = { name: installed.name, version: installed.version, main: installed.main,
      versionMatchesLock: installed.version === locked?.version, nameMatches: installed.name === "@qualitzer/mobile-gateway",
      requireEntrypointMatches: installed.exports?.["."]?.require === "./index.cjs", bundleSha256: installedMarkers.sha256, expectedBundleSha256: bundleSha,
      bundleMatches: installedMarkers.sha256 === bundleSha, markers: installedMarkers, remotelyVerified: false };
    report.archivedGatewayMarkers = Object.entries(patterns).map(([marker, pattern]) => ({ marker, present: pattern.test(entries.get("package/index.cjs").toString("utf8")) }));
    ensure(report.backendReferences.matches && report.backendCopies.every(item => item.matches), "BACKEND_DECLARATION_OR_ARTIFACT_DIFFERS");
    return { declaredVersion: "1.0.4", installedVersion: installed.version, installedMatches: report.backendInstalled.versionMatchesLock && report.backendInstalled.bundleMatches,
      note: "Installed mismatch is a finding, not hidden by this inspection-success flag" };
  });

  check("backend-diagnostic-source-read-only-and-source-build-markers", () => {
    const file = "scripts/check-mobile-sync-deployment.cjs";
    const diagnostic = text(backend, file);
    const imports = [...diagnostic.matchAll(/require\(["']([^"']+)["']\)/g)].map(match => match[1]);
    report.backendDiagnostic = { path: file, sha256: sha(Buffer.from(diagnostic)), staticRequireSpecifiers: imports, imported: false, executed: false,
      documentationSha256: sha(read(backend, "docs/diagnostics/mobile-sync-deployment.md")) };
    report.backendSource = backendMarkers("src", "ts");
    report.backendBuild = backendMarkers("build/src", "js");
    ensure(JSON.stringify(imports.sort()) === JSON.stringify(["node:crypto", "node:fs", "node:path"]) && report.backendSource.allPresent && report.backendBuild.allPresent, "BACKEND_STATIC_MARKERS_DIFFER");
    return { sourceFiles: 6, compiledFiles: 6, markersPresent: true, diagnosticExecuted: false };
  });

  check("observed-inputs-stable-at-audit-close", () => {
    report.concurrentChanges = [];
    for (const item of [...observations.values()]) {
      try { const current = sha(read(item.repository === "Mobile" ? root : backend, item.path)); if (current !== item.sha256) report.concurrentChanges.push({ ...item, current }); }
      catch (error) { report.concurrentChanges.push({ ...item, current: null, code: codeFor(error) }); }
    }
    const finalInventory = ["App.tsx", ...runtimeFiles("src"), ...runtimeFiles("server")].sort();
    report.runtimeInventoryStable = JSON.stringify(inventory) === JSON.stringify(finalInventory);
    ensure(!report.concurrentChanges.length && report.runtimeInventoryStable, "INPUTS_CHANGED_DURING_AUDIT");
    return { observedFiles: observations.size, changed: 0 };
  });
  report.completed = true;
  report.auditPassed = report.checks.every(item => item.passed);
  report.newGatewayPackageNeeded = report.auditPassed ? report.gateway.newPackageNeeded : null;
  report.localInstalledGatewayMatchesRelease = report.backendInstalled?.versionMatchesLock === true && report.backendInstalled?.bundleMatches === true;
  report.remoteAction = "If the actual service already runs approved gateway 1.0.4 with compatible Backend, these client changes require no new gateway package or reinstall. Remote state is not verified. Local installed 1.0.0 is a separate mismatch; no installation performed.";
}

try { main(); }
catch (error) { report.auditPassed = false; report.checks.push({ name: "completion", passed: false, code: codeFor(error) }); }
finally {
  report.completedAt = new Date().toISOString();
  if (output) {
    report.output = path.relative(root, output).split(path.sep).join("/");
    fs.writeFileSync(path.join(output, "observed-hashes.json"), JSON.stringify([...observations.values()], null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify({ report: report.output ? `${report.output}/report.json` : null, auditPassed: report.auditPassed,
    newGatewayPackageNeeded: report.newGatewayPackageNeeded, localInstalledGatewayMatchesRelease: report.localInstalledGatewayMatchesRelease, checks: report.checks }, null, 2)}\n`);
  process.exitCode = report.auditPassed ? 0 : 1;
}