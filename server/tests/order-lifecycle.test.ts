import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test, type TestContext } from "node:test";
import express from "express";
import { z } from "zod";
import type { Assignments } from "../../src/domain/models";
import { assignmentRouter } from "../assignments/routes";
import { errorHandler } from "../errors";
import type { MaintenanceDetail, MaintenanceStep } from "../orders/contracts";
import { createOrderRouter } from "../orders/routes";
import { MAX_SIGNATURE_BYTES, ORDER_DELIVERY_JSON_LIMIT_BYTES, signatureSchema } from "../orders/validation";
import { SessionContext } from "../session-context";
import { SessionManager } from "../sessions";
import { TenantRegistry } from "../tenants";
import { assignments, group, PNG, RANGE, step, TOKEN, user, work } from "./fixtures";
import type { RecordedCall } from "./mock-upstream";

const signature = `data:image/png;base64,${PNG.toString("base64")}`;
const orderPath = (suffix = "/maintenance-delivery", id = "maintenance-50", range = RANGE) => `/api/assignments/${id}${suffix}?${range}`;
const writes = (calls: RecordedCall[]) => calls.filter((call) => call.method !== "GET");
const assignedReads = (calls: RecordedCall[]) => calls.filter((call) => call.path === "/api/technician-dashboard/assignments");
const input = () => ({ note: "Revisión técnica", durationMinutes: 35, faultType: null, receivedByName: null, clientSignature: null, technicianSignature: signature });
const clientInput = () => ({ ...input(), faultType: "operative", receivedByName: "Cliente Prueba", clientSignature: signature });
const assigned = () => assignments([group({ id: "maintenance-50", type: "internal_maintenance", status: "pending", maintenanceType: "preventivo", canManage: false, isResponsible: false, works: [work({ status: "pending", canExecute: false, missingRequiredInfo: ["irrelevant-child-restriction"], responsibles: [] })] })]);

function rawStep(overrides: Partial<MaintenanceStep> = {}): MaintenanceStep {
  return { id: 101, maintenanceWorkId: 11, checklistId: 10, type: "select", responseValue: "approved", isCompleted: true, isFilesRequired: false, files: [], ...overrides };
}

function detail(overrides: Partial<MaintenanceDetail> = {}): MaintenanceDetail {
  return {
    id: 50, type: "preventivo", status: "planificada", companyBranchId: 1, isArchived: false,
    damageType: null, durationMinutes: null, finalizationNote: null, finalizedAt: null,
    signatures: [], works: [{ id: 11, maintenanceId: 50, title: "Inspección", checklists: [{ checklistId: 10, name: "Control", isRequired: false, steps: [rawStep()] }] }],
    ...overrides,
  };
}

async function listen(t: TestContext, server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS");
  return `http://127.0.0.1:${address.port}`;
}

async function backend(t: TestContext) {
  const state = {
    user: user(), assignments: assigned(), detail: detail() as unknown,
    assignmentSequence: [] as Assignments[], detailSequence: [] as unknown[], calls: [] as RecordedCall[],
    failure: null as { status: number; body: unknown } | null, result: { success: true } as unknown,
    beforeResponse: undefined as ((call: RecordedCall) => Promise<void>) | undefined,
  };
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(async (req, res) => {
    const call: RecordedCall = { path: req.path, method: req.method, query: new URL(req.originalUrl, "http://mock.invalid").searchParams, headers: req.headers, json: req.body, files: [] };
    state.calls.push(call);
    await state.beforeResponse?.(call);
    if (req.headers.authorization !== TOKEN) { res.status(401).end(); return; }
    if (req.method === "GET" && req.path === "/api/auth/me") { res.json(state.user); return; }
    if (req.method === "GET" && req.path === "/api/technician-dashboard/assignments") { res.json(state.assignmentSequence.shift() ?? state.assignments); return; }
    if (req.method === "GET" && req.path === "/api/maintenances/50") { res.json(state.detailSequence.shift() ?? state.detail); return; }
    if (req.method === "POST" && ["/api/maintenances/50/start-repair", "/api/maintenances/50/finalize", "/api/maintenances/50/technician-delivery"].includes(req.path)) {
      if (state.failure) res.status(state.failure.status).json(state.failure.body); else res.json(state.result);
      return;
    }
    res.status(404).json({ error: "MOCK_ROUTE_NOT_FOUND" });
  });
  return { state, backendUrl: `${await listen(t, createServer(app))}/api` };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  token?: string | null;
  headers?: HeadersInit;
}

