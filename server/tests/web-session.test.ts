import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import express from "express";
import { z } from "zod";
import type { LoginResult } from "../../src/domain/models";
import { createApp } from "../app";
import { authRouter } from "../auth";
import { resolveConfig, type GatewayConfig, type TenantConfig } from "../config";
import { loginResultSchema, userSchema } from "../contracts";
import { errorHandler } from "../errors";
import { SessionContext } from "../session-context";
import { createSessionPersistence } from "../session-persistence";
import { SessionManager } from "../sessions";
import { TenantRegistry } from "../tenants";
import { Upstream } from "../upstream";
import { WEB_SESSION_COOKIE, WEB_SESSION_HEADER, WEB_SESSION_MAX_AGE_MS, WEB_SESSION_TOKEN } from "../web-session";
import { RANGE, TOKEN, user } from "./fixtures";
import { gatewayHarness, harness, mockBackend, writeCalls } from "./mock-upstream";

const webOrigin = "http://localhost:8081";
const credentials = { username: "test", password: "web-private-password", remember: true } as const;
const legacyCredentials = { ...credentials, tenantId: "local" };
const password = { newPassword: "NewPassword42!", confirmPassword: "NewPassword42!", remember: true };
const loginResult: LoginResult = { username: "test", email: "test@example.invalid", token: "test-token", nextStep: "DONE" };
const statusPath = `/api/assignments/direct-11/works/11/status?${RANGE}`;
const preparePath = "/api/auth/mobile/prepare";
const exchangePath = "/api/auth/mobile/exchange";
const tenantOf = (data: unknown) => z.object({ tenant: z.object({ id: z.string(), name: z.string(), portalOrigin: z.string() }) }).parse(data).tenant;
const challengeOf = (data: unknown) => z.object({ nextStep: z.literal("SELECT_TENANT"), challenge: z.string() }).parse(data).challenge;

interface WebRequestOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  transport?: string | null;
  headers?: HeadersInit;
}

async function webRequest(baseUrl: string, path: string, options: WebRequestOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set("Origin", options.origin ?? webOrigin);
  if (options.transport !== null) headers.set(WEB_SESSION_HEADER, options.transport ?? "cookie");
  if (options.cookie !== undefined) headers.set("Cookie", options.cookie);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET", headers, credentials: "include", redirect: "manual",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data: unknown = await response.json();
  return { response, data };
}

function cookieOf(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /^qz_mobile_session=qzm_[A-Za-z0-9_-]{43};/);
  return cookie.split(";")[0]!;
}

function assertCleared(response: Response): void {
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^qz_mobile_session=;/);
  assert.match(cookie, /; Path=\/api(?:;|$)/);
  assert.match(cookie, /; HttpOnly(?:;|$)/);
  assert.match(cookie, /; Expires=Thu, 01 Jan 1970 00:00:00 GMT(?:;|$)/);
  assert.doesNotMatch(cookie, /qzm_|Domain=/);
}

function assertWebLogin(result: Awaited<ReturnType<typeof webRequest>>, tenantId = "local"): string {
  assert.equal(result.response.status, 200);
  assert.equal(loginResultSchema.parse(result.data).token, WEB_SESSION_TOKEN);
  assert.equal(tenantOf(result.data).id, tenantId);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(JSON.stringify(result.data), /qzm_|test-token|web-private-password|defaultModule|internal/);
  return cookieOf(result.response);
}

async function listenApp(t: TestContext, app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS");
  const close = async (): Promise<void> => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  };
  t.after(close);
  return { baseUrl: `http://127.0.0.1:${address.port}`, close };
}

async function discoveryHarness(t: TestContext, count: number) {
  const backends = await Promise.all(Array.from({ length: count }, () => mockBackend(t)));
  const tenants: TenantConfig[] = backends.map((backend, index) => {
    backend.state.failures.set(preparePath, { status: 200, body: { grant: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.now() + 120_000).toISOString() } });
    backend.state.failures.set(exchangePath, { status: 200, body: loginResult });
    backend.state.failures.set("/api/companies/branding", { status: 200, body: { name: `Brand ${index}` } });
    return { id: `tenant-${index}`, name: `Configured ${index}`, backendUrl: backend.backendUrl, tenantOrigin: `http://tenant-${index}.localhost:3000`, environment: "development", enabled: true };
  });
  return { ...await gatewayHarness(t, { tenants }), backends };
}

