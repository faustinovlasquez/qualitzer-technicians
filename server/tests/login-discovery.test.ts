import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import type { LoginResult } from "../../src/domain/models";
import type { TenantConfig } from "../config";
import { loginResultSchema, userSchema } from "../contracts";
import { GatewayError } from "../errors";
import { LoginChallenges } from "../login-challenges";
import { LoginDiscovery } from "../login-discovery";
import { SessionContext } from "../session-context";
import { SessionManager } from "../sessions";
import { TenantRegistry } from "../tenants";
import { MOBILE_USER_AGENT, type Upstream } from "../upstream";
import { PNG, TOKEN, user } from "./fixtures";
import { errorCode, gatewayHarness, jsonRequest, loginGateway, mockBackend } from "./mock-upstream";

const credentials = { username: "test", password: "discovery-password", remember: true } as const;
const startPath = "/api/auth/login/start";
const completePath = "/api/auth/login/complete";
const preparePath = "/api/auth/mobile/prepare";
const exchangePath = "/api/auth/mobile/exchange";
const brandingPath = "/api/companies/branding";
const result: LoginResult = { username: "test", email: "test@example.invalid", token: "test-token", nextStep: "DONE" };
const tenantSchema = z.object({ id: z.string(), name: z.string(), portalOrigin: z.string(), environment: z.enum(["development", "production"]), logo: z.string().nullable().optional(), description: z.string().nullable().optional() }).strict();
const challengeSchema = z.object({ nextStep: z.literal("SELECT_TENANT"), challenge: z.string().regex(/^qzc_[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime(), tenants: z.array(tenantSchema) }).strict();
const tenantOf = (data: unknown) => z.object({ tenant: tenantSchema }).parse(data).tenant;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function discoveryHarness(t: TestContext, matches: readonly boolean[]) {
  const backends = await Promise.all(matches.map(async (match, index) => {
    const backend = await mockBackend(t);
    const grant = randomBytes(32).toString("base64url");
    backend.state.failures.set(preparePath, { status: match ? 200 : 401, body: match ? { grant, expiresAt: new Date(Date.now() + 120_000).toISOString() } : { error: "UNAUTHORIZED", private: credentials.password } });
    backend.state.failures.set(exchangePath, { status: 200, body: { ...result, defaultModule: "private-module", password: credentials.password, grant } });
    backend.state.failures.set(brandingPath, { status: 200, body: { name: `Brand ${index}`, description: `Company ${index}`, logo: `data:image/png;base64,${PNG.toString("base64")}`, id: "attacker", tenantOrigin: "private-origin", backendUrl: "private-url" } });
    return { ...backend, grant };
  }));
  const tenants: TenantConfig[] = backends.map((backend, index) => ({ id: `tenant-${index}`, name: `Configured ${index}`, backendUrl: backend.backendUrl, tenantOrigin: `http://tenant-${index}.localhost:3000`, environment: "development", enabled: true }));
  if (tenants[0]) tenants.push({ ...tenants[0], id: "disabled", tenantOrigin: "http://disabled.localhost:3000", enabled: false });
  const { baseUrl } = await gatewayHarness(t, { tenants });
  const start = (body: unknown = credentials) => jsonRequest(baseUrl, startPath, "POST", body, null);
  const complete = (challenge: string, tenantId: string) => jsonRequest(baseUrl, completePath, "POST", { challenge, tenantId }, null);
  return { backends, tenants, baseUrl, start, complete };
}

test("one match prepares every enabled tenant and auto-exchanges only that match into an opaque session", async (t) => {
  const { backends, start, baseUrl } = await discoveryHarness(t, [false, true, false]);
  const response = await start();
  assert.equal(response.response.status, 200);
  assert.equal(response.response.headers.get("cache-control"), "no-store");
  const login = loginResultSchema.parse(response.data);
  assert.match(login.token, /^qzm_[A-Za-z0-9_-]{43}$/);
  assert.equal(tenantOf(response.data).id, "tenant-1");
  assert.equal(tenantOf(response.data).name, "Brand 1");
  assert.equal(tenantOf(response.data).portalOrigin, "http://tenant-1.localhost:3000");
  assert.doesNotMatch(JSON.stringify(response.data), /test-token|discovery-password|private-module|private-origin|private-url|backendUrl/);
  for (const [index, backend] of backends.entries()) {
    const calls = backend.state.calls;
    assert.equal(calls.filter((call) => call.path === preparePath).length, 1);
    assert.deepEqual(calls[0]?.json, credentials);
    assert.equal(calls.filter((call) => call.path === exchangePath).length, index === 1 ? 1 : 0);
    assert.equal(calls.filter((call) => call.path === brandingPath).length, index === 1 ? 1 : 0);
    assert.equal(calls.filter((call) => call.path === "/api/auth/login").length, 0);
    assert.ok(!JSON.stringify(response.data).includes(backend.grant));
    for (const call of calls) {
      assert.equal(call.headers.origin, `http://tenant-${index}.localhost:3000`);
      assert.equal(call.headers["user-agent"], MOBILE_USER_AGENT);
      assert.equal(call.headers.authorization, undefined);
    }
  }
  assert.deepEqual(backends[1]!.state.calls.find((call) => call.path === exchangePath)?.json, { grant: backends[1]!.grant });
  const token = `Bearer ${login.token}`;
  const me = await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token);
  assert.equal(me.response.status, 200);
  assert.deepEqual(userSchema.parse(me.data), user());
  assert.deepEqual(tenantOf(me.data), tenantOf(response.data));
  backends[1]!.state.failures.set("/api/auth/logout", { status: 503, body: "private" });
  assert.deepEqual((await jsonRequest(baseUrl, "/api/auth/logout", "POST", {}, token)).data, { success: true });
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token)).response.status, 401);
  assert.equal(backends[1]!.state.calls.find((call) => call.path === "/api/auth/logout")?.headers.authorization, TOKEN);
});