async function gateway(t: TestContext, backends: Array<{ backendUrl: string }>) {
  const tenants = new TenantRegistry(backends.map((item, index) => ({ id: `tenant-${index}`, name: `Tenant ${index}`, backendUrl: item.backendUrl, tenantOrigin: `http://tenant-${index}.localhost:3000`, environment: "development", enabled: true })));
  const sessions = new SessionManager();
  const issue = (tenantId: string, nextStep: "DONE" | "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" = "DONE") => `Bearer ${sessions.issue(tenantId, { token: "test-token", username: "test", email: "test@example.invalid", nextStep }).token}`;
  const tokens = backends.map((_item, index) => issue(`tenant-${index}`));
  const context = new SessionContext(tenants, sessions);
  const routers = new Map(tenants.list().map((tenant) => {
    const upstream = tenants.get(tenant.id).upstream;
    const router = express.Router();
    router.use(createOrderRouter(upstream));
    router.use(assignmentRouter(upstream, (_req, _res, next) => next()));
    return [tenant.id, router];
  }));
  const app = express();
  app.set("query parser", "simple");
  const smallJson = express.json({ limit: "32kb", strict: true, inflate: false });
  app.use((req, res, next) => {
    if (req.method === "POST" && /^\/api\/assignments\/[^/]+\/deliver\/?$/i.test(req.path)) { next(); return; }
    smallJson(req, res, next);
  });
  app.use("/api/assignments", context.middleware(), (req, res, next) => {
    const router = routers.get(context.get(req).session.tenantId);
    if (!router) throw new Error("TEST_TENANT_NOT_FOUND");
    router(req, res, next);
  });
  app.use((_req, res) => { res.status(404).json({ error: "NOT_FOUND" }); });
  app.use(context.invalidateUnauthorized);
  app.use(errorHandler);
  const baseUrl = await listen(t, createServer(app));
  async function request(path = orderPath(), options: RequestOptions = {}) {
    const headers = new Headers(options.headers);
    const token = options.token === undefined ? tokens[0]! : options.token;
    if (token !== null) headers.set("Authorization", token);
    if ((options.body !== undefined || options.rawBody !== undefined) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET", headers, redirect: "manual",
      body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    const data: unknown = await response.json();
    return { response, data };
  }
  return { request, tokens, issue };
}

async function harness(t: TestContext) {
  const upstream = await backend(t);
  return { ...upstream, ...await gateway(t, [upstream]) };
}

test("order metadata is source-aware, canonical and sanitized without trusting management or child execution flags", async (t) => {
  const { request, state } = await harness(t);
  state.detail = {
    ...detail({ finalizationNote: "Borrador guardado", damageType: "desgaste", durationMinutes: 70 }),
    internalNotes: "SECRET", totals: { totalCost: 100 }, tenantContacts: [{ email: "SECRET" }],
    signatures: [{ id: 1, maintenanceId: 50, role: "technician", signedBy: 9, signedByName: "Autor real", signedAt: "2026-09-01T09:00:00.000Z", signatureUrl: signature }],
  };
  const result = await request();
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(result.data, {
    groupId: "maintenance-50", maintenanceId: 50, companyBranchId: 1, generatedAt: "2026-09-01T10:00:00.000Z",
    status: "pending", maintenanceType: "preventivo", finalizationNote: "Borrador guardado", damageType: "desgaste", durationMinutes: 70,
    startedAt: null, finalizedAt: null, incompleteChecklists: [], suggestedDurationMinutes: 0,
    technicianDeliverySupported: true, canTechnicianDeliver: true, totalWorks: 1, pendingWorkNames: ["Inspección"], pendingDeliveryChecklists: ["Inspección — Control"],
    canStart: true, canDeliver: true, requiresClientSignature: false, faultTypes: ["operative", "wear", "undetermined"], maxSignatureBytes: MAX_SIGNATURE_BYTES,
    technician: { userId: 9, workerId: 42, name: "Técnico Prueba" },
    signatures: [{ id: 1, role: "technician", signedBy: 9, signedByName: "Autor real", signedAt: "2026-09-01T09:00:00.000Z", hasSignature: true }],
  });
  assert.doesNotMatch(JSON.stringify(result.data), /SECRET|signatureUrl|totalCost|responsibleIds/);
  assert.deepEqual(Object.fromEntries(assignedReads(state.calls)[0]!.query), Object.fromEntries(new URLSearchParams(RANGE)));
  assert.equal(writes(state.calls).length, 0);
});

test("start maps only pending maintenance parents to POST start-repair with empty JSON and session-derived headers", async (t) => {
  const { request, state } = await harness(t);
  const result = await request(orderPath("/start"), { method: "POST", body: {} });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { success: true });
  assert.deepEqual(writes(state.calls).map((call) => ({ method: call.method, path: call.path, json: call.json })), [{ method: "POST", path: "/api/maintenances/50/start-repair", json: {} }]);
  assert.equal(assignedReads(state.calls).length, 2);
  assert.equal(state.calls.filter((call) => call.path === "/api/maintenances/50").length, 2);
  assert.ok(state.calls.every((call) => call.headers.authorization === TOKEN && call.headers.origin === "http://tenant-0.localhost:3000"));
});

