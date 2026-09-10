import assert from "node:assert/strict";
import { test } from "node:test";
import { request, type Request } from "express";
import { z } from "zod";
import { createApp } from "../app";
import { AssignmentService } from "../assignments/service";
import { resolveConfig } from "../config";
import { assignmentsSchema, filesSchema, loginResultSchema, userSchema } from "../contracts";
import { MOBILE_USER_AGENT, Upstream } from "../upstream";
import { assignments, group, PNG, RANGE, step, TOKEN, user, work } from "./fixtures";
import { assignmentCalls, errorCode, form, gatewayToken, harness, jsonRequest, loginGateway, uploadRequest, writeCalls } from "./mock-upstream";

const base = "/api/assignments/direct-11/works/11";
const maintenanceBase = "/api/assignments/maintenance-50/works/7";
const path = (suffix: string) => `${base}${suffix}?${RANGE}`;
const maintenancePath = (suffix: string) => `${maintenanceBase}${suffix}?${RANGE}`;
const completion = { status: "completed", executionStartTime: "08:00", executionEndTime: "09:00", executionDates: ["2026-09-01"], endDateOffset: 0 };
const answer = { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: "Revisión" };
const password = { newPassword: "NewPassword42!", confirmPassword: "NewPassword42!", remember: false };

function mutationRequest(groupId = "direct-11", workId = "11", token = TOKEN, companyBranchId = "1"): Request {
  return Object.create(request, {
    headers: { value: { authorization: token }, enumerable: true },
    params: { value: { groupId, workId }, enumerable: true },
    query: { value: { ...Object.fromEntries(new URLSearchParams(RANGE)), companyBranchId }, enumerable: true },
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("health treats missing bearer 401 as reachable; auth uses real shapes and fixed mobile headers", async (t) => {
  const { state, baseUrl } = await harness(t, { login: false });
  const health = await jsonRequest(baseUrl, "/health", "GET", undefined, null);
  assert.deepEqual(health.data, { ok: true, backendReachable: true });
  assert.equal(state.calls[0]?.headers.authorization, undefined);
  state.loginNextStep = "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:8081", "User-Agent": "Desktop", "X-Tenant-Origin": "https://attacker.invalid", "X-Backend-Url": "https://attacker.invalid" },
    body: JSON.stringify({ tenantId: "local", username: "test", password: "password", remember: true }),
  });
  const loginData: unknown = await login.json();
  assert.equal(login.status, 200);
  assert.deepEqual(loginData, { ...loginResultSchema.parse(loginData), tenant: { id: "local", name: "Entorno local", portalOrigin: "http://localhost:3000", environment: "development" } });
  assert.match(loginResultSchema.parse(loginData).token, /^qzm_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(loginResultSchema.parse(loginData).token, TOKEN.slice(7));
  assert.equal(loginResultSchema.parse(loginData).nextStep, "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED");
  assert.deepEqual(state.calls.find((call) => call.path === "/api/auth/login")?.json, { username: "test", password: "password", remember: true });
  const forced = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, `Bearer ${loginResultSchema.parse(loginData).token}`);
  assert.equal(forced.response.status, 200);
  assert.equal(loginResultSchema.parse(forced.data).nextStep, "DONE");
  assert.notEqual(loginResultSchema.parse(forced.data).token, loginResultSchema.parse(loginData).token);
  const me = await jsonRequest(baseUrl, "/api/auth/me?companyBranchId=1");
  assert.deepEqual(userSchema.parse(me.data), state.user);
  assert.equal(userSchema.parse(me.data).workerId, 42);
  assert.equal(userSchema.parse(me.data).role.isTechnician, false);
  assert.deepEqual((await jsonRequest(baseUrl, "/api/auth/logout", "POST")).data, { success: true });
  for (const call of state.calls) {
    assert.equal(call.headers.origin, "http://localhost:3000");
    assert.equal(call.headers["user-agent"], MOBILE_USER_AGENT);
    assert.equal(call.headers["x-tenant-origin"], undefined);
    assert.equal(call.headers["x-backend-url"], undefined);
  }
  assert.equal(login.headers.get("access-control-allow-origin"), "http://localhost:8081");
  assert.equal(login.headers.get("x-content-type-options"), "nosniff");
  assert.equal(login.headers.get("cache-control"), "no-store");
  assert.equal(login.headers.get("x-powered-by"), null);
});

test("DONE sessions cannot force a password change or reach upstream and keep their user fields unchanged", async (t) => {
  const { baseUrl, state } = await harness(t);
  const token = gatewayToken(baseUrl);
  const expectedUser = structuredClone(state.user);
  const denied = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, token);
  assert.equal(denied.response.status, 403);
  assert.deepEqual(denied.data, { error: "PASSWORD_CHANGE_NOT_REQUIRED" });
  assert.equal(state.calls.length, 0);
  assert.equal(gatewayToken(baseUrl), token);
  const me = await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, token);
  assert.equal(me.response.status, 200);
  assert.deepEqual(userSchema.parse(me.data), expectedUser);
  assert.deepEqual(state.user, expectedUser);
});

test("concurrent forced password changes lock only the session key and never reuse a rotated token upstream", { timeout: 5000 }, async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  state.loginNextStep = "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  const login = await loginGateway(baseUrl);
  const other = await loginGateway(baseUrl);
  const expectedUser = structuredClone(state.user);
  const entered = deferred();
  const release = deferred();
  let changes = 0;
  state.calls.length = 0;
  state.beforeResponse = async (call) => {
    if (call.path === "/api/auth/forced_password") {
      changes += 1;
      if (changes === 1) { entered.resolve(); await release.promise; }
    }
  };
  const pending = jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, login.token);
  let rotatedToken = "";
  try {
    await entered.promise;
    const duplicate = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, login.token);
    assert.equal(duplicate.response.status, 409);
    assert.deepEqual(duplicate.data, { error: "PASSWORD_CHANGE_IN_PROGRESS" });
    assert.equal(state.calls.length, 1);
    const independent = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, other.token);
    assert.equal(independent.response.status, 200);
    assert.equal(loginResultSchema.parse(independent.data).nextStep, "DONE");
    assert.equal(changes, 2);
  } finally {
    release.resolve();
    const completed = await pending;
    assert.equal(completed.response.status, 200);
    assert.equal(loginResultSchema.parse(completed.data).nextStep, "DONE");
    rotatedToken = `Bearer ${loginResultSchema.parse(completed.data).token}`;
  }
  assert.notEqual(rotatedToken, login.token);
  const calls = state.calls.length;
  const stale = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, login.token);
  assert.equal(stale.response.status, 401);
  assert.deepEqual(stale.data, { error: "UNAUTHORIZED" });
  const done = await jsonRequest(baseUrl, "/api/auth/forced_password", "PATCH", password, rotatedToken);
  assert.equal(done.response.status, 403);
  assert.deepEqual(done.data, { error: "PASSWORD_CHANGE_NOT_REQUIRED" });
  assert.equal(state.calls.length, calls);
  assert.equal(changes, 2);
  const me = await jsonRequest(baseUrl, "/api/auth/me", "GET", undefined, rotatedToken);
  assert.equal(me.response.status, 200);
  assert.deepEqual(userSchema.parse(me.data), expectedUser);
  assert.deepEqual(state.user, expectedUser);
});

