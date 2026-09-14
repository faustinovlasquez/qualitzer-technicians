import assert from "node:assert/strict";
import { test } from "node:test";
import type { TenantLoginChallenge } from "../src/domain/models";
import { getTenantChallengeRemaining, registerTenantChallengeClock } from "../src/infrastructure/tenantChallengeClock";

const serverDate = "Thu, 10 Sep 2026 12:00:00 GMT";
const expiry = "2026-09-10T12:02:00.000Z";
function challenge(expiresAt = expiry): TenantLoginChallenge {
  return { nextStep: "SELECT_TENANT", challenge: `qzc_${"a".repeat(43)}`, expiresAt, tenants: [] };
}
function fixture(date: string | null = serverDate, expiresAt = expiry, start = 0, headers = 400, body = 100) {
  let now = headers + body;
  const value = challenge(expiresAt);
  registerTenantChallengeClock(value, { serverDate: date, requestStartedAt: start, headersReceivedAt: headers }, () => now);
  return { value, read: () => getTenantChallengeRemaining(value), advance: (ms: number) => { now += ms; } };
}

test("server baseline ignores phone offsets and later forward/backward wall-clock jumps", (t) => {
  const f = fixture();
  const original = Date.now();
  for (const offset of [24 * 3600_000, -24 * 3600_000, 365 * 86400_000, -365 * 86400_000]) {
    t.mock.method(Date, "now", () => original + offset);
    assert.deepEqual(f.read(), { source: "server", remainingMs: 118_500 });
  }
  f.advance(10_000);
  assert.equal(f.read().remainingMs, 108_500);
});

test("request, body and time before first render are charged, including a slow login", () => {
  const f = fixture(serverDate, expiry, 1000, 21_000, 5000);
  assert.equal(f.read().remainingMs, 94_000);
  f.advance(4000);
  assert.equal(f.read().remainingMs, 90_000);
});

test("Date whole-second uncertainty costs one second, not the entire normal challenge", () => {
  assert.equal(fixture().read().remainingMs, 118_500);
  assert.equal(fixture(serverDate, "2026-09-10T12:02:00.950Z").read().remainingMs, 119_450);
  assert.equal(fixture(serverDate, "2026-09-10T13:02:00.000Z").read().remainingMs, 119_500);
});

for (const date of [null, "", "not-a-date", "0", "2026-09-10", "Wed, 10 Sep 2026 12:00:00 GMT", "Thu, 31 Sep 2026 12:00:00 GMT"]) {
  test(`missing/unexposed/malformed Date falls back to a bounded local budget: ${String(date)}`, () => {
    const f = fixture(date, "2000-01-01T00:00:00Z");
    assert.deepEqual(f.read(), { source: "unverified", remainingMs: 119_500 });
    f.advance(119_500);
    assert.deepEqual(f.read(), { source: "unverified", remainingMs: 0 });
  });
}

test("malformed expiry fails closed regardless of server baseline", () => {
  for (const expiresAt of ["", "invalid", "0", "2026-02-30T00:00:00Z", "2026-09-10T12:02:00", "2026-09-10T25:00:00Z"]) {
    for (const date of [serverDate, null]) assert.deepEqual(fixture(date, expiresAt).read(), { source: "invalid", remainingMs: 0 });
  }
});

test("server-expired values, exhausted latency and actual elapsed deadline return exactly zero", () => {
  for (const expiresAt of ["2026-09-10T11:59:59Z", "2026-09-10T12:00:00Z"]) assert.equal(fixture(serverDate, expiresAt).read().remainingMs, 0);
  assert.equal(fixture(serverDate, expiry, 0, 110_000, 10_000).read().remainingMs, 0);
  const f = fixture();
  f.advance(118_500);
  assert.equal(f.read().remainingMs, 0);
  f.advance(20_000);
  assert.equal(f.read().remainingMs, 0);
});

test("repeat registration, reads and returning to the same challenge never renew the deadline", () => {
  const f = fixture();
  const before = JSON.stringify(f.value);
  f.advance(60_000);
  registerTenantChallengeClock(f.value, { serverDate, requestStartedAt: 60_000, headersReceivedAt: 60_001 }, () => 60_001);
  assert.equal(f.read().remainingMs, 58_500);
  assert.equal(f.read().remainingMs, 58_500);
  assert.equal(JSON.stringify(f.value), before);
  assert.deepEqual(Reflect.ownKeys(f.value).sort(), ["challenge", "expiresAt", "nextStep", "tenants"]);
});

test("unregistered legacy object starts only one monotonic fallback window", () => {
  const value = challenge("2000-01-01T00:00:00Z");
  const first = getTenantChallengeRemaining(value);
  const second = getTenantChallengeRemaining(value);
  assert.equal(first.source, "unverified");
  assert.ok(first.remainingMs > 119_000 && first.remainingMs <= 120_000);
  assert.ok(second.remainingMs <= first.remainingMs);
});

test("invalid or regressing monotonic timing fails closed and cannot revive", () => {
  for (const start of [Number.NaN, -1, 1000]) assert.equal(fixture(serverDate, expiry, start).read().source, "invalid");
  const f = fixture();
  f.advance(-1);
  assert.deepEqual(f.read(), { source: "invalid", remainingMs: 0 });
  f.advance(1000);
  assert.deepEqual(f.read(), { source: "invalid", remainingMs: 0 });
});

test("short TTL never gains the uncertain Date second or a minimum grace period", () => {
  for (const ms of [1, 500, 999, 1000, 1499, 1500, 1501, 2000, 5000]) {
    const expiresAt = new Date(Date.parse(serverDate) + ms).toISOString();
    const f = fixture(serverDate, expiresAt);
    assert.equal(f.read().remainingMs, Math.max(0, ms - 1500));
    for (const fraction of [0, 1, 500, 999]) {
      assert.ok(f.read().remainingMs <= Math.max(0, ms - fraction - 500));
    }
  }
});

test("a new challenge object gets a fresh anchor even if the fixture reuses the opaque value", () => {
  const previous = fixture();
  previous.advance(120_000);
  assert.equal(previous.read().remainingMs, 0);
  const fresh = fixture(serverDate, expiry, 121_000, 121_400);
  assert.equal(previous.value.challenge, fresh.value.challenge);
  assert.notEqual(previous.value, fresh.value);
  assert.equal(fresh.read().remainingMs, 118_500);
  assert.equal(previous.read().remainingMs, 0);
});