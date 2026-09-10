import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import type { Tenant } from "../../src/domain/models";
import type { TenantConfig } from "../config";
import { assignmentsSchema, loginResultSchema, userSchema } from "../contracts";
import { assignments, group, RANGE, TOKEN, user, work } from "./fixtures";
import { errorCode, form, gatewayHarness, jsonRequest, loginGateway, mockBackend, uploadRequest, writeCalls } from "./mock-upstream";

const listPath = `/api/assignments?${RANGE}`;
const workPath = (suffix: string) => `/api/assignments/direct-11/works/11${suffix}?${RANGE}`;
const password = { newPassword: "NewPassword42!", confirmPassword: "NewPassword42!", remember: false };
const credentials = { username: "test", password: "password", remember: false };
const tenantSchema = z.object({ id: z.string(), name: z.string(), portalOrigin: z.string(), environment: z.enum(["development", "production"]) }).strict();
const tenantOf = (data: unknown): Tenant => z.object({ tenant: tenantSchema }).parse(data).tenant;

async function multiTenantHarness(t: TestContext) {
  const a = await mockBackend(t, {
    branding: "Grupoeliseo", user: { ...user(), system: { name: "Grupoeliseo", timezone: "UTC" } },
    assignments: assignments([group({ title: "OT exclusiva A", works: [work({ title: "Tarea exclusiva A" })] })]),
  });
  const b = await mockBackend(t, {
    branding: "Otraempresa", user: { ...user(), system: { name: "Otraempresa", timezone: "UTC" } },
    assignments: assignments([group({ title: "OT exclusiva B", works: [work({ title: "Tarea exclusiva B" })] })]),
  });
  const tenants: TenantConfig[] = [
    { id: "grupo-eliseo-local", name: "Grupo Eliseo", backendUrl: a.backendUrl, tenantOrigin: "http://localhost:3000", environment: "development", enabled: true },
    { id: "otra-empresa", name: "Otra Empresa", backendUrl: b.backendUrl, tenantOrigin: "http://other.localhost:3000", environment: "development", enabled: true },
    { id: "disabled", name: "No visible", backendUrl: a.backendUrl, tenantOrigin: "http://disabled.localhost:3000", environment: "development", enabled: false },
  ];
  const { baseUrl } = await gatewayHarness(t, { tenants });
  return { a, b, tenants, baseUrl };
}

async function withTenant(baseUrl: string, path: string, token: string, tenant: string, method = "GET", body?: unknown) {
  const headers = new Headers({ Authorization: token, "X-Qualitzer-Tenant": tenant });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data: unknown = await response.json();
  return { response, data };
}

test("tenant discovery uses only the server allowlist, strips routing and never discovers backend branding", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const result = await jsonRequest(baseUrl, "/api/tenants", "GET", undefined, null);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { data: [
    { id: "grupo-eliseo-local", name: "Grupo Eliseo", portalOrigin: "http://localhost:3000", environment: "development" },
    { id: "otra-empresa", name: "Otra Empresa", portalOrigin: "http://other.localhost:3000", environment: "development" },
  ] });
  z.object({ data: z.array(tenantSchema) }).strict().parse(result.data);
  assert.doesNotMatch(JSON.stringify(result.data), /backendUrl|tenantOrigin|enabled|disabled|jaras|Grupoeliseo/);
  assert.equal(a.state.calls.length + b.state.calls.length, 0);
  assert.equal((await jsonRequest(baseUrl, "/api/companies/branding", "GET", undefined, null)).response.status, 404);
  assert.equal((await jsonRequest(baseUrl, "/api/tenants?backendUrl=http://attacker.invalid", "GET", undefined, null)).response.status, 400);
});