test("every resource route rejects unauthenticated calls before touching upstream", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const [route, method, body] of [
    [`/api/assignments?${RANGE}`, "GET", undefined], [path("/files"), "GET", undefined],
    [path("/status"), "POST", completion], [path("/steps/101"), "PATCH", answer],
    [path("/report"), "POST", { note: "Reporte" }],
    [maintenancePath("/report"), "POST", { note: "Reporte" }],
  ] as const) {
    const result = await jsonRequest(baseUrl, route, method, body, null);
    assert.equal(result.response.status, 401);
    assert.equal(errorCode(result.data), "UNAUTHORIZED");
  }
  for (const suffix of ["/files", "/steps/101/files"]) {
    assert.equal((await uploadRequest(baseUrl, path(suffix), form(), null)).response.status, 401);
  }
  assert.equal(state.calls.length, 0);
});

test("branch membership cannot be bypassed by query, disabled branch or workerless admin", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const route of [`/api/assignments?${RANGE.replace("companyBranchId=1", "companyBranchId=2")}`, "/api/auth/me?companyBranchId=2"]) {
    const result = await jsonRequest(baseUrl, route);
    assert.equal(result.response.status, 403);
    assert.equal(errorCode(result.data), "BRANCH_FORBIDDEN");
  }
  assert.equal(assignmentCalls(state).length, 0);
  state.user.accessBranchs = [{ id: 1, name: "Deshabilitada", main: true, isEnabled: false }];
  assert.equal((await jsonRequest(baseUrl, path("/files"))).response.status, 403);
  state.user.accessBranchs[0]!.isEnabled = true;
  state.user.workerId = null;
  assert.equal(errorCode((await jsonRequest(baseUrl, path("/files"))).data), "WORKER_REQUIRED");
  assert.equal(assignmentCalls(state).length, 0);
});

test("strict real ISO range, positive single branch and unknown query rejection", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const range of [
    "startDate=2026-02-30&endDate=2026-03-02&companyBranchId=1",
    "startDate=2025-02-29&endDate=2025-03-02&companyBranchId=1",
    "startDate=2026-09-08&endDate=2026-09-01&companyBranchId=1",
    "startDate=2026-09-01&endDate=2026-10-02&companyBranchId=1",
    RANGE.replace("companyBranchId=1", "companyBranchId=0"),
    RANGE.replace("companyBranchId=1", "companyBranchId=1e0"),
    `${RANGE}&companyBranchId=2`, `${RANGE}&workerId=42`, `${RANGE}&target=https://attacker.invalid`,
  ]) assert.equal((await jsonRequest(baseUrl, `/api/assignments?${range}`)).response.status, 400);
  assert.equal(state.calls.length, 0);
  assert.equal((await jsonRequest(baseUrl, "/api/assignments?startDate=2026-09-01&endDate=2026-10-01&companyBranchId=1")).response.status, 200);
  assert.deepEqual(Object.fromEntries(assignmentCalls(state)[0]!.query), { startDate: "2026-09-01", endDate: "2026-10-01", companyBranchId: "1" });
});

test("assignment allowlist strips nested finances without refiltering canonical works by responsibles", async (t) => {
  const { baseUrl, state } = await harness(t);
  const own = work();
  state.invalidAssignments = {
    ...assignments(), salary: 1000,
    groups: [{ ...group(), internalCosts: 123, works: [
      { ...own, netCostHH: 12, price: 45, materials: [{ ...own.materials[0], costPrice: 25, netSalePrice: 100 }], responsibles: [{ id: 42, name: "Técnico", salary: 100 }] },
      work({ id: "12", title: "Asignado por actividad", responsibles: [{ id: 84, name: "Otro" }] }),
    ] }],
  };
  const result = await jsonRequest(baseUrl, `/api/assignments?${RANGE}`);
  const data = assignmentsSchema.parse(result.data);
  assert.equal(result.response.status, 200);
  assert.equal(data.summary.totalWorks, 2);
  assert.equal(data.summary.plannedMinutes, 120);
  assert.deepEqual(data.groups[0]?.works.map((item) => item.id), ["11", "12"]);
  assert.equal(data.groups[0]?.works[0]?.activities?.[0]?.technicalDocuments[0]?.documentName, "Manual");
  assert.equal(data.groups[0]?.works[0]?.workEquipment?.identifier, "M-1");
  assert.equal(data.groups[0]?.works[0]?.systemName, "Motor");
  assert.equal(data.groups[0]?.works[0]?.elapsedSeconds, 1200);
  assert.equal(data.groups[0]?.canManage, false);
  assert.equal(data.groups[0]?.works[0]?.canEditDefinition, false);
  assert.doesNotMatch(JSON.stringify(result.data), /netCost|costPrice|netSalePrice|salary|internalCosts|"price"/);
});