test("web login returns only a sentinel and a persistent HttpOnly host cookie; a fresh request recovers tenant and user", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  const login = await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials });
  const cookie = assertWebLogin(login);
  const attributes = login.response.headers.get("set-cookie")!;
  assert.match(attributes, /; Path=\/api(?:;|$)/);
  assert.match(attributes, /; HttpOnly(?:;|$)/);
  assert.match(attributes, /; SameSite=Lax(?:;|$)/);
  assert.match(attributes, /; Expires=/);
  assert.equal(Number(/; Max-Age=(\d+)/.exec(attributes)?.[1]), WEB_SESSION_MAX_AGE_MS / 1000);
  assert.doesNotMatch(attributes, /; Secure|; Domain=/);
  assert.equal(login.response.headers.get("access-control-allow-origin"), webOrigin);
  assert.equal(login.response.headers.get("access-control-allow-credentials"), "true");
  state.calls.length = 0;
  const restored = await webRequest(baseUrl, "/api/auth/me", { cookie });
  assert.equal(restored.response.status, 200);
  assert.deepEqual(userSchema.parse(restored.data), state.user);
  assert.equal(tenantOf(restored.data).id, "local");
  assert.equal(restored.response.headers.get("set-cookie"), null);
  assert.doesNotMatch(JSON.stringify(restored.data), /qzm_|test-token/);
  assert.equal((await webRequest(baseUrl, `/api/assignments?${RANGE}`, { cookie })).response.status, 200);
  assert.equal((await webRequest(baseUrl, statusPath, { cookie, method: "POST", body: { status: "paused" } })).response.status, 200);
  assert.ok(writeCalls(state).length > 0);
  for (const call of state.calls) {
    if (call.path !== "/api/companies/branding") assert.equal(call.headers.authorization, TOKEN);
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers[WEB_SESSION_HEADER.toLowerCase()], undefined);
    assert.equal(call.headers.origin, "http://localhost:3000");
  }
});

test("native login keeps qzm bearer responses even with an Origin and ignores all unsolicited cookies", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  for (const origin of [null, webOrigin]) {
    const native = await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials, transport: null, origin });
    const token = loginResultSchema.parse(native.data).token;
    assert.equal(native.response.status, 200);
    assert.match(token, /^qzm_[A-Za-z0-9_-]{43}$/);
    assert.equal(native.response.headers.get("set-cookie"), null);
    const me = await webRequest(baseUrl, "/api/auth/me", { transport: null, origin, cookie: `${WEB_SESSION_COOKIE}=invalid`, headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.response.status, 200);
    assert.equal(me.response.headers.get("set-cookie"), null);
    const calls = state.calls.length;
    for (const authorization of [undefined, `Bearer ${WEB_SESSION_TOKEN}`]) {
      const rejected = await webRequest(baseUrl, "/api/auth/me", { transport: null, origin, cookie: `${WEB_SESSION_COOKIE}=${token}`, headers: authorization ? { Authorization: authorization } : undefined });
      assert.equal(rejected.response.status, 401);
      assert.equal(rejected.response.headers.get("set-cookie"), null);
    }
    assert.equal(state.calls.length, calls);
  }
});

test("CORS permits credentials and the opt-in header only for the configured exact origins", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  const preflight = await fetch(`${baseUrl}/api/auth/login`, { method: "OPTIONS", headers: {
    Origin: webOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-qualitzer-session,x-qualitzer-tenant",
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), webOrigin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  assert.ok(preflight.headers.get("access-control-allow-headers")?.toLowerCase().split(",").includes("x-qualitzer-session"));
  assert.equal(preflight.headers.get("set-cookie"), null);
  for (const origin of ["https://attacker.invalid", `${webOrigin}.attacker.invalid`, "null"]) {
    const denied = await fetch(`${baseUrl}/api/auth/login`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal(denied.headers.get("set-cookie"), null);
  }
  assert.equal(state.calls.length, 0);
});

test("all public login variants require an allowlisted Origin before upstream when cookie transport is requested", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  for (const [path, body] of [
    ["/api/auth/login", legacyCredentials], ["/api/auth/login/start", credentials],
    ["/api/auth/login/complete", { challenge: `qzc_${"a".repeat(43)}`, tenantId: "local" }],
  ] as const) {
    for (const origin of [null, "https://attacker.invalid", "null"]) {
      const rejected = await webRequest(baseUrl, path, { method: "POST", body, origin });
      assert.equal(rejected.response.status, 403);
      assert.deepEqual(rejected.data, { error: "ORIGIN_FORBIDDEN" });
      assert.equal(rejected.response.headers.get("set-cookie"), null);
    }
  }
  assert.equal(state.calls.length, 0);
});

test("every protected GET and mutation refuses cookie CSRF without both opt-in and an allowlisted Origin", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  const cookie = assertWebLogin(await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials }));
  state.calls.length = 0;
  for (const [path, method, body] of [
    ["/api/auth/me", "GET", undefined], [`/api/assignments?${RANGE}`, "GET", undefined],
    [statusPath, "POST", { status: "paused" }], ["/api/auth/forced_password", "PATCH", password], ["/api/auth/logout", "POST", {}],
  ] as const) {
    for (const [options, expected] of [
      [{ origin: null }, 403], [{ origin: "https://attacker.invalid" }, 403],
      [{ transport: null }, 401], [{ transport: null, origin: null }, 401],
    ] as const) {
      const rejected = await webRequest(baseUrl, path, { ...options, cookie, method, body });
      assert.equal(rejected.response.status, expected);
      assert.equal(rejected.response.headers.get("set-cookie"), null);
    }
  }
  assert.equal(state.calls.length, 0);
  assert.equal((await webRequest(baseUrl, "/api/auth/me", { cookie })).response.status, 200);
});