test("delivery from pending does not require completed children and maps only exact finalize fields", async (t) => {
  const { request, state } = await harness(t);
  const result = await request(orderPath("/deliver"), { method: "POST", body: input() });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { success: true });
  assert.deepEqual(writes(state.calls).map((call) => ({ method: call.method, path: call.path, json: call.json })), [{ method: "POST", path: "/api/maintenances/50/finalize", json: input() }]);
  assert.equal(assignedReads(state.calls).length, 2);
  state.calls.length = 0;
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: { technicianSignature: signature, durationMinutes: 0 } })).response.status, 200);
  assert.deepEqual(writes(state.calls)[0]?.json, { ...input(), note: null, durationMinutes: null });
});

test("acknowledged technical delivery allows incomplete checklists and uses only the dedicated backend endpoint", async (t) => {
  const { request, state } = await harness(t);
  state.assignments.groups[0]!.maintenanceType = "correctivo";
  state.detail = detail({ type: "correctivo", works: [{ id: 11, maintenanceId: 50, title: "Inspección", status: "pending", checklists: [{ checklistId: 10, name: "Seguridad", isRequired: true, steps: [rawStep({ responseValue: null })] }] }] });
  const metadata = await request();
  assert.deepEqual(z.object({ pendingWorkNames: z.array(z.string()), pendingDeliveryChecklists: z.array(z.string()), canTechnicianDeliver: z.boolean() }).parse(metadata.data), {
    pendingWorkNames: ["Inspección"], pendingDeliveryChecklists: ["Inspección — Seguridad", "Inspección — Control"], canTechnicianDeliver: true,
  });
  const result = await request(orderPath("/deliver"), { method: "POST", body: { note: "Entrega con pendientes revisados", durationMinutes: 35, technicianSignature: signature, acknowledgeDelivery: true } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(writes(state.calls).map(call => [call.path, Object.fromEntries(call.query), call.json]), [["/api/maintenances/50/technician-delivery", { companyBranchId: "1" }, { note: "Entrega con pendientes revisados", durationMinutes: 35, technicianSignature: signature, acknowledgeDelivery: true }]]);
  state.calls.length = 0;
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: { ...input(), acknowledgeDelivery: false } })).response.status, 400);
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: { ...clientInput(), acknowledgeDelivery: true } })).response.status, 400);
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: { ...input(), technicianSignature: null, acknowledgeDelivery: true } })).response.status, 400);
  assert.equal(writes(state.calls).length, 0);
});

