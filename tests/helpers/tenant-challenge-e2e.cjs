const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const { createWriteStream, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const output = mkdtempSync(path.join(tmpdir(), "qualitzer-tenant-clock-isolated-"));
const summary = { startedAt: new Date().toISOString(), output, passed: false };
const sources = ["src/infrastructure/tenantChallengeClock.ts", "src/infrastructure/HttpTechnicianRepository.ts", "src/application/useTechnicianApp.ts", "src/screens/TenantSelectionScreen.tsx"];
const fingerprint = () => Object.fromEntries(sources.map((file) => [file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")]));
const environment = { ...process.env, CI: "1", EXPO_NO_DOTENV: "1", EXPO_PUBLIC_STANDALONE: "true", EXPO_PUBLIC_GATEWAY_URL: "https://tenant-clock.example.com/mobile", TENANT_CLOCK_METRO_URL: "http://localhost:8788" };

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

(async () => {
  console.log(`ISOLATED_REPORT=${output}`);
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(8788, resolve); });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  summary.sourcesBefore = fingerprint();
  const log = createWriteStream(path.join(output, "metro.log"));
  const metro = spawn(process.execPath, ["node_modules/expo/bin/cli", "start", "--port", "8788", "--offline"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  metro.stdout.pipe(log); metro.stderr.pipe(log);
  let smoke;
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { clearInterval(interval); reject(new Error("ISOLATED_METRO_START_TIMEOUT")); }, 90000);
      const interval = setInterval(async () => {
        try {
          const response = await fetch("http://localhost:8788/status", { signal: AbortSignal.timeout(1000) });
          if (!response.ok || !/packager-status:running/.test(await response.text())) return;
          clearInterval(interval); clearTimeout(deadline); resolve();
        } catch {}
      }, 500);
      metro.once("error", (error) => { clearInterval(interval); clearTimeout(deadline); reject(error); });
      metro.once("exit", () => { clearInterval(interval); clearTimeout(deadline); reject(new Error("ISOLATED_METRO_EXITED")); });
    });
    smoke = spawn(process.execPath, ["tests/e2e/tenant-selection-clock-smoke.cjs"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const smokeLog = createWriteStream(path.join(output, "smoke.log"));
    smoke.stdout.pipe(smokeLog); smoke.stderr.pipe(smokeLog);
    smoke.stdout.pipe(process.stdout); smoke.stderr.pipe(process.stderr);
    const [exit] = await once(smoke, "exit");
    summary.smokeExit = exit;
    summary.sourcesAfter = fingerprint();
    assert.deepEqual(summary.sourcesAfter, summary.sourcesBefore, "Auth sources must not change during verification");
    assert.equal(exit, 0, "Isolated UI assertions must all pass");
    summary.passed = true;
  } finally {
    await stop(smoke); await stop(metro); log.end();
    summary.completedAt = new Date().toISOString();
    writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  }
  console.log(`ISOLATED_TENANT_CLOCK_PASS ${output}`);
})().catch((error) => {
  summary.error = error.stack;
  writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.error(error); process.exitCode = 1;
});