test("missing, tampered, duplicate and non-qzm cookies cannot authenticate; cookie transport never falls back to bearer", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  const cookie = assertWebLogin(await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials }));
  const token = cookie.slice(WEB_SESSION_COOKIE.length + 1);
  const tampered = `${token.slice(0, 4)}${token[4] === "a" ? "b" : "a"}${token.slice(5)}`;
  state.calls.length = 0;
  for (const invalid of [undefined, "other=ignored", `${WEB_SESSION_COOKIE}`, `${WEB_SESSION_COOKIE}=`, `${WEB_SESSION_COOKIE}=test-token`,
    `${WEB_SESSION_COOKIE}=${WEB_SESSION_TOKEN}`, `${WEB_SESSION_COOKIE}=${tampered}`, `${WEB_SESSION_COOKIE}=qzc_${"a".repeat(43)}`,
    `${WEB_SESSION_COOKIE}="${token}"`, `${WEB_SESSION_COOKIE}=%71${token.slice(1)}`, `${cookie}; ${cookie}`,
  ]) {
    const rejected = await webRequest(baseUrl, "/api/auth/me", { cookie: invalid });
    assert.equal(rejected.response.status, 401);
    assert.deepEqual(rejected.data, { error: "UNAUTHORIZED" });
    assertCleared(rejected.response);
  }
  for (const authorization of [`Bearer ${token}`, `Bearer ${WEB_SESSION_TOKEN}`]) {
    for (const suppliedCookie of [undefined, cookie]) {
      const rejected = await webRequest(baseUrl, "/api/auth/me", { cookie: suppliedCookie, headers: { Authorization: authorization } });
      assert.equal(rejected.response.status, 401);
    }
  }
  assert.equal(state.calls.length, 0);
  assert.equal((await webRequest(baseUrl, "/api/auth/me", { cookie: `other=ignored; ${cookie}; theme=dark` })).response.status, 200);
});

test("unsupported transport headers and body or query overrides never choose authentication or a different tenant", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  const cookie = assertWebLogin(await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials }));
  state.calls.length = 0;
  for (const transport of ["COOKIE", "cookie,bearer", "bearer"]) {
    const rejected = await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials, transport });
    assert.equal(rejected.response.status, 400);
    assert.deepEqual(rejected.data, { error: "INVALID_SESSION_TRANSPORT" });
    assert.equal(rejected.response.headers.get("set-cookie"), null);
  }
  for (const property of ["token", "transport", "session", "backendUrl"]) {
    const rejected = await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: { ...legacyCredentials, [property]: "override" } });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.response.headers.get("set-cookie"), null);
    assert.equal((await webRequest(baseUrl, `/api/auth/me?${property}=override`, { cookie })).response.status, 400);
  }
  for (const path of ["/api/auth/me", statusPath]) {
    const rejected = await webRequest(baseUrl, path, { cookie, headers: { "X-Qualitzer-Tenant": "other" }, method: path === statusPath ? "POST" : "GET", body: path === statusPath ? { status: "paused" } : undefined });
    assert.equal(rejected.response.status, 409);
    assert.deepEqual(rejected.data, { error: "TENANT_SESSION_MISMATCH" });
  }
  assert.equal(state.calls.length, 0);
  assert.equal((await webRequest(baseUrl, `${statusPath}&tenantId=other`, { cookie, method: "POST", body: { status: "paused" } })).response.status, 400);
  assert.equal((await webRequest(baseUrl, statusPath, { cookie, method: "POST", body: { status: "paused", tenantId: "other" } })).response.status, 400);
  assert.equal(writeCalls(state).length, 0);
  assert.equal((await webRequest(baseUrl, "/api/auth/me", { cookie, headers: { "X-Qualitzer-Tenant": "local" } })).response.status, 200);
});

