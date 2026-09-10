import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import type express from "express";
import { z } from "zod";
import { createApp, createConfiguredApp } from "../app";
import { BackendDirectory, BACKEND_CATALOG_TTL_MS, BACKEND_REQUEST_TIMEOUT_MS, BACKEND_RESPONSE_LIMIT, backendCatalogSchema, type BackendTenant } from "../backend-directory";
import { loadConfig, resolveConfig, tenantsSchema, type TenantConfig } from "../config";
import { EncryptedFileSessionPersistence } from "../session-persistence";
import { SessionManager } from "../sessions";
import { TenantRegistry } from "../tenants";
import { WEB_SESSION_HEADER } from "../web-session";
import { RANGE, TOKEN } from "./fixtures";
import { jsonRequest, mockBackend } from "./mock-upstream";

const configPath = "/api/auth/mobile/config";
const discoverPath = "/api/auth/mobile/discover";
const completePath = "/api/auth/mobile/complete";
const startPath = "/api/auth/login/start";
const credentials = { username: "fixture", password: "fixture-password", remember: true } as const;
const result = { token: "test-token", username: "fixture", email: "fixture@example.invalid", nextStep: "DONE" as const };
const first: BackendTenant = { id: "tenant-1", name: "First", portalOrigin: "http://localhost:3000", environment: "development" };
const second: BackendTenant = { id: "tenant-2", name: "Second", portalOrigin: "http://second.invalid", environment: "development" };
const loginSchema = z.object({ token: z.string(), tenant: z.object({ id: z.string(), portalOrigin: z.string() }) });
const challengeSchema = z.object({ nextStep: z.literal("SELECT_TENANT"), challenge: z.string(), tenants: z.array(z.object({ id: z.string() })) });

async function listen(t: TestContext, app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_ADDRESS");
  const close = async (): Promise<void> => {
    if (!server.listening) return;
    await new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done());
      server.closeAllConnections();
    });
  };
  t.after(close);
  return { baseUrl: `http://127.0.0.1:${address.port}`, close };
}

async function central(t: TestContext, initial: BackendTenant[] = [first]) {
  const backend = await mockBackend(t);
  const catalog = (tenants: BackendTenant[]): void => { backend.state.failures.set(configPath, { status: 200, body: { version: 1, tenants } }); };
  const discover = (tenants: BackendTenant[]): void => {
    backend.state.failures.set(discoverPath, { status: 200, body: { matches: tenants.map((tenant) => ({ tenant, grant: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.now() + 120_000).toISOString() })) } });
  };
  const complete = (tenant: BackendTenant): void => { backend.state.failures.set(completePath, { status: 200, body: { ...result, tenant } }); };
  catalog(initial);
  discover(initial);
  complete(initial[0] ?? first);
  backend.state.failures.set("/api/companies/branding", { status: 200, body: { name: "Fixture brand" } });
  const config = resolveConfig({ environment: "test", tenantResolution: "backend", backendUrl: backend.backendUrl });
  return { ...backend, catalog, discover, complete, config };
}

test("environment startup is backend-owned and does not read an ambient tenant file or synthesize localhost Origin", () => {
  const read = fs.readFileSync;
  let tenantReads = 0;
  const context = test.mock.method(fs, "readFileSync", ((...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]).replaceAll("\\", "/").endsWith("/config/tenants.json")) { tenantReads++; throw new Error("AMBIENT_FILE_MUST_NOT_BE_READ"); }
    return read(...args);
  }) as typeof fs.readFileSync);
  try {
    const config = loadConfig({ NODE_ENV: "test", BACKEND_URL: "http://backend.invalid/api" });
    assert.equal(config.tenantResolution, "backend");
    assert.equal(config.tenantOrigin, undefined);
    assert.deepEqual(config.tenants, []);
    assert.equal(tenantReads, 0);
    assert.throws(() => createApp(config), { message: "BACKEND_BOOTSTRAP_REQUIRED" });
    assert.equal(resolveConfig({ tenants: [] }).tenantResolution, "legacy");
    assert.equal(loadConfig({ NODE_ENV: "test", TENANT_ORIGIN: "http://explicit.invalid" }).tenantResolution, "legacy");
    assert.throws(() => resolveConfig({ tenantResolution: "backend", tenantOrigin: "http://injected.invalid" }));
  } finally { context.mock.restore(); }
});

