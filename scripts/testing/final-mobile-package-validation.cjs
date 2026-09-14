const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/mobile-package-1.0.1-final");
fs.mkdirSync(output, { recursive: true });
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { startedAt: new Date().toISOString(), node: process.version, phases: [] };
const reportFile = path.join(output, "validation.json");
const save = () => fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
function snapshot() {
  const files = [];
  function walk(relative) {
    const full = path.join(root, relative);
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full)) {
        if (!["build", ".gradle", "tests", "node_modules"].includes(name)) walk(`${relative}/${name}`);
      }
    } else files.push([relative, sha(full)]);
  }
  for (const relative of ["App.tsx", "app.json", "app.config.ts", "src", "server", "config", "modules", "scripts/android"]) walk(relative);
  return Object.fromEntries(files);
}
function run(label, executable, args, extraEnv = {}) {
  const result = spawnSync(executable, args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_DOTENV: "1", ...extraEnv },
  });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  fs.writeFileSync(path.join(output, `${label}.log`), text);
  const counts = {};
  for (const key of ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const match = text.match(new RegExp(`(?:^|\\n)(?:#|\\u2139) ${key} (\\d+)`));
    if (match) counts[key] = Number(match[1]);
  }
  const phase = { label, exitCode: result.status, signal: result.signal, error: result.error?.message, counts };
  report.phases.push(phase);
  save();
  process.stdout.write(`${JSON.stringify(phase)}\n`);
  return { phase, text };
}

try {
  const before = snapshot();
  const oldArchive = path.resolve(root, "../Qualitzer2.0-Backend/infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.0.tgz");
  const oldHash = fs.existsSync(oldArchive) ? sha(oldArchive) : null;
  const systemNode = "C:/nvm4w/nodejs/node.exe";
  const npmCli = fs.realpathSync("C:/nvm4w/nodejs/node_modules/npm/bin/npm-cli.js");
  report.npmCli = npmCli;
  report.systemNode = spawnSync(systemNode, ["--version"], { encoding: "utf8" }).stdout.trim();
  save();
  const packed = run("pack", process.execPath, ["scripts/pack-mobile-gateway.cjs"], { npm_execpath: npmCli });
  if (packed.phase.exitCode !== 0) throw new Error("PACK_FAILED");
  report.package = JSON.parse(packed.text.trim());
  run("full-mobile", process.execPath, ["scripts/test.cjs"]);
  run("typecheck-app", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--project", "tsconfig.json"]);
  run("typecheck-server", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--project", "server/tsconfig.json"]);
  run("branding-assets", process.execPath, ["--test", "--test-reporter=tap", "tests/branding-assets.test.cjs"]);
  const archiveEnv = { QZM_GATEWAY_ARCHIVE: report.package.archive, QZM_GATEWAY_VERSION: "1.0.1" };
  run("packed-node22", process.execPath, ["--test", "--test-reporter=tap", "server/tests/embedded-runtime.test.cjs"], archiveEnv);
  if (!/^v20\./.test(report.systemNode)) throw new Error("NODE20_NOT_AVAILABLE");
  run("packed-node20", systemNode, ["--test", "--test-reporter=tap", "server/tests/embedded-runtime.test.cjs"], archiveEnv);
  const after = snapshot();
  report.runtimeChanges = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((file) => before[file] !== after[file]);
  report.oldArchive = { presentBefore: oldHash !== null, sha256: oldHash, unchanged: (fs.existsSync(oldArchive) ? sha(oldArchive) : null) === oldHash };
  report.package.verifiedSha256 = sha(report.package.archive);
  report.package.bytes = fs.statSync(report.package.archive).size;
  const tar = path.join(process.env.SystemRoot, "System32/tar.exe");
  const manifestRead = spawnSync(tar, ["-xOf", report.package.archive, "package/SOURCE-MANIFEST.json"], { encoding: "utf8" });
  if (manifestRead.status !== 0) throw new Error("SOURCE_MANIFEST_READ_FAILED");
  const manifest = JSON.parse(manifestRead.stdout);
  report.package.localSources = manifest.sources.filter((source) => !source.path.startsWith("node_modules/")).map((source) => source.path);
  report.package.forbiddenSources = report.package.localSources.filter((file) => /^(?:App\.tsx|modules\/|src\/(?:application|branding|screens|infrastructure)\/|scripts\/android\/)/.test(file));
  if (report.package.forbiddenSources.length) throw new Error("FORBIDDEN_PACKAGE_GRAPH");
  if (!report.package.localSources.includes("server/branch-branding.ts") || !report.package.localSources.includes("config/gatewayPolicy.js")) throw new Error("BRANCH_BRANDING_GRAPH_MISSING");
  report.nativeRefreshEvidence = JSON.parse(fs.readFileSync(path.join(root, "artifacts/logs/native-refresh-closure/validation.json"), "utf8"));
  report.nativeRefreshSourcesMatch = report.nativeRefreshEvidence.refreshSources.every((source) => sha(path.join(root, source.file)) === source.sha256);
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo;
  report.app = { version: app.version, versionCode: app.android.versionCode };
  report.passed = report.phases.every((phase) => phase.exitCode === 0) && report.runtimeChanges.length === 0 && report.oldArchive.unchanged && report.package.sha256 === report.package.verifiedSha256 && report.nativeRefreshSourcesMatch;
} catch (error) {
  report.error = error.message;
  report.passed = false;
} finally {
  report.completedAt = new Date().toISOString();
  save();
  process.stdout.write(`FINAL_REPORT=${reportFile}\nPASSED=${report.passed}\n`);
  process.exitCode = report.passed ? 0 : 1;
}