test("login selection is mandatory even with one tenant; unknown, disabled and routing overrides never reach upstream", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  for (const body of [credentials, { ...credentials, tenantId: "" }]) {
    const result = await jsonRequest(baseUrl, "/api/auth/login", "POST", body, null);
    assert.equal(result.response.status, 400);
    assert.equal(errorCode(result.data), "TENANT_REQUIRED");
  }
  for (const tenantId of ["unknown", "disabled", "jaras", "local"]) {
    const result = await jsonRequest(baseUrl, "/api/auth/login", "POST", { ...credentials, tenantId }, null);
    assert.equal(result.response.status, 404);
    assert.equal(errorCode(result.data), "TENANT_NOT_FOUND");
  }
  for (const extra of [{ tenantOrigin: "http://attacker.invalid" }, { backendUrl: a.backendUrl }, { tenant: "otra-empresa" }]) {
    assert.equal((await jsonRequest(baseUrl, "/api/auth/login", "POST", { ...credentials, tenantId: "grupo-eliseo-local", ...extra }, null)).response.status, 400);
  }
  assert.equal(a.state.calls.length + b.state.calls.length, 0);
  const single = await gatewayHarness(t, { backendUrl: a.backendUrl });
  const missing = await jsonRequest(single.baseUrl, "/api/auth/login", "POST", credentials, null);
  assert.equal(errorCode(missing.data), "TENANT_REQUIRED");
  assert.equal(tenantOf((await loginGateway(single.baseUrl)).data).id, "local");
});

test("health probes the selected tenant only and unselected health aggregates without implying a tenant", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const selected = await jsonRequest(baseUrl, "/health?tenantId=grupo-eliseo-local", "GET", undefined, null);
  assert.deepEqual(selected.data, { ok: true, backendReachable: true, tenantOrigin: "http://localhost:3000", tenant: {
    id: "grupo-eliseo-local", name: "Grupo Eliseo", portalOrigin: "http://localhost:3000", environment: "development",
  } });
  assert.equal(a.state.calls.length, 1);
  assert.equal(a.state.calls[0]?.headers.authorization, undefined);
  assert.equal(b.state.calls.length, 0);
  a.state.failures.set("/api/auth/me", { status: 503, body: "private details" });
  assert.equal(z.object({ backendReachable: z.boolean() }).parse((await jsonRequest(baseUrl, "/health?tenantId=otra-empresa", "GET", undefined, null)).data).backendReachable, true);
  assert.equal(a.state.calls.length, 1);
  assert.deepEqual((await jsonRequest(baseUrl, "/health", "GET", undefined, null)).data, { ok: true, backendReachable: false });
  a.state.calls.length = b.state.calls.length = 0;
  for (const tenantId of ["missing", "disabled"]) {
    const result = await jsonRequest(baseUrl, `/health?tenantId=${tenantId}`, "GET", undefined, null);
    assert.equal(result.response.status, 404);
    assert.equal(errorCode(result.data), "TENANT_NOT_FOUND");
  }
  for (const query of ["tenantOrigin=http://attacker.invalid", "tenantId=grupo-eliseo-local&tenantId=otra-empresa", "tenantId=grupo-eliseo-local&backendUrl=http://attacker.invalid"]) {
    assert.equal((await jsonRequest(baseUrl, `/health?${query}`, "GET", undefined, null)).response.status, 400);
  }
  assert.equal(a.state.calls.length + b.state.calls.length, 0);
});

