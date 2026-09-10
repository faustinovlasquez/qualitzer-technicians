/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, NetworkError, classifyTransportError } from "../../infrastructure/errors";
import { OfflineQueuedError, isOfflineQueuedError, type OfflineOperation } from "../../domain/offline";
import { OFFLINE_LIMITS } from "../contracts";
import { OfflineEngine, backoffMs, canUseCache, resolveScope, sameOfflineUser } from "../engine";
import { cloneState, decodeState, emptyState, hasPendingChanges, putCache, updateState, validateQuota } from "../state";
import { overlayCreations } from "../overlay";
import { creation, fixture, MemoryStore, result, user, uuid } from "./fakes";
import type { Assignments, LocalPhoto, Session } from "../../domain/models";
import type { OfflineDocumentMetadata } from "../../domain/offline";

const base = (id = 1) => ({ id: uuid(id), createdAt: 100, status: "pending" as const, attempts: 0, nextAttemptAt: 0 });
const create = (id = 1): OfflineOperation => ({ ...base(id), kind: "create", input: creation(id), localGroupId: `local-${uuid(id)}`, localWorkId: `local-${uuid(id)}` });
const scope = { companyBranchId: 1, groupId: "direct-10", workId: "10", startDate: "2026-09-08", endDate: "2026-09-08" };
const comment = (id = 2): OfflineOperation => ({ ...base(id), kind: "comment", scope, text: "Comentario" });