test("correctivo and detencion require failure type, receiver and client signature derived from backend type", async (t) => {
  const { request, state } = await harness(t);
  for (const type of ["correctivo", "detencion"] as const) {
    state.assignments.groups[0]!.maintenanceType = type;
    state.detail = detail({ type });
    for (const [body, error] of [
      [{ ...clientInput(), faultType: null }, "FAULT_TYPE_REQUIRED"],
      [{ ...clientInput(), receivedByName: "   " }, "RECEIVED_BY_NAME_REQUIRED"],
      [{ ...clientInput(), clientSignature: null }, "CLIENT_SIGNATURE_REQUIRED"],
    ] as const) {
      state.calls.length = 0;
      const result = await request(orderPath("/deliver"), { method: "POST", body });
      assert.equal(result.response.status, 400);
      assert.deepEqual(result.data, { error });
      assert.equal(writes(state.calls).length, 0);
    }
    for (const faultType of ["operative", "wear", "undetermined"]) {
      state.calls.length = 0;
      const body = { ...clientInput(), faultType, receivedByName: "  Cliente Prueba  " };
      assert.equal((await request(orderPath("/deliver"), { method: "POST", body })).response.status, 200);
      assert.deepEqual(writes(state.calls)[0]?.json, { ...body, receivedByName: "Cliente Prueba" });
    }
    assert.equal(z.object({ requiresClientSignature: z.boolean() }).parse((await request()).data).requiresClientSignature, true);
  }
  state.assignments.groups[0]!.maintenanceType = "preventivo";
  state.detail = detail();
  state.calls.length = 0;
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: clientInput() })).response.status, 400);
  assert.equal(writes(state.calls).length, 0);
});

test("all raw children are checked, including unassigned children, with no completion-status requirement", async (t) => {
  const { request, state } = await harness(t);
  const hidden = { id: 22, maintenanceId: 50, title: "Otro técnico", checklists: [{ checklistId: 20, name: "Seguridad", isRequired: true, steps: [rawStep({ id: 202, maintenanceWorkId: 22, checklistId: 20, type: "approval", responseValue: null })] }] };
  state.detail = detail({ works: [...detail().works, hidden] });
  const metadata = z.object({ incompleteChecklists: z.array(z.string()), canDeliver: z.boolean() }).parse((await request()).data);
  assert.deepEqual(metadata, { incompleteChecklists: ["Otro técnico — Seguridad"], canDeliver: false });
  const rejected = await request(orderPath("/deliver"), { method: "POST", body: input() });
  assert.equal(rejected.response.status, 400);
  assert.match(JSON.stringify(rejected.data), /REQUIRED_CHECKLISTS_INCOMPLETE/);
  assert.equal(writes(state.calls).length, 0);
  hidden.checklists[0]!.steps[0]!.responseValue = "rejected";
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 200);
});

test("required checklist parity handles negative validation, no aplica, approval, multiselect, evidence and text", async (t) => {
  const { request, state } = await harness(t);
  const cases: Array<{ step: MaintenanceStep; allowed: boolean }> = [
    { step: rawStep({ type: "validation", responseValue: false, isCompleted: false }), allowed: true },
    { step: rawStep({ type: "validation", responseValue: "not_applicable", isCompleted: false }), allowed: true },
    { step: rawStep({ type: "validation", responseValue: null, isCompleted: false }), allowed: false },
    { step: rawStep({ type: "validation", responseValue: null, isCompleted: true }), allowed: true },
    { step: rawStep({ type: "number", responseValue: 0 }), allowed: true },
    { step: rawStep({ type: "select", responseValue: " " }), allowed: false },
    { step: rawStep({ type: "approval", responseValue: "not_applicable" }), allowed: true },
    { step: rawStep({ type: "multiselect", responseValue: [] }), allowed: false },
    { step: rawStep({ type: "multiselect", responseValue: [{ value: "yes", label: "Sí" }] }), allowed: true },
    { step: rawStep({ isFilesRequired: true }), allowed: false },
    { step: rawStep({ isFilesRequired: true, files: [{ id: 7 }] }), allowed: true },
    { step: rawStep({ type: "text", responseValue: null, isFilesRequired: true }), allowed: true },
  ];
  for (const candidate of cases) {
    state.calls.length = 0;
    state.detail = detail({ works: [{ id: 11, maintenanceId: 50, title: "Inspección", checklists: [{ checklistId: 10, name: "Control", isRequired: true, steps: [candidate.step] }] }] });
    const result = await request(orderPath("/deliver"), { method: "POST", body: input() });
    assert.equal(result.response.status, candidate.allowed ? 200 : 400, JSON.stringify(candidate));
    assert.equal(writes(state.calls).length, candidate.allowed ? 1 : 0);
  }
  state.detail = detail({ works: [{ id: 11, maintenanceId: 50, title: "Inspección", checklists: [{ checklistId: 10, name: "Vacío", isRequired: true, steps: [] }] }] });
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 200);
  state.detail = detail({ works: [{ id: 11, maintenanceId: 50, title: "Productos utilizados", checklists: [{ checklistId: 10, name: "Contenedor", isRequired: true, steps: [rawStep({ responseValue: null })] }] }] });
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 200);
});