test("same upstream token and user/worker/work IDs create independent opaque sessions with isolated reads and writes", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const loginA = await loginGateway(baseUrl, "grupo-eliseo-local");
  const loginB = await loginGateway(baseUrl, "otra-empresa");
  assert.notEqual(loginA.token, loginB.token);
  for (const [login, backend, tenantId] of [[loginA, a, "grupo-eliseo-local"], [loginB, b, "otra-empresa"]] as const) {
    assert.match(login.token, /^Bearer qzm_[A-Za-z0-9_-]{43}$/);
    assert.equal(tenantOf(login.data).id, tenantId);
    assert.deepEqual(login.data, { ...loginResultSchema.parse(login.data), tenant: tenantOf(login.data) });
    assert.deepEqual(backend.state.calls[0]?.json, credentials);
    assert.equal(backend.state.calls[0]?.headers.authorization, undefined);
    assert.doesNotMatch(JSON.stringify(login.data), /test-token|backendUrl|defaultModule|internal/);
  }
  const meA = await jsonRequest(baseUrl, "/api/auth/me?companyBranchId=1", "GET", undefined, loginA.token);
  const meB = await jsonRequest(baseUrl, "/api/auth/me?companyBranchId=1", "GET", undefined, loginB.token);
  assert.equal(userSchema.parse(meA.data).system.name, a.state.branding);
  assert.equal(userSchema.parse(meB.data).system.name, b.state.branding);
  assert.equal(userSchema.parse(meA.data).id, userSchema.parse(meB.data).id);
  assert.equal(userSchema.parse(meA.data).workerId, userSchema.parse(meB.data).workerId);
  assert.equal(tenantOf(meA.data).id, "grupo-eliseo-local");
  assert.equal(tenantOf(meB.data).id, "otra-empresa");
  a.state.calls.length = b.state.calls.length = 0;
  const readsA = await withTenant(baseUrl, listPath, loginA.token, "grupo-eliseo-local");
  assert.equal(readsA.response.status, 200);
  assert.equal(assignmentsSchema.parse(readsA.data).groups[0]?.works[0]?.title, "Tarea exclusiva A");
  assert.equal(b.state.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(readsA.data), /exclusiva B|Otraempresa|otra-empresa/);
  assert.equal((await jsonRequest(baseUrl, workPath("/status"), "POST", { status: "paused" }, loginA.token)).response.status, 200);
  assert.equal((await jsonRequest(baseUrl, workPath("/report"), "POST", { note: "Reporte A" }, loginA.token)).response.status, 200);
  assert.equal((await uploadRequest(baseUrl, workPath("/files"), form(), loginA.token)).response.status, 201);
  assert.equal((await jsonRequest(baseUrl, workPath("/files"), "GET", undefined, loginA.token)).response.status, 200);
  assert.equal(b.state.calls.length, 0);
  assert.equal(writeCalls(a.state).length, 3);
  const countA = a.state.calls.length;
  const readsB = await jsonRequest(baseUrl, listPath, "GET", undefined, loginB.token);
  assert.equal(assignmentsSchema.parse(readsB.data).groups[0]?.works[0]?.title, "Tarea exclusiva B");
  assert.doesNotMatch(JSON.stringify(readsB.data), /exclusiva A|Grupoeliseo|grupo-eliseo-local/);
  assert.equal((await jsonRequest(baseUrl, workPath("/report"), "POST", { note: "Reporte B" }, loginB.token)).response.status, 200);
  assert.equal(a.state.calls.length, countA);
  assert.equal(writeCalls(b.state).length, 1);
  for (const [backend, origin] of [[a, "http://localhost:3000"], [b, "http://other.localhost:3000"]] as const) {
    for (const call of backend.state.calls) {
      assert.equal(call.headers.authorization, TOKEN);
      assert.equal(call.headers.origin, origin);
      assert.equal(call.headers["x-qualitzer-tenant"], undefined);
      assert.doesNotMatch(JSON.stringify(call.json ?? {}), /qzm_|tenantId|backendUrl|tenantOrigin/);
    }
  }
});

test("tenant header mismatch or unknown tenant rejects every protected route before upstream, including multipart", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const { token } = await loginGateway(baseUrl, "grupo-eliseo-local");
  a.state.calls.length = 0;
  for (const tenant of ["otra-empresa", "unknown", "disabled"]) {
    for (const [path, method, body] of [
      ["/api/auth/me", "GET", undefined], ["/api/auth/logout", "POST", {}], ["/api/auth/forced_password", "PATCH", password],
      [listPath, "GET", undefined], [workPath("/files"), "GET", undefined], [workPath("/status"), "POST", { status: "paused" }],
      [workPath("/steps/101"), "PATCH", {}], [workPath("/report"), "POST", { note: "No escribir" }],
    ] as const) {
      const result = await withTenant(baseUrl, path, token, tenant, method, body);
      assert.equal(result.response.status, 409);
      assert.equal(errorCode(result.data), "TENANT_SESSION_MISMATCH");
    }
    for (const suffix of ["/files", "/steps/101/files"]) {
      const response = await fetch(`${baseUrl}${workPath(suffix)}`, { method: "POST", headers: { Authorization: token, "X-Qualitzer-Tenant": tenant }, body: form() });
      assert.equal(response.status, 409);
      assert.equal(errorCode(await response.json()), "TENANT_SESSION_MISMATCH");
    }
  }
  for (const tenant of ["GRUPO-ELISEO-LOCAL", "grupo-eliseo-local, grupo-eliseo-local", ""]) {
    assert.equal((await withTenant(baseUrl, "/api/auth/me", token, tenant)).response.status, 409);
  }
  assert.equal(a.state.calls.length + b.state.calls.length, 0);
  assert.equal((await withTenant(baseUrl, "/api/auth/me", token, "grupo-eliseo-local")).response.status, 200);
});

