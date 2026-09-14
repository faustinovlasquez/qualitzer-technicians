const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const root = path.resolve(__dirname, "../..");
const policy = require("../../scripts/android/release-policy.cjs");
const provenance = require("../../scripts/android/release-provenance.cjs");
async function main() {
  const release = policy.expectedRelease(root);
  assert.deepEqual(release, { version: "1.0.1", versionCode: 2, name: "qualitzer-tecnicos-1.0.1-android.apk" });
  for (const [version, code] of [["../1.0.1", 2], ["1.0.1", 0], ["01.0.1", 2], ["1.0.1", 2.5]]) assert.throws(() => policy.validateVersion(version, code), /INVALID_RELEASE_VERSION_OR_CODE/);
  const sources = provenance.captureSources(root);
  assert.equal(sources.length, 10);
  assert.ok(sources.some((source) => source.file === "src/infrastructure/tenantChallengeClock.ts"));
  assert.ok(!sources.some((source) => source.file === "src/domain/tenantChallengeClock.ts"));
  const isolatedPath = path.join(os.tmpdir(), "qualitzer-tenant-clock-isolated-DUUPpg", "summary.json");
  const isolated = JSON.parse(fs.readFileSync(isolatedPath, "utf8"));
  assert.equal(isolated.passed, true);
  for (const [file, hash] of Object.entries(isolated.sourcesAfter)) assert.equal(policy.sha256File(path.join(root, file)), hash, `Clock E2E evidence must match current ${file}`);
  const clockPath = path.join(os.tmpdir(), "qualitzer-tenant-clock-e2e-ebCKZq", "summary.json");
  const clock = JSON.parse(fs.readFileSync(clockPath, "utf8"));
  assert.equal(clock.results.length, 12);
  assert.ok(clock.results.every((result) => result.passed));
  const excludedCjs = fs.readdirSync(path.join(root, "server/tests")).filter((file) => file.endsWith(".test.cjs"));
  const profile = fs.readFileSync(path.join(root, "src/screens/ProfileScreen.tsx"), "utf8");
  const report = {
    release, packageName: policy.packageName, sourceCount: sources.length, sources,
    previousClockEvidence: { clockPath, isolatedPath, passed: 12, sourceHashesMatch: true, rerun: false },
    health: await provenance.checkHealth(),
    excludedCjs: excludedCjs.map((file) => `server/tests/${file}`),
    reasonExcluded: "scripts/test.cjs discovers only .test.ts; these additional CJS suites load sibling backend sources or its gateway archive and are outside Mobile-only scope",
    remainingFinding: profile.includes("Primera versión técnica · 1.0.0") ? "Profile footer reports 1.0.0 although release is 1.0.1; runtime unchanged" : null,
  };
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });