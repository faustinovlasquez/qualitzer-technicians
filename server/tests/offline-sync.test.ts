import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import { z } from "zod";
import { answerFromStep } from "../../src/domain/format";
import { normalizeChecklistAnswer } from "../../src/domain/checklistProgress";
import { receiptForOperation, syncAnswerFromStep, syncAnswerSchema, syncAnswersEqual, syncCommandSchema, toSyncAnswer } from "../../src/domain/offlineProtocol";
import type { OfflineCommand, OfflineDocumentMetadata } from "../../src/domain/offline";
import { DemoOfflineStore } from "../../src/infrastructure/offlineDemo";
import { ApiError } from "../../src/infrastructure/errors";
import { MAX_SYNC_MULTIPART_BYTES } from "../offline/upload";
import { PNG, step, TOKEN } from "./fixtures";
import { assignmentCalls, errorCode, gatewayHarness, gatewayToken, harness, jsonRequest, loginGateway, mockBackend, uploadRequest, writeCalls } from "./mock-upstream";

const id = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
const otherId = "52b5201d-4ea9-4dad-9f9d-191d11ea8462";
const scope = { groupId: "direct-11", workId: "11", companyBranchId: 1, startDate: "2026-09-01", endDate: "2026-09-07" };
const command: OfflineCommand = { operationId: id, kind: "comment", scope, payload: { text: "Revisión local" } };
const applied = { operationId: id, state: "applied" };
const upstreamCommands = "/api/mobile-sync/commands";
const upstreamDocuments = "/api/mobile-sync/documents";
const upstreamReceipt = `/api/mobile-sync/receipts/${id}`;
const receiptPath = `/api/offline/receipts/${id}?companyBranchId=1`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const metadata: OfflineDocumentMetadata = { operationId: id, scope, sha256: hash(PNG) };
function documentForm(input: object = metadata, bytes: Buffer = PNG, name = "evidencia.png", mime = "image/png") {
  const form = new FormData();
  form.append("metadata", JSON.stringify(input));
  form.append("files", new Blob([new Uint8Array(bytes)], { type: mime }), name);
  return form;
}