test("commit precedes all network writes and survives engine replacement", async () => {
  const f = fixture(); f.connect(false);
  await new OfflineEngine(f.dependencies).enqueue([create()]);
  assert.equal(f.upstream.creates.length, 0);
  const restarted = new OfflineEngine(f.dependencies); await restarted.refresh();
  assert.equal(restarted.getSnapshot().pending, 1);
});
test("failed durable commit never calls remote", async () => {
  const f = fixture(); f.store.failWrites = true;
  await assert.rejects(new OfflineEngine(f.dependencies).enqueue([create()]));
  assert.equal(f.upstream.creates.length, 0);
});
test("CAS conflicts retry without duplicating queue items", async () => {
  const f = fixture(); f.store.conflicts = 3;
  const e = new OfflineEngine(f.dependencies); await e.enqueue([create()]);
  assert.equal((await f.store.read("a")).operations.length, 1);
});
test("concurrent writers preserve both commands", async () => {
  const f = fixture();
  await Promise.all([new OfflineEngine(f.dependencies).enqueue([comment(1)]), new OfflineEngine(f.dependencies).enqueue([comment(2)])]);
  assert.equal((await f.store.read("a")).operations.length, 2);
});
test("namespaces isolate queues and cache entries", async () => {
  const store = new MemoryStore(); const f = fixture("first", store); const other = fixture("second", store);
  await new OfflineEngine(f.dependencies).enqueue([create()]);
  await updateState(store, "first", (state) => putCache(state, { key: "me", json: "{}", fetchedAt: 1 }));
  assert.deepEqual(await other.store.read("second"), emptyState());
});
test("global pending check includes inactive namespaces", async () => {
  const f = fixture("old-user"); await new OfflineEngine(f.dependencies).enqueue([comment()]);
  assert.equal(await hasPendingChanges(f.store), true);
});
test("same creation UUID and input is idempotent locally", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  await e.enqueue([create()]); await e.enqueue([create()]);
  assert.equal((await f.store.read("a")).operations.length, 1);
});
test("edited creation UUID is rejected without overwriting original", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); await e.enqueue([create()]);
  const modified = create(); if (modified.kind === "create") modified.input.schedule.startTime = "08:00";
  await assert.rejects(e.enqueue([modified]), /REUSED/);
  assert.deepEqual((await f.store.read("a")).operations[0], create());
});
test("me is revalidated before every cycle", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  await e.enqueue([create()]); await e.syncNow(); await e.syncNow();
  assert.equal(f.upstream.verifyCount, 2); assert.equal(f.upstream.creates.length, 1);
});
test("401 blocks and retains queue; further cycles do not probe", async () => {
  const f = fixture(); f.upstream.verifyError = new ApiError(401, "UNAUTHORIZED", "No");
  const e = new OfflineEngine(f.dependencies); await e.enqueue([create()]); await e.syncNow(); await e.syncNow();
  assert.equal(e.getSnapshot().authBlocked, true); assert.equal(e.getSnapshot().operations[0]?.status, "auth_required");
  assert.equal(f.upstream.verifyCount, 1); assert.equal(f.upstream.creates.length, 0);
});
test("different authenticated worker cannot flush old namespace", async () => {
  const f = fixture(); f.upstream.identity.workerId = 8;
  const e = new OfflineEngine(f.dependencies); await e.enqueue([create()]); await e.syncNow();
  assert.equal(e.getSnapshot().authBlocked, true); assert.equal(f.upstream.creates.length, 0);
});
test("branch authorization is checked on current profile", () => {
  assert.equal(sameOfflineUser(user, { ...user, accessBranchs: [] }, 1), false);
  assert.equal(sameOfflineUser(user, { ...user, id: 3 }, 1), false);
});
test("native creation replay retains immutable UUID after uncertain response", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); f.upstream.sendError = new NetworkError("timeout");
  await e.enqueue([create()]); await e.syncNow(); f.upstream.sendError = undefined; f.advance(); await e.syncNow();
  assert.deepEqual(f.upstream.creates.map((input) => input.clientRequestId), [uuid(1), uuid(1)]);
  assert.equal(e.getSnapshot().pending, 0);
});
test("crashed syncing command checks receipt then replays identical POST to verify ownership", async () => {
  const f = fixture(); await updateState(f.store, "a", (state) => { state.operations = [{ ...comment(), status: "syncing" }]; });
  f.upstream.receipts.set(uuid(2), { operationId: uuid(2), state: "applied" });
  const e = new OfflineEngine(f.dependencies); await e.syncNow();
  assert.equal(f.upstream.commands.length, 1); assert.equal(e.getSnapshot().pending, 0);
});
test("unexpired lease held in another tab prevents sends", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); await e.enqueue([create()]);
  await updateState(f.store, "a", (state) => { state.lease = { owner: "other-tab", until: 999_000 }; });
  await e.syncNow(); assert.equal(f.upstream.verifyCount, 0); assert.equal(f.upstream.creates.length, 0);
});
test("expired lease permits restart and receipt recovery", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); await e.enqueue([comment()]);
  await updateState(f.store, "a", (state) => { state.lease = { owner: "crashed", until: 999 }; });
  await e.syncNow(); assert.equal(f.upstream.commands.length, 1); assert.equal(e.getSnapshot().pending, 0);
});
test("simultaneous engines claim only one flush lease", async () => {
  const f = fixture(); const a = new OfflineEngine(f.dependencies); const b = new OfflineEngine(f.dependencies);
  await a.enqueue([comment()]); await Promise.all([a.syncNow(), b.syncNow()]);
  assert.equal(f.upstream.commands.length, 1);
});
test("local child scope maps group and work IDs after parent creation", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  const child: OfflineOperation = { ...base(2), kind: "comment", scope: { ...scope, groupId: `local-${uuid(1)}`, workId: `local-${uuid(1)}` }, text: "Después", dependencyId: uuid(1) };
  await e.enqueue([child, create()]); await e.syncNow();
  assert.equal(f.upstream.commands[0]?.scope.groupId, "direct-80"); assert.equal(f.upstream.commands[0]?.scope.workId, "80");
  assert.equal(e.getSnapshot().pending, 0);
});
test("blocked parent keeps dependent operation unsent", async () => {
  const f = fixture(); f.upstream.sendError = new ApiError(403, "FORBIDDEN", "No");
  const child: OfflineOperation = { ...base(2), kind: "comment", scope, text: "Después", dependencyId: uuid(1) };
  const e = new OfflineEngine(f.dependencies); await e.enqueue([create(), child]); await e.syncNow();
  assert.equal(f.upstream.commands.length, 0); assert.equal(e.getSnapshot().pending, 2);
});
test("unresolved local IDs never reach upstream", () => {
  assert.equal(resolveScope({ ...scope, groupId: "local-unknown" }, []), null);
  assert.equal(resolveScope({ ...scope, workId: "local-unknown" }, []), null);
});
test("conflict receipt is retained without auto replay", async () => {
  const f = fixture(); f.upstream.receiptState = "conflict"; const e = new OfflineEngine(f.dependencies);
  await e.enqueue([comment()]); await e.syncNow(); f.advance(); await e.syncNow();
  assert.equal(e.getSnapshot().operations[0]?.status, "conflict"); assert.equal(f.upstream.commands.length, 1);
  await assert.rejects(e.retry(uuid(2)), /REVIEW/);
});
test("authorization rejection is held, never deleted", async () => {
  const f = fixture(); f.upstream.receiptState = "rejected"; const e = new OfflineEngine(f.dependencies);
  await e.enqueue([comment()]); await e.syncNow();
  assert.equal(e.getSnapshot().operations[0]?.status, "blocked"); assert.equal(await e.hasPendingChanges(), true);
});
test("needs_review receipt remains visible", async () => {
  const f = fixture(); f.upstream.receiptState = "needs_review"; const e = new OfflineEngine(f.dependencies);
  await e.enqueue([comment()]); await e.syncNow(); assert.equal(e.getSnapshot().conflicts, 1);
});
test("mismatched receipt ID cannot mark operation applied", async () => {
  const f = fixture(); f.upstream.receipts.set(uuid(2), { operationId: uuid(99), state: "applied" });
  const e = new OfflineEngine(f.dependencies); await e.enqueue([comment()]); await e.syncNow();
  assert.equal(e.getSnapshot().operations[0]?.status, "needs_review"); assert.equal(e.getSnapshot().pending, 1);
});
test("partial document upload verifies the first receipt by replaying its owned file", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  const files = await Promise.all([1, 2].map((id) => f.files.own("a", { id: String(id), uri: "fake:", name: `${id}.png`, mimeType: "image/png", size: 20 })));
  const operations: OfflineOperation[] = files.map((file, index) => ({ ...base(index + 1), kind: "document", scope, file }));
  await e.enqueue(operations); f.upstream.receipts.set(uuid(1), { operationId: uuid(1), state: "applied", fileId: "remote-1" });
  await e.syncNow();
  assert.equal(f.upstream.documents.length, 2); assert.equal(f.upstream.documents[0]?.operationId, uuid(1));
  assert.equal(e.getSnapshot().pending, 0); assert.equal(f.files.removes.length, 0);
});
test("missing local file blocks safely without calling document upload", async () => {
  const f = fixture(); const file = await f.files.own("a", { id: "1", uri: "fake:", name: "x", mimeType: "x" }); f.files.files.clear();
  const e = new OfflineEngine(f.dependencies); await e.enqueue([{ ...base(), kind: "document", scope, file }]); await e.syncNow();
  assert.equal(f.upstream.documents.length, 0); assert.equal(e.getSnapshot().operations[0]?.status, "needs_review");
});
test("cross-namespace file reference cannot be uploaded", async () => {
  const f = fixture(); const file = await f.files.own("different-user", { id: "1", uri: "fake:", name: "x", mimeType: "x" });
  const e = new OfflineEngine(f.dependencies); await e.enqueue([{ ...base(), kind: "document", scope, file }]); await e.syncNow();
  assert.equal(f.upstream.documents.length, 0); assert.equal(e.getSnapshot().pending, 1);
});
test("stop during revalidation prevents the mutation", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); f.upstream.duringVerify = async () => e.stop();
  await e.enqueue([create()]); await e.syncNow(); assert.equal(f.upstream.creates.length, 0);
});
test("stop during receipt lookup prevents subsequent POST", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); f.upstream.duringReceipt = () => e.stop();
  await e.enqueue([comment()]); await e.syncNow(); assert.equal(f.upstream.commands.length, 0);
});
test("cycle operation count is bounded", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); await e.enqueue(Array.from({ length: 35 }, (_, i) => comment(i + 1))); await e.syncNow();
  assert.equal(f.upstream.commands.length, OFFLINE_LIMITS.cycleOperations); assert.equal(e.getSnapshot().pending, 5);
});
test("network backoff is bounded and not immediately retried", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); f.upstream.sendError = new NetworkError("network");
  await e.enqueue([comment()]); await e.syncNow(); await e.syncNow();
  assert.equal(f.upstream.commands.length, 1); assert.equal(backoffMs(1000), OFFLINE_LIMITS.maxBackoffMs);
});
test("401 403 404 503 and invalid JSON never qualify as cache fallback", () => {
  for (const code of [401, 403, 404, 503]) assert.equal(canUseCache(new ApiError(code, "ERROR", "No")), false);
  assert.equal(canUseCache(new SyntaxError("Invalid JSON")), false); assert.equal(canUseCache(new NetworkError("timeout")), true);
});
test("cache is bounded without evicting queued commands", () => {
  const state = emptyState(); state.operations.push(comment());
  for (let i = 0; i < 250; i++) putCache(state, { key: String(i), json: "{}", fetchedAt: i });
  assert.equal(state.cache.length, OFFLINE_LIMITS.cacheEntries); assert.equal(state.operations.length, 1);
});
test("oversized cache insertion preserves previous value", () => {
  const state = emptyState(); putCache(state, { key: "day", json: "{}", fetchedAt: 1 });
  assert.throws(() => putCache(state, { key: "day", json: "x".repeat(OFFLINE_LIMITS.cacheBytes), fetchedAt: 2 }));
  assert.equal(state.cache[0]?.json, "{}");
});
test("25MiB per file and 500MiB global quota reject without eviction", () => {
  validateQuota(OFFLINE_LIMITS.fileBytes, OFFLINE_LIMITS.totalFileBytes - OFFLINE_LIMITS.fileBytes);
  for (const size of [0, -1, NaN, OFFLINE_LIMITS.fileBytes + 1]) assert.throws(() => validateQuota(size, 0));
  assert.throws(() => validateQuota(1, OFFLINE_LIMITS.totalFileBytes));
});
test("quota failure preserves already owned file", async () => {
  const f = fixture(); const file = await f.files.own("a", { id: "1", uri: "fake:", name: "x", mimeType: "x" }); f.files.used = OFFLINE_LIMITS.totalFileBytes;
  await assert.rejects(f.files.own("a", { id: "2", uri: "fake:", name: "y", mimeType: "y" }));
  assert.ok(f.files.files.has(file.id)); assert.equal(f.files.removes.length, 0);
});
test("versioned state rejects corruption instead of resetting pending data", () => {
  assert.throws(() => decodeState('{"version":2}')); assert.throws(() => decodeState("broken"));
  assert.deepEqual(cloneState(emptyState()), emptyState());
});
test("queued outcome is distinguishable and identifies durable ownership", () => {
  const error = new OfflineQueuedError({ operationId: uuid(1), operationIds: [uuid(1)], kind: "document", date: "2026-09-08", ownsFiles: true });
  assert.equal(isOfflineQueuedError(error), true); assert.equal(error.ownsFiles, true); assert.equal(isOfflineQueuedError(new Error()), false);
});
test("local overlay has no fabricated checklist or execution permission and deduplicates receipt binding", () => {
  const session: Session = { token: "test-only", user, tenant: user.tenant!, branchId: 1, mode: "live" };
  const assignments: Assignments = { generatedAt: "2026-09-08T00:00:00Z", technician: { id: user.workerId, name: user.name, allowEditExecutionTime: false }, summary: { totalGroups: 0, totalWorks: 0, activeWorks: 0, overdueWorks: 0, plannedMinutes: 0 }, groups: [] };
  const pending = overlayCreations(assignments, "2026-09-08", [create()], session);
  assert.equal(pending.groups[0]?.works[0]?.canExecute, false); assert.deepEqual(pending.groups[0]?.works[0]?.checklists, []);
  assert.equal(overlayCreations(assignments, "2026-09-09", [create()], session).groups.length, 0);
  const applied = create(); if (applied.kind === "create") { applied.status = "applied"; applied.result = result(applied.input); }
  const overlay = overlayCreations(assignments, "2026-09-08", [applied], session);
  assert.equal(overlayCreations(overlay, "2026-09-08", [applied], session).groups.length, 1);
});
test("Expo 57 native FetchError wrapper is classified without masking malformed JSON", () => {
  assert.ok(classifyTransportError(new Error("fetch failed: network connection lost"), false, true) instanceof NetworkError);
  assert.ok(classifyTransportError(new TypeError("Failed to fetch"), false, false) instanceof NetworkError);
  const parse = new SyntaxError("Invalid JSON");
  assert.equal(classifyTransportError(parse, false, true), parse);
  const body = new Error("Unsupported FormData implementation");
  assert.equal(classifyTransportError(body, false, true), body);
});