test("single-match discovery emits the same cookie transport without exposing the opaque session", async (t) => {
  const { baseUrl, backends } = await discoveryHarness(t, 1);
  const login = await webRequest(baseUrl, "/api/auth/login/start", { method: "POST", body: credentials });
  const cookie = assertWebLogin(login, "tenant-0");
  assert.equal(tenantOf(login.data).name, "Brand 0");
  assert.equal(backends[0]!.state.calls.filter((call) => call.path === exchangePath).length, 1);
  assert.equal((await webRequest(baseUrl, "/api/auth/me", { cookie })).response.status, 200);
});

test("tenant challenges never set cookies and selection succeeds without one; forbidden origins do not consume the challenge", async (t) => {
  const { baseUrl, backends } = await discoveryHarness(t, 2);
  const started = await webRequest(baseUrl, "/api/auth/login/start", { method: "POST", body: credentials, cookie: `${WEB_SESSION_COOKIE}=ignored` });
  const challenge = challengeOf(started.data);
  assert.equal(started.response.status, 200);
  assert.equal(started.response.headers.get("set-cookie"), null);
  assert.doesNotMatch(JSON.stringify(started.data), /qzm_|cookie-session|test-token|web-private-password/);
  assert.ok(backends.every((backend) => backend.state.calls.every((call) => call.path !== exchangePath)));
  for (const origin of [null, "https://attacker.invalid"]) {
    const rejected = await webRequest(baseUrl, "/api/auth/login/complete", { method: "POST", body: { challenge, tenantId: "tenant-1" }, origin });
    assert.equal(rejected.response.status, 403);
    assert.equal(rejected.response.headers.get("set-cookie"), null);
  }
  const completed = await webRequest(baseUrl, "/api/auth/login/complete", { method: "POST", body: { challenge, tenantId: "tenant-1" } });
  const cookie = assertWebLogin(completed, "tenant-1");
  assert.equal(tenantOf(completed.data).name, "Brand 1");
  assert.equal(backends[0]!.state.calls.filter((call) => call.path === exchangePath).length, 0);
  assert.equal(backends[1]!.state.calls.filter((call) => call.path === exchangePath).length, 1);
  const me = await webRequest(baseUrl, "/api/auth/me", { cookie });
  assert.equal(me.response.status, 200);
  assert.equal(tenantOf(me.data).id, "tenant-1");
  const replay = await webRequest(baseUrl, "/api/auth/login/complete", { method: "POST", body: { challenge, tenantId: "tenant-0" } });
  assert.equal(replay.response.status, 401);
  assert.equal(replay.response.headers.get("set-cookie"), null);
});

test("failed web authentication never issues a cookie or returns credentials", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  state.failures.set("/api/auth/login", { status: 401, body: { token: "private", password: credentials.password } });
  state.failures.set(preparePath, { status: 401, body: { token: "private", password: credentials.password } });
  for (const [path, body] of [["/api/auth/login", legacyCredentials], ["/api/auth/login/start", credentials]] as const) {
    const rejected = await webRequest(baseUrl, path, { method: "POST", body });
    assert.equal(rejected.response.status, 401);
    assert.deepEqual(rejected.data, { error: "UNAUTHORIZED" });
    assert.equal(rejected.response.headers.get("set-cookie"), null);
  }
});

