import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { LocalPhoto } from "../../domain/models";
import type { OfflineDocumentMetadata, OfflineOperation, OfflineReceipt } from "../../domain/offline";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { OfflineEngine } from "../engine";
import { updateState } from "../state";
import { fixture, uuid } from "./fakes";

const unexpected = "OFFLINE_SYNC_UNEXPECTED_RESPONSE";
const scope = { companyBranchId: 1, groupId: "direct-10", workId: "10", startDate: "2026-09-08", endDate: "2026-09-08" };
const bytes = new Uint8Array([0, 1, 2, 255]);
type Document = Extract<OfflineOperation, { kind: "document" }>;

async function legacy() {
  const f = fixture();
  f.files.sources.set("source:", bytes);
  const file = await f.files.own("a", { id: "draft", name: "evidencia original.pdf", mimeType: "application/pdf", uri: "source:" });
  const operation: Document = { id: uuid(1), kind: "document", file, scope, stepId: "9", sourceDraftId: "draft",
    status: "needs_review", lastError: unexpected, createdAt: 100, attempts: 1, nextAttemptAt: 3000 };
  await updateState(f.store, "a", (state) => { state.operations.push(operation); });
  let gets = 0;
  f.upstream.duringReceipt = () => { gets++; };
  const read = async () => (await f.store.read("a")).operations[0]!;
  return { ...f, operation, read, gets: () => gets };
}

test("historical unexpected document automatically recovers the exact UUID, scope, name, MIME and bytes", async () => {
  const f = await legacy();
  const calls: Array<{ metadata: OfflineDocumentMetadata; photo: LocalPhoto; bytes: Uint8Array }> = [];
  f.dependencies.upstream.offlineDocument = async (metadata, photo) => {
    calls.push({ metadata, photo, bytes: f.files.contents.get(photo.id)!.slice() });
    return { operationId: metadata.operationId, state: "applied", fileId: 321 };
  };
  const engine = new OfflineEngine(f.dependencies);
  await engine.syncNow();
  assert.equal(f.gets(), 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.metadata, { operationId: f.operation.id, scope, stepId: "9", sha256: f.operation.file.sha256 });
  assert.deepEqual(calls[0]!.photo, { ...f.operation.file, uri: `memory:${f.operation.file.id}` });
  assert.deepEqual(calls[0]!.bytes, bytes);
  const saved = await f.read();
  assert.ok(saved.kind === "document");
  assert.deepEqual(saved.file, f.operation.file);
  assert.equal(saved.sourceDraftId, "draft");
  assert.equal(saved.status, "applied");
  assert.equal((await f.store.read("a")).attachments[0]?.attachmentId, "321");
  f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(calls.length, 1);
  assert.equal(f.files.removes.length, 0);
});

for (const state of ["needs_review", "conflict", "rejected"] as const) test(`historical recovery stops at GET ${state}: zero POSTs even after restart`, async () => {
  const f = await legacy();
  f.upstream.receipts.set(f.operation.id, { operationId: f.operation.id, state, error: "MOBILE_SYNC_REQUIRES_REVIEW" });
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  assert.equal((await f.read()).status, state === "rejected" ? "blocked" : state);
  f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(f.gets(), 1); assert.equal(f.upstream.documents.length, 0);
  await assert.rejects(engine.retry(f.operation.id), /REVIEW/);
});

test("only exact legacy document needs_review without a local receipt is eligible", async () => {
  const f = await legacy();
  const held: OfflineOperation[] = [
    ...(["conflict", "blocked", "auth_required"] as const).map((status, index) => ({ ...f.operation, id: uuid(10 + index), status })),
    { ...f.operation, id: uuid(20), lastError: "MOBILE_SYNC_OPERATION_REUSED" },
    { ...f.operation, id: uuid(21), lastError: `${unexpected} ` },
    { ...f.operation, id: uuid(22), lastError: "OFFLINE_LOCAL_FILE_MISSING" },
    ...(["needs_review", "conflict", "rejected", "applied"] as const).map((state, index) => ({ ...f.operation, id: uuid(30 + index), receipt: { operationId: uuid(30 + index), state } })),
    { id: uuid(40), kind: "comment", scope, text: "unchanged", status: "needs_review", lastError: unexpected, attempts: 1, createdAt: 100, nextAttemptAt: 0 },
  ];
  await updateState(f.store, "a", (state) => { state.operations = structuredClone(held); });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.deepEqual((await f.store.read("a")).operations, held);
  assert.equal(f.gets(), 0); assert.equal(f.upstream.documents.length, 0);
});

test("GET in_progress persists a delay without POST and then verifies applied by identical POST", async () => {
  const f = await legacy();
  f.upstream.receiptError = new ApiError(409, "MOBILE_SYNC_IN_PROGRESS", "wait");
  await new OfflineEngine(f.dependencies).syncNow();
  const waiting = await f.read();
  assert.equal(waiting.status, "pending"); assert.ok(waiting.nextAttemptAt >= f.dependencies.now() + 5000);
  const restarted = new OfflineEngine(f.dependencies);
  f.advance(4999); await restarted.syncNow(); assert.equal(f.gets(), 1);
  f.upstream.receiptError = undefined;
  f.upstream.receipts.set(f.operation.id, { operationId: f.operation.id, state: "applied", fileId: 999 });
  f.advance(); await restarted.syncNow();
  assert.equal(f.upstream.documents.length, 1);
  assert.equal((await f.read()).receipt?.fileId, 101);
});

for (const lost of [new NetworkError("timeout"), new NetworkError("network")]) test(`lost ${lost.kind} response: identical replays have one effect and confirm only POST fileId`, async () => {
  const f = await legacy();
  let effects = 0;
  const submissions: string[] = [];
  f.dependencies.upstream.offlineDocument = async (metadata, photo) => {
    const actual = f.files.contents.get(photo.id)!;
    const signature = JSON.stringify({ metadata, name: photo.name, mimeType: photo.mimeType, sha256: createHash("sha256").update(actual).digest("hex") });
    submissions.push(signature);
    if (!f.upstream.receipts.has(metadata.operationId)) {
      effects++;
      f.upstream.receipts.set(metadata.operationId, { operationId: metadata.operationId, state: "applied", fileId: 55 });
      throw lost;
    }
    assert.equal(signature, submissions[0]);
    return f.upstream.receipts.get(metadata.operationId)!;
  };
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "pending");
  assert.equal((await f.store.read("a")).attachments.length, 0);
  await new OfflineEngine(f.dependencies).syncNow(); assert.equal(submissions.length, 1);
  f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(effects, 1); assert.equal(submissions.length, 2);
  assert.equal((await f.read()).status, "applied");
  assert.equal((await f.read()).receipt?.fileId, 55);
});

for (const viaReceipt of [false, true]) test(`applied GET cannot hide UUID/hash collision via ${viaReceipt ? "receipt" : "HTTP"}`, async () => {
  const f = await legacy();
  f.upstream.receipts.set(f.operation.id, { operationId: f.operation.id, state: "applied", fileId: 88 });
  let posts = 0;
  f.dependencies.upstream.offlineDocument = async (metadata) => {
    posts++;
    if (viaReceipt) return { operationId: metadata.operationId, state: "conflict", error: "MOBILE_SYNC_OPERATION_REUSED" };
    throw new ApiError(409, "MOBILE_SYNC_OPERATION_REUSED", "collision");
  };
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  assert.equal((await f.read()).status, "needs_review");
  assert.equal((await f.read()).lastError, "MOBILE_SYNC_OPERATION_REUSED");
  f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  await assert.rejects(engine.retry(f.operation.id), /REVIEW/);
  assert.equal(posts, 1); assert.equal(f.gets(), 1);
  assert.equal((await f.store.read("a")).attachments.length, 0);
});

