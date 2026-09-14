import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import type { Tenant } from "../../src/domain/models";
import { requireSessionTenant, tenantStorageNamespace } from "../../src/domain/tenantSession";
import { tenantSchema } from "../../src/infrastructure/tenantSchemas";
import { currentUser } from "../auth";
import { sanitizeBranchLogo, selectedBranchDisplay } from "../branch-branding";
import { userSchema } from "../contracts";
import { Upstream } from "../upstream";
import { PNG, TOKEN } from "./fixtures";
import { errorCode, gatewayHarness, gatewayToken, harness, jsonRequest, loginGateway, mockBackend } from "./mock-upstream";

const logo = "https://branch-assets.s3.us-east-1.amazonaws.com/logos/one.png?versionId=test%2Fvalue";
const companyLogo = `data:image/png;base64,${PNG.toString("base64")}`;
const company: Tenant = { id: "local", name: "Company", portalOrigin: "http://localhost:3000", environment: "development", logo: companyLogo, description: "Company description" };
const responseSchema = z.object({ tenant: tenantSchema, branchBranding: z.object({ companyBranchId: z.number(), status: z.enum(["APPLIED", "FALLBACK"]), error: z.string().optional() }) });
const path = "/api/auth/me?companyBranchId=1";

async function brandedHarness(t: TestContext) {
  const result = await harness(t);
  result.state.failures.set("/api/companies/branding", { status: 200, body: { name: company.name, logo: company.logo, description: company.description } });
  result.state.branches.set(1, { id: 1, name: " Branch one ", logo });
  return result;
}

test("selected branch branding uses a protected exact GET after both fresh users and preserves client identity", async (t) => {
  const { state, baseUrl } = await brandedHarness(t);
  const token = gatewayToken(baseUrl);
  const original = structuredClone(state.user);
  state.branches.set(1, { id: 1, name: " Branch one ", logo, tenant: { id: "evil" }, portalOrigin: "https://evil.example.com", environment: "production", description: "private", bankAccount: ["private"], apis: ["private"], alias: "" });
  const result = await jsonRequest(baseUrl, path);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  const display = responseSchema.parse(result.data);
  assert.deepEqual(display, { tenant: { ...company, name: "Branch one", logo }, branchBranding: { companyBranchId: 1, status: "APPLIED" } });
  assert.deepEqual(userSchema.parse(result.data), original);
  assert.deepEqual(state.user, original);
  assert.equal(gatewayToken(baseUrl), token);
  requireSessionTenant(company, display.tenant);
  const session = { mode: "live" as const, tenant: company, user: original };
  assert.equal(tenantStorageNamespace(session, "https://gateway.example.com/mobile", 1), tenantStorageNamespace({ ...session, tenant: display.tenant }, "https://gateway.example.com/mobile", 1));
  assert.deepEqual(state.calls.map((call) => call.path), ["/api/auth/me", "/api/auth/me", "/api/companies/branding", "/api/branches/1"]);
  assert.equal(state.calls[1]?.query.get("companyBranchId"), "1");
  const call = state.calls[3]!;
  assert.equal(call.headers.authorization, TOKEN);
  assert.equal(call.headers.origin, company.portalOrigin);
  assert.equal(call.method, "GET");
  assert.equal(call.query.size, 0);
  assert.equal(call.json, undefined);
  assert.equal(JSON.stringify(result.data).includes("private"), false);
});

test("unscoped me and currentUser keep company presentation and never request branch metadata", async (t) => {
  const { state, baseUrl, backendUrl } = await brandedHarness(t);
  const result = await jsonRequest(baseUrl, "/api/auth/me");
  assert.deepEqual(z.object({ tenant: tenantSchema }).parse(result.data).tenant, company);
  assert.equal(responseSchema.safeParse(result.data).success, false);
  const upstream = new Upstream({ backendUrl, tenantOrigin: company.portalOrigin });
  assert.deepEqual(await currentUser(upstream, TOKEN), state.user);
  assert.deepEqual(state.calls.map((call) => call.path), ["/api/auth/me", "/api/companies/branding", "/api/auth/me"]);
});

test("branch read mock itself requires upstream bearer authorization", async (t) => {
  const { state, backendUrl } = await brandedHarness(t);
  const upstream = new Upstream({ backendUrl, tenantOrigin: company.portalOrigin });
  await assert.rejects(upstream.request("/branches/1"), { status: 401, code: "UNAUTHORIZED" });
  assert.deepEqual(await upstream.request("/branches/1", { token: TOKEN }), state.branches.get(1));
});