test("multiple valid credentials produce branded choices but no upstream login or exchange until selection", async (t) => {
  const { start, complete, backends, baseUrl } = await discoveryHarness(t, [true, false, true]);
  const startedAt = Date.now();
  const response = await start();
  const challenge = challengeSchema.parse(response.data);
  assert.equal(response.response.status, 200);
  assert.deepEqual(challenge.tenants.map((tenant) => tenant.id), ["tenant-0", "tenant-2"]);
  assert.deepEqual(challenge.tenants.map((tenant) => tenant.name), ["Brand 0", "Brand 2"]);
  assert.ok(Date.parse(challenge.expiresAt) > startedAt);
  assert.ok(Date.parse(challenge.expiresAt) <= Date.now() + 120_000);
  for (const backend of backends) {
    assert.equal(backend.state.calls.filter((call) => call.path === exchangePath || call.path === "/api/auth/login").length, 0);
    assert.ok(!JSON.stringify(response.data).includes(backend.grant));
  }
  assert.equal(backends[1]!.state.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(response.data), /discovery-password|test-token|private-module|token|grant/);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${challenge.challenge}`)).response.status, 401);
  const selected = await complete(challenge.challenge, "tenant-2");
  assert.equal(selected.response.status, 200);
  assert.equal(tenantOf(selected.data).id, "tenant-2");
  assert.match(loginResultSchema.parse(selected.data).token, /^qzm_/);
  assert.equal(backends[0]!.state.calls.filter((call) => call.path === exchangePath).length, 0);
  assert.equal(backends[2]!.state.calls.filter((call) => call.path === exchangePath).length, 1);
  assert.equal((await complete(challenge.challenge, "tenant-0")).response.status, 401);
});

test("unknown credentials and empty registries return generic 401 without branding, choices or sessions", async (t) => {
  for (const matches of [[false, false], []]) {
    const { start, backends } = await discoveryHarness(t, matches);
    const response = await start({ ...credentials, username: "unknown" });
    assert.equal(response.response.status, 401);
    assert.deepEqual(response.data, { error: "UNAUTHORIZED" });
    assert.ok(backends.every((backend) => backend.state.calls.length === 1 && backend.state.calls[0]?.path === preparePath));
  }
});

test("any incomplete, unsupported or rejected prepare fails closed after all tenants finish, discarding matches", async (t) => {
  for (const status of [404, 503, 500, 429, 403]) {
    const { start, backends } = await discoveryHarness(t, [true, false, true, true]);
    backends[1]!.state.failures.set(preparePath, { status, body: { error: "backend-private", password: credentials.password, grant: backends[0]!.grant } });
    const response = await start();
    assert.equal(response.response.status, 503);
    assert.deepEqual(response.data, { error: "LOGIN_DISCOVERY_UNAVAILABLE" });
    for (const backend of backends) assert.deepEqual(backend.state.calls.map((call) => call.path), [preparePath]);
  }
});

test("malformed, already expired and non-ISO prepare responses cannot create partial logins", async (t) => {
  for (const body of [{ grant: "short", expiresAt: new Date().toISOString() }, { grant: "g".repeat(43), expiresAt: "not-an-iso-date" }, { grant: "g".repeat(43), expiresAt: new Date(Date.now() - 1000).toISOString() }, { grant: "g".repeat(43), expiresAt: new Date(Date.now() + 120_000).toISOString(), token: "private-token" }]) {
    const { start, backends } = await discoveryHarness(t, [true, true]);
    backends[1]!.state.failures.set(preparePath, { status: 200, body });
    const response = await start();
    assert.equal(response.response.status, 503);
    assert.deepEqual(response.data, { error: "LOGIN_DISCOVERY_UNAVAILABLE" });
    assert.ok(backends.every((backend) => backend.state.calls.length === 1));
  }
});

test("discovery concurrency is exactly bounded to three and a late failure cannot race a partial success", { timeout: 10_000 }, async (t) => {
  const { start, backends } = await discoveryHarness(t, [true, true, true, true, true, true, true]);
  const entered = deferred();
  const release = deferred();
  let active = 0;
  let peak = 0;
  let completed = 0;
  for (const [index, backend] of backends.entries()) {
    backend.state.beforeResponse = async (call) => {
      if (call.path !== preparePath) return;
      active += 1;
      peak = Math.max(peak, active);
      if (active === 3) entered.resolve();
      if (index < 3) await release.promise;
      active -= 1;
      completed += 1;
    };
  }
  backends[6]!.state.failures.set(preparePath, { status: 404, body: "unsupported" });
  const pending = start();
  try {
    await entered.promise;
    assert.equal(active, 3);
    assert.equal(backends.reduce((count, backend) => count + backend.state.calls.length, 0), 3);
  } finally { release.resolve(); }
  const response = await pending;
  assert.equal(peak, 3);
  assert.equal(completed, 7);
  assert.deepEqual(response.data, { error: "LOGIN_DISCOVERY_UNAVAILABLE" });
  assert.ok(backends.every((backend) => backend.state.calls.every((call) => call.path === preparePath)));
});

test("unknown, disabled and unmatched selected tenants return the same 401 and consume the challenge", async (t) => {
  const { start, complete, backends } = await discoveryHarness(t, [true, true, false]);
  for (const tenantId of ["unknown", "disabled", "tenant-2"]) {
    const challenge = challengeSchema.parse((await start()).data).challenge;
    const response = await complete(challenge, tenantId);
    assert.equal(response.response.status, 401);
    assert.deepEqual(response.data, { error: "UNAUTHORIZED" });
    assert.deepEqual((await complete(challenge, "tenant-0")).data, { error: "UNAUTHORIZED" });
  }
  assert.ok(backends.every((backend) => backend.state.calls.every((call) => call.path !== exchangePath)));
});

test("complete consumes before awaiting exchange, rejecting concurrent selection and all replays", { timeout: 10_000 }, async (t) => {
  const { start, complete, backends } = await discoveryHarness(t, [true, true]);
  const challenge = challengeSchema.parse((await start()).data).challenge;
  const entered = deferred();
  const release = deferred();
  backends[0]!.state.beforeResponse = async (call) => { if (call.path === exchangePath) { entered.resolve(); await release.promise; } };
  const pending = complete(challenge, "tenant-0");
  try {
    await entered.promise;
    for (const tenantId of ["tenant-0", "tenant-1"]) {
      const duplicate = await complete(challenge, tenantId);
      assert.equal(duplicate.response.status, 401);
      assert.deepEqual(duplicate.data, { error: "UNAUTHORIZED" });
    }
    assert.equal(backends[0]!.state.calls.filter((call) => call.path === exchangePath).length, 1);
    assert.equal(backends[1]!.state.calls.filter((call) => call.path === exchangePath).length, 0);
  } finally { release.resolve(); }
  assert.equal((await pending).response.status, 200);
  assert.equal((await complete(challenge, "tenant-1")).response.status, 401);
});

test("exchange unauthorized or offline failures never restore choices or leak backend details", async (t) => {
  for (const status of [401, 404, 503]) {
    const { start, complete, backends } = await discoveryHarness(t, [true, true]);
    const challenge = challengeSchema.parse((await start()).data).challenge;
    backends[0]!.state.failures.set(exchangePath, { status, body: { error: "backend-private", grant: backends[0]!.grant, password: credentials.password } });
    const response = await complete(challenge, "tenant-0");
    assert.equal(response.response.status, status === 401 ? 401 : 503);
    assert.deepEqual(response.data, { error: status === 401 ? "UNAUTHORIZED" : "LOGIN_DISCOVERY_UNAVAILABLE" });
    assert.equal((await complete(challenge, "tenant-1")).response.status, 401);
    assert.equal(backends[1]!.state.calls.filter((call) => call.path === exchangePath).length, 0);
  }
});

test("expired and tampered challenge endpoints return generic 401 without looking up tenants or exchanging", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const { start, complete, backends, baseUrl } = await discoveryHarness(t, [true, true]);
  const issued = challengeSchema.parse((await start()).data);
  const tampered = `${issued.challenge.slice(0, 4)}${issued.challenge[4] === "a" ? "b" : "a"}${issued.challenge.slice(5)}`;
  const wrong = await complete(tampered, "tenant-0");
  assert.equal(wrong.response.status, 401);
  assert.deepEqual(wrong.data, { error: "UNAUTHORIZED" });
  const extra = await jsonRequest(baseUrl, completePath, "POST", { challenge: issued.challenge, tenantId: "tenant-0", grant: backends[0]!.grant }, null);
  assert.equal(extra.response.status, 400);
  now = Date.parse(issued.expiresAt);
  for (const tenantId of ["tenant-0", "tenant-1", "unknown"]) {
    const response = await complete(issued.challenge, tenantId);
    assert.equal(response.response.status, 401);
    assert.deepEqual(response.data, { error: "UNAUTHORIZED" });
  }
  assert.ok(backends.every((backend) => backend.state.calls.every((call) => call.path !== exchangePath)));
});

test("me refreshes display metadata at TTL only after successful session and branch authorization", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const { start, backends, baseUrl } = await discoveryHarness(t, [true]);
  const login = await start();
  const original = tenantOf(login.data);
  const token = `Bearer ${loginResultSchema.parse(login.data).token}`;
  const backend = backends[0]!;
  backend.state.failures.set(brandingPath, { status: 200, body: { name: "Updated company", logo: "https://bucket.example.invalid/new.png", id: "evil", portalOrigin: "https://evil.invalid" } });
  now += 5 * 60_000;
  const deniedBranch = await jsonRequest(baseUrl, "/api/auth/me?companyBranchId=999", "GET", undefined, token);
  assert.equal(deniedBranch.response.status, 403);
  assert.equal(backend.state.calls.filter((call) => call.path === brandingPath).length, 1);
  const refreshed = await jsonRequest(baseUrl, "/api/auth/me?companyBranchId=1", "GET", undefined, token);
  assert.equal(refreshed.response.status, 200);
  assert.equal(tenantOf(refreshed.data).name, "Updated company");
  assert.equal(tenantOf(refreshed.data).id, original.id);
  assert.equal(tenantOf(refreshed.data).portalOrigin, original.portalOrigin);
  assert.equal(backend.state.calls.filter((call) => call.path === brandingPath).length, 2);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token)).response.status, 200);
  assert.equal(backend.state.calls.filter((call) => call.path === brandingPath).length, 2);
  now += 5 * 60_000;
  backend.state.failures.set("/api/auth/me", { status: 401, body: "private" });
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token)).response.status, 401);
  assert.equal(backend.state.calls.filter((call) => call.path === brandingPath).length, 2);
  const calls = backend.state.calls.length;
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token)).response.status, 401);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, null)).response.status, 401);
  assert.equal(backend.state.calls.length, calls);
});

test("branding failures never block login or selection and configured identity stays public and unchanged", async (t) => {
  for (const matches of [[true], [true, true]]) {
    const { start, complete, backends, baseUrl } = await discoveryHarness(t, matches);
    for (const backend of backends) backend.state.failures.set(brandingPath, { status: 503, body: "backend-private" });
    const response = await start();
    assert.equal(response.response.status, 200);
    const selected = matches.length === 1 ? response : await complete(challengeSchema.parse(response.data).challenge, "tenant-0");
    assert.equal(selected.response.status, 200);
    assert.equal(tenantOf(selected.data).name, "Configured 0");
    assert.equal(tenantOf(selected.data).logo, undefined);
    const me = await jsonRequest(baseUrl, "/api/auth/me?companyBranchId=1", "GET", undefined, `Bearer ${loginResultSchema.parse(selected.data).token}`);
    assert.equal(me.response.status, 200);
    assert.equal(tenantOf(me.data).name, "Configured 0");
    assert.equal(backends[0]!.state.calls.filter((call) => call.path === brandingPath).length, 1);
    const catalog = z.object({ data: z.array(tenantSchema) }).parse((await jsonRequest(baseUrl, "/api/tenants", "GET", undefined, null)).data);
    assert.equal(catalog.data[0]?.name, "Configured 0");
  }
});

test("restricted exchange sessions still require forced password and DONE sessions still cannot force it", async (t) => {
  const { start, backends, baseUrl } = await discoveryHarness(t, [true]);
  backends[0]!.state.failures.set(exchangePath, { status: 200, body: { ...result, nextStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" } });
  const login = loginResultSchema.parse((await start()).data);
  const token = `Bearer ${login.token}`;
  assert.equal(login.nextStep, "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED");
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token)).data), "PASSWORD_CHANGE_REQUIRED");
  const password = { newPassword: "NewPassword42!", confirmPassword: "NewPassword42!", remember: true };
  const changed = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, token);
  assert.equal(changed.response.status, 200);
  const done = `Bearer ${loginResultSchema.parse(changed.data).token}`;
  assert.notEqual(done, token);
  assert.equal(tenantOf(changed.data).id, "tenant-0");
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token)).response.status, 401);
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, done)).data), "PASSWORD_CHANGE_NOT_REQUIRED");
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, done)).response.status, 200);
});

test("strict new bodies reject routing overrides before upstream while legacy login still requires tenantId", async (t) => {
  const { start, backends, baseUrl } = await discoveryHarness(t, [true]);
  for (const body of [{ ...credentials, tenantId: "tenant-0" }, { ...credentials, backendUrl: "https://attacker.invalid" }, { ...credentials, username: "" }, { ...credentials, remember: false }, { ...credentials, password: "p".repeat(1025) }, { username: "test", password: "password" }]) assert.equal((await start(body)).response.status, 400);
  assert.equal((await jsonRequest(baseUrl, `${startPath}?tenantId=tenant-0`, "POST", credentials, null)).response.status, 400);
  assert.equal(backends[0]!.state.calls.length, 0);
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/auth/login", "POST", credentials, null)).data), "TENANT_REQUIRED");
  const legacy = await loginGateway(baseUrl, "tenant-0");
  assert.equal(tenantOf(legacy.data).name, "Configured 0");
  assert.deepEqual(backends[0]!.state.calls.map((call) => call.path), ["/api/auth/login"]);
});

test("the existing credentials limiter covers both new nested paths and counts invalid challenge attempts", async (t) => {
  const { start, complete, backends } = await discoveryHarness(t, [false]);
  for (let index = 0; index < 10; index++) {
    const response = index % 2 ? await complete(`qzc_${"a".repeat(43)}`, "unknown") : await start();
    assert.equal(response.response.status, 401);
  }
  const denied = await complete(`qzc_${"b".repeat(43)}`, "tenant-0");
  assert.equal(denied.response.status, 429);
  assert.equal(errorCode(denied.data), "AUTH_RATE_LIMITED");
  assert.equal(backends[0]!.state.calls.length, 5);
});

test("offline discovery and grants expiring while discovery or branding finishes never issue sessions", async (t) => {
  for (const failure of ["offline", "discovery-expiry", "branding-expiry"] as const) {
    let now = 1000;
    const configs: TenantConfig[] = ["a", "b"].map((id) => ({ id, name: id, backendUrl: "http://127.0.0.1:5001/api", tenantOrigin: `http://${id}.localhost:3000`, environment: "development", enabled: true }));
    const registry = new TenantRegistry(configs, () => now);
    const sessions = new SessionManager(() => now);
    const issued = t.mock.method(sessions, "issue");
    let preparations = 0;
    let exchanges = 0;
    for (const id of ["a", "b"]) {
      t.mock.method(registry.get(id).upstream, "request", async (...[path]: Parameters<Upstream["request"]>): Promise<unknown> => {
        if (path === "/auth/mobile/prepare") {
          preparations += 1;
          if (id === "b" && failure === "offline") throw new GatewayError(502, "UPSTREAM_UNAVAILABLE");
          if (id === "b" && failure === "discovery-expiry") now = 5000;
          return { grant: id.repeat(43), expiresAt: new Date(4000).toISOString() };
        }
        if (path === "/companies/branding") { if (failure === "branding-expiry") now = 5000; return { name: id }; }
        exchanges += 1;
        return result;
      });
    }
    const challenges = new LoginChallenges(() => now);
    const discovery = new LoginDiscovery(new SessionContext(registry, sessions), challenges, () => now);
    await assert.rejects(discovery.start(credentials), { status: 503, code: "LOGIN_DISCOVERY_UNAVAILABLE" });
    assert.equal(preparations, 2);
    assert.equal(exchanges, 0);
    assert.equal(issued.mock.callCount(), 0);
  }
});