test("fresh assignment checklist restrictions are also enforced, but start never requires completed checklists", async (t) => {
  const { request, state } = await harness(t);
  state.assignments.groups[0]!.works[0]!.checklists = [{ checklistId: 10, name: "Control", code: "10", required: true, steps: [step()] }];
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 400);
  assert.equal(writes(state.calls).length, 0);
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, 200);
});

test("finalized and archived parents are read-only and an in-progress parent cannot be restarted", async (t) => {
  const { request, state } = await harness(t);
  for (const [status, rawStatus] of [["delivered", "entrega_tecnico"], ["completed", "finalizada"]] as const) {
    state.assignments.groups[0]!.status = status;
    state.detail = detail({ status: rawStatus });
    for (const [suffix, body] of [["/start", {}], ["/deliver", input()]] as const) {
      assert.equal((await request(orderPath(suffix), { method: "POST", body })).response.status, 409);
    }
    assert.deepEqual(z.object({ canStart: z.boolean(), canDeliver: z.boolean() }).parse((await request()).data), { canStart: false, canDeliver: false });
  }
  state.assignments = assigned();
  state.detail = detail({ isArchived: true });
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 409);
  state.assignments.groups[0]!.status = "in_progress";
  state.detail = detail({ status: "en_progreso" });
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, 409);
  assert.equal(writes(state.calls).length, 0);
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 200);
});

test("group ID and source collisions never authorize a different maintenance", async (t) => {
  const { request, state } = await harness(t);
  for (const id of ["external-50", "direct-50", "direct-np-50", "maintenance-51"]) {
    assert.equal((await request(orderPath("/start", id), { method: "POST", body: {} })).response.status, 404);
  }
  for (const [id, type] of [["external-50", "external_ot"], ["direct-50", "direct_assignment"]] as const) {
    state.assignments = assignments([group({ id, type })]);
    assert.equal((await request(orderPath("/deliver", id), { method: "POST", body: input() })).response.status, 400);
  }
  state.assignments = assignments([group({ id: "maintenance-50", type: "external_ot" })]);
  assert.equal((await request()).response.status, 502);
  for (const data of [assignments([]), assignments([assigned().groups[0]!, assigned().groups[0]!])]) {
    state.assignments = data;
    assert.equal((await request()).response.status, 404);
  }
  assert.equal(writes(state.calls).length, 0);
  assert.equal(state.calls.some((call) => call.path.startsWith("/api/maintenances/")), false);
});

test("missing canonical permission fields, required flags and unknown sources fail closed", async (t) => {
  const { request, state } = await harness(t);
  const rawAssignments = assigned();
  Reflect.deleteProperty(rawAssignments.groups[0]!, "canManage");
  state.assignments = rawAssignments;
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, 502);
  state.assignments = assigned();
  const raw = detail();
  Reflect.deleteProperty(raw.works[0]!.checklists[0]!, "isRequired");
  state.detail = raw;
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 502);
  state.detail = { ...detail(), type: "unknown" };
  assert.equal((await request()).response.status, 502);
  assert.equal(writes(state.calls).length, 0);
});