test("forced password changes rotate the cookie, retain the tenant and invalidate the restricted cookie", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  state.loginNextStep = "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  const login = await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials });
  const previous = assertWebLogin(login);
  const restricted = await webRequest(baseUrl, "/api/auth/me", { cookie: previous });
  assert.equal(restricted.response.status, 403);
  assert.deepEqual(restricted.data, { error: "PASSWORD_CHANGE_REQUIRED" });
  assert.equal(restricted.response.headers.get("set-cookie"), null);
  const changed = await webRequest(baseUrl, "/api/auth/forced_password", { cookie: previous, method: "PATCH", body: password });
  const rotated = assertWebLogin(changed);
  assert.notEqual(rotated, previous);
  assert.equal(loginResultSchema.parse(changed.data).nextStep, "DONE");
  const calls = state.calls.length;
  const stale = await webRequest(baseUrl, "/api/auth/me", { cookie: previous });
  assert.equal(stale.response.status, 401);
  assertCleared(stale.response);
  assert.equal(state.calls.length, calls);
  const reused = await webRequest(baseUrl, "/api/auth/me", { cookie: rotated });
  assert.equal(reused.response.status, 200);
  assert.deepEqual(userSchema.parse(reused.data), state.user);
  const done = await webRequest(baseUrl, "/api/auth/forced_password", { cookie: rotated, method: "PATCH", body: password });
  assert.equal(done.response.status, 403);
  assert.deepEqual(done.data, { error: "PASSWORD_CHANGE_NOT_REQUIRED" });
  assert.equal(done.response.headers.get("set-cookie"), null);
});

test("cookie lifetime cannot exceed the upstream expiry and an expired session clears the cookie without upstream access", async (t) => {
  let now = Math.floor(Date.now() / 1000) * 1000;
  t.mock.method(Date, "now", () => now);
  const { baseUrl, state } = await harness(t, { login: false });
  const expiresAt = now + 123_000;
  const upstreamToken = `header.${Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString("base64url")}.signature`;
  state.failures.set("/api/auth/login", { status: 200, body: { ...loginResult, token: upstreamToken } });
  const login = await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials });
  const cookie = assertWebLogin(login);
  assert.match(login.response.headers.get("set-cookie")!, /; Max-Age=123;/);
  assert.ok(!JSON.stringify(login.data).includes(upstreamToken));
  state.calls.length = 0;
  now = expiresAt;
  const expired = await webRequest(baseUrl, "/api/auth/me", { cookie });
  assert.equal(expired.response.status, 401);
  assertCleared(expired.response);
  assert.equal(state.calls.length, 0);
});

test("upstream unauthorized clears and revokes a cookie session instead of retrying it remotely", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  const cookie = assertWebLogin(await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials }));
  state.failures.set("/api/auth/me", { status: 401, body: "private-upstream-error" });
  const rejected = await webRequest(baseUrl, "/api/auth/me", { cookie });
  assert.equal(rejected.response.status, 401);
  assertCleared(rejected.response);
  const calls = state.calls.length;
  state.failures.delete("/api/auth/me");
  assert.equal((await webRequest(baseUrl, "/api/auth/me", { cookie })).response.status, 401);
  assert.equal(state.calls.length, calls);
});