for (const duringGet of [true, false]) test(`in-progress ${duringGet ? "GET" : "POST"} retains exact command and durable minimum five-second delay`, async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  const error = new ApiError(409, "MOBILE_SYNC_IN_PROGRESS", "Processing");
  if (duringGet) f.upstream.receiptError = error; else f.upstream.sendError = error;
  await e.enqueue([comment()]); await e.syncNow();
  const op = (await f.store.read("a")).operations[0]!;
  assert.equal(op.status, "pending"); assert.equal(op.nextAttemptAt, 6000);
  assert.equal(op.id, uuid(2)); assert.ok(op.kind === "comment"); assert.equal(op.text, "Comentario");
  const restarted = new OfflineEngine(f.dependencies);
  f.upstream.receiptError = undefined; f.upstream.sendError = undefined;
  f.advance(4999); await restarted.retry(uuid(2));
  assert.equal((await f.store.read("a")).operations[0]!.attempts, 1);
  f.advance(1); await restarted.syncNow();
  assert.equal(restarted.getSnapshot().pending, 0);
});

for (const viaReceipt of [true, false]) test(`wrong-hash applied GET requires POST verification and ${viaReceipt ? "receipt" : "HTTP409"} collision is held permanently`, async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  f.upstream.receipts.set(uuid(2), { operationId: uuid(2), state: "applied" });
  f.upstream.offlineCommand = async (command) => {
    f.upstream.commands.push(command);
    if (!viaReceipt) throw new ApiError(409, "MOBILE_SYNC_OPERATION_REUSED", "Wrong hash");
    return { operationId: command.operationId, state: "conflict", error: "MOBILE_SYNC_OPERATION_REUSED" };
  };
  await e.enqueue([comment()]); await e.syncNow();
  assert.equal(e.getSnapshot().operations[0]!.status, "needs_review");
  assert.equal(e.getSnapshot().lastSyncedAt, null);
  const restarted = new OfflineEngine(f.dependencies); f.advance();
  await assert.rejects(restarted.retry(uuid(2)), /REVIEW/); await restarted.syncNow();
  assert.equal(f.upstream.commands.length, 1);
});