test("raw maintenance identity, branch, status, type and nested relationships must match canonical group", async (t) => {
  const { request, state } = await harness(t);
  const invalid: Array<{ value: unknown; status: number }> = [
    { value: detail({ id: 51 }), status: 502 },
    { value: detail({ companyBranchId: 2 }), status: 403 },
    { value: detail({ companyBranchId: null }), status: 403 },
    { value: detail({ type: "correctivo" }), status: 409 },
    { value: detail({ status: "finalizada" }), status: 409 },
    { value: detail({ works: [] }), status: 409 },
    { value: detail({ works: [detail().works[0]!, detail().works[0]!] }), status: 502 },
    { value: detail({ works: [{ ...detail().works[0]!, maintenanceId: 99 }] }), status: 502 },
    { value: detail({ works: [{ ...detail().works[0]!, checklists: [{ checklistId: 10, name: "Test", isRequired: true, steps: [rawStep({ maintenanceWorkId: 99 })] }] }] }), status: 502 },
    { value: detail({ signatures: [{ id: 1, maintenanceId: 99, role: "technician", signedBy: 9, signedByName: "Técnico", signedAt: null, signatureUrl: signature }] }), status: 502 },
  ];
  for (const candidate of invalid) {
    state.detail = candidate.value;
    assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, candidate.status);
  }
  assert.equal(writes(state.calls).length, 0);
});

test("scoped queries and empty start JSON reject spoofed workers, tenants, resource IDs and arbitrary payload keys", async (t) => {
  const { request, state } = await harness(t);
  for (const extra of ["workerId=9", "userId=9", "tenantId=tenant-1", "sourceType=maintenance", "groupType=internal_maintenance", "maintenanceId=50", "companyBranchId=1", "startDate=2026-09-01", "canManage=true", "filters={}", "page=0"]) {
    assert.equal((await request(orderPath("/start", "maintenance-50", `${RANGE}&${extra}`), { method: "POST", body: {} })).response.status, 400);
  }
  for (const id of ["maintenance-0", "maintenance-01", "maintenance-9007199254740992", "maintenance-50oops", "50", "maintenance--1"]) {
    assert.equal((await request(orderPath("/start", id), { method: "POST", body: {} })).response.status, 400);
  }
  for (const range of ["", RANGE.replace("2026-09-01", "2026-02-30"), RANGE.replace("2026-09-07", "2026-08-31"), RANGE.replace("2026-09-07", "2026-10-07")]) {
    assert.equal((await request(orderPath("/start", "maintenance-50", range), { method: "POST", body: {} })).response.status, 400);
  }
  for (const body of [{ workerId: 42 }, { userId: 9 }, { maintenanceId: 50 }, { companyBranchId: 1 }, { sourceType: "maintenance" }, { canManage: true }, null, []]) {
    assert.equal((await request(orderPath("/start"), { method: "POST", body })).response.status, 400);
  }
  for (const key of ["workerId", "userId", "signedBy", "signedByName", "actor", "tenant", "maintenanceId", "companyBranchId", "canManage", "sourceType", "maintenanceType", "finalizedAt", "success"]) {
    assert.equal((await request(orderPath("/deliver"), { method: "POST", body: { ...input(), [key]: 9 } })).response.status, 400);
  }
  assert.equal(state.calls.length, 0);
});

test("delivery input validation rejects malformed signatures, invalid types, huge fields and unsupported transport", async (t) => {
  const { request, state } = await harness(t);
  const invalid: unknown[] = [
    {}, { ...input(), technicianSignature: null }, { ...input(), technicianSignature: "" },
    { ...input(), technicianSignature: "https://example.invalid/signature.png" },
    { ...input(), technicianSignature: "data:image/svg+xml;base64,PHN2Zy8+" },
    { ...input(), technicianSignature: signature.replace("image/png", "image/jpeg") },
    { ...input(), technicianSignature: signature + "\n" },
    { ...input(), technicianSignature: "data:image/png;base64,%%%%" },
    { ...input(), technicianSignature: `data:image/png;base64,${Buffer.from("<html/>").toString("base64")}` },
    { ...input(), technicianSignature: `data:image/png;base64,${PNG.subarray(0, 33).toString("base64")}` },
    { ...input(), clientSignature: "javascript:alert(1)" },
    { ...input(), faultType: "electrical" }, { ...input(), faultType: 1 },
    { ...input(), durationMinutes: -1 }, { ...input(), durationMinutes: 1.5 }, { ...input(), durationMinutes: "35" }, { ...input(), durationMinutes: 525601 },
    { ...input(), note: "x".repeat(10001) }, { ...input(), receivedByName: "x".repeat(201) }, { ...input(), receivedByName: "A\u0000B" },
    { ...input(), note: {} }, { ...input(), technicianSignature: [signature] },
  ];
  for (const body of invalid) assert.equal((await request(orderPath("/deliver"), { method: "POST", body })).response.status, 400);
  assert.equal((await request(orderPath("/deliver"), { method: "POST", rawBody: "{broken" })).response.status, 400);
  assert.equal((await request(orderPath("/deliver"), { method: "POST", rawBody: JSON.stringify(input()), headers: { "Content-Type": "text/plain" } })).response.status, 415);
  assert.equal((await request(orderPath("/start"), { method: "POST" })).response.status, 415);
  assert.equal(state.calls.length, 0);
});