test("backend production validates the pinned HTTPS destination, not the frontend dependency", () => {
  const secure = { environment: "production" as const, tenantResolution: "backend" as const, backendUrl: "https://backend.invalid/api", corsOrigins: ["https://mobile.invalid"], trustedProxyIps: ["127.0.0.1"] };
  assert.equal(resolveConfig(secure).tenantOrigin, undefined);
  assert.throws(() => resolveConfig({ ...secure, backendUrl: "http://backend.invalid/api" }));
  assert.throws(() => resolveConfig({ ...secure, trustedProxyIps: [] }));
  assert.throws(() => resolveConfig({ ...secure, corsOrigins: [] }));
  assert.equal(backendCatalogSchema.safeParse({ version: 1, tenants: [first] }).success, true);
  assert.equal(backendCatalogSchema.safeParse({ version: 1, tenants: [{ ...first, environment: "production" }] }).success, false);
});

test("neutral bootstrap and health use only the central API without Origin, credentials or tenant probes, including an empty catalog", async (t) => {
  const backend = await central(t, []);
  const { baseUrl } = await listen(t, await createConfiguredApp(backend.config));
  const health = await jsonRequest(baseUrl, "/health", "GET", undefined, null);
  assert.deepEqual(health.data, { ok: true, backendReachable: true });
  assert.deepEqual((await jsonRequest(baseUrl, "/api/tenants", "GET", undefined, null)).data, { data: [] });
  assert.equal((await jsonRequest(baseUrl, startPath, "POST", credentials, null)).response.status, 401);
  assert.ok(backend.state.calls.every((call) => [configPath, discoverPath].includes(call.path)));
  for (const call of backend.state.calls) {
    assert.equal(call.headers.origin, undefined);
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.headers.cookie, undefined);
  }
});