test("missing session, invalid queries and unauthorized branches never reach branch GET", async (t) => {
  const { state, baseUrl } = await brandedHarness(t);
  assert.equal((await jsonRequest(baseUrl, path, "GET", undefined, null)).response.status, 401);
  for (const query of ["companyBranchId=0", "companyBranchId=1&companyBranchId=2", "companyBranchId=1&logo=https://evil.example.com", "companyBranchId=1%2F2"]) {
    assert.equal((await jsonRequest(baseUrl, `/api/auth/me?${query}`)).response.status, 400);
  }
  assert.equal(state.calls.length, 0);
  for (const accessBranchs of [[], [{ id: 1, name: "Disabled", main: true, isEnabled: false }], [{ id: 1, name: "Deleted", main: true, isDeleted: true }]]) {
    state.user.accessBranchs = accessBranchs;
    assert.equal(errorCode((await jsonRequest(baseUrl, path)).data), "BRANCH_FORBIDDEN");
  }
  assert.equal(state.calls.length, 3);
  assert.ok(state.calls.every((call) => call.path === "/api/auth/me"));
});

for (const change of ["user", "worker", "membership"] as const) {
  test(`fresh scoped ${change} change blocks branding`, async (t) => {
    const { state, baseUrl } = await brandedHarness(t);
    state.beforeResponse = async (call) => {
      if (call.path !== "/api/auth/me" || !call.query.has("companyBranchId")) return;
      if (change === "user") state.user.id += 1;
      if (change === "worker") state.user.workerId = null;
      if (change === "membership") state.user.accessBranchs = [];
    };
    const result = await jsonRequest(baseUrl, path);
    assert.equal(result.response.status, change === "membership" ? 403 : 401);
    assert.equal(errorCode(result.data), change === "membership" ? "BRANCH_FORBIDDEN" : "SESSION_CHANGED");
    assert.deepEqual(state.calls.map((call) => call.path), ["/api/auth/me", "/api/auth/me"]);
  });
}