for (const state of ["conflict", "needs_review", "rejected"] as const) test(`GET ${state} does not send original payload again`, async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  f.upstream.receipts.set(uuid(2), { operationId: uuid(2), state });
  await e.enqueue([comment()]); await e.syncNow();
  assert.equal(f.upstream.commands.length, 0);
  await assert.rejects(e.retry(uuid(2)), /REVIEW/);
});

test("ambiguous applied comment replays the same UUID and text after restart", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  let first = true;
  f.upstream.offlineCommand = async (command) => {
    f.upstream.commands.push(structuredClone(command));
    f.upstream.receipts.set(command.operationId, { operationId: command.operationId, state: "applied" });
    if (first) { first = false; throw new NetworkError("timeout"); }
    return { operationId: command.operationId, state: "applied" };
  };
  await e.enqueue([comment()]); await e.syncNow(); f.advance();
  const restarted = new OfflineEngine(f.dependencies); await restarted.syncNow();
  assert.equal(f.upstream.commands.length, 2); assert.deepEqual(f.upstream.commands[1], f.upstream.commands[0]);
  assert.equal(restarted.getSnapshot().pending, 0);
});

test("wrong-hash document GET does not auto-ack or delete the owned copy", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  const file = await f.files.own("a", { id: "photo", name: "x.png", mimeType: "image/png", uri: "source:" });
  f.upstream.receipts.set(uuid(1), { operationId: uuid(1), state: "applied", fileId: 123 });
  f.upstream.sendError = new ApiError(409, "MOBILE_SYNC_OPERATION_REUSED", "Wrong hash");
  await e.enqueue([{ ...base(), kind: "document", scope, file }]); await e.syncNow();
  assert.equal(e.getSnapshot().operations[0]!.status, "needs_review");
  assert.equal(f.upstream.documents[0]!.sha256, file.sha256);
  assert.equal((await f.store.read("a")).attachments.length, 0);
  assert.equal(f.files.files.has(file.id), true); assert.equal(f.files.removes.length, 0);
});