test("IDOR checks exact group, work and step; fresh ownership is required on every request", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ works: [work()] })]);
  for (const suffix of ["/files", "/status", "/report", "/steps/101"]) {
    const method = suffix === "/files" ? "GET" : suffix.includes("steps") ? "PATCH" : "POST";
    const body = method === "GET" ? undefined : suffix === "/status" ? completion : suffix === "/report" ? { note: "Reporte" } : answer;
    assert.equal((await jsonRequest(baseUrl, path(suffix).replace("/works/11", "/works/12"), method, body)).response.status, 404);
  }
  assert.equal((await jsonRequest(baseUrl, path("/files").replace("direct-11", "external-11"))).response.status, 404);
  assert.equal((await jsonRequest(baseUrl, path("/steps/999"), "PATCH", answer)).response.status, 404);
  assert.equal((await jsonRequest(baseUrl, path("/files"))).response.status, 200);
  state.assignments.groups[0]!.works = [];
  assert.equal((await jsonRequest(baseUrl, path("/files"))).response.status, 404);
  assert.equal(writeCalls(state).length, 0);
});

test("maintenance products use all canonical works and canonical nonproductive works remain visible", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([
    group({ id: "maintenance-50", type: "internal_maintenance", products: [{ id: "secret", name: "Privado", quantity: 100, ref: null, stockStatus: "requested" }], works: [work({ id: "7" }), work({ id: "8", responsibles: [] })] }),
    group({ id: "direct-np-90", works: [work({ id: "90", workType: "non_productive", responsibles: [] })] }),
  ]);
  const result = assignmentsSchema.parse((await jsonRequest(baseUrl, `/api/assignments?${RANGE}`)).data);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0]?.works.length, 2);
  assert.deepEqual(result.groups[0]?.products, [...work().materials, ...work().materials]);
  assert.equal(result.groups[1]?.works[0]?.id, "90");
});

test("source crossover and caller-controlled identifiers are rejected", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group(), group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] })]);
  assert.equal((await jsonRequest(baseUrl, `${maintenanceBase.replace("/works/7", "/works/11")}/files?${RANGE}`)).response.status, 404);
  for (const extra of [{ sourceType: "maintenance" }, { maintenanceWorkId: 7 }, { workId: 7 }, { finalizeAll: true }, { finalizeAllDays: true }, { workerId: 84 }]) {
    assert.equal((await jsonRequest(baseUrl, path("/status"), "POST", { ...completion, ...extra })).response.status, 400);
  }
  state.assignments.groups[0]!.type = "internal_maintenance";
  assert.equal(errorCode((await jsonRequest(baseUrl, path("/files"))).data), "UPSTREAM_INVALID_SOURCE");
  assert.equal(writeCalls(state).length, 0);
});

test("standard mutations share a lock across groups and branches and release it after success or failure", { timeout: 5000 }, async (t) => {
  const { backendUrl, state } = await harness(t);
  state.assignments = assignments([group(), group({ id: "external-300", type: "external_ot" })]);
  state.user.accessBranchs.push({ id: 2, name: "Segunda", main: false });
  const service = new AssignmentService(new Upstream(resolveConfig({ backendUrl })));
  const req = mutationRequest();
  const entered = deferred();
  const release = deferred();
  const blockedOperation = t.mock.fn(async () => {});
  const first = service.mutate(req, async () => { entered.resolve(); await release.promise; });
  try {
    await entered.promise;
    for (const concurrent of [req, mutationRequest("external-300"), mutationRequest("direct-11", "11", TOKEN, "2")]) {
      await assert.rejects(service.mutate(concurrent, blockedOperation), { status: 409, code: "WORK_MUTATION_IN_PROGRESS" });
    }
    assert.equal(blockedOperation.mock.callCount(), 0);
  } finally { release.resolve(); await first; }
  await assert.rejects(service.mutate(req, async () => { throw new Error("MUTATION_FAILED"); }), { message: "MUTATION_FAILED" });
  const nextOperation = t.mock.fn(async () => {});
  await service.mutate(req, nextOperation);
  assert.equal(nextOperation.mock.callCount(), 1);
});

test("maintenance and standard mutations with the same work ID have independent locks", { timeout: 5000 }, async (t) => {
  const { backendUrl, state } = await harness(t);
  state.assignments = assignments([group(), group({ id: "maintenance-50", type: "internal_maintenance", works: [work()] })]);
  const service = new AssignmentService(new Upstream(resolveConfig({ backendUrl })));
  const entered = deferred();
  const release = deferred();
  const standard = service.mutate(mutationRequest(), async () => { entered.resolve(); await release.promise; });
  const maintenanceReq = mutationRequest("maintenance-50");
  const blockedOperation = t.mock.fn(async () => {});
  const maintenanceOperation = t.mock.fn(async () => {
    await assert.rejects(service.mutate(maintenanceReq, blockedOperation), { status: 409, code: "WORK_MUTATION_IN_PROGRESS" });
  });
  try {
    await entered.promise;
    await service.mutate(maintenanceReq, maintenanceOperation);
    assert.equal(maintenanceOperation.mock.callCount(), 1);
    assert.equal(blockedOperation.mock.callCount(), 0);
  } finally { release.resolve(); await standard; }
});

test("a foreign user's pending authorization cannot lock an owner's work or observe its busy lock", { timeout: 5000 }, async (t) => {
  const upstream = new Upstream(resolveConfig({}));
  const service = new AssignmentService(upstream);
  const foreignToken = "Bearer other-token";
  const data = assignments();
  const entered = deferred();
  const release = deferred();
  const writes: string[] = [];
  t.mock.method(upstream, "request", async (...[path, options]: Parameters<Upstream["request"]>): Promise<unknown> => {
    const foreign = options?.token === foreignToken;
    if (path === "/auth/me") return foreign ? { ...user(), id: 18, workerId: 84, name: "Otro" } : user();
    if (path === "/technician-dashboard/assignments") {
      if (foreign) {
        entered.resolve();
        await release.promise;
        return { ...assignments([]), technician: { ...data.technician, id: 84 } };
      }
      return data;
    }
    if (path === "/technician-dashboard/update-work-status") {
      assert.equal(options?.token, TOKEN);
      writes.push(path);
      return { success: true };
    }
    throw new Error("UNEXPECTED_UPSTREAM_REQUEST");
  });
  const ownerReq = Object.assign(mutationRequest(), { body: { status: "paused" } });
  const foreignReq = Object.assign(mutationRequest("direct-11", "11", foreignToken), { body: { status: "paused" } });
  const foreignOperation = t.mock.fn(async () => service.status(foreignReq));
  const rejected = assert.rejects(service.mutate(foreignReq, foreignOperation), { status: 404, code: "ASSIGNMENT_NOT_FOUND" });
  try {
    await entered.promise;
    await service.mutate(ownerReq, () => service.status(ownerReq));
  } finally { release.resolve(); await rejected; }
  await service.mutate(ownerReq, async () => {
    await assert.rejects(service.mutate(foreignReq, foreignOperation), { status: 404, code: "ASSIGNMENT_NOT_FOUND" });
  });
  assert.equal(foreignOperation.mock.callCount(), 0);
  assert.deepEqual(writes, ["/technician-dashboard/update-work-status"]);
});