for (const status of [401, 403]) {
  test(`branch GET ${status} propagates rather than granting a fallback response`, async (t) => {
    const { state, baseUrl } = await brandedHarness(t);
    state.failures.set("/api/branches/1", { status, body: "private upstream error" });
    const result = await jsonRequest(baseUrl, path);
    assert.equal(result.response.status, status);
    assert.deepEqual(result.data, { error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" });
    assert.equal(state.calls.filter((call) => call.path === "/api/branches/1").length, 1);
  });
}

for (const status of [404, 429, 500, 503, 302]) {
  test(`branch GET ${status} returns explicit company fallback without leaking errors or following redirects`, async (t) => {
    const { state, baseUrl } = await brandedHarness(t);
    state.failures.set("/api/branches/1", { status, body: "private upstream error", location: "https://127.0.0.1/private" });
    const result = await jsonRequest(baseUrl, path);
    assert.equal(result.response.status, 200);
    assert.deepEqual(responseSchema.parse(result.data), { tenant: company, branchBranding: { companyBranchId: 1, status: "FALLBACK", error: "BRANCH_BRANDING_UNAVAILABLE" } });
    assert.equal(state.calls.length, 4);
  });
}

test("branch timeout is bounded independently from operational requests and falls back", { timeout: 8000 }, async (t) => {
  const { state, baseUrl } = await brandedHarness(t);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  state.beforeResponse = async (call) => { if (call.path === "/api/branches/1") await pending; };
  try {
    const result = await jsonRequest(baseUrl, path);
    assert.equal(result.response.status, 200);
    assert.equal(responseSchema.parse(result.data).branchBranding.error, "BRANCH_BRANDING_UNAVAILABLE");
    assert.equal(state.calls.length, 4);
  } finally { release(); }
});

test("branch schema rejects mismatched IDs and malformed payloads without copying any fields", async (t) => {
  const { state, baseUrl } = await brandedHarness(t);
  for (const input of [null, [], {}, { id: "1", name: "Wrong", logo }, { id: 2, name: "Other branch", logo }, { id: 0, name: "Wrong" }, { id: Number.MAX_SAFE_INTEGER + 1, name: "Wrong" }]) {
    state.branches.set(1, input);
    const result = await jsonRequest(baseUrl, path);
    assert.equal(result.response.status, 200);
    assert.deepEqual(responseSchema.parse(result.data), { tenant: company, branchBranding: { companyBranchId: 1, status: "FALLBACK", error: "BRANCH_BRANDING_INVALID_RESPONSE" } });
  }
  state.failures.set("/api/branches/1", { status: 200, body: "not JSON" });
  assert.equal(responseSchema.parse((await jsonRequest(baseUrl, path)).data).branchBranding.error, "BRANCH_BRANDING_UNAVAILABLE");
});

test("missing, null and invalid branch logos retain the company logo; names fall back to fresh branch then company", async (t) => {
  const { state, baseUrl } = await brandedHarness(t);
  for (const invalidLogo of [undefined, null, "", "http://assets.example.com/logo.png", "https://127.0.0.1/logo", companyLogo, { url: logo }]) {
    state.branches.set(1, { id: 1, name: " Branch one ", logo: invalidLogo, alias: "" });
    const display = responseSchema.parse((await jsonRequest(baseUrl, path)).data);
    assert.deepEqual(display.tenant, { ...company, name: "Branch one" });
    assert.equal(display.branchBranding.status, "APPLIED");
  }
  for (const name of [undefined, null, " ", "x".repeat(121), 1]) {
    state.branches.set(1, { id: 1, name, alias: "Do not use alias" });
    assert.equal(responseSchema.parse((await jsonRequest(baseUrl, path)).data).tenant.name, "Principal");
  }
  state.user.accessBranchs[0]!.name = " ";
  assert.deepEqual(responseSchema.parse((await jsonRequest(baseUrl, path)).data).tenant, company);
});

test("A to B to A refresh never caches branch branding or overwrites the company display", async (t) => {
  const { state, baseUrl } = await brandedHarness(t);
  state.user.accessBranchs.push({ id: 2, name: "Second membership", main: false });
  state.branches.set(2, { id: 2, name: "Branch two", logo: null });
  assert.equal(responseSchema.parse((await jsonRequest(baseUrl, path)).data).tenant.logo, logo);
  assert.deepEqual(responseSchema.parse((await jsonRequest(baseUrl, "/api/auth/me?companyBranchId=2")).data).tenant, { ...company, name: "Branch two" });
  state.branches.set(1, { id: 1, name: "Updated one", logo: null });
  assert.deepEqual(responseSchema.parse((await jsonRequest(baseUrl, path)).data).tenant, { ...company, name: "Updated one" });
  assert.deepEqual(z.object({ tenant: tenantSchema }).parse((await jsonRequest(baseUrl, "/api/auth/me")).data).tenant, company);
  assert.deepEqual(state.calls.filter((call) => call.path.startsWith("/api/branches/")).map((call) => call.path), ["/api/branches/1", "/api/branches/2", "/api/branches/1"]);
  assert.equal(state.calls.filter((call) => call.path === "/api/companies/branding").length, 1);
});

test("same branch ID in different tenant sessions stays isolated", async (t) => {
  const a = await mockBackend(t);
  const b = await mockBackend(t);
  a.state.branches.set(1, { id: 1, name: "A", logo });
  b.state.branches.set(1, { id: 1, name: "B", logo: null });
  const tenants = [{ id: "a", name: "Company A", backendUrl: a.backendUrl, tenantOrigin: "https://a.example.com", environment: "development" as const, enabled: true }, { id: "b", name: "Company B", backendUrl: b.backendUrl, tenantOrigin: "https://b.example.com", environment: "development" as const, enabled: true }];
  const { baseUrl } = await gatewayHarness(t, { tenants });
  const tokenA = (await loginGateway(baseUrl, "a")).token;
  const tokenB = (await loginGateway(baseUrl, "b")).token;
  for (const [token, id, name] of [[tokenA, "a", "A"], [tokenB, "b", "B"], [tokenA, "a", "A"]]) {
    const display = responseSchema.parse((await jsonRequest(baseUrl, path, "GET", undefined, token)).data);
    assert.equal(display.tenant.id, id);
    assert.equal(display.tenant.name, name);
    assert.equal(display.tenant.logo, id === "a" ? logo : undefined);
    assert.equal(display.tenant.portalOrigin, `https://${id}.example.com`);
  }
});

test("branch URL policy accepts HTTPS public DNS only, preserving signed queries without fetching images", async (t) => {
  assert.equal(sanitizeBranchLogo(logo), logo);
  assert.equal(sanitizeBranchLogo("https://cdn.example.com/logo.png?version=a@b"), "https://cdn.example.com/logo.png?version=a@b");
  for (const value of [undefined, null, companyLogo, "https://localhost/logo", "https://a.localhost/logo", "https://a.local/logo", "https://a.internal/logo", "https://a.home.arpa/logo", "https://a.invalid/logo", "https://127.0.0.1/logo", "https://127.1/logo", "https://2130706433/logo", "https://0x7f000001/logo", "https://10.0.0.1/logo", "https://169.254.169.254/latest", "https://[::1]/logo", "https://[::ffff:127.0.0.1]/logo", "https://user:pass@cdn.example.com/logo", "https://@cdn.example.com/logo", "https://cdn.example.com:8443/logo", "https://cdn.example.com/logo#fragment", "http://cdn.example.com/logo", " https://cdn.example.com/logo", "https://cdn.example.com/lo\tgo", "https://cdn.example.com/lo\ngo", "https://cdn.example.com/lo\\go", "https://cdn.example.com/logo "]) {
    assert.equal(sanitizeBranchLogo(value), undefined, String(value));
  }
  const { backendUrl } = await mockBackend(t);
  const upstream = new Upstream({ backendUrl, tenantOrigin: company.portalOrigin });
  const requests: string[] = [];
  t.mock.method(upstream, "request", async (...[requestPath, options]: Parameters<Upstream["request"]>): Promise<unknown> => {
    requests.push(requestPath);
    assert.equal(options?.token, TOKEN);
    return { id: 1, name: "One", logo };
  });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("IMAGE_DOWNLOAD_FORBIDDEN"); });
  const display = await selectedBranchDisplay(upstream, TOKEN, Object.freeze({ ...company }), { id: 1, name: "Principal" });
  assert.equal(display.tenant.logo, logo);
  assert.equal(Object.isFrozen(display.tenant), true);
  assert.deepEqual(requests, ["/branches/1"]);
});