test("start reads current connectivity and probes me even when displayed online is false", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies); f.connect(false);
  await e.enqueue([comment()]); await e.syncNow(); assert.equal(e.getSnapshot().online, false);
  f.connect(true);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { e.stop(); reject(new Error("PROBE_NOT_STARTED")); }, 1000);
    e.subscribe(() => { if (!e.getSnapshot().pending) { clearTimeout(timeout); e.stop(); resolve(); } });
    e.start();
  });
  assert.equal(f.upstream.verifyCount, 1); assert.equal(f.upstream.commands.length, 1);
});

test("network recovery event retries protected me despite an offline snapshot", async () => {
  const f = fixture(); let listener: ((connected: boolean) => void) | undefined;
  f.dependencies.connectivity.subscribe = (next) => { listener = next; return () => { listener = undefined; }; };
  const e = new OfflineEngine(f.dependencies);
  f.upstream.verifyError = new NetworkError("network"); await e.enqueue([comment()]); await e.syncNow();
  assert.equal(e.getSnapshot().online, false);
  f.upstream.verifyError = undefined;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { e.stop(); reject(new Error("RECOVERY_NOT_STARTED")); }, 1000);
    e.subscribe(() => { if (!e.getSnapshot().pending) { clearTimeout(timeout); e.stop(); resolve(); } });
    e.start(); listener?.(true);
  });
  assert.equal(f.upstream.verifyCount, 2);
});