test("status permits finalization with an existing timer and honors canExecute", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const [previous, next, expected] of [
    ["pending", "completed", 200], ["pending", "paused", 409], ["pending", "in_progress", 200],
    ["in_progress", "paused", 200], ["paused", "in_progress", 200], ["in_progress", "in_progress", 409],
    ["completed", "in_progress", 409], ["delivered", "paused", 409], ["in_progress", "pending", 400], ["in_progress", "delivered", 200],
  ] as const) {
    state.assignments = assignments([group({ works: [work({ status: previous })] })]);
    assert.equal((await jsonRequest(baseUrl, path("/status"), "POST", { status: next })).response.status, expected);
  }
  state.assignments = assignments([group({ works: [work({ status: "pending", canExecute: false })] })]);
  assert.equal(errorCode((await jsonRequest(baseUrl, path("/status"), "POST", { status: "in_progress" })).data), "WORK_CANNOT_EXECUTE");
});

test("standard completion without explicit times derives timing from the confirmed timer", async (t) => {
  const { baseUrl, state } = await harness(t);
  const result = await jsonRequest(baseUrl, path("/status"), "POST", { status: "completed" });
  assert.equal(result.response.status, 200);
  assert.equal(writeCalls(state).length, 1);
  assert.equal(writeCalls(state)[0]?.path, "/api/technician-dashboard/update-work-status");
  assert.deepEqual(writeCalls(state)[0]?.json, {
    status: "completed", executionStartTime: "08:00", executionEndTime: "08:20", executionDates: ["2026-09-01"],
    endDateOffset: 0, isManual: false, workId: 11, sourceType: "work",
  });
});

test("standard completion validates explicit times, dates, required checklists and files before a real write", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const input of [
    { status: "completed", executionStartTime: "08:00" }, { status: "completed", executionEndTime: "09:00" },
    { ...completion, executionStartTime: "25:00" },
    { ...completion, executionEndTime: "07:00" }, { ...completion, executionDates: ["2026-08-31"] },
    { ...completion, executionDates: ["2026-09-01", "2026-09-01"] },
    { ...completion, endDateOffset: 31 },
  ]) assert.equal((await jsonRequest(baseUrl, path("/status"), "POST", input)).response.status, 400);
  state.assignments = assignments([group({ works: [work({ checklists: [{ checklistId: 10, name: "Requerida", code: "CHK", required: true, steps: [step()] }] })] })]);
  assert.equal(errorCode((await jsonRequest(baseUrl, path("/status"), "POST", completion)).data), "REQUIRED_CHECKLISTS_INCOMPLETE");
  state.assignments.groups[0]!.works[0]!.checklists[0]!.steps = [step({ selectValue: "approved", isFilesRequired: true })];
  assert.equal(errorCode((await jsonRequest(baseUrl, path("/status"), "POST", completion)).data), "STEP_FILES_REQUIRED");
  state.assignments = assignments([group({ works: [work({ isFilesRequired: true, filesCount: 999 })] })]);
  state.files = { data: [], totalRows: 0, totalPages: 0 };
  assert.equal(errorCode((await jsonRequest(baseUrl, path("/status"), "POST", completion)).data), "WORK_FILES_REQUIRED");
  assert.equal(writeCalls(state).length, 0);
  state.assignments.groups[0]!.works[0]!.isFilesRequired = false;
  assert.equal((await jsonRequest(baseUrl, path("/status"), "POST", completion)).response.status, 200);
  const write = writeCalls(state)[0]!;
  assert.equal(write.path, "/api/technician-dashboard/update-work-status");
  assert.deepEqual(write.json, { ...completion, isManual: true, workId: 11, sourceType: "work" });
});

test("standard manual completion may end after the query boundary without widening execution dates", async (t) => {
  const { baseUrl, state } = await harness(t);
  const overnight = { ...completion, executionDates: ["2026-09-07"], executionStartTime: "23:30", executionEndTime: "01:00", endDateOffset: 1 };
  assert.equal((await jsonRequest(baseUrl, path("/status"), "POST", overnight)).response.status, 200);
  assert.equal(writeCalls(state).length, 1);
  assert.deepEqual(writeCalls(state)[0]?.json, { ...overnight, isManual: true, workId: 11, sourceType: "work" });
  const selectedDayReads = assignmentCalls(state).filter((call) => call.query.get("startDate") === "2026-09-07");
  assert.equal(selectedDayReads.length, 2);
  assert.ok(selectedDayReads.every((call) => call.query.get("endDate") === "2026-09-07"));
});

test("maintenance automatic completion derives source and id and omits manual timing fields", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7", status: "paused" })] })]);
  assert.equal((await jsonRequest(baseUrl, maintenancePath("/status"), "POST", { status: "completed" })).response.status, 200);
  assert.equal(writeCalls(state).length, 1);
  assert.deepEqual(writeCalls(state)[0]?.json, { workId: 7, maintenanceWorkId: 7, sourceType: "maintenance", status: "completed", executionDates: ["2026-09-01"], isManual: false });
  const read = state.calls.find((call) => call.path === "/api/maintenance_files/50")!;
  assert.deepEqual(JSON.parse(read.query.get("filters") ?? "{}"), { companyBranchId: 1, folderId: "maintenance_work_7" });
});

test("maintenance completion honors legacy and explicit manual hours when the branch permits editing", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7", status: "paused" })] })]);
  assert.equal(state.assignments.technician.allowEditExecutionTime, true);
  for (const input of [completion, { ...completion, isManual: true }]) {
    state.calls.length = 0;
    assert.equal((await jsonRequest(baseUrl, maintenancePath("/status"), "POST", input)).response.status, 200);
    assert.equal(writeCalls(state).length, 1);
    assert.equal(writeCalls(state)[0]?.path, "/api/technician-dashboard/update-work-status");
    assert.deepEqual(writeCalls(state)[0]?.json, { ...completion, isManual: true, workId: 7, maintenanceWorkId: 7, sourceType: "maintenance" });
  }
});

