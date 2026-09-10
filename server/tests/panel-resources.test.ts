import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test, type TestContext } from "node:test";
import express, { type RequestHandler } from "express";
import multer from "multer";
import type { Assignments } from "../../src/domain/models";
import { assignmentRouter, type UploadConcurrency } from "../assignments/routes";
import { errorHandler, GatewayError } from "../errors";
import { detectDocument, documentFilename, MAX_DOCUMENT_BYTES } from "../files/documents";
import { panelCommentsSchema, panelFilesSchema } from "../panel/contracts";
import { createPanelRouter } from "../panel/routes";
import { SessionContext } from "../session-context";
import { SessionManager } from "../sessions";
import { TenantRegistry } from "../tenants";
import { assignments, group, PNG, RANGE, step, TOKEN, user, work } from "./fixtures";
import type { RecordedCall } from "./mock-upstream";

const file = { id: 7, name: "Inspección.pdf", type: "application/pdf", size: 30, url: "https://files.example.invalid/inspection.pdf", originalUrl: "https://files.example.invalid/inspection.pdf", thumbnailPath: null, createdAt: "2026-09-08T10:00:00Z" };
const fileList = { data: [file], totalRows: 1, totalPages: 1 };
const comments = { data: [{ id: "3", text: "Revisión <pendiente>", createdAt: null, author: { id: 9, name: "Técnico", avatarUrl: null }, files: [file] }], totalRows: 1, totalPages: 1 };
const pdf = Buffer.from("%PDF-1.7\nfixture\n%%EOF");
const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(4), Buffer.from("mif1heic")]);
const groupPath = (id = "external-300", suffix = "/files", range = RANGE) => `/api/assignments/${id}${suffix}?${range}`;
const workPath = (id = "direct-11", workId = "11", suffix = "/comments", range = RANGE) => groupPath(id, `/works/${workId}${suffix}`, range);
const writes = (calls: RecordedCall[]) => calls.filter((call) => call.method !== "GET");
const assignedReads = (calls: RecordedCall[]) => calls.filter((call) => call.path === "/api/technician-dashboard/assignments");

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
    user: user(), assignments: assignments(), sequence: [] as Assignments[], calls: [] as RecordedCall[],
    files: fileList as unknown, comments: comments as unknown, pages: [] as unknown[],
    failures: new Map<string, { status: number; body: unknown }>(),
    beforeResponse: undefined as ((call: RecordedCall) => Promise<void>) | undefined,
  };
  const app = express();
  app.use(express.json());
  app.use(multer({ storage: multer.memoryStorage() }).any());
  app.use(async (req, res) => {
    const call: RecordedCall = {
      path: req.path, method: req.method, query: new URL(req.originalUrl, "http://mock.invalid").searchParams,
      headers: req.headers, json: req.body,
      files: Array.isArray(req.files) ? req.files.map((entry) => ({ field: entry.fieldname, name: entry.originalname, mime: entry.mimetype, bytes: entry.buffer })) : [],
    };
    state.calls.push(call);
    await state.beforeResponse?.(call);
    if (req.headers.authorization !== TOKEN) { res.status(401).end(); return; }
    const failure = state.failures.get(`${req.method} ${req.path}`);
    if (failure) { res.status(failure.status).send(failure.body); return; }
    if (req.path === "/api/auth/me") { res.json(state.user); return; }
    if (req.path === "/api/technician-dashboard/assignments") { res.json(state.sequence.shift() ?? state.assignments); return; }
    if (req.method === "GET" && /^\/api\/(work_files|maintenance_files|negotiation_files)\/\d+$/.test(req.path)) {
      const page: unknown = JSON.parse(call.query.get("pagination") ?? "{}");
      const index = typeof page === "object" && page !== null && "page" in page && typeof page.page === "number" ? page.page : 0;
      res.json(state.pages[index] ?? state.files); return;
    }
    if (/^\/api\/technician-dashboard\/panel\/[^/]+\/works\/\d+\/comments$/.test(req.path)) {
      if (req.method === "GET") res.json(state.comments); else res.status(201).json({ success: true });
      return;
    }
    if (req.method === "DELETE" && /^\/api\/files\/\d+$/.test(req.path)) { res.status(204).end(); return; }
    if (req.method === "POST" || req.method === "PATCH") { res.status(201).json({ success: true }); return; }
    res.status(404).end();
  });
  return { state, backendUrl: `${await listen(t, createServer(app))}/api` };
}