test("a shared account selects one verified backend tenant and all legacy traffic stays pinned with the selected internal Origin", async (t) => {
  const backend = await central(t, [first, second]);
  const { baseUrl } = await listen(t, await createConfiguredApp(backend.config));
  const started = await jsonRequest(baseUrl, startPath, "POST", credentials, null);
  const challenge = challengeSchema.parse(started.data);
  assert.deepEqual(challenge.tenants.map(({ id }) => id), [first.id, second.id]);
  assert.doesNotMatch(JSON.stringify(started.data), /fixture-password|test-token|grant|backendUrl/);
  assert.equal(backend.state.calls.filter(({ path }) => path === completePath).length, 0);
  backend.complete(second);
  const selected = await jsonRequest(baseUrl, "/api/auth/login/complete", "POST", { challenge: challenge.challenge, tenantId: second.id }, null);
  const login = loginSchema.parse(selected.data);
  assert.match(login.token, /^qzm_[A-Za-z0-9_-]{43}$/);
  assert.equal(login.tenant.id, second.id);
  assert.equal(login.tenant.portalOrigin, second.portalOrigin);
  assert.equal((await jsonRequest(baseUrl, `/api/assignments?${RANGE}`, "GET", undefined, `Bearer ${login.token}`)).response.status, 200);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/login/complete", "POST", { challenge: challenge.challenge, tenantId: first.id }, null)).response.status, 401);
  for (const call of backend.state.calls) {
    if ([configPath, discoverPath, completePath].includes(call.path)) {
      assert.equal(call.headers.origin, undefined);
      assert.equal(call.headers.authorization, undefined);
    } else {
      assert.equal(call.headers.origin, second.portalOrigin);
      if (call.path !== "/api/companies/branding") assert.equal(call.headers.authorization, TOKEN);
    }
    assert.ok(!["/api/auth/login", "/api/auth/mobile/prepare", "/api/auth/mobile/exchange"].includes(call.path));
  }
  assert.deepEqual(backend.state.calls.find(({ path }) => path === discoverPath)?.json, credentials);
  assert.deepEqual(Object.keys(z.object({ grant: z.string() }).strict().parse(backend.state.calls.find(({ path }) => path === completePath)?.json)), ["grant"]);
  const asserted = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${login.token}`, "X-Qualitzer-Tenant": first.id } });
  assert.equal(asserted.status, 409);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/login", "POST", { ...credentials, tenantId: first.id }, null)).response.status, 400);
});

test("new catalog tenants become routable on login without restart; TTL retirement revokes only removed sessions permanently", async (t) => {
  let now = Date.now();
  const backend = await central(t);
  const { baseUrl } = await listen(t, await createConfiguredApp(backend.config, { now: () => now }));
  const oldLogin = loginSchema.parse((await jsonRequest(baseUrl, startPath, "POST", credentials, null)).data);
  backend.catalog([first, second]);
  backend.discover([second]);
  backend.complete(second);
  const newLogin = loginSchema.parse((await jsonRequest(baseUrl, startPath, "POST", credentials, null)).data);
  assert.equal(newLogin.tenant.id, second.id);
  assert.equal((await jsonRequest(baseUrl, `/api/assignments?${RANGE}`, "GET", undefined, `Bearer ${newLogin.token}`)).response.status, 200);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${oldLogin.token}`)).response.status, 200);
  assert.equal(backend.state.calls.filter(({ path }) => path === "/api/auth/me").at(-1)?.headers.origin, first.portalOrigin);
  backend.catalog([second]);
  now += BACKEND_CATALOG_TTL_MS;
  backend.state.calls.length = 0;
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${oldLogin.token}`)).response.status, 401);
  assert.deepEqual(backend.state.calls.map(({ path }) => path), [configPath]);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${newLogin.token}`)).response.status, 200);
  backend.catalog([first, second]);
  now += BACKEND_CATALOG_TTL_MS;
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${oldLogin.token}`)).response.status, 401);
});

test("stale catalog failures block protected requests and rebindings never forward old sessions to a new Origin", async (t) => {
  let now = Date.now();
  const backend = await central(t);
  const { baseUrl } = await listen(t, await createConfiguredApp(backend.config, { now: () => now }));
  const login = loginSchema.parse((await jsonRequest(baseUrl, startPath, "POST", credentials, null)).data);
  backend.state.failures.set(configPath, { status: 503, body: { secret: "do-not-publish" } });
  now += BACKEND_CATALOG_TTL_MS;
  backend.state.calls.length = 0;
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${login.token}`)).response.status, 503);
  backend.catalog([{ ...first, portalOrigin: "http://replacement.invalid" }]);
  const rebound = await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${login.token}`);
  assert.equal(rebound.response.status, 503);
  assert.deepEqual(rebound.data, { error: "BACKEND_TENANT_BINDING_CHANGED" });
  assert.ok(backend.state.calls.every(({ path }) => path === configPath));
  backend.catalog([first]);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${login.token}`)).response.status, 200);
});

test("catalog validation rejects partial metadata, duplicate identities/routes, unsafe URLs, extra network destinations and over 50 tenants", () => {
  for (const tenants of [
    [{ ...first, id: "manual-alias" }], [{ ...first, name: " " }], [{ ...first, environment: undefined }],
    [{ ...first, portalOrigin: "http://user:password@private.invalid" }], [{ ...first, portalOrigin: "http://private.invalid/path" }],
    [{ ...first, portalOrigin: " http://private.invalid" }], [{ ...first, backendUrl: "https://attacker.invalid" }],
    [first, first], [first, { ...second, portalOrigin: first.portalOrigin }],
    Array.from({ length: 51 }, (_, index) => ({ ...first, id: `tenant-${index + 1}`, portalOrigin: `http://tenant-${index}.invalid` })),
  ]) assert.equal(backendCatalogSchema.safeParse({ version: 1, tenants }).success, false);
  assert.equal(backendCatalogSchema.safeParse({ version: 2, tenants: [] }).success, false);
});