test("completion revalidates ownership after its file read", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.sequence = [assignments(), assignments(), assignments(), assignments([group({ works: [] })])];
  const result = await jsonRequest(baseUrl, path("/status"), "POST", completion);
  assert.equal(result.response.status, 404);
  assert.equal(assignmentCalls(state).length, 4);
  assert.equal(writeCalls(state).length, 0);
});

test("external OT work uses standard source rather than treating the group ID as the work", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "external-300", type: "external_ot" })]);
  const result = await jsonRequest(baseUrl, path("/status").replace("direct-11", "external-300"), "POST", { status: "paused" });
  assert.equal(result.response.status, 200);
  assert.deepEqual(writeCalls(state)[0]?.json, { workId: 11, sourceType: "work", status: "paused", executionDates: ["2026-09-01"] });
});

test("checklist answers are type-checked and standard activityId matches verified desktop behavior", async (t) => {
  const { baseUrl, state } = await harness(t);
  const valid = await jsonRequest(baseUrl, path("/steps/101"), "PATCH", answer);
  assert.equal(valid.response.status, 200);
  assert.deepEqual(writeCalls(state)[0]?.json, { ...answer, companyBranchId: 1, activityId: 11 });
  assert.equal(writeCalls(state)[0]?.path, "/api/works/activity-checklist-steps/101");
  for (const body of [{ ...answer, responseValue: "unknown" }, { ...answer, responseValue: true }, { ...answer, activityId: 901 }, { ...answer, responseValue: null }]) {
    assert.equal((await jsonRequest(baseUrl, path("/steps/101"), "PATCH", body)).response.status, 400);
  }
  for (const [type, value, valid] of [
    ["text", "Informe", true], ["text", false, false], ["number", "12.5", true], ["number", "NaN", false],
    ["validation", true, true], ["validation", "not_applicable", true], ["validation", "true", false],
    ["approval", "approved", true], ["approval", "invented", false],
    ["multiselect", [{ value: "approved", label: "Untrusted label" }], true], ["multiselect", [{ value: "unknown", label: "X" }], false],
  ] as const) {
    state.assignments.groups[0]!.works[0]!.checklists[0]!.steps = [step({ type })];
    const input = { ...answer, responseValue: value, ...(type === "validation" && value === "not_applicable" ? { isCompleted: false, executionStatus: null } : {}) };
    assert.equal((await jsonRequest(baseUrl, path("/steps/101"), "PATCH", input)).response.status, valid ? 200 : 400);
    if (type === "validation" && value === "not_applicable") {
      assert.deepEqual(writeCalls(state).at(-1)?.json, { ...answer, responseValue: "not_applicable", isCompleted: false, executionStatus: null, companyBranchId: 1, activityId: 11 });
    }
  }
  const multi = writeCalls(state).at(-1)!;
  assert.deepEqual(z.object({ responseValue: z.array(z.object({ value: z.string(), label: z.string() })) }).parse(multi.json).responseValue, [{ value: "approved", label: "Aprobado" }]);
});

test("maintenance step answers derive workId; completed work blocks every mutation", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] })]);
  assert.equal((await jsonRequest(baseUrl, maintenancePath("/steps/101"), "PATCH", answer)).response.status, 200);
  assert.equal(writeCalls(state)[0]?.path, "/api/maintenances/works/steps/101/response");
  assert.deepEqual(writeCalls(state)[0]?.json, { ...answer, companyBranchId: 1, workId: 7 });
  state.assignments = assignments([group({ works: [work({ status: "completed" })] })]);
  for (const [suffix, method, body] of [["/steps/101", "PATCH", answer], ["/report", "POST", { note: "No" }], ["/status", "POST", { status: "paused" }]] as const) {
    assert.equal((await jsonRequest(baseUrl, path(suffix), method, body)).response.status, 409);
  }
  assert.equal((await uploadRequest(baseUrl, path("/files"), form())).response.status, 409);
  assert.equal((await jsonRequest(baseUrl, path("/files"))).response.status, 200);
  assert.equal(writeCalls(state).length, 1);
});

test("files list is scoped, paginated and normalized without financial fields", async (t) => {
  const { baseUrl, state } = await harness(t);
  const result = await jsonRequest(baseUrl, path("/files"));
  const data = filesSchema.parse(result.data);
  assert.equal(data.data[0]?.responsible?.name, "Técnico");
  assert.equal(data.data[0]?.thumbnailUrl, "https://files.example.invalid/thumb.png");
  assert.equal(data.totalRows, 1);
  assert.doesNotMatch(JSON.stringify(result.data), /netCost/);
  const call = state.calls.at(-1)!;
  assert.equal(call.path, "/api/work_files/11");
  assert.deepEqual(JSON.parse(call.query.get("pagination") ?? "{}"), { page: 0, limit: 1000 });
  assert.deepEqual(JSON.parse(call.query.get("filters") ?? "{}"), { companyBranchId: 1 });
});

test("multipart rebuild maps files to attachments, verifies magic and accepts exactly four files", async (t) => {
  const { baseUrl, state } = await harness(t);
  const result = await uploadRequest(baseUrl, path("/files"), form(4));
  assert.equal(result.response.status, 201);
  const call = writeCalls(state)[0]!;
  assert.equal(call.path, "/api/work_files/11");
  assert.deepEqual(z.object({ companyBranchId: z.string() }).parse(call.json), { companyBranchId: "1" });
  assert.equal(call.files.length, 4);
  for (const file of call.files) {
    assert.equal(file.field, "attachments");
    assert.equal(file.mime, "image/png");
    assert.match(file.name, /^photo-[\w-]+\.png$/);
    assert.deepEqual(file.bytes, PNG);
  }
  assert.equal(assignmentCalls(state).length, 3);
  assert.equal((await uploadRequest(baseUrl, path("/steps/101/files"), form())).response.status, 400);
  assert.equal(writeCalls(state).length, 1);
});