function sizedPng(bytes: number): Buffer {
  const padding = Buffer.alloc(bytes - PNG.length);
  padding.writeUInt32BE(padding.length - 12, 0);
  padding.write("tEXt", 4, "ascii");
  return Buffer.concat([PNG.subarray(0, PNG.length - 12), padding, PNG.subarray(PNG.length - 12)]);
}

test("signature and request limits allow actual PNG payloads beyond 32 KiB but stop at 1 MiB each and 3 MiB JSON", async (t) => {
  const { request, state } = await harness(t);
  const maximum = `data:image/png;base64,${sizedPng(MAX_SIGNATURE_BYTES).toString("base64")}`;
  assert.equal(signatureSchema.safeParse(maximum).success, true);
  assert.equal(signatureSchema.safeParse(`data:image/png;base64,${sizedPng(MAX_SIGNATURE_BYTES + 1).toString("base64")}`).success, false);
  state.assignments.groups[0]!.maintenanceType = "correctivo";
  state.detail = detail({ type: "correctivo" });
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: { ...clientInput(), technicianSignature: maximum, clientSignature: maximum } })).response.status, 200);
  state.calls.length = 0;
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: { ...input(), technicianSignature: `data:image/png;base64,${sizedPng(MAX_SIGNATURE_BYTES + 1).toString("base64")}` } })).response.status, 400);
  assert.equal((await request(orderPath("/deliver"), { method: "POST", rawBody: `{"note":"${"x".repeat(ORDER_DELIVERY_JSON_LIMIT_BYTES)}"}` })).response.status, 413);
  assert.equal(state.calls.length, 0);
});

test("missing, raw, restricted and foreign tenant sessions cannot reach lifecycle upstream", async (t) => {
  const { request, state, issue } = await harness(t);
  for (const token of [null, TOKEN, "Bearer qzm_forged"]) {
    assert.equal((await request(orderPath("/start"), { method: "POST", body: {}, token })).response.status, 401);
  }
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {}, token: issue("tenant-0", "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") })).response.status, 403);
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {}, headers: { "X-Qualitzer-Tenant": "tenant-1", "X-Worker-Id": "42" } })).response.status, 409);
  assert.equal(state.calls.length, 0);
});

test("worker and enabled-branch membership come exclusively from fresh auth/me and canonical assignments", async (t) => {
  const { request, state } = await harness(t);
  state.user.workerId = null;
  assert.equal((await request()).response.status, 403);
  state.user = user();
  state.assignments.technician.id = 9;
  assert.equal((await request()).response.status, 403);
  state.assignments = assigned();
  for (const branch of [{ ...user().accessBranchs[0]!, isEnabled: false }, { ...user().accessBranchs[0]!, isDeleted: true }]) {
    state.user.accessBranchs = [branch];
    assert.equal((await request()).response.status, 403);
  }
  state.user = user();
  assert.equal((await request(orderPath("/start", "maintenance-50", RANGE.replace("BranchId=1", "BranchId=2")), { method: "POST", body: {}, headers: { "X-Worker-Id": "42" } })).response.status, 403);
  assert.equal(writes(state.calls).length, 0);
  assert.equal(state.calls.some((call) => call.path === "/api/maintenances/50"), false);
});