test("malformed/incomplete discovery never exchanges a partial match or leaks backend grants", async (t) => {
  const backend = await central(t);
  const { baseUrl } = await listen(t, await createConfiguredApp(backend.config));
  const valid = { tenant: first, grant: "g".repeat(43), expiresAt: new Date(Date.now() + 120_000).toISOString() };
  for (const body of [
    { matches: [valid, { ...valid, tenant: second }] }, { matches: [valid, valid] },
    { matches: [{ ...valid, tenant: { ...first, backendUrl: "https://untrusted.invalid" } }] },
    { matches: [{ ...valid, expiresAt: new Date(0).toISOString() }] },
    { matches: [{ ...valid, token: "private-jwt" }] }, { matches: [valid], incomplete: true },
  ]) {
    backend.state.failures.set(discoverPath, { status: 200, body });
    const response = await jsonRequest(baseUrl, startPath, "POST", credentials, null);
    assert.equal(response.response.status, 503);
    assert.doesNotMatch(JSON.stringify(response.data), /private-jwt|ggggg|fixture-password|untrusted/);
  }
  assert.equal(backend.state.calls.filter(({ path }) => path === completePath).length, 0);
});

test("401, 503 and 429 discovery outcomes stay fail-closed and a complete response must identify the selected route", async (t) => {
  const backend = await central(t);
  const { baseUrl } = await listen(t, await createConfiguredApp(backend.config));
  for (const status of [401, 503, 429]) {
    backend.state.failures.set(discoverPath, { status, body: { matches: [], token: "private-token" } });
    const response = await jsonRequest(baseUrl, startPath, "POST", credentials, null);
    assert.equal(response.response.status, status);
    assert.doesNotMatch(JSON.stringify(response.data), /private-token/);
  }
  backend.discover([first]);
  for (const tenant of [second, { ...first, portalOrigin: "http://wrong.invalid" }]) {
    backend.complete(tenant);
    const response = await jsonRequest(baseUrl, startPath, "POST", credentials, null);
    assert.equal(response.response.status, 503);
    assert.doesNotMatch(JSON.stringify(response.data), /test-token|qzm_/);
  }
});

test("catalog bootstrap refuses redirects, excessive bodies, non-JSON and unavailable endpoints without falling back to Origin auth", async (t) => {
  const backend = await central(t);
  for (const failure of [
    { status: 302, body: "redirect", location: "http://untrusted.invalid" }, { status: 404, body: "missing" },
    { status: 200, body: { version: 1, tenants: [{ ...first, backendUrl: "http://untrusted.invalid" }] } },
    { status: 200, body: { oversized: "a".repeat(BACKEND_RESPONSE_LIMIT) } }, { status: 200, body: "not-json" },
  ]) {
    backend.state.failures.set(configPath, failure);
    await assert.rejects(createConfiguredApp(backend.config), { status: 503 });
  }
  assert.ok(backend.state.calls.every(({ path, headers }) => path === configPath && headers.origin === undefined));
});

test("neutral requests time out even before response headers and never leak the supplied credentials", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(new Error("fixture-password")), { once: true });
  }));
  const pending = new BackendDirectory("http://backend.invalid/api").request("/auth/mobile/discover", credentials);
  t.mock.timers.tick(BACKEND_REQUEST_TIMEOUT_MS);
  await assert.rejects(pending, { status: 503, message: "BACKEND_DIRECTORY_UNAVAILABLE" });
});

test("catalog refresh is coalesced and unchanged bindings retain runtime operation locks despite name changes", async (t) => {
  const backend = await central(t);
  const registry = new TenantRegistry([], Date.now, new BackendDirectory(backend.backendUrl));
  await registry.ensureFresh(true);
  const runtime = registry.get(first.id);
  backend.catalog([{ ...first, name: "Renamed" }]);
  backend.state.calls.length = 0;
  await Promise.all([registry.ensureFresh(true), registry.ensureFresh(true), registry.ensureFresh()]);
  assert.equal(registry.get(first.id), runtime);
  assert.equal(runtime.tenant.name, "Renamed");
  assert.equal(backend.state.calls.length, 1);
  backend.catalog([{ ...first, portalOrigin: "http://rebound.invalid" }]);
  await assert.rejects(registry.ensureFresh(true), { code: "BACKEND_TENANT_BINDING_CHANGED" });
  assert.throws(() => registry.get(first.id), { status: 503 });
  assert.throws(() => registry.matchBackendTenant(first), { status: 503 });
  assert.throws(() => registry.list(), { status: 503 });
});