async function gateway(t: TestContext, backends: Array<{ backendUrl: string }>) {
  const tenants = new TenantRegistry(backends.map((item, index) => ({
    id: `tenant-${index}`, name: `Tenant ${index}`, backendUrl: item.backendUrl, tenantOrigin: `http://tenant-${index}.localhost:3000`, environment: "development", enabled: true,
  })));
  const sessions = new SessionManager();
  const tokens = backends.map((_item, index) => `Bearer ${sessions.issue(`tenant-${index}`, { token: "test-token", username: "test", email: "test@example.invalid", nextStep: "DONE" }).token}`);
  const context = new SessionContext(tenants, sessions);
  const uploads: UploadConcurrency = { active: 0 };
  const limiter = { calls: 0 };
  const uploadLimiter: RequestHandler = (_req, _res, next) => { limiter.calls++; next(); };
  const routers = new Map(tenants.list().map((tenant) => {
    const upstream = tenants.get(tenant.id).upstream;
    const router = express.Router();
    router.use(createPanelRouter(upstream, uploadLimiter, uploads));
    router.use(assignmentRouter(upstream, uploadLimiter, uploads));
    return [tenant.id, router];
  }));
  const app = express();
  app.set("query parser", "simple");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/assignments", context.middleware(), (req, res, next) => {
    const router = routers.get(context.get(req).session.tenantId);
    if (!router) throw new Error("TEST_TENANT_NOT_FOUND");
    router(req, res, next);
  });
  app.use((_req, res) => { res.status(404).json({ error: "NOT_FOUND" }); });
  app.use(context.invalidateUnauthorized);
  app.use(errorHandler);
  const baseUrl = await listen(t, createServer(app));
  async function request(path: string, method = "GET", body?: unknown, token: string | null = tokens[0]!) {
    const headers = new Headers();
    if (token !== null) headers.set("Authorization", token);
    if (body !== undefined && !(body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const data: unknown = await response.json();
    return { response, data };
  }
  return { request, uploads, limiter, tokens };
}

async function harness(t: TestContext) {
  const upstream = await backend(t);
  return { ...upstream, ...await gateway(t, [upstream]) };
}

function document(bytes = pdf, name = "Inspección.pdf", count = 1): FormData {
  const form = new FormData();
  for (let index = 0; index < count; index++) form.append("files", new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }), name);
  return form;
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("group files resolve canonical OT IDs, maintenance roots and the first unambiguous direct work", async (t) => {
  const { request, state } = await harness(t);
  for (const [assigned, expected] of [
    [group({ id: "external-300", type: "external_ot", workOrderNumber: 81, status: "delivered" }), "/api/negotiation_files/300"],
    [group({ id: "maintenance-50", type: "internal_maintenance", status: "completed" }), "/api/maintenance_files/50"],
    [group({ works: [work({ id: "12" }), work({ id: "12" }), work({ id: "11" })] }), "/api/work_files/11"],
  ] as const) {
    state.assignments = assignments([assigned]);
    state.calls.length = 0;
    const result = await request(groupPath(assigned.id));
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.equal(panelFilesSchema.parse(result.data).data[0]?.size, 30);
    assert.equal(assignedReads(state.calls).length, 1);
    assert.equal(state.calls.at(-1)?.path, expected);
    assert.deepEqual(JSON.parse(state.calls.at(-1)!.query.get("filters")!), { companyBranchId: 1 });
  }
  state.assignments = assignments([group({ works: [] })]);
  assert.deepEqual((await request(groupPath("direct-11"))).data, { error: "GROUP_HAS_NO_OT" });
});

