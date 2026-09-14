import assert from "node:assert/strict";
import { test } from "node:test";
import { challenge, httpFixture, loginResult, tenant } from "./helpers/tenant-challenge";

test("actual HTTP parsed challenge has a private WeakMap anchor, no timing/credential/token wire additions", async () => {
  const wire = { ...challenge(), password: "discard-me", token: "discard-me", clock: 123 };
  const f = httpFixture({ body: wire });
  const result = await f.repo.startLogin(" fixture ", "fixture-only");
  assert.equal(result.nextStep, "SELECT_TENANT");
  if (result.nextStep !== "SELECT_TENANT") return;
  assert.equal(f.clock.getTenantChallengeRemaining(result).remainingMs, 118_500);
  assert.equal(f.clock.getTenantChallengeRemaining(result).source, "server");
  assert.equal(JSON.stringify(result), JSON.stringify(challenge()));
  assert.deepEqual(Reflect.ownKeys(result).sort(), ["challenge", "expiresAt", "nextStep", "tenants"]);
  assert.equal(f.repo.token, "");
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { username: "fixture", password: "fixture-only", remember: true });
  const complete = await f.repo.completeLogin(result.challenge, tenant);
  assert.deepEqual(complete, loginResult);
  assert.deepEqual(JSON.parse(String(f.calls[1].init.body)), { challenge: result.challenge, tenantId: tenant.id });
  assert.equal(f.calls.length, 2);
  assert.equal(f.repo.token, "");
});

test("actual HTTP headers are captured before slow response body and time continues before first render", async () => {
  const f = httpFixture({ requestMs: 20_000, bodyMs: 5000 });
  const result = await f.repo.startLogin("fixture", "fixture-only");
  assert.ok(result.nextStep === "SELECT_TENANT");
  assert.equal(f.clock.getTenantChallengeRemaining(result).remainingMs, 94_000);
  f.time.mono += 7000;
  f.time.wall -= 12 * 3600_000;
  assert.equal(f.clock.getTenantChallengeRemaining(result).remainingMs, 87_000);
});

test("late HTTP bodies cannot start a new client window, with or without Date", async () => {
  for (const date of [undefined, null]) {
    const f = httpFixture({ date, requestMs: 40_000, bodyMs: 81_000 });
    const result = await f.repo.startLogin("fixture", "fixture-only");
    assert.ok(result.nextStep === "SELECT_TENANT");
    assert.equal(f.clock.getTenantChallengeRemaining(result).remainingMs, 0);
    assert.equal(f.calls.length, 1);
  }
});

test("each parsed HTTP attempt owns a new anchor, not a cached previous deadline", async () => {
  const f = httpFixture();
  const previous = await f.repo.startLogin("fixture", "fixture-only");
  assert.ok(previous.nextStep === "SELECT_TENANT");
  f.time.mono += 121_000;
  assert.equal(f.clock.getTenantChallengeRemaining(previous).remainingMs, 0);
  const fresh = await f.repo.startLogin("fixture", "fixture-only");
  assert.ok(fresh.nextStep === "SELECT_TENANT");
  assert.notEqual(fresh, previous);
  assert.equal(f.clock.getTenantChallengeRemaining(fresh).remainingMs, 118_500);
  assert.equal(f.clock.getTenantChallengeRemaining(previous).remainingMs, 0);
});

for (const os of ["android", "web"] as const) {
  for (const date of [null, "invalid Date", "0"]) {
    test(`gateway 1.0.0 without usable Date remains selectable on ${os}: ${String(date)}`, async () => {
      const f = httpFixture({ os, date, body: { ...challenge(), expiresAt: "2000-01-01T00:00:00Z" } });
      const result = await f.repo.startLogin("fixture", "fixture-only");
      assert.ok(result.nextStep === "SELECT_TENANT");
      assert.equal(f.clock.getTenantChallengeRemaining(result).source, "unverified");
      assert.equal(f.clock.getTenantChallengeRemaining(result).remainingMs, 119_500);
      assert.equal(f.calls[0].init.credentials, os === "web" ? "include" : "omit");
      assert.equal(f.repo.token, "");
    });
  }
}

test("HTTP malformed expiry is rejected without completing or caching credentials", async () => {
  const f = httpFixture({ body: { ...challenge(), expiresAt: "invalid" } });
  await assert.rejects(f.repo.startLogin("fixture", "fixture-only"));
  assert.equal(f.calls.length, 1);
  assert.equal(f.repo.token, "");
});

test("single-tenant login response stays unchanged and does not require challenge timing", async () => {
  const f = httpFixture({ body: loginResult });
  const result = await f.repo.startLogin("fixture", "fixture-only");
  assert.deepEqual(result, loginResult);
  assert.equal(f.repo.token, "");
  assert.equal(f.calls.length, 1);
});

test("server 401 expiry/reuse is not hidden by a valid local window or sent to session unauthorized handler", async () => {
  const f = httpFixture({ completeStatus: 401 });
  let unauthorized = 0;
  f.repo.onUnauthorized = () => { unauthorized++; };
  const result = await f.repo.startLogin("fixture", "fixture-only");
  assert.ok(result.nextStep === "SELECT_TENANT");
  assert.ok(f.clock.getTenantChallengeRemaining(result).remainingMs > 0);
  await assert.rejects(f.repo.completeLogin(result.challenge, tenant), (error: unknown) => error instanceof Error && "status" in error && error.status === 401);
  assert.equal(unauthorized, 0);
  assert.equal(f.calls.length, 2);
  assert.equal(f.repo.token, "");
});