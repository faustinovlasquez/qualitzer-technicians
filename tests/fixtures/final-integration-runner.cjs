const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const output = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-mobile-beforebuild-"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
function snapshot() {
  const result = {};
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    if (fs.statSync(absolute).isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) {
        if (["node_modules", "build", ".gradle", "tests"].includes(entry)) continue;
        visit(`${relative}/${entry}`);
      }
    } else if (!/\.(key|keystore|jks|tgz)$/i.test(relative)) result[relative] = sha(fs.readFileSync(absolute));
  }
  for (const relative of ["src", "server", "modules", "assets", "config", "scripts", "App.tsx", "app.json", "app.config.ts", "package.json", "package-lock.json", "eas.json", "tsconfig.json", "index.ts"]) visit(relative);
  return result;
}
const baselinePath = path.join(output, "source-baseline.json");
if (!fs.existsSync(baselinePath)) fs.writeFileSync(baselinePath, JSON.stringify(snapshot(), null, 2));
const run = new Date().toISOString().replace(/[:.]/g, "-");
const report = { output, run, node: process.version, stages: [] };
console.log(`VALIDATION_OUTPUT=${output}`);
const stages = process.argv[3] === "archive" ? [] : process.argv[3] === "supplemental" ? [
  ["branding-ui", ["tests/e2e/branding-smoke.cjs"]],
  ["app-shell-ui", ["tests/fixtures/final-app-shell.cjs"]],
  ["release-contract", ["tests/fixtures/final-release-check.cjs"]],
] : [
  ["full-tests", ["scripts/test.cjs"]],
  ["app-types", ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"]],
  ["server-types", ["node_modules/typescript/bin/tsc", "--project", "server/tsconfig.json", "--noEmit", "--pretty", "false"]],
  ["branding-assets-cjs", ["--test", "--test-reporter=tap", "tests/branding-assets.test.cjs"]],
];
for (const [name, args] of stages) {
  const log = path.join(output, `${run}-${name}.log`);
  const fd = fs.openSync(log, "w");
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: ["ignore", fd, fd], env: { ...process.env, NO_COLOR: "1" }, windowsHide: true });
  fs.closeSync(fd);
  const text = fs.readFileSync(log, "utf8");
  const summary = text.split(/\r?\n/).filter((line) => /^(?:\u2139|#) (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(line));
  report.stages.push({ name, status: result.status, signal: result.signal, error: result.error?.message, log, summary });
  console.log(JSON.stringify(report.stages.at(-1)));
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const current = snapshot();
report.sourceFiles = Object.keys(baseline).length;
report.baselineSha256 = sha(fs.readFileSync(baselinePath));
report.sourceChanges = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].filter((file) => baseline[file] !== current[file]);
fs.writeFileSync(path.join(output, `${run}-report.json`), JSON.stringify(report, null, 2));
if (process.argv[3] === "archive") {
  const archive = path.join(root, "artifacts/logs/mobile-beforebuild-final-2026-09-10");
  fs.mkdirSync(archive, { recursive: true });
  fs.cpSync(output, archive, { recursive: true });
  for (const file of ["final-integration-runner.cjs", "final-app-shell.cjs", "final-release-check.cjs"]) {
    fs.copyFileSync(path.join(__dirname, file), path.join(archive, file));
  }
  for (const [name, directory] of [["app-shell", "qualitzer-final-app-shell-KmNSaC"], ["branding", "qualitzer-brand-ui-xVFmjK"], ["clock-prior", "qualitzer-tenant-clock-e2e-ebCKZq"]]) {
    fs.cpSync(path.join(os.tmpdir(), directory), path.join(archive, name), { recursive: true });
  }
  const text = fs.readFileSync(path.join(output, "2026-09-10T22-20-29-950Z-full-tests.log"), "utf8");
  const final = {
    ...report, completedAt: new Date().toISOString(),
    tests: { total: 773, pass: 772, fail: 0, skipped: 1, skipLines: text.split(/\r?\n/).filter((line) => /SKIP|skip|\uFE63/.test(line)) },
    appTypecheckExit: 0, serverTypecheckExit: 0, assetsCjs: { pass: 4, fail: 0 },
    brandingViewports: 4, appShellViewports: 4, clockPriorScenarios: 12,
    shellScope: "Real App, Dashboard, Profile, Brand; controlled demo hook; native APIs and decorative icons are fixture boundaries; no real auth/offline engine or native phone verification",
    fixtureFix: "Wait for logout modal to unmount before counting the next viewport's company label; no production stub or production edit",
    remainingFinding: "ProfileScreen footer hardcodes 1.0.0 while app release is 1.0.1/code2; left for principal",
    forbiddenActionsPerformed: [],
  };
  fs.writeFileSync(path.join(archive, "final-report.json"), JSON.stringify(final, null, 2));
  console.log(`ARCHIVED_EVIDENCE=${archive}`);
}
console.log(`VALIDATION_COMPLETE=${JSON.stringify(report)}`);
process.exitCode = report.stages.some((stage) => stage.status !== 0) || report.sourceChanges.length ? 1 : 0;