for (const fault of ["missing", "changed-hash", "changed-size", "namespace", "unreadable", "no-fingerprint"] as const) test(`${fault}: owned copy fails closed before POST even with an applied GET`, async () => {
  const f = await legacy();
  f.upstream.receipts.set(f.operation.id, { operationId: f.operation.id, state: "applied", fileId: 88 });
  if (fault === "missing") f.files.files.clear();
  if (fault === "changed-hash") f.files.contents.set(f.operation.file.id, new Uint8Array([0, 1, 2, 254]));
  if (fault === "changed-size") f.files.contents.set(f.operation.file.id, new Uint8Array([1]));
  if (fault === "namespace") await updateState(f.store, "a", (state) => { const op = state.operations[0]; if (op?.kind === "document") op.file.namespace = "other-user"; });
  if (fault === "unreadable") f.files.fingerprint = async () => { throw new Error("file:///private/secret token=secret"); };
  if (fault === "no-fingerprint") f.dependencies.fileStore = { own: f.files.own.bind(f.files), resolveURI: f.files.resolveURI.bind(f.files), remove: f.files.remove.bind(f.files), releaseURLs: () => undefined };
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(f.upstream.documents.length, 0); assert.equal((await f.read()).status, "needs_review");
  assert.notEqual((await f.read()).lastError, unexpected);
  assert.doesNotMatch((await f.read()).lastError ?? "", /private|secret/);
  assert.equal((await f.store.read("a")).attachments.length, 0);
  f.advance(); await new OfflineEngine(f.dependencies).syncNow(); assert.equal(f.gets(), 1);
});

for (const fileId of [undefined, "", " ", 0, -1, 1.5, "0", "-1", "garbage", Number.MAX_SAFE_INTEGER + 1]) test(`document applied without valid fileId (${String(fileId)}) never confirms or binds a file`, async () => {
  const f = await legacy();
  f.upstream.receipts.set(f.operation.id, { operationId: f.operation.id, state: "applied", fileId: 88 });
  f.dependencies.upstream.offlineDocument = async (metadata) => ({ operationId: metadata.operationId, state: "applied", fileId });
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  assert.equal((await f.read()).status, "needs_review");
  assert.equal((await f.read()).lastError, "OFFLINE_DOCUMENT_FILE_ID_INVALID");
  assert.equal(engine.getSnapshot().lastSyncedAt, null);
  assert.equal((await f.store.read("a")).attachments.length, 0);
});

test("backend effect followed by crash and needs_review receipt is never replayed", async () => {
  const f = await legacy();
  let effects = 0; let posts = 0;
  f.dependencies.upstream.offlineDocument = async (metadata) => {
    posts++; effects++;
    f.upstream.receipts.set(metadata.operationId, { operationId: metadata.operationId, state: "needs_review", error: "MOBILE_SYNC_REQUIRES_REVIEW" });
    throw new NetworkError("timeout");
  };
  await new OfflineEngine(f.dependencies).syncNow(); f.advance();
  await new OfflineEngine(f.dependencies).syncNow(); f.advance();
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(effects, 1); assert.equal(posts, 1);
  assert.equal((await f.read()).status, "needs_review");
  assert.equal((await f.read()).receipt?.state, "needs_review");
});

test("persistent unknown error is reclassified once, survives restart, and never busy-loops", async () => {
  const f = await legacy();
  f.upstream.sendError = new Error("private/path secret native error");
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).lastError, "OFFLINE_DOCUMENT_SUBMISSION_FAILED");
  for (let index = 0; index < 10; index++) { f.advance(); await new OfflineEngine(f.dependencies).syncNow(); }
  assert.equal(f.upstream.documents.length, 1); assert.equal(f.gets(), 1);
  assert.equal((await f.read()).attempts, 2);
  assert.equal((await f.read()).status, "needs_review");
});

test("generic malformed receipt is diagnosed without exposing its content or retrying", async () => {
  const f = await legacy();
  f.dependencies.upstream.offlineReceipt = async () => ({ operationId: f.operation.id, state: "unexpected-private" } as unknown as OfflineReceipt);
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).lastError, "OFFLINE_RECEIPT_INVALID_RESPONSE");
  assert.equal(f.upstream.documents.length, 0);
});

test("HTTP invalid receipt is held without repeated document POSTs", async () => {
  const f = await legacy();
  f.upstream.sendError = new ApiError(502, "OFFLINE_INVALID_RECEIPT", "Invalid receipt");
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "needs_review");
  assert.equal((await f.read()).lastError, "OFFLINE_INVALID_RECEIPT");
  f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(f.upstream.documents.length, 1);
});

test("stop during integrity check retains the operation without sending", async () => {
  const f = await legacy(); const engine = new OfflineEngine(f.dependencies);
  f.files.fingerprint = async () => { engine.stop(); return f.operation.file; };
  await engine.syncNow();
  assert.equal(f.upstream.documents.length, 0);
  assert.equal((await f.read()).lastError, "OFFLINE_CYCLE_INTERRUPTED");
  assert.equal((await f.read()).status, "pending");
});