test("comments use only canonical panel routes and page 0..1000 with a fixed limit of 30", async (t) => {
  const { request, state } = await harness(t);
  for (const assigned of [group(), group({ id: "maintenance-50", type: "internal_maintenance" }), group({ id: "external-300", type: "external_ot" })]) {
    state.assignments = assignments([assigned]);
    state.calls.length = 0;
    state.comments = { ...comments, internal: "secret", data: [{ ...comments.data[0], cost: 123 }] };
    const result = await request(workPath(assigned.id, "11", "/comments", `${RANGE}&page=1000`));
    assert.equal(result.response.status, 200);
    assert.equal(panelCommentsSchema.parse(result.data).data[0]?.files[0]?.id, 7);
    assert.doesNotMatch(JSON.stringify(result.data), /secret|cost/);
    const call = state.calls.at(-1)!;
    assert.equal(call.path, `/api/technician-dashboard/panel/${assigned.id}/works/11/comments`);
    assert.deepEqual(Object.fromEntries(call.query), { ...Object.fromEntries(new URLSearchParams(RANGE)), groupType: assigned.type, page: "1000", limit: "30" });
    assert.deepEqual(Object.fromEntries(assignedReads(state.calls)[0]!.query), Object.fromEntries(new URLSearchParams(RANGE)));
    const created = await request(workPath(assigned.id), "POST", { text: "  Observación <válida>  " });
    assert.equal(created.response.status, 201);
    assert.deepEqual(state.calls.at(-1)?.json, { text: "Observación <válida>" });
    assert.equal(state.calls.at(-1)?.query.has("page"), false);
    assert.equal(state.calls.at(-1)?.query.has("limit"), false);
  }
  assert.ok(state.calls.every((call) => call.headers.authorization === TOKEN && call.headers.origin === "http://tenant-0.localhost:3000"));
  assert.equal(state.calls.some((call) => call.path.startsWith("/api/works/comments")), false);
});

test("raw query overrides, malformed IDs, extra bodies and page on non-comment reads are rejected", async (t) => {
  const { request, state } = await harness(t);
  for (const extra of ["target=11", "source=work", "tenant=other", "groupType=external_ot", "workId=11", "folderId=3", "companyBranchId=1", "page=0", "filters={}"]) {
    assert.equal((await request(groupPath("direct-11", "/files", `${RANGE}&${extra}`))).response.status, 400);
  }
  for (const page of ["-1", "1001", "1.5", "1e2", "00", "1&page=2", "1&page[x]=2"]) {
    assert.equal((await request(workPath("direct-11", "11", "/comments", `${RANGE}&page=${page}`))).response.status, 400);
  }
  for (const suffix of ["&limit=30", "&startDate=2026-09-01", "&tenantId=tenant-1"]) {
    assert.equal((await request(workPath("direct-11", "11", "/comments", RANGE + suffix))).response.status, 400);
  }
  for (const id of ["11oops", "0", "-1", "9007199254740992"]) assert.equal((await request(workPath("direct-11", id))).response.status, 400);
  assert.equal((await request(groupPath("external-9007199254740992"))).response.status, 400);
  assert.equal((await request(workPath("direct-11", "11", "/comments", "startDate=2026-02-30&endDate=2026-03-01&companyBranchId=1"))).response.status, 400);
  for (const input of [{ text: "" }, { text: "x".repeat(10001) }, { text: "x", tenant: "other" }, { text: "x", workId: 22 }, { text: "x", sourceType: "work" }, { text: "x", attachments: [] }]) {
    assert.equal((await request(workPath(), "POST", input)).response.status, 400);
  }
  assert.equal((await request(workPath("direct-11", "11", "/comments", `${RANGE}&page=1`), "POST", { text: "x" })).response.status, 400);
  assert.equal((await request(workPath("direct-11", "11", "/files/7"), "DELETE", { fileId: 7 })).response.status, 400);
  assert.equal(state.calls.length, 0);
});

test("group authorization rejects absent or duplicate groups, worker mismatch and foreign branch", async (t) => {
  const { request, state } = await harness(t);
  for (const data of [assignments([]), assignments([group(), group()])]) {
    state.assignments = data;
    assert.equal((await request(groupPath("direct-11"))).response.status, 404);
  }
  state.assignments = assignments();
  state.assignments.technician.id = 84;
  assert.equal((await request(groupPath("direct-11"))).response.status, 403);
  state.assignments = assignments();
  assert.equal((await request(groupPath("direct-11", "/files", RANGE.replace("BranchId=1", "BranchId=2")))).response.status, 403);
  assert.equal((await request(groupPath("direct-11"), "GET", undefined, null)).response.status, 401);
  assert.equal((await request(groupPath("direct-11"), "GET", undefined, TOKEN)).response.status, 401);
  assert.ok(state.calls.every((call) => ["/api/auth/me", "/api/technician-dashboard/assignments"].includes(call.path)));
});