test("backend login preserves native Bearer and web HttpOnly cookie isolation with no neutral Origin forwarding", async (t) => {
  const backend = await central(t);
  const { baseUrl } = await listen(t, await createConfiguredApp(backend.config));
  const native = await jsonRequest(baseUrl, startPath, "POST", credentials, null);
  assert.match(loginSchema.parse(native.data).token, /^qzm_/);
  assert.equal(native.response.headers.get("set-cookie"), null);
  const headers = { Origin: "http://localhost:8081", [WEB_SESSION_HEADER]: "cookie", "Content-Type": "application/json" };
  const web = await fetch(`${baseUrl}${startPath}`, { method: "POST", headers, body: JSON.stringify(credentials) });
  assert.equal(loginSchema.parse(await web.json()).token, "cookie-session");
  const cookie = web.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/api/);
  const authHeaders = { ...headers, Cookie: cookie.split(";")[0]! };
  assert.equal((await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: authHeaders.Cookie } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/auth/me`, { headers: { ...authHeaders, Origin: "http://forbidden.invalid" } })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/auth/me`, { headers: { ...authHeaders, Authorization: "Bearer cookie-session" } })).status, 401);
  assert.ok(backend.state.calls.filter(({ path }) => [configPath, discoverPath, completePath].includes(path)).every(({ headers }) => headers.origin === undefined && headers.cookie === undefined));
});

test("V1 migration preserves custom offline alias and opaque sessions, writes encrypted V2, then restarts without the migration file", async (t) => {
  const backend = await central(t);
  const directory = fs.mkdtempSync(join(tmpdir(), "qzm-backend-migration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "sessions.enc");
  const legacyFile = join(directory, "fixture-tenants.json");
  const key = Buffer.alloc(32, 17);
  const legacy: TenantConfig[] = [{ id: "grupo-eliseo-local", name: "Previous display", backendUrl: backend.backendUrl, tenantOrigin: first.portalOrigin, environment: "development", enabled: true }];
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  const original = new SessionManager(Date.now, new EncryptedFileSessionPersistence(file, key, legacy));
  const issued = original.issue(legacy[0]!.id, result);
  const config = { ...backend.config, environment: "development" as const, sessionFile: file, sessionSecret: key.toString("hex") };
  let reads = 0;
  const app = await createConfiguredApp(config, { legacyMigrationTenants: () => { reads++; return tenantsSchema.parse(JSON.parse(fs.readFileSync(legacyFile, "utf8")) as unknown); } });
  const running = await listen(t, app);
  const me = await jsonRequest(running.baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${issued.token}`);
  assert.equal(me.response.status, 200);
  const identity = z.object({ tenant: z.object({ id: z.string(), portalOrigin: z.string(), environment: z.string() }) }).parse(me.data).tenant;
  assert.deepEqual(identity, { id: "grupo-eliseo-local", portalOrigin: first.portalOrigin, environment: "development" });
  assert.equal(reads, 1);
  const encrypted = fs.readFileSync(file);
  assert.equal(encrypted.includes(Buffer.from(result.token)), false);
  assert.equal(encrypted.includes(Buffer.from(issued.token)), false);
  assert.equal(encrypted.includes(Buffer.from("grupo-eliseo-local")), false);
  await running.close();
  fs.unlinkSync(legacyFile);
  backend.catalog([first, second]);
  const restarted = await listen(t, await createConfiguredApp(config, { legacyMigrationTenants: () => { throw new Error("MIGRATION_MUST_NOT_RUN_TWICE"); } }));
  assert.equal((await jsonRequest(restarted.baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${issued.token}`)).response.status, 200);
  const restoredCookie = await fetch(`${restarted.baseUrl}/api/auth/me`, { headers: {
    Origin: "http://localhost:8081", [WEB_SESSION_HEADER]: "cookie", Cookie: `qz_mobile_session=${issued.token}`, "X-Qualitzer-Tenant": "grupo-eliseo-local",
  } });
  assert.equal(restoredCookie.status, 200);
  const login = loginSchema.parse((await jsonRequest(restarted.baseUrl, startPath, "POST", credentials, null)).data);
  assert.equal(login.tenant.id, "grupo-eliseo-local");
  const assertion = await fetch(`${restarted.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${issued.token}`, "X-Qualitzer-Tenant": "grupo-eliseo-local" } });
  assert.equal(assertion.status, 200);
  backend.discover([first, second]);
  const challenge = challengeSchema.parse((await jsonRequest(restarted.baseUrl, startPath, "POST", credentials, null)).data);
  assert.deepEqual(challenge.tenants.map(({ id }) => id), ["grupo-eliseo-local", second.id]);
  const complete = await jsonRequest(restarted.baseUrl, "/api/auth/login/complete", "POST", { challenge: challenge.challenge, tenantId: "grupo-eliseo-local" }, null);
  assert.equal(loginSchema.parse(complete.data).tenant.id, "grupo-eliseo-local");
});