test("query, JSON and multipart routing overrides are rejected rather than used for dispatch", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const { token } = await loginGateway(baseUrl, "grupo-eliseo-local");
  a.state.loginNextStep = "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  const { token: forcedToken } = await loginGateway(baseUrl, "grupo-eliseo-local");
  a.state.calls.length = 0;
  for (const [key, value] of [["tenantId", "otra-empresa"], ["tenantOrigin", "http://other.localhost:3000"], ["backendUrl", b.backendUrl], ["tenant", "otra-empresa"]]) {
    for (const path of [listPath, workPath("/files"), "/api/auth/me?companyBranchId=1"]) {
      assert.equal((await jsonRequest(baseUrl, `${path}&${key}=${encodeURIComponent(value!)}`, "GET", undefined, token)).response.status, 400);
    }
    for (const [path, method, body] of [[workPath("/report"), "POST", { note: "No" }], ["/api/auth/logout", "POST", {}], ["/api/auth/forced_password", "PATCH", password]] as const) {
      assert.equal((await jsonRequest(baseUrl, path, method, { ...body, [key!]: value }, path === "/api/auth/forced_password" ? forcedToken : token)).response.status, 400);
    }
    const body = form();
    body.set(key!, value!);
    assert.equal((await uploadRequest(baseUrl, workPath("/files"), body, token)).response.status, 400);
  }
  assert.equal(writeCalls(a.state).length, 0);
  assert.equal(b.state.calls.length, 0);
});

test("raw backend bearer, invented opaque tokens and sessions from another gateway instance are denied", async (t) => {
  const { a, b, baseUrl, tenants } = await multiTenantHarness(t);
  const { token } = await loginGateway(baseUrl, "grupo-eliseo-local");
  const restarted = await gatewayHarness(t, { tenants });
  a.state.calls.length = 0;
  for (const stale of [TOKEN, `Bearer qzm_${"a".repeat(43)}`, token]) {
    const target = stale === token ? restarted.baseUrl : baseUrl;
    const response = await fetch(`${target}${listPath}`, { headers: { Authorization: stale } });
    assert.equal(response.status, 401);
    assert.equal(errorCode(await response.json()), "UNAUTHORIZED");
  }
  assert.equal(a.state.calls.length + b.state.calls.length, 0);
  const fresh = await loginGateway(restarted.baseUrl, "grupo-eliseo-local");
  assert.notEqual(fresh.token, token);
  assert.equal((await jsonRequest(restarted.baseUrl, "/api/auth/me", "GET", undefined, token)).response.status, 401);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, fresh.token)).response.status, 401);
});