test("same maintenance ID in separate tenants never shares runtime, authorization or metadata", async (t) => {
  const first = await backend(t);
  const second = await backend(t);
  second.state.detail = detail({ finalizationNote: "Tenant dos" });
  const { request, tokens } = await gateway(t, [first, second]);
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {}, token: tokens[1] })).response.status, 200);
  assert.equal(first.state.calls.length, 0);
  assert.ok(second.state.calls.every((call) => call.headers.origin === "http://tenant-1.localhost:3000"));
  first.state.assignments = assignments([]);
  assert.equal((await request()).response.status, 404);
  const metadata = z.object({ finalizationNote: z.string().nullable() }).parse((await request(orderPath(), { token: tokens[1] })).data);
  assert.equal(metadata.finalizationNote, "Tenant dos");
  assert.equal(writes(first.state.calls).length, 0);
});

test("every mutation rechecks assignment, parent status, type and all-child checklists immediately before writing", async (t) => {
  const { request, state } = await harness(t);
  for (const [suffix, body] of [["/start", {}], ["/deliver", input()]] as const) {
    state.assignmentSequence = [assigned(), assignments([])];
    assert.equal((await request(orderPath(suffix), { method: "POST", body })).response.status, 404);
  }
  const finalized = assigned();
  finalized.groups[0]!.status = "delivered";
  state.assignmentSequence = [assigned(), finalized];
  state.detailSequence = [detail(), detail({ status: "entrega_tecnico" })];
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 409);
  const corrected = assigned();
  corrected.groups[0]!.maintenanceType = "correctivo";
  state.assignmentSequence = [assigned(), corrected];
  state.detailSequence = [detail(), detail({ type: "correctivo" })];
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 400);
  const incomplete = detail();
  incomplete.works[0]!.checklists[0]!.isRequired = true;
  incomplete.works[0]!.checklists[0]!.steps[0]!.responseValue = null;
  state.detailSequence = [detail(), incomplete];
  assert.equal((await request(orderPath("/deliver"), { method: "POST", body: input() })).response.status, 400);
  assert.equal(writes(state.calls).length, 0);
});

test("fresh authorization catches worker, user and branch changes after the initial canonical detail", async (t) => {
  const { state, backendUrl } = await backend(t);
  for (const [change, status] of [
    [() => { state.user.workerId = 84; }, 403],
    [() => { state.user.id = 10; }, 401],
    [() => { state.user.accessBranchs = []; }, 403],
  ] as const) {
    state.user = user();
    state.calls.length = 0;
    let reads = 0;
    state.beforeResponse = async (call) => { if (call.path === "/api/maintenances/50" && ++reads === 1) change(); };
    const { request } = await gateway(t, [{ backendUrl }]);
    assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, status);
    assert.equal(writes(state.calls).length, 0);
  }
});

test("backend final validation is not bypassed, errors never confirm success and no mutation is retried", async (t) => {
  const { request, state } = await harness(t);
  for (const status of [400, 403, 409, 500]) {
    state.calls.length = 0;
    state.failure = { status, body: { error: "REQUIRED_CHECKLISTS_INCOMPLETE:hidden backend validation" } };
    const result = await request(orderPath("/deliver"), { method: "POST", body: input() });
    assert.equal(result.response.status, status === 500 ? 502 : status);
    assert.equal(writes(state.calls).length, 1);
    assert.doesNotMatch(JSON.stringify(result.data), /success|hidden backend validation/);
  }
  state.failure = null;
  for (const result of [null, {}, { success: false }, { success: "true" }]) {
    state.result = result;
    assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, 502);
  }
  state.result = { success: true };
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, 200);
});

test("parent writes serialize per tenant and release the lock after completion", async (t) => {
  const { request, state } = await harness(t);
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  state.beforeResponse = async (call) => {
    if (call.method === "POST") { entered(); await blocked; }
  };
  const first = request(orderPath("/start"), { method: "POST", body: {} });
  try {
    await ready;
    const concurrent = await request(orderPath("/deliver"), { method: "POST", body: input() });
    assert.equal(concurrent.response.status, 409);
    assert.deepEqual(concurrent.data, { error: "ORDER_MUTATION_IN_PROGRESS" });
    assert.equal(writes(state.calls).length, 1);
  } finally { release(); }
  assert.equal((await first).response.status, 200);
  state.beforeResponse = undefined;
  assert.equal((await request(orderPath("/start"), { method: "POST", body: {} })).response.status, 200);
});