test("ambiguous document replay verifies identical metadata and the same owned bytes after restart", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  const file = await f.files.own("a", { id: "source", uri: "source:", name: "x.png", mimeType: "image/png" });
  const calls: Array<{ metadata: OfflineDocumentMetadata; photo: LocalPhoto }> = [];
  f.dependencies.upstream.offlineDocument = async (metadata, photo) => {
    calls.push(structuredClone({ metadata, photo }));
    f.upstream.receipts.set(metadata.operationId, { operationId: metadata.operationId, state: "applied", fileId: 32 });
    if (calls.length === 1) throw new NetworkError("timeout");
    assert.deepEqual(calls[1], calls[0]);
    return { operationId: metadata.operationId, state: "applied", fileId: 32 };
  };
  await e.enqueue([{ ...base(), kind: "document", scope, file }]); await e.syncNow(); f.advance();
  const restarted = new OfflineEngine(f.dependencies); await restarted.syncNow();
  assert.equal(calls.length, 2); assert.equal(restarted.getSnapshot().pending, 0);
  assert.equal(f.files.removes.length, 0); assert.equal((await f.store.read("a")).attachments[0]!.file.id, file.id);
});

test("applied legacy document ID binding is reconstructed without duplicating or evicting bytes", async () => {
  const f = fixture();
  const file = await f.files.own("a", { id: "source", uri: "source:", name: "x.png", mimeType: "image/png" });
  const state = emptyState();
  state.operations.push({ ...base(), kind: "document", scope, file, status: "applied", receipt: { operationId: uuid(1), state: "applied", fileId: 32 } });
  const migrated = decodeState(JSON.stringify(state));
  assert.equal(migrated.attachments.length, 1); assert.equal(migrated.attachments[0]!.attachmentId, "32");
  assert.equal(cloneState(migrated).attachments.length, 1); assert.equal(f.files.files.size, 1);
});