test("forced password sessions cannot access data and rotate without changing tenant or reviving old tokens", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  a.state.loginNextStep = "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  a.state.forcedNextStep = "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  const loginA = await loginGateway(baseUrl, "grupo-eliseo-local");
  const loginB = await loginGateway(baseUrl, "otra-empresa");
  assert.equal(loginResultSchema.parse(loginA.data).nextStep, a.state.loginNextStep);
  a.state.calls.length = b.state.calls.length = 0;
  for (const [path, method, body] of [
    ["/api/auth/me", "GET", undefined], [listPath, "GET", undefined], [workPath("/files"), "GET", undefined],
    [workPath("/status"), "POST", { status: "paused" }], [workPath("/steps/101"), "PATCH", {}], [workPath("/report"), "POST", { note: "No" }],
  ] as const) {
    const result = await jsonRequest(baseUrl, path, method, body, loginA.token);
    assert.equal(result.response.status, 403);
    assert.equal(errorCode(result.data), "PASSWORD_CHANGE_REQUIRED");
  }
  for (const suffix of ["/files", "/steps/101/files"]) assert.equal((await uploadRequest(baseUrl, workPath(suffix), form(), loginA.token)).response.status, 403);
  assert.equal(a.state.calls.length + b.state.calls.length, 0);
  a.state.failures.set("/api/auth/forced_password", { status: 400, body: "secret" });
  assert.equal((await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, loginA.token)).response.status, 400);
  a.state.failures.clear();
  const first = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, loginA.token);
  const secondToken = `Bearer ${loginResultSchema.parse(first.data).token}`;
  assert.notEqual(secondToken, loginA.token);
  assert.equal(tenantOf(first.data).id, "grupo-eliseo-local");
  assert.equal((await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, loginA.token)).response.status, 401);
  assert.equal((await jsonRequest(baseUrl, listPath, "GET", undefined, secondToken)).response.status, 403);
  a.state.forcedNextStep = "DONE";
  const second = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, secondToken);
  const finalToken = `Bearer ${loginResultSchema.parse(second.data).token}`;
  assert.notEqual(finalToken, secondToken);
  assert.equal(loginResultSchema.parse(second.data).nextStep, "DONE");
  assert.equal((await jsonRequest(baseUrl, listPath, "GET", undefined, secondToken)).response.status, 401);
  const calls = a.state.calls.length + b.state.calls.length;
  const denied = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, finalToken);
  assert.equal(denied.response.status, 403);
  assert.deepEqual(denied.data, { error: "PASSWORD_CHANGE_NOT_REQUIRED" });
  assert.equal(a.state.calls.length + b.state.calls.length, calls);
  assert.equal((await jsonRequest(baseUrl, listPath, "GET", undefined, finalToken)).response.status, 200);
  for (const [token, backend] of [[finalToken, a], [loginB.token, b]] as const) {
    const me = await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token);
    assert.equal(me.response.status, 200);
    assert.deepEqual(userSchema.parse(me.data), backend.state.user);
  }
  assert.ok(a.state.calls.filter((call) => call.method === "PATCH").every((call) => call.headers.authorization === TOKEN));
});

test("logout revokes locally even on upstream failure and never revokes the other tenant's identical backend token", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  a.state.loginNextStep = "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  const loginA = await loginGateway(baseUrl, "grupo-eliseo-local");
  const loginB = await loginGateway(baseUrl, "otra-empresa");
  a.state.failures.set("/api/auth/logout", { status: 500, body: "private details" });
  a.state.calls.length = b.state.calls.length = 0;
  assert.deepEqual((await jsonRequest(baseUrl, "/api/auth/logout", "POST", {}, loginA.token)).data, { success: true });
  assert.equal(a.state.calls.length, 1);
  assert.equal(a.state.calls[0]?.path, "/api/auth/logout");
  assert.equal(a.state.calls[0]?.headers.origin, "http://localhost:3000");
  assert.equal(b.state.calls.length, 0);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, loginA.token)).response.status, 401);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/logout", "POST", {}, loginA.token)).response.status, 401);
  assert.equal(a.state.calls.length, 1);
  assert.equal((await jsonRequest(baseUrl, listPath, "GET", undefined, loginB.token)).response.status, 200);
});

test("upstream 401 on auth, reads, writes and uploads revokes only the matching opaque session", async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const loginB = await loginGateway(baseUrl, "otra-empresa");
  for (const [upstream, path, method, body] of [
    ["/api/auth/me", "/api/auth/me", "GET", undefined],
    ["/api/technician-dashboard/assignments", listPath, "GET", undefined],
    ["/api/work_files/11", workPath("/files"), "GET", undefined],
    ["/api/works/comments/11", workPath("/report"), "POST", { note: "No" }],
    ["/api/work_files/11", workPath("/files"), "UPLOAD", undefined],
    ["/api/auth/forced_password", "/api/auth/forced_password", "PATCH", password],
  ] as const) {
    a.state.loginNextStep = path === "/api/auth/forced_password" ? "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" : "DONE";
    const { token } = await loginGateway(baseUrl, "grupo-eliseo-local");
    a.state.failures.set(upstream, { status: 401, body: "secret" });
    const result = method === "UPLOAD" ? await uploadRequest(baseUrl, path, form(), token) : await jsonRequest(baseUrl, path, method, body, token);
    assert.equal(result.response.status, 401);
    assert.deepEqual(result.data, { error: "UNAUTHORIZED" });
    a.state.failures.clear();
    a.state.calls.length = 0;
    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token)).response.status, 401);
    assert.equal(a.state.calls.length, 0);
  }
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, loginB.token)).response.status, 200);
  assert.equal(b.state.calls.filter((call) => call.path === "/api/auth/logout").length, 0);
});