test("maintenance work and step uploads use files and server-derived step workId", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] })]);
  assert.equal((await uploadRequest(baseUrl, maintenancePath("/files"), form())).response.status, 201);
  assert.equal((await uploadRequest(baseUrl, maintenancePath("/steps/101/files"), form())).response.status, 201);
  const writes = writeCalls(state);
  assert.equal(writes[0]?.path, "/api/maintenances/works/7/files");
  assert.equal(writes[1]?.path, "/api/maintenances/works/steps/101/files");
  assert.equal(writes[1]?.files[0]?.field, "files");
  assert.deepEqual(z.object({ companyBranchId: z.string(), workId: z.string() }).parse(writes[1]?.json), { companyBranchId: "1", workId: "7" });
});

test("multipart cannot bypass ownership, MIME, field or aggregate size restrictions", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const invalid of [form(5), form(1, Buffer.from("<svg onload='x'/>") , "photo.png", "image/png"), form(1, Buffer.from("MZ executable"), "photo.jpg", "image/jpeg")]) {
    assert.equal((await uploadRequest(baseUrl, path("/files"), invalid)).response.status, 400);
  }
  const override = form();
  override.set("companyBranchId", "2");
  assert.equal((await uploadRequest(baseUrl, path("/files"), override)).response.status, 400);
  const wrongField = new FormData();
  wrongField.append("attachments", new Blob([new Uint8Array(PNG)]), "photo.png");
  assert.equal((await uploadRequest(baseUrl, path("/files"), wrongField)).response.status, 400);
  const large = Buffer.alloc(26 * 1024 * 1024);
  PNG.copy(large);
  assert.equal((await uploadRequest(baseUrl, path("/files"), form(1, large))).response.status, 413);
  assert.equal((await uploadRequest(baseUrl, path("/files"), form(2, large.subarray(0, 21 * 1024 * 1024)))).response.status, 413);
  assert.equal(writeCalls(state).length, 0);
  state.sequence = [assignments(), assignments(), assignments([group({ works: [] })])];
  assert.equal((await uploadRequest(baseUrl, path("/files"), form())).response.status, 404);
  assert.equal(writeCalls(state).length, 0);
});

test("JPEG, WebP and HEIC signatures are preserved and MIME names are rebuilt", async (t) => {
  const { baseUrl, state } = await harness(t);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([16, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(4), Buffer.from("mif1heic")]);
  for (const [bytes, mime] of [[jpeg, "image/jpeg"], [webp, "image/webp"], [heic, "image/heic"]] as const) {
    assert.equal((await uploadRequest(baseUrl, path("/files"), form(1, bytes))).response.status, 201);
    assert.equal(writeCalls(state).at(-1)?.files[0]?.mime, mime);
  }
});

test("standard reports still persist escaped technical comments", async (t) => {
  const { baseUrl, state } = await harness(t);
  const result = await jsonRequest(baseUrl, path("/report"), "POST", { note: "Comprobación <script>\nTerminada" });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { success: true });
  const call = writeCalls(state)[0]!;
  assert.equal(call.path, "/api/works/comments/11");
  assert.equal(call.query.get("isTechnical"), "true");
  assert.deepEqual(call.json, { comment: "<p>Comprobación &lt;script&gt;<br>Terminada</p>", companyBranchId: 1 });
  assert.equal(writeCalls(state).length, 1);
});

test("maintenance reports generate UTF-8 TXT files with trusted metadata and map back through the work folder", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.user.name = "José Muñoz";
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", code: "OT-PRE-50", works: [work({ id: "7", title: "Revisión del motor" })] })]);
  const note = "  Comprobación <script> & ajuste\r\nTerminada ✅  ";
  const startedAt = Date.now();
  const result = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", { note });
  const finishedAt = Date.now();
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { success: true });
  assert.equal(assignmentCalls(state).length, 3);
  assert.equal(writeCalls(state).length, 1);
  const call = writeCalls(state)[0]!;
  assert.equal(call.path, "/api/maintenances/works/7/files");
  assert.equal(call.method, "POST");
  assert.equal(call.query.size, 0);
  assert.equal(call.headers.authorization, TOKEN);
  assert.equal(call.headers.origin, "http://localhost:3000");
  assert.equal(call.headers["user-agent"], MOBILE_USER_AGENT);
  assert.match(String(call.headers["content-type"]), /^multipart\/form-data; boundary=/);
  assert.deepEqual(z.object({ companyBranchId: z.string() }).strict().parse(call.json), { companyBranchId: "1" });
  assert.equal(call.files.length, 1);
  const file = call.files[0]!;
  assert.equal(file.field, "files");
  assert.equal(file.mime, "text/plain");
  assert.match(file.name, /^reporte-tecnico-\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.txt$/);
  const createdAt = /^Fecha: (.+)$/m.exec(file.bytes.toString("utf8"))?.[1];
  assert.ok(createdAt);
  assert.equal(new Date(createdAt).toISOString(), createdAt);
  assert.ok(Date.parse(createdAt) >= startedAt && Date.parse(createdAt) <= finishedAt);
  assert.ok(file.name.startsWith(`reporte-tecnico-${createdAt.slice(0, 10)}-`));
  assert.deepEqual(file.bytes, Buffer.from([
    "Reporte técnico de mantenimiento", "OT: OT-PRE-50", "Trabajo: Revisión del motor",
    "Autor: José Muñoz", `Fecha: ${createdAt}`, "", "Nota:", note.trim(), "",
  ].join("\n"), "utf8"));
  const second = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", { note: "Segunda revisión" });
  assert.deepEqual(second.data, { success: true });
  assert.equal(writeCalls(state).length, 2);
  assert.notEqual(writeCalls(state)[1]?.files[0]?.name, file.name);
  assert.ok(writeCalls(state).every((write) => write.path === "/api/maintenances/works/7/files"));
  const attachment = {
    id: 70, name: file.name, url: `https://files.example.invalid/${file.name}`, type: file.mime,
    createdAt, responsible: { id: state.user.id, name: state.user.name },
  };
  state.files = { data: [{ ...attachment, netCost: 100 }], totalRows: 1, totalPages: 1 };
  const listed = await jsonRequest(baseUrl, maintenancePath("/files"));
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.data, { data: [attachment], totalRows: 1, totalPages: 1 });
  assert.deepEqual(filesSchema.parse(listed.data).data[0], attachment);
  const read = state.calls.at(-1)!;
  assert.equal(read.path, "/api/maintenance_files/50");
  assert.deepEqual(JSON.parse(read.query.get("filters") ?? "{}"), { companyBranchId: 1, folderId: "maintenance_work_7" });
});