test("work resources reject cross-source collisions, foreign work/step IDs and duplicate canonical children", async (t) => {
  const { request, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ responsibles: [] })] })]);
  for (const [groupId, workId] of [["external-50", "11"], ["maintenance-50", "12"], ["direct-11", "11"]]) {
    assert.equal((await request(workPath(groupId, workId))).response.status, 404);
    assert.equal((await request(workPath(groupId, workId), "POST", { text: "No autorizado" })).response.status, 404);
    assert.equal((await request(workPath(groupId, workId, "/documents"), "POST", document())).response.status, 404);
  }
  state.assignments = assignments([group({ works: [work(), work()] })]);
  assert.equal((await request(workPath())).response.status, 404);
  const duplicateSteps = work();
  duplicateSteps.checklists[0]!.steps = [step(), step()];
  state.assignments = assignments([group({ works: [duplicateSteps] })]);
  assert.equal((await request(workPath("direct-11", "11", "/steps/101/documents"), "POST", document())).response.status, 404);
  assert.equal(writes(state.calls).length, 0);
});

test("documents retain original UTF-8 names, force trusted MIME and allow finalized inherited resources", async (t) => {
  const { request, state, uploads, limiter } = await harness(t);
  for (const [assigned, path, expected, folderId] of [
    [group({ status: "delivered", works: [work({ status: "completed", canExecute: false, responsibles: [] })] }), workPath("direct-11", "11", "/documents"), "/api/work_files/11", undefined],
    [group({ id: "external-300", type: "external_ot" }), groupPath(), "/api/negotiation_files/300", undefined],
    [group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ status: "delivered", responsibles: [] })] }), workPath("maintenance-50", "11", "/documents"), "/api/maintenance_files/50", "maintenance_work_11"],
    [group({ id: "maintenance-50", type: "internal_maintenance" }), groupPath("maintenance-50"), "/api/maintenance_files/50", undefined],
  ] as const) {
    state.assignments = assignments([assigned]);
    state.calls.length = 0;
    const result = await request(path, "POST", document(pdf, "Informe técnico.pdf"));
    assert.equal(result.response.status, 201);
    assert.equal(assignedReads(state.calls).length, 2);
    const [call] = writes(state.calls);
    assert.equal(call?.path, expected);
    assert.equal(JSON.stringify(call?.json), JSON.stringify({ companyBranchId: "1", ...(folderId ? { folderId } : {}) }));
    assert.equal(call?.files[0]?.field, "attachments");
    assert.equal(Buffer.from(call!.files[0]!.name, "latin1").toString("utf8"), "Informe técnico.pdf");
    assert.equal(call?.files[0]?.mime, "application/pdf");
    assert.deepEqual(call?.files[0]?.bytes, pdf);
    assert.equal(uploads.active, 0);
  }
  assert.equal(limiter.calls, 4);
});

test("standard and maintenance steps upload one file through the new canonical endpoint without form fields", async (t) => {
  const { request, state } = await harness(t);
  for (const assigned of [group(), group({ id: "maintenance-50", type: "internal_maintenance", status: "delivered" })]) {
    state.assignments = assignments([assigned]);
    state.calls.length = 0;
    const result = await request(workPath(assigned.id, "11", "/steps/101/documents"), "POST", document(PNG, "Foto revisión.png"));
    assert.equal(result.response.status, 201);
    const [call] = writes(state.calls);
    assert.equal(call?.path, `/api/technician-dashboard/panel/${assigned.id}/works/11/steps/101/files`);
    assert.equal(call?.query.get("groupType"), assigned.type);
    assert.equal(call?.query.get("companyBranchId"), "1");
    assert.equal(JSON.stringify(call?.json), "{}");
    assert.equal(call?.files[0]?.field, "files");
    assert.equal(call?.files.length, 1);
    state.calls.length = 0;
    assert.equal((await request(workPath(assigned.id, "11", "/steps/102/documents"), "POST", document())).response.status, 404);
    assert.deepEqual((await request(workPath(assigned.id, "11", "/steps/101/documents"), "POST", document(heic, "original.heic"))).data, { error: "HEIC_STEP_DOCUMENT_UNSUPPORTED", message: "El backend no admite HEIC en pasos; convierta la imagen a JPEG o PNG." });
    assert.equal(writes(state.calls).length, 0);
  }
});