test("offline authenticates before its 64KiB JSON parser, checks fresh actor/branch and never assigns from client IDs", async (t) => {
  const { state, baseUrl } = await harness(t);
  const denied = await fetch(`${baseUrl}/api/offline/commands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(denied.status, 401);
  assert.equal(state.calls.length, 0);
  state.failures.set(upstreamCommands, { status: 200, body: applied });
  assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...command, scope: { ...scope, companyBranchId: 2 } })).response.status, 403);
  state.user.workerId = null;
  assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", command)).response.status, 403);
  state.user.workerId = 42;
  state.assignments.groups = [];
  for (let index = 0; index < 2; index++) assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", command)).response.status, 200);
  assert.equal(assignmentCalls(state).length, 0);
  assert.equal(writeCalls(state).length, 2);
  assert.ok(state.calls.every((call) => call.headers.authorization === TOKEN));
});

test("offline canonical answers preserve false/NA and compare source representation, not mobile completion flags", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(upstreamCommands, { status: 200, body: applied });
  for (const value of [false, true, null, "not_applicable"] as const) {
    const source = step({ type: "validation", isCompleted: value === "not_applicable" ? null : value, selectValue: value === "not_applicable" ? value : "" });
    const mobile = normalizeChecklistAnswer(source, answerFromStep(source));
    const canonical = toSyncAnswer(source.type, mobile);
    assert.deepEqual(canonical, syncAnswerFromStep(source));
    const body = { ...command, kind: "answer", payload: { stepId: "101", answer: canonical, base: syncAnswerFromStep(source) } };
    assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", body)).response.status, 200);
    assert.deepEqual(writeCalls(state).at(-1)?.json, syncCommandSchema.parse(body));
    assert.equal(canonical.isCompleted, typeof value === "boolean" ? value : null);
  }
  for (const type of ["number", "text", "select", "approval", "multiselect"] as const) {
    const source = step({ type, responseValue: type === "number" ? "0" : type === "text" ? "texto" : "", selectValue: ["select", "approval"].includes(type) ? "approved" : "", optionsSelectValue: type === "multiselect" ? [{ value: "x", label: "X" }] : [] });
    const mobile = normalizeChecklistAnswer(source, answerFromStep(source));
    assert.equal(mobile.isCompleted, true);
    assert.equal(toSyncAnswer(type, mobile).isCompleted, null);
    assert.deepEqual(toSyncAnswer(type, mobile), syncAnswerFromStep(source));
  }
  const a = syncAnswerSchema.parse({ optionsSelectValue: [{ value: "b", label: "B" }, { value: "a", label: "A" }] });
  const b = syncAnswerSchema.parse({ optionsSelectValue: [{ value: "a", label: "Uno" }, { value: "b", label: "Dos" }] });
  assert.equal(syncAnswersEqual(a, b), true);
});

test("offline rejects local/noncanonical IDs, actor overrides, invalid ranges and legacy answer flags before forwarding", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const patch of [{ groupId: "local-11" }, { groupId: "direct-01" }, { workId: "01" }, { workId: -1 }, { workId: "0" }, { workId: "local-11" }, { groupId: "external-9007199254740992" }, { companyBranchId: "1" }, { startDate: "2026-02-30" }, { endDate: "2027-01-01" }, { userId: 9 }]) {
    assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...command, scope: { ...scope, ...patch } })).response.status, 400);
  }
  assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...command, kind: "answer", payload: { stepId: "101", answer: answerFromStep(step()), base: answerFromStep(step()) } })).response.status, 400);
  assert.equal((await jsonRequest(baseUrl, `${receiptPath}&workerId=42`)).response.status, 400);
  assert.equal(writeCalls(state).length, 0);
});

test("offline preserves structured 400/409 receipts, in-progress and collision hold, dropping credentials", async (t) => {
  const { state, baseUrl } = await harness(t);
  const results = [
    { status: 200, state: "applied", error: undefined },
    { status: 400, state: "rejected", error: "MOBILE_SYNC_INVALID_ANSWER" },
    { status: 409, state: "conflict", error: "MOBILE_SYNC_BASE_CONFLICT" },
    { status: 409, state: "needs_review", error: "MOBILE_SYNC_REQUIRES_REVIEW" },
    { status: 409, state: "in_progress", error: "MOBILE_SYNC_IN_PROGRESS" },
    { status: 409, state: "conflict", error: "MOBILE_SYNC_OPERATION_REUSED" },
  ];
  for (const result of results) {
    state.failures.set(upstreamCommands, { status: result.status, body: { ...result, operationId: id, token: "SECRET", sql: "SECRET", message: "SECRET" } });
    const response = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
    assert.equal(response.response.status, result.status);
    assert.equal(z.object({ state: z.string() }).parse(response.data).state, result.error === "MOBILE_SYNC_OPERATION_REUSED" ? "needs_review" : result.state);
    assert.doesNotMatch(JSON.stringify(response.data), /SECRET|token|sql|message|status/);
    assert.equal(response.response.headers.get("cache-control"), "no-store");
    if (result.state === "in_progress") assert.equal(response.response.headers.get("retry-after"), "5");
  }
});

test("offline never interprets generic 409, mismatched UUID or fabricated receipt as applied", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const [status, body] of [[409, { error: "SECRET", token: "SECRET" }], [200, { ...applied, operationId: otherId }], [409, applied], [200, { ...applied, success: false }], [200, { ...applied, error: "MOBILE_SYNC_BASE_CONFLICT" }], [200, { ...applied, fileId: "123" }]] as const) {
    state.failures.set(upstreamCommands, { status, body });
    const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
    assert.ok(result.response.status >= 400);
    assert.doesNotMatch(JSON.stringify(result.data), /applied|SECRET|token/);
  }
  assert.equal(receiptForOperation({ ...applied, operationId: otherId }, id, 200), null);
  state.failures.set(upstreamReceipt, { status: 404, body: { operationId: otherId, state: "rejected", error: "MOBILE_SYNC_RECEIPT_NOT_FOUND" } });
  const invalidNotFound = await jsonRequest(baseUrl, receiptPath);
  assert.equal(invalidNotFound.response.status, 502);
  assert.notEqual(errorCode(invalidNotFound.data), "OFFLINE_RECEIPT_NOT_FOUND");
});

test("offline receipt 404 maps only explicit not-found; missing routes never authorize replay and lost assignment doesn't block read", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.assignments.groups = [];
  for (const [body, expected] of [[{ error: "MOBILE_SYNC_RECEIPT_NOT_FOUND" }, "OFFLINE_RECEIPT_NOT_FOUND"], [{ error: "NOT_FOUND" }, "OFFLINE_SYNC_ROUTE_NOT_FOUND"], ["Cannot GET /mobile-sync/receipts SECRET", "OFFLINE_SYNC_ROUTE_NOT_FOUND"]] as const) {
    state.failures.set(upstreamReceipt, { status: 404, body });
    const result = await jsonRequest(baseUrl, receiptPath);
    assert.equal(errorCode(result.data), expected);
    assert.equal(writeCalls(state).length, 0);
  }
  state.failures.set(upstreamReceipt, { status: 200, body: applied });
  assert.deepEqual((await jsonRequest(baseUrl, receiptPath)).data, applied);
  state.failures.set(upstreamReceipt, { status: 409, body: { operationId: id, state: "in_progress", error: "MOBILE_SYNC_IN_PROGRESS" } });
  assert.equal((await jsonRequest(baseUrl, receiptPath)).response.status, 409);
  assert.equal(assignmentCalls(state).length, 0);
});

test("offline documents verify byte SHA before forward, strip metadata SHA and never fabricate fileId", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(upstreamDocuments, { status: 200, body: applied });
  const wrong = await uploadRequest(baseUrl, "/api/offline/documents", documentForm({ ...metadata, sha256: "0".repeat(64) }));
  assert.equal(errorCode(wrong.data), "OFFLINE_DOCUMENT_DIGEST_MISMATCH");
  assert.equal(writeCalls(state).length, 0);
  assert.equal((await uploadRequest(baseUrl, "/api/offline/documents", documentForm(), null)).response.status, 401);
  const success = await uploadRequest(baseUrl, "/api/offline/documents", documentForm());
  assert.deepEqual(success.data, applied);
  const call = writeCalls(state)[0]!;
  const upstreamMetadata = JSON.parse(z.object({ metadata: z.string() }).parse(call.json).metadata);
  assert.deepEqual(upstreamMetadata, { operationId: id, scope: { ...scope, workId: 11 } });
  assert.deepEqual(call.files[0]?.bytes, PNG);
  assert.equal(call.files[0]?.name, "evidencia.png");
  assert.equal(call.files[0]?.mime, "image/png");
});

test("offline multipart rejects extra/duplicate metadata, multiple files, oversized fields, dangerous types and MIME mismatches", async (t) => {
  const { state, baseUrl } = await harness(t);
  const duplicate = documentForm(); duplicate.append("metadata", JSON.stringify(metadata));
  const extra = documentForm(); extra.append("userId", "9");
  const two = documentForm(); two.append("files", new Blob([PNG]), "two.png");
  const huge = documentForm({ ...metadata, unknown: "x".repeat(16384) });
  for (const body of [duplicate, extra, two, huge, documentForm(metadata, PNG, "bad.exe"), documentForm(metadata, PNG, "photo.png", "text/plain"), documentForm({ ...metadata, userId: 9 })]) {
    assert.ok((await uploadRequest(baseUrl, "/api/offline/documents", body)).response.status >= 400);
  }
  for (const [content, name, mime] of [["=SUM(A1)", "data.csv", "text/csv"], ["<svg></svg>", "data.txt", "text/plain"], ["%PDF-1.7\n/Java#53cript\n%%EOF", "data.pdf", "application/pdf"]]) {
    const bytes = Buffer.from(content!);
    assert.equal((await uploadRequest(baseUrl, "/api/offline/documents", documentForm({ ...metadata, sha256: hash(bytes) }, bytes, name, mime))).response.status, 415);
  }
  assert.equal(writeCalls(state).length, 0);
});

test("offline 64KiB JSON is route specific and auth JSON limit remains 32KiB", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(upstreamCommands, { status: 200, body: applied });
  const answer = syncAnswerSchema.parse({ responseValue: "a".repeat(10000), comment: "b".repeat(10000) });
  const body = { ...command, kind: "answer", payload: { stepId: "101", answer, base: answer } };
  assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", body)).response.status, 200);
  assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...body, extra: "x".repeat(66000) })).response.status, 413);
  assert.equal((await jsonRequest(baseUrl, "/api/auth/login", "POST", { extra: "x".repeat(33000) }, null)).response.status, 413);
});

test("offline accepts exactly 25MiB and rejects excess file bytes or compressed uploads without forwarding", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(upstreamDocuments, { status: 200, body: applied });
  const bytes = Buffer.alloc(25 * 1024 * 1024, 65);
  assert.equal((await uploadRequest(baseUrl, "/api/offline/documents", documentForm({ ...metadata, sha256: hash(bytes) }, bytes, "large.txt", "text/plain"))).response.status, 200);
  assert.equal(writeCalls(state).length, 1);
  const excess = Buffer.alloc(bytes.length + 1, 65);
  assert.equal((await uploadRequest(baseUrl, "/api/offline/documents", documentForm({ ...metadata, sha256: hash(excess) }, excess, "large.txt", "text/plain"))).response.status, 413);
  for (const path of ["commands", "documents"]) {
    const compressed = await fetch(`${baseUrl}/api/offline/${path}`, { method: "POST", headers: { Authorization: gatewayToken(baseUrl), "Content-Type": path === "commands" ? "application/json" : "multipart/form-data; boundary=x", "Content-Encoding": "gzip" }, body: "not compressed" });
    assert.equal(compressed.status, 415);
  }
  assert.equal(writeCalls(state).length, 1);
});

test("offline bounds chunked multipart bytes including preamble without trusting Content-Length", async (t) => {
  const { state, baseUrl } = await harness(t);
  const status = await new Promise<number | null>((resolve, reject) => {
    const req = httpRequest(`${baseUrl}/api/offline/documents`, { method: "POST", headers: { Authorization: gatewayToken(baseUrl), "Content-Type": "multipart/form-data; boundary=x", "Transfer-Encoding": "chunked" } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? null));
    });
    req.once("error", (error: NodeJS.ErrnoException) => error.code === "ECONNRESET" || error.code === "EPIPE" ? resolve(null) : reject(error));
    req.end(Buffer.alloc(MAX_SYNC_MULTIPART_BYTES + 1, 65));
  });
  assert.ok(status === null || status === 413);
  assert.equal(writeCalls(state).length, 0);
});

test("offline sessions isolate identical UUIDs and reject tenant assertion changes without replay", async (t) => {
  const a = await mockBackend(t);
  const b = await mockBackend(t);
  const { baseUrl } = await gatewayHarness(t, { tenants: [
    { id: "first", name: "First", backendUrl: a.backendUrl, tenantOrigin: "http://first.localhost:3000", environment: "development", enabled: true },
    { id: "second", name: "Second", backendUrl: b.backendUrl, tenantOrigin: "http://second.localhost:3000", environment: "development", enabled: true },
  ] });
  const loginA = await loginGateway(baseUrl, "first");
  const loginB = await loginGateway(baseUrl, "second");
  a.state.calls.length = b.state.calls.length = 0;
  a.state.failures.set(upstreamReceipt, { status: 200, body: applied });
  b.state.failures.set(upstreamReceipt, { status: 404, body: { error: "MOBILE_SYNC_RECEIPT_NOT_FOUND" } });
  assert.deepEqual((await jsonRequest(baseUrl, receiptPath, "GET", undefined, loginA.token)).data, applied);
  assert.equal(b.state.calls.length, 0);
  assert.equal(errorCode((await jsonRequest(baseUrl, receiptPath, "GET", undefined, loginB.token)).data), "OFFLINE_RECEIPT_NOT_FOUND");
  const count = a.state.calls.length + b.state.calls.length;
  const forged = await fetch(`${baseUrl}${receiptPath}`, { headers: { Authorization: loginA.token, "X-Qualitzer-Tenant": "second" } });
  assert.equal(forged.status, 409);
  assert.equal(a.state.calls.length + b.state.calls.length, count);
  assert.equal(writeCalls(a.state).length + writeCalls(b.state).length, 0);
});

test("offline shares the existing global two-upload counter across routes", async (t) => {
  const { state, baseUrl } = await harness(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered = 0;
  let ready!: () => void;
  const both = new Promise<void>((resolve) => { ready = resolve; });
  state.failures.set(upstreamDocuments, { status: 200, body: applied });
  state.beforeResponse = async (call) => { if (call.path === upstreamDocuments) { entered++; if (entered === 2) ready(); await gate; } };
  const pending = [uploadRequest(baseUrl, "/api/offline/documents", documentForm()), uploadRequest(baseUrl, "/api/offline/documents", documentForm())];
  try {
    await both;
    const busy = await uploadRequest(baseUrl, "/api/assignments/direct-11/works/11/documents?startDate=2026-09-01&endDate=2026-09-07&companyBranchId=1", documentForm());
    assert.equal(errorCode(busy.data), "UPLOAD_BUSY");
  } finally { release(); await Promise.all(pending); }
});

test("demo offline verifies exact payload and file bytes, shares receipt state, exposes real optional ID and writes once", async () => {
  let writes = 0;
  let nextFileId = 10000;
  let bytes = PNG;
  const store = new DemoOfflineStore({ branchId: 1, hash: async (value) => hash(value), readFile: async () => ({ bytes, uri: "data:image/png;base64,captured" }),
    command: async () => { writes++; }, document: async () => { writes++; return { fileId: nextFileId++ }; } });
  assert.deepEqual(await store.command(command), applied);
  assert.deepEqual(await store.command(command), applied);
  assert.equal((await store.command({ ...command, payload: { text: "Diferente" } })).state, "needs_review");
  assert.equal(writes, 1);
  assert.deepEqual(await store.receipt(id, 1), applied);
  await assert.rejects(store.receipt(id, 2), (error: unknown) => error instanceof ApiError && error.status === 403);
  const file = { id: "local-file", uri: "file:///local", name: "evidencia.png", mimeType: "image/png" };
  const input = { ...metadata, operationId: otherId };
  assert.deepEqual(await store.document(input, file), { operationId: otherId, state: "applied", fileId: 10000 });
  assert.deepEqual(await store.document(input, { ...file, uri: "file:///different-but-identical" }), { operationId: otherId, state: "applied", fileId: 10000 });
  bytes = Buffer.from("changed");
  await assert.rejects(store.document(input, file), (error: unknown) => error instanceof ApiError && error.code === "OFFLINE_DOCUMENT_DIGEST_MISMATCH");
  assert.equal((await store.document({ ...input, sha256: hash(bytes) }, file)).state, "needs_review");
  assert.equal(writes, 2);
});

test("demo concurrent identical operations return in-progress without a second effect; ambiguous effect stays held", async () => {
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const store = new DemoOfflineStore({ branchId: 1, hash: async (bytes) => hash(bytes), readFile: async () => ({ bytes: PNG, uri: "captured" }), document: async () => {}, command: async () => { writes++; entered(); await gate; throw new Error("SECRET"); } });
  const first = store.command(command);
  await ready;
  try {
    await assert.rejects(store.command(command), (error: unknown) => error instanceof ApiError && error.code === "MOBILE_SYNC_IN_PROGRESS");
    await assert.rejects(store.receipt(id, 1), (error: unknown) => error instanceof ApiError && error.code === "MOBILE_SYNC_IN_PROGRESS");
  } finally { release(); }
  const result = await first;
  assert.equal(result.state, "needs_review");
  assert.deepEqual(await store.command(command), result);
  assert.equal(writes, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});