test("mutation locks are per tenant, but identical work IDs remain locked inside the same tenant", { timeout: 5000 }, async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const loginA = await loginGateway(baseUrl, "grupo-eliseo-local");
  const loginB = await loginGateway(baseUrl, "otra-empresa");
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  a.state.beforeResponse = async (call) => {
    if (call.path === "/api/works/comments/11") { enter(); await blocked; }
  };
  const pending = jsonRequest(baseUrl, workPath("/report"), "POST", { note: "A bloqueada" }, loginA.token);
  try {
    await entered;
    const sameTenant = await jsonRequest(baseUrl, workPath("/report"), "POST", { note: "A simultánea" }, loginA.token);
    assert.equal(sameTenant.response.status, 409);
    assert.equal(errorCode(sameTenant.data), "WORK_MUTATION_IN_PROGRESS");
    assert.equal((await jsonRequest(baseUrl, workPath("/report"), "POST", { note: "B independiente" }, loginB.token)).response.status, 200);
    assert.equal(b.state.calls.filter((call) => call.path === "/api/works/comments/11").length, 1);
  } finally { release(); assert.equal((await pending).response.status, 200); }
});

test("CORS explicitly allows the optional tenant assertion header", async (t) => {
  const { baseUrl, a, b } = await multiTenantHarness(t);
  const response = await fetch(`${baseUrl}/api/assignments`, { method: "OPTIONS", headers: {
    Origin: "http://localhost:8081", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,x-qualitzer-tenant",
  } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /X-Qualitzer-Tenant/i);
  assert.equal(a.state.calls.length + b.state.calls.length, 0);
});

test("explicit empty and disabled-only registries never fall back to the environment tenant", async (t) => {
  const backend = await mockBackend(t);
  const disabled: TenantConfig = { id: "disabled", name: "No visible", backendUrl: backend.backendUrl, tenantOrigin: "http://localhost:3000", environment: "development", enabled: false };
  for (const tenants of [[], [disabled]]) {
    const { baseUrl } = await gatewayHarness(t, { tenants, backendUrl: backend.backendUrl });
    assert.deepEqual((await jsonRequest(baseUrl, "/api/tenants", "GET", undefined, null)).data, { data: [] });
    assert.deepEqual((await jsonRequest(baseUrl, "/health", "GET", undefined, null)).data, { ok: true, backendReachable: false });
    assert.equal((await jsonRequest(baseUrl, "/api/auth/login", "POST", { ...credentials, tenantId: "local" }, null)).response.status, 404);
  }
  assert.equal(backend.state.calls.length, 0);
});

test("the two concurrent upload slots remain global across tenant-specific routers", { timeout: 5000 }, async (t) => {
  const { a, b, baseUrl } = await multiTenantHarness(t);
  const loginA = await loginGateway(baseUrl, "grupo-eliseo-local");
  const loginB = await loginGateway(baseUrl, "otra-empresa");
  let enter!: () => void;
  let release!: () => void;
  let count = 0;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const beforeResponse: NonNullable<typeof a.state.beforeResponse> = async (call) => {
    if (call.path === "/api/work_files/11" && call.method === "POST") {
      count += 1;
      if (count === 2) enter();
      await blocked;
    }
  };
  a.state.beforeResponse = b.state.beforeResponse = beforeResponse;
  const uploads = [uploadRequest(baseUrl, workPath("/files"), form(), loginA.token), uploadRequest(baseUrl, workPath("/files"), form(), loginB.token)];
  try {
    await entered;
    const rejected = await uploadRequest(baseUrl, workPath("/files"), form(), loginA.token);
    assert.equal(rejected.response.status, 429);
    assert.equal(errorCode(rejected.data), "UPLOAD_BUSY");
  } finally {
    release();
    for (const result of await Promise.all(uploads)) assert.equal(result.response.status, 201);
  }
  assert.equal((await uploadRequest(baseUrl, workPath("/files"), form(), loginB.token)).response.status, 201);
});