test("document multipart rejects extra files, destination fields, empty payloads and invalid content", async (t) => {
  const { request, state, uploads } = await harness(t);
  const injected = document();
  injected.append("folderId", "maintenance_work_22");
  const wrongField = new FormData();
  wrongField.append("attachments", new Blob([pdf]), "file.pdf");
  for (const form of [document(pdf, "a.pdf", 2), injected, wrongField, new FormData(), document(Buffer.alloc(0)), document(Buffer.from("<svg/>"), "fake.png"), document(Buffer.from("%PDFfake"), "fake.pdf")]) {
    assert.ok((await request(workPath("direct-11", "11", "/documents"), "POST", form)).response.status >= 400);
    assert.equal(uploads.active, 0);
  }
  assert.equal(writes(state.calls).length, 0);
});

test("file deletion requires a fresh owning list or exact step attachments and accepts void upstream success", async (t) => {
  const { request, state } = await harness(t);
  for (const [assigned, path, list] of [
    [group({ id: "external-300", type: "external_ot", status: "delivered" }), groupPath("external-300", "/files/7"), "/api/negotiation_files/300"],
    [group({ id: "maintenance-50", type: "internal_maintenance" }), groupPath("maintenance-50", "/files/7"), "/api/maintenance_files/50"],
    [group(), workPath("direct-11", "11", "/files/7"), "/api/work_files/11"],
    [group({ id: "maintenance-50", type: "internal_maintenance" }), workPath("maintenance-50", "11", "/files/7"), "/api/maintenance_files/50"],
  ] as const) {
    state.assignments = assignments([assigned]);
    state.calls.length = 0;
    assert.equal((await request(path, "DELETE")).response.status, 200);
    assert.equal(state.calls.some((call) => call.path === list), true);
    assert.deepEqual(writes(state.calls).map((call) => [call.method, call.path]), [["DELETE", "/api/files/7"]]);
    state.calls.length = 0;
    assert.equal((await request(path.replace("/files/7?", "/files/8?"), "DELETE")).response.status, 404);
    assert.equal(writes(state.calls).length, 0);
  }
  for (const assigned of [group(), group({ id: "maintenance-50", type: "internal_maintenance" })]) {
    assigned.works[0]!.checklists[0]!.steps = [step({ attachments: [file] })];
    state.assignments = assignments([assigned]);
    state.calls.length = 0;
    assert.equal((await request(workPath(assigned.id, "11", "/steps/101/files/7"), "DELETE")).response.status, 200);
    assert.equal(state.calls.some((call) => /_files\//.test(call.path)), false);
    state.calls.length = 0;
    assert.equal((await request(workPath(assigned.id, "11", "/steps/101/files/8"), "DELETE")).response.status, 404);
    assert.equal(writes(state.calls).length, 0);
  }
});

test("deletion checks later owned-file pages without taking caller filters or arbitrary file IDs", async (t) => {
  const { request, state } = await harness(t);
  state.pages = [{ data: [{ ...file, id: 6 }], totalRows: 2, totalPages: 2 }, { ...fileList, totalRows: 2, totalPages: 2 }];
  assert.equal((await request(workPath("direct-11", "11", "/files/7"), "DELETE")).response.status, 200);
  assert.deepEqual(state.calls.filter((call) => call.path === "/api/work_files/11").map((call) => JSON.parse(call.query.get("pagination")!)), [{ page: 0, limit: 1000 }, { page: 1, limit: 1000 }]);
});

test("all resource mutations revalidate assignment ownership after reading the initial snapshot", async (t) => {
  const { request, state, uploads } = await harness(t);
  for (const [path, method, body] of [
    [workPath(), "POST", { text: "Nota" }],
    [workPath("direct-11", "11", "/documents"), "POST", document()],
    [workPath("direct-11", "11", "/steps/101/documents"), "POST", document()],
    [workPath("direct-11", "11", "/files/7"), "DELETE", undefined],
    [groupPath("direct-11"), "POST", document()],
    [groupPath("direct-11", "/files/7"), "DELETE", undefined],
  ] as const) {
    state.calls.length = 0;
    state.sequence = [assignments(), assignments([])];
    assert.equal((await request(path, method, body)).response.status, 404);
    assert.equal(writes(state.calls).length, 0);
    assert.equal(uploads.active, 0);
  }
  const assigned = group();
  assigned.works[0]!.checklists[0]!.steps = [step({ attachments: [file] })];
  state.sequence = [assignments([assigned]), assignments()];
  assert.equal((await request(workPath("direct-11", "11", "/steps/101/files/7"), "DELETE")).response.status, 404);
  assert.equal(writes(state.calls).length, 0);
});

test("fresh authorization also catches a worker or branch revoked during multipart reception", async (t) => {
  const { request, state, uploads } = await harness(t);
  for (const revoke of [() => { state.user.workerId = 84; }, () => { state.user.accessBranchs = []; }]) {
    state.user = user();
    state.calls.length = 0;
    let reads = 0;
    state.beforeResponse = async (call) => {
      if (call.path === "/api/auth/me" && ++reads === 2) revoke();
    };
    assert.equal((await request(workPath("direct-11", "11", "/documents"), "POST", document())).response.status, 403);
    assert.equal(writes(state.calls).length, 0);
    assert.equal(uploads.active, 0);
  }
});

test("direct group delegation cannot change work while a document is being received", async (t) => {
  const { request, state } = await harness(t);
  state.sequence = [assignments(), assignments([group({ works: [work({ id: "12" })] })])];
  assert.equal((await request(groupPath("direct-11"), "POST", document())).response.status, 409);
  assert.equal(writes(state.calls).length, 0);
});

test("resource failures are not retried and release mutation locks and the shared upload slot", async (t) => {
  const { request, state, uploads } = await harness(t);
  state.failures.set("POST /api/work_files/11", { status: 503, body: { internal: "secret" } });
  const failed = await request(workPath("direct-11", "11", "/documents"), "POST", document());
  assert.equal(failed.response.status, 502);
  assert.equal(writes(state.calls).length, 1);
  assert.doesNotMatch(JSON.stringify(failed.data), /secret/);
  assert.equal(uploads.active, 0);
  state.failures.clear();
  assert.equal((await request(workPath("direct-11", "11", "/documents"), "POST", document())).response.status, 201);
  assert.equal(writes(state.calls).length, 2);
});

test("panel mutations use a per-work lock and the same two-upload budget as existing photo routes", { timeout: 10000 }, async (t) => {
  const { request, state, uploads } = await harness(t);
  state.assignments = assignments([group({ id: "external-300", type: "external_ot", works: [work(), work({ id: "12" }), work({ id: "13" })] })]);
  const firstStarted = deferred();
  const secondStarted = deferred();
  const release = deferred();
  t.after(release.resolve);
  state.beforeResponse = async (call) => {
    if (call.method !== "POST") return;
    if (call.path === "/api/work_files/11") { firstStarted.resolve(); await release.promise; }
    if (call.path === "/api/work_files/12") { secondStarted.resolve(); await release.promise; }
  };
  const first = request(workPath("external-300", "11", "/documents"), "POST", document());
  try {
    await firstStarted.promise;
    assert.equal((await request(workPath("external-300"), "POST", { text: "Concurrente" })).response.status, 409);
    const second = request(workPath("external-300", "12", "/files"), "POST", document(PNG, "photo.png"));
    try {
      await secondStarted.promise;
      assert.equal(uploads.active, 2);
      assert.equal((await request(workPath("external-300", "13", "/documents"), "POST", document())).response.status, 429);
    } finally { release.resolve(); await second; }
  } finally { release.resolve(); await first; }
  assert.equal(uploads.active, 0);
});

test("identical IDs remain tenant-bound through native opaque sessions", async (t) => {
  const a = await backend(t);
  const b = await backend(t);
  b.state.assignments = assignments([]);
  const { request, tokens } = await gateway(t, [a, b]);
  assert.equal((await request(workPath(), "POST", { text: "Tenant A" }, tokens[0])).response.status, 201);
  assert.equal(b.state.calls.length, 0);
  const countA = a.state.calls.length;
  assert.equal((await request(workPath(), "POST", { text: "Tenant B" }, tokens[1])).response.status, 404);
  assert.equal(a.state.calls.length, countA);
  assert.equal(writes(b.state.calls).length, 0);
  assert.ok(a.state.calls.every((call) => call.headers.origin === "http://tenant-0.localhost:3000"));
  assert.ok(b.state.calls.every((call) => call.headers.origin === "http://tenant-1.localhost:3000"));
});

function officeZip(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from("<xml>fixture</xml>");
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(bytes.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes);
    directory.push(entry, filename);
    offset += local.length + filename.length + bytes.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

test("document signatures support images, safe UTF-8 text and typed OOXML, not generic or active payloads", () => {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  for (const [bytes, name, mime] of [
    [PNG, "photo.exe", "image/png"], [Buffer.from([255, 216, 255, 224]), "photo.jpg", "image/jpeg"],
    [Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(4)]), "photo.webp", "image/webp"],
    [gif, "photo.gif", "image/gif"], [heic, "photo.heic", "image/heic"], [pdf, "file.pdf", "application/pdf"],
    [Buffer.from("Revisión técnica\n"), "nota.txt", "text/plain"], [Buffer.from("pieza,cantidad\nFiltro,1"), "datos.csv", "text/csv"],
    [officeZip(["[Content_Types].xml", "word/document.xml"]), "Informe.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    [officeZip(["[Content_Types].xml", "xl/workbook.xml"]), "Datos.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ] as const) assert.equal(detectDocument(bytes, name).mime, mime);
  for (const [bytes, name] of [
    [Buffer.from("<html>danger</html>"), "fake.txt"], [Buffer.from("<svg/>"), "fake.csv"], [Buffer.from([0xff, 0xfe, 1]), "fake.txt"],
    [Buffer.from("abc\0def"), "fake.csv"], [Buffer.from("MZexecutable"), "fake.txt"], [Buffer.from("ordinary text"), "old.doc"],
    [officeZip(["readme.txt"]), "fake.docx"], [officeZip(["[Content_Types].xml", "word/document.xml", "../escape.xml"]), "fake.docx"],
    [officeZip(["[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"]), "fake.docx"],
    [officeZip(["[Content_Types].xml", "word/document.xml", "xl/workbook.xml"]), "fake.docx"],
    [officeZip(["[Content_Types].xml", "word/document.xml", "payload.exe"]), "fake.docx"],
    [officeZip(["[Content_Types].xml", "word/document.xml"]).subarray(0, 80), "truncated.docx"],
  ] as const) assert.throws(() => detectDocument(bytes, name), GatewayError);
  assert.throws(() => detectDocument(Buffer.alloc(MAX_DOCUMENT_BYTES + 1), "large.pdf"), (error: unknown) => error instanceof GatewayError && error.status === 413);
  assert.throws(() => detectDocument(Buffer.alloc(0), "empty.txt"), GatewayError);
  assert.equal(documentFilename("C:\\temp\\Informe técnico.pdf", "pdf"), "Informe técnico.pdf");
  assert.equal(documentFilename(Buffer.from("Diagnóstico.xlsx", "utf8").toString("latin1"), "xlsx"), "Diagnóstico.xlsx");
  assert.equal(documentFilename("photo.exe", "png"), "photo.png");
  assert.equal(documentFilename("../CON.txt", "txt"), "_CON.txt");
  assert.ok(Buffer.byteLength(documentFilename(`${"á".repeat(300)}.pdf`, "pdf")) <= 240);
  assert.throws(() => documentFilename(`file.${"x".repeat(300)}`), GatewayError);
});