test("maintenance report IDOR cannot cross owners, groups or standard work sources", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([
    group(),
    group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] }),
    group({ id: "maintenance-51", type: "internal_maintenance", works: [work({ id: "9" })] }),
  ]);
  for (const route of [
    maintenancePath("/report").replace("/works/7", "/works/8"),
    maintenancePath("/report").replace("maintenance-50", "maintenance-51"),
    maintenancePath("/report").replace("/works/7", "/works/9"),
    maintenancePath("/report").replace("/works/7", "/works/11"),
    path("/report").replace("/works/11", "/works/7"),
  ]) {
    const result = await jsonRequest(baseUrl, route, "POST", { note: "Reporte ajeno" });
    assert.equal(result.response.status, 404);
    assert.equal(errorCode(result.data), "ASSIGNMENT_NOT_FOUND");
  }
  assert.equal(writeCalls(state).length, 0);
});

test("maintenance reports revalidate ownership and read-only state immediately before persistence", async (t) => {
  const { baseUrl, state } = await harness(t);
  const maintenance = group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] });
  for (const [updated, status, code] of [
    [group({ ...maintenance, id: "maintenance-51", works: [work({ id: "7", responsibles: [] })] }), 404, "ASSIGNMENT_NOT_FOUND"],
    [group({ ...maintenance, works: [] }), 404, "ASSIGNMENT_NOT_FOUND"],
    [group({ ...maintenance, works: [work({ id: "7", status: "completed" })] }), 409, "WORK_READ_ONLY"],
    [group({ ...maintenance, works: [work({ id: "7", status: "delivered" })] }), 409, "WORK_READ_ONLY"],
  ] as const) {
    state.calls.length = 0;
    state.sequence = [assignments([maintenance]), assignments([maintenance]), assignments([updated])];
    const result = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", { note: "Reporte" });
    assert.equal(result.response.status, status);
    assert.equal(errorCode(result.data), code);
    assert.equal(assignmentCalls(state).length, 3);
    assert.equal(writeCalls(state).length, 0);
  }
});

test("maintenance reports allow an active child when its parent closes before persistence", async (t) => {
  const { baseUrl, state } = await harness(t);
  const maintenance = group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] });
  for (const status of ["completed", "delivered"] as const) {
    state.calls.length = 0;
    state.sequence = [assignments([maintenance]), assignments([maintenance]), assignments([group({ ...maintenance, status })])];
    const result = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", { note: "Reporte" });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.data, { success: true });
    assert.equal(assignmentCalls(state).length, 3);
    assert.equal(writeCalls(state).length, 1);
    assert.equal(writeCalls(state)[0]?.path, "/api/maintenances/works/7/files");
    assert.equal(writeCalls(state)[0]?.headers.authorization, TOKEN);
  }
});

test("maintenance reports still require a matching canonical actor immediately before persistence", async (t) => {
  const { baseUrl, state } = await harness(t);
  const maintenance = group({ id: "maintenance-50", type: "internal_maintenance", status: "delivered", works: [work({ id: "7" })] });
  for (const id of [84, null]) {
    const mismatched = assignments([maintenance]);
    mismatched.technician.id = id;
    state.calls.length = 0;
    state.sequence = [assignments([maintenance]), assignments([maintenance]), mismatched];
    const result = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", { note: "Reporte" });
    assert.equal(result.response.status, 403);
    assert.equal(errorCode(result.data), "WORKER_MISMATCH");
    assert.equal(assignmentCalls(state).length, 3);
    assert.equal(writeCalls(state).length, 0);
  }
});

test("maintenance reports require only a validated JSON note and accept the existing 10000-character maximum", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] })]);
  for (const body of [
    {}, { note: "" }, { note: " \r\n " }, { note: null }, { note: 123 }, { note: "ñ".repeat(10001) },
    { note: "Reporte", workId: 8 }, { note: "Reporte", maintenanceId: 51 }, { note: "Reporte", companyBranchId: 2 },
    { note: "Reporte", folderId: "maintenance_work_8" }, { note: "Reporte", sourceType: "work" },
    { note: "Reporte", files: ["contenido arbitrario"] }, { note: "Reporte", filename: "cliente.txt" },
    { note: "Reporte", type: "text/plain" }, { note: "Reporte", author: "Otro" }, { note: "Reporte", date: "2026-01-01" },
  ]) {
    const result = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", body);
    assert.equal(result.response.status, 400);
    assert.equal(errorCode(result.data), "INVALID_INPUT");
  }
  const multipart = form(1, Buffer.from("Reporte arbitrario"), "reporte.txt", "text/plain");
  multipart.set("note", "Reporte");
  assert.equal((await uploadRequest(baseUrl, maintenancePath("/report"), multipart)).response.status, 400);
  const plain = await fetch(`${baseUrl}${maintenancePath("/report")}`, {
    method: "POST", headers: { Authorization: gatewayToken(baseUrl), "Content-Type": "text/plain" }, body: JSON.stringify({ note: "Reporte" }),
  });
  assert.equal(plain.status, 400);
  await plain.json();
  assert.equal(writeCalls(state).length, 0);
  const note = "ñ".repeat(10000);
  const result = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", { note });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { success: true });
  assert.equal(writeCalls(state).length, 1);
  assert.ok(writeCalls(state)[0]?.files[0]?.bytes.toString("utf8").endsWith(`Nota:\n${note}\n`));
});

test("client TXT uploads remain forbidden for maintenance work and step files, even with spoofed image MIME", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] })]);
  for (const suffix of ["/files", "/steps/101/files"]) {
    for (const mime of ["text/plain", "image/png"]) {
      const result = await uploadRequest(baseUrl, maintenancePath(suffix), form(1, Buffer.from("Texto arbitrario"), "reporte-tecnico-2026-09-07-cliente.txt", mime));
      assert.equal(result.response.status, 400);
      assert.equal(errorCode(result.data), "UNSUPPORTED_IMAGE");
    }
  }
  assert.equal(writeCalls(state).length, 0);
});