test("V1 migration requires the exact old fingerprint and verified pinned route; failures leave the encrypted fixture untouched", async (t) => {
  const backend = await central(t);
  const directory = fs.mkdtempSync(join(tmpdir(), "qzm-backend-migration-reject-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "sessions.enc");
  const key = Buffer.alloc(32, 19);
  const legacy: TenantConfig[] = [{ id: "custom", name: "Fixture", backendUrl: backend.backendUrl, tenantOrigin: first.portalOrigin, environment: "development", enabled: true }];
  new SessionManager(Date.now, new EncryptedFileSessionPersistence(file, key, legacy)).issue("custom", result);
  const config = { ...backend.config, environment: "development" as const, sessionFile: file, sessionSecret: key.toString("hex") };
  const previous = fs.readFileSync(file);
  await assert.rejects(createConfiguredApp(config, { legacyMigrationTenants: () => { throw new Error("SESSION_MIGRATION_LEGACY_ROUTES_REQUIRED"); } }), { message: "SESSION_MIGRATION_LEGACY_ROUTES_REQUIRED" });
  await assert.rejects(createConfiguredApp(config, { legacyMigrationTenants: () => [{ ...legacy[0]!, id: "renamed" }] }), { message: "SESSION_MIGRATION_ROUTING_FINGERPRINT_MISMATCH" });
  backend.catalog([{ ...first, portalOrigin: "http://other.invalid" }]);
  await assert.rejects(createConfiguredApp(config, { legacyMigrationTenants: () => legacy }), { message: "SESSION_MIGRATION_ROUTE_NOT_VERIFIED" });
  assert.deepEqual(fs.readFileSync(file), previous);
  assert.equal(fs.existsSync(`${file}.unavailable`), false);
});

test("V2 binding changes fail closed across restart, while retirement persists and does not revive on re-addition", async (t) => {
  const backend = await central(t);
  const directory = fs.mkdtempSync(join(tmpdir(), "qzm-backend-retirement-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { ...backend.config, environment: "development" as const, sessionFile: resolve(directory, "sessions.enc"), sessionSecret: Buffer.alloc(32, 23).toString("hex") };
  const firstRun = await listen(t, await createConfiguredApp(config));
  const login = loginSchema.parse((await jsonRequest(firstRun.baseUrl, startPath, "POST", credentials, null)).data);
  await firstRun.close();
  const anotherBackend = await central(t);
  await assert.rejects(createConfiguredApp({ ...config, backendUrl: anotherBackend.backendUrl }), { message: "SESSION_PERSISTENCE_ROUTING_MISMATCH" });
  backend.catalog([{ ...first, portalOrigin: "http://rebound.invalid" }]);
  await assert.rejects(createConfiguredApp(config), { code: "BACKEND_TENANT_BINDING_CHANGED" });
  backend.catalog([]);
  const retired = await listen(t, await createConfiguredApp(config));
  assert.equal((await jsonRequest(retired.baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${login.token}`)).response.status, 401);
  await retired.close();
  backend.catalog([first]);
  const readded = await listen(t, await createConfiguredApp(config));
  assert.equal((await jsonRequest(readded.baseUrl, "/api/auth/me", "GET", undefined, `Bearer ${login.token}`)).response.status, 401);
});