test("a browser reuses its cookie after gateway restart; logout persists revocation before remote await and survives another restart", { timeout: 15_000 }, async (t) => {
  const { backendUrl, state } = await mockBackend(t);
  const directory = mkdtempSync(join(tmpdir(), "qzm-web-session-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config: GatewayConfig = { backendUrl, environment: "development", sessionFile: join(directory, "sessions.enc"), sessionSecret: randomBytes(32).toString("hex") };
  const original = await listenApp(t, createApp(config));
  const cookie = assertWebLogin(await webRequest(original.baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials }));
  await original.close();
  const restarted = await listenApp(t, createApp(config));
  const restored = await webRequest(restarted.baseUrl, "/api/auth/me", { cookie });
  assert.equal(restored.response.status, 200);
  assert.equal(tenantOf(restored.data).id, "local");
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  state.beforeResponse = async (call) => { if (call.path === "/api/auth/logout") { entered(); await released; } };
  state.failures.set("/api/auth/logout", { status: 503, body: "remote-unavailable" });
  const pending = webRequest(restarted.baseUrl, "/api/auth/logout", { cookie, method: "POST", body: {} });
  try {
    await waiting;
    const persisted = new SessionManager(Date.now, createSessionPersistence(resolveConfig(config)));
    assert.throws(() => persisted.resolve(cookie.slice(WEB_SESSION_COOKIE.length + 1)), { status: 401 });
    assert.equal((await webRequest(restarted.baseUrl, "/api/auth/me", { cookie })).response.status, 401);
  } finally { release(); }
  const loggedOut = await pending;
  assert.equal(loggedOut.response.status, 200);
  assert.deepEqual(loggedOut.data, { success: true });
  assertCleared(loggedOut.response);
  assert.match(loggedOut.response.headers.get("set-cookie")!, /; SameSite=Lax(?:;|$)/);
  await restarted.close();
  const afterLogout = await listenApp(t, createApp(config));
  const calls = state.calls.length;
  const rejected = await webRequest(afterLogout.baseUrl, "/api/auth/me", { cookie });
  assert.equal(rejected.response.status, 401);
  assertCleared(rejected.response);
  assert.equal(state.calls.length, calls);
});

test("HTTPS development cookies are Secure and Lax; production cookies and their deletion are Secure and SameSite=None", async (t) => {
  const { backendUrl } = await mockBackend(t);
  const development = await gatewayHarness(t, { backendUrl, trustedProxyIps: ["127.0.0.1"] });
  const devLogin = await webRequest(development.baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials, headers: { "X-Forwarded-Proto": "https" } });
  assertWebLogin(devLogin);
  assert.match(devLogin.response.headers.get("set-cookie")!, /; Secure(?:;|$)/);
  assert.match(devLogin.response.headers.get("set-cookie")!, /; SameSite=Lax(?:;|$)/);
  const upstream = t.mock.method(Upstream.prototype, "request", async (...[path]: Parameters<Upstream["request"]>): Promise<unknown> => {
    if (path === "/auth/login") return loginResult;
    if (path === "/auth/logout") return null;
    throw new Error("UNEXPECTED_UPSTREAM_REQUEST");
  });
  const production = await gatewayHarness(t, {
    environment: "production", backendUrl: "https://backend.example.invalid/api", tenantOrigin: "https://tenant.example.invalid",
    corsOrigins: ["https://mobile.example.invalid"], trustedProxyIps: ["127.0.0.1"],
  });
  const options = { origin: "https://mobile.example.invalid", headers: { "X-Forwarded-Proto": "https" } };
  const insecure = await webRequest(production.baseUrl, "/api/auth/login", { origin: options.origin, method: "POST", body: legacyCredentials });
  assert.equal(insecure.response.status, 400);
  assert.deepEqual(insecure.data, { error: "HTTPS_REQUIRED" });
  assert.equal(upstream.mock.callCount(), 0);
  const login = await webRequest(production.baseUrl, "/api/auth/login", { ...options, method: "POST", body: legacyCredentials });
  const cookie = assertWebLogin(login);
  assert.match(login.response.headers.get("set-cookie")!, /; Secure(?:;|$)/);
  assert.match(login.response.headers.get("set-cookie")!, /; SameSite=None(?:;|$)/);
  assert.doesNotMatch(login.response.headers.get("set-cookie")!, /; Domain=/);
  assert.equal(login.response.headers.get("access-control-allow-origin"), options.origin);
  const logout = await webRequest(production.baseUrl, "/api/auth/logout", { ...options, cookie, method: "POST", body: {} });
  assert.equal(logout.response.status, 200);
  assertCleared(logout.response);
  assert.match(logout.response.headers.get("set-cookie")!, /; Secure(?:;|$)/);
  assert.match(logout.response.headers.get("set-cookie")!, /; SameSite=None(?:;|$)/);
});

test("SessionContext without web options preserves existing bearer callers and never enables cookies implicitly", async (t) => {
  const { backendUrl, state } = await mockBackend(t);
  const tenants = new TenantRegistry(resolveConfig({ backendUrl }).tenants);
  const sessions = new SessionManager();
  const context = new SessionContext(tenants, sessions);
  const issued = sessions.issue("local", loginResult);
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter(context));
  app.use(context.invalidateUnauthorized);
  app.use(errorHandler);
  const { baseUrl } = await listenApp(t, app);
  const cookie = `${WEB_SESSION_COOKIE}=${issued.token}`;
  assert.equal((await webRequest(baseUrl, "/api/auth/me", { cookie })).response.status, 403);
  assert.equal((await webRequest(baseUrl, "/api/auth/me", { cookie, transport: null })).response.status, 401);
  const rejectedLogin = await webRequest(baseUrl, "/api/auth/login", { method: "POST", body: legacyCredentials });
  assert.equal(rejectedLogin.response.status, 403);
  assert.equal(state.calls.length, 0);
  const native = await webRequest(baseUrl, "/api/auth/me", { transport: null, origin: null, headers: { Authorization: `Bearer ${issued.token}` } });
  assert.equal(native.response.status, 200);
  assert.deepEqual(userSchema.parse(native.data), user());
  assert.equal(native.response.headers.get("set-cookie"), null);
});