test("maintenance reports succeed only after upstream 2xx and never retry or follow redirects", async (t) => {
  const { baseUrl, backendUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ id: "7" })] })]);
  for (const [status, body, expectedStatus, code] of [
    [201, { success: true }, 200, null], [204, "", 200, null],
    [400, { error: "PRIVATE_DETAILS" }, 400, "UPSTREAM_REJECTED"],
    [401, { error: "PRIVATE_DETAILS" }, 401, "UNAUTHORIZED"],
    [403, { error: "PRIVATE_DETAILS" }, 403, "FORBIDDEN"],
    [404, { error: "PRIVATE_DETAILS" }, 404, "RESOURCE_NOT_FOUND"],
    [409, { error: "PRIVATE_DETAILS" }, 409, "UPSTREAM_REJECTED"],
    [500, { error: "PRIVATE_DETAILS" }, 502, "UPSTREAM_ERROR"],
    [302, "", 502, "UPSTREAM_ERROR"],
    [200, { success: false, error: "PRIVATE_DETAILS" }, 502, "UPSTREAM_REJECTED"],
    [201, { error: "PRIVATE_DETAILS" }, 502, "UPSTREAM_REJECTED"],
    [200, "PRIVATE_DETAILS", 502, "UPSTREAM_INVALID_RESPONSE"],
  ] as const) {
    state.calls.length = 0;
    state.failures.set("/api/maintenances/works/7/files", { status, body, location: status === 302 ? `${backendUrl}/capture` : undefined });
    const result = await jsonRequest(baseUrl, maintenancePath("/report"), "POST", { note: "Reporte" });
    assert.equal(result.response.status, expectedStatus);
    if (code === null) assert.deepEqual(result.data, { success: true });
    else {
      assert.equal(errorCode(result.data), code);
      assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE_DETAILS|success/);
    }
    assert.equal(state.calls.length, 7);
    assert.equal(assignmentCalls(state).length, 3);
    assert.equal(writeCalls(state).length, 1);
    assert.equal(writeCalls(state)[0]?.path, "/api/maintenances/works/7/files");
    if (status === 401) await loginGateway(baseUrl);
  }
});

test("upstream failures and malformed payloads are sanitized; POST/upload never retry", async (t) => {
  const { baseUrl, state } = await harness(t);
  const secret = "SELECT password FROM users; ER_BAD_FIELD_ERROR private host";
  state.failures.set("/api/works/comments/11", { status: 500, body: { error: secret, sql: secret } });
  const report = await jsonRequest(baseUrl, path("/report"), "POST", { note: "Reporte" });
  assert.equal(report.response.status, 502);
  assert.deepEqual(report.data, { error: "UPSTREAM_ERROR" });
  assert.equal(writeCalls(state).length, 1);
  state.failures.set("/api/work_files/11", { status: 500, body: secret });
  assert.deepEqual((await uploadRequest(baseUrl, path("/files"), form())).data, { error: "UPSTREAM_ERROR" });
  assert.equal(writeCalls(state).length, 2);
  state.failures.clear();
  state.failures.set("/api/auth/me", { status: 401, body: { error: secret } });
  assert.deepEqual((await jsonRequest(baseUrl, path("/files"))).data, { error: "UNAUTHORIZED" });
  state.failures.clear();
  await loginGateway(baseUrl);
  state.invalidAssignments = { malformed: true, sql: secret };
  assert.deepEqual((await jsonRequest(baseUrl, `/api/assignments?${RANGE}`)).data, { error: "UPSTREAM_INVALID_RESPONSE" });
});

test("upstream redirects cannot leak bearer or change target", async (t) => {
  const { baseUrl, backendUrl, state } = await harness(t);
  state.failures.set("/api/auth/me", { status: 302, body: "", location: `${backendUrl}/capture` });
  const result = await jsonRequest(baseUrl, "/api/auth/me");
  assert.equal(result.response.status, 502);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0]?.headers.authorization, TOKEN);
});

test("HTTP 200 error envelopes never become fake mutation successes", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.failures.set("/api/works/comments/11", { status: 200, body: { success: false, error: "SQL_INTERNAL_DETAILS" } });
  const result = await jsonRequest(baseUrl, path("/report"), "POST", { note: "Reporte" });
  assert.equal(result.response.status, 502);
  assert.deepEqual(result.data, { error: "UPSTREAM_REJECTED" });
  assert.equal(writeCalls(state).length, 1);
  state.failures.set("/api/auth/me", { status: 503, body: "PRIVATE_BACKEND_DETAILS" });
  assert.deepEqual((await jsonRequest(baseUrl, "/health")).data, { ok: true, backendReachable: false });
});

test("CORS denies arbitrary origins, no arbitrary passthrough and localhost is rate limited", async (t) => {
  const { baseUrl, state } = await harness(t, { login: false });
  const denied = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://evil.example" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal((await jsonRequest(baseUrl, "/api/proxy?target=http://evil.invalid", "GET", undefined, null)).response.status, 404);
  assert.equal(state.calls.length, 0);
  for (let index = 0; index < 10; index++) {
    assert.equal((await jsonRequest(baseUrl, "/api/auth/login", "POST", { tenantId: "local", username: "test", password: "password", remember: false }, null)).response.status, 200);
  }
  assert.equal((await jsonRequest(baseUrl, "/api/auth/login", "POST", { tenantId: "local", username: "test", password: "password", remember: false }, null)).response.status, 429);
  assert.equal(writeCalls(state).length, 10);
});

test("production requires explicit HTTPS backend, tenant, CORS and trusted proxy IPs", () => {
  assert.throws(() => createApp({ environment: "production" }));
  assert.throws(() => resolveConfig({ backendUrl: "http://user:password@127.0.0.1:5001/api" }));
  assert.throws(() => resolveConfig({ corsOrigins: ["*"] }));
  assert.throws(() => resolveConfig({ trustedProxyIps: ["true"] }));
  const config = resolveConfig({ environment: "production", backendUrl: "https://backend.example.invalid/api", tenantOrigin: "https://tenant.example.invalid", corsOrigins: ["https://mobile.example.invalid"], trustedProxyIps: ["127.0.0.1"] });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(resolveConfig({}).host, "0.0.0.0");
});