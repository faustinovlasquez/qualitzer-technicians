/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TechnicianRepository } from "../../domain/TechnicianRepository";
import type { LocalPhoto, Session, StepAnswer, WorkScope } from "../../domain/models";
import { OfflineQueuedError, type OfflineCommand, type OfflineReceipt } from "../../domain/offline";
import { syncCommandSchema } from "../../domain/offlineProtocol";
import type { ChecklistCatalogPage } from "../../domain/checklistAssignment";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { OfflineTechnicianRepository } from "../OfflineTechnicianRepository";
import { OfflineEngine } from "../engine";
import { checklistCatalogCacheKey, localTimerElapsedSeconds } from "../queueIntentions";
import { resourceCacheKey } from "../cacheSchemas";
import { decodeState, updateState } from "../state";
import { assignmentsWithStep, creation, fixture, result, user } from "./fakes";

const scope: WorkScope = { companyBranchId: 1, groupId: "direct-80", workId: "80", startDate: "2026-09-08", endDate: "2026-09-08" };
const photo: LocalPhoto = { id: "stable-file-draft", uri: "source:photo", name: "proof.png", mimeType: "image/png", size: 10 };
const answer: StepAnswer = { responseValue: "Checked", isCompleted: true, executionStatus: "completed", comment: "Note" };
const catalog: ChecklistCatalogPage = { items: [{ id: 17, name: "Available", code: null, description: null, alreadyAssigned: false }], page: 0, pageSize: 20, hasMore: false };
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function queued(action: Promise<unknown>): Promise<OfflineQueuedError> {
  try { await action; } catch (error) { assert.ok(error instanceof OfflineQueuedError); return error; }
  throw new Error("EXPECTED_QUEUED_OUTCOME");
}
async function setup() {
  const f = fixture();
  const data = assignmentsWithStep();
  data.groups[0]!.works[0]!.canExecute = true;
  const unavailable = async (): Promise<never> => { throw new Error("UNEXPECTED_REMOTE_ACTION"); };
  const remote: TechnicianRepository = {
    me: () => f.upstream.me(), createRecord: (input) => f.upstream.createRecord(input),
    offlineReceipt: (id) => f.upstream.offlineReceipt(id), offlineCommand: (command) => f.upstream.offlineCommand(command), offlineDocument: (metadata) => f.upstream.offlineDocument(metadata),
    assignments: async () => structuredClone(data), checklistOptions: async () => structuredClone(catalog), attachChecklist: unavailable,
    files: unavailable, comments: unavailable, creationOptions: unavailable, health: unavailable, login: unavailable, logout: unavailable, forcePassword: unavailable,
    notificationStatus: unavailable, notificationInbox: unavailable, registerNotificationDevice: unavailable, unregisterNotificationDevice: unavailable,
    readNotification: unavailable, deleteNotification: unavailable, testNotification: unavailable, status: unavailable, answer: unavailable, stepFiles: unavailable,
    upload: unavailable, report: unavailable, addComment: unavailable, uploadDocuments: unavailable, deleteFile: unavailable, groupFiles: unavailable,
    uploadGroupFiles: unavailable, deleteGroupFile: unavailable, orderDelivery: unavailable, startOrder: unavailable, deliverOrder: unavailable,
  };
  const session: Session = { token: "test-only", tenant: user.tenant!, user, branchId: 1, mode: "live" };
  const dependencies = { ...f.dependencies, upstream: remote };
  const repository = new OfflineTechnicianRepository(remote, session, dependencies);
  await updateState(f.store, "a", (state) => {
    state.cache.push({ key: `assignments:${scope.startDate}`, json: JSON.stringify(data), fetchedAt: 100,
      coverage: { branchId: 1, date: scope.startDate, fetchedAt: 100 } });
    state.cache.push({ key: checklistCatalogCacheKey(scope, {}), json: JSON.stringify(catalog), fetchedAt: 100 });
  });
  return { ...f, data, remote, dependencies, session, repository };
}

for (const stage of ["me", "receipt", "send"] as const) test(`durable acceptance does not wait for an in-flight ${stage}`, { timeout: 3000 }, async () => {
  const f = await setup();
  const entered = deferred<void>(); const release = deferred<void>();
  if (stage === "me") f.upstream.duringVerify = async () => { entered.resolve(); await release.promise; };
  if (stage === "receipt") f.remote.offlineReceipt = async () => { entered.resolve(); await release.promise; return null; };
  if (stage === "send") f.remote.offlineCommand = async (command) => { entered.resolve(); await release.promise; return { operationId: command.operationId, state: "applied" }; };
  await queued(f.repository.addComment(scope, "Seed"));
  const cycle = f.repository.syncNow();
  await entered.promise;
  f.repository.engine.noteNetworkState(false);
  try {
    const outcomes = await Promise.all([
      queued(f.repository.createRecord(creation(22))), queued(f.repository.addComment(scope, "Unblocked comment")),
      queued(f.repository.answer(scope, "9", answer)), queued(f.repository.uploadDocuments(scope, [photo])),
      queued(f.repository.status(scope, { status: "in_progress", executionDates: [scope.startDate] })), queued(f.repository.attachChecklist(scope, 17)),
    ]);
    assert.deepEqual(outcomes.map((item) => item.kind), ["create", "comment", "answer", "document", "timer", "checklist"]);
    assert.equal(outcomes[3]!.ownsFiles, true);
    const state = await f.store.read("a");
    for (const outcome of outcomes) assert.ok(state.operations.some((operation) => operation.id === outcome.operationId && operation.status === "pending"));
    assert.equal(f.upstream.creates.length, 0); assert.equal(f.upstream.documents.length, 0);
  } finally { f.repository.stop(); release.resolve(); await cycle; }
});

test("fresh reception consults no connectivity, me, receipt or send and observers cannot undo acceptance", async () => {
  const f = await setup();
  f.dependencies.connectivity.current = async () => { throw new Error("NETWORK_WAIT_FORBIDDEN"); };
  f.repository.subscribe(() => { throw new Error("OBSERVER_FAILED"); });
  await queued(f.repository.status(scope, { status: "in_progress" }));
  await queued(f.repository.attachChecklist(scope, 17));
  const document = await queued(f.repository.uploadDocuments(scope, [photo]));
  assert.equal(document.ownsFiles, true); assert.equal(f.files.files.size, 1);
  assert.equal(f.upstream.verifyCount, 0); assert.equal(f.upstream.commands.length, 0); assert.equal(f.upstream.documents.length, 0);
  assert.equal(f.repository.getSnapshot().pending, 3);
});

for (const kind of ["create", "comment", "answer", "document", "timer", "checklist"] as const) test(`${kind} local write failure is not acceptance`, async () => {
  const f = await setup(); f.store.failWrites = true;
  const action = kind === "create" ? f.repository.createRecord(creation()) : kind === "comment" ? f.repository.addComment(scope, "Keep")
    : kind === "answer" ? f.repository.answer(scope, "9", answer) : kind === "document" ? f.repository.uploadDocuments(scope, [photo])
      : kind === "timer" ? f.repository.status(scope, { status: "in_progress" }) : f.repository.attachChecklist(scope, 17);
  await assert.rejects(action, (error: unknown) => error instanceof Error && !(error instanceof OfflineQueuedError) && error.message === "DISK_FULL");
  assert.equal((await f.store.read("a")).operations.length, 0); assert.equal(f.files.files.size, 0); assert.equal(f.upstream.verifyCount, 0);
});

test("already-applied creation and file reuse their committed results without a new effect or file copy", async () => {
  const f = await setup(); const input = creation(55);
  assert.ok(input.kind === "work");
  await queued(f.repository.createRecord(input)); await queued(f.repository.uploadDocuments(scope, [photo]));
  await f.repository.syncNow();
  const before = await f.store.read("a");
  const document = before.operations.find((op) => op.kind === "document"); assert.ok(document?.kind === "document");
  const savedFile = structuredClone(document.file); const receiptFileId = document.receipt?.fileId;
  f.dependencies.connectivity.current = async () => { throw new Error("NO_REVALIDATION"); };
  assert.deepEqual(await f.repository.createRecord(input), result(input));
  await f.repository.uploadDocuments(scope, [photo]);
  const after = await f.store.read("a");
  assert.equal(f.upstream.creates.length, 1); assert.equal(f.upstream.documents.length, 1); assert.equal(f.files.sequence, 1);
  assert.deepEqual(after.operations.find((op) => op.kind === "document"), document);
  assert.equal(document.sourceDraftId, photo.id); assert.deepEqual(document.file, savedFile); assert.ok(receiptFileId);
  await assert.rejects(f.repository.createRecord({ ...input, work: { ...input.work, title: "Changed" } }), /OPERATION_ID_REUSED/);
});

test("concurrent timer deduplication and start-pause-resume are atomic across engines and CAS retries", async () => {
  const f = await setup(); f.store.conflicts = 2;
  const other = new OfflineTechnicianRepository(f.remote, f.session, f.dependencies);
  const [first, duplicate] = await Promise.all([queued(f.repository.status(scope, { status: "in_progress" })), queued(other.status(scope, { status: "in_progress" }))]);
  assert.equal(first.operationId, duplicate.operationId);
  const pause = await queued(other.status(scope, { status: "paused" }));
  const resume = await queued(f.repository.status(scope, { status: "in_progress" }));
  assert.notEqual(first.operationId, resume.operationId);
  const state = await f.store.read("a"); const timers = state.operations.filter((op) => op.kind === "timer");
  assert.equal(timers.length, 3);
  assert.deepEqual(timers.map((op) => op.dependencyId), [undefined, first.operationId, pause.operationId]);
  assert.deepEqual(timers.map((op) => ({ status: op.payload.status, baseStatus: op.payload.baseStatus })), [
    { status: "in_progress", baseStatus: "pending" }, { status: "paused", baseStatus: "in_progress" }, { status: "in_progress", baseStatus: "paused" },
  ]);
  const local = await f.repository.localAssignments(scope, 1);
  assert.equal(local.groups[0]!.works[0]!.status, "pending");
  assert.equal(local.groups[0]!.works[0]!.elapsedSeconds, f.data.groups[0]!.works[0]!.elapsedSeconds);
  assert.equal(local.groups[0]!.works[0]!.executedMinutes, f.data.groups[0]!.works[0]!.executedMinutes);
  const restarted = new OfflineEngine(f.dependencies);
  const events: string[] = [];
  f.remote.offlineReceipt = async (id) => { events.push(`receipt:${id}`); return null; };
  f.remote.offlineCommand = async (command) => { events.push(`send:${command.operationId}`); assert.doesNotThrow(() => syncCommandSchema.parse(command)); return { operationId: command.operationId, state: "applied" }; };
  await restarted.syncNow();
  assert.deepEqual(events, timers.flatMap((op) => [`receipt:${op.id}`, `send:${op.id}`]));
  assert.ok((await f.store.read("a")).operations.every((op) => op.status === "applied"));
});

test("offline start pause resume and manual delivery retain one ordered chain after restart", async () => {
  const fixture = await setup();
  fixture.connect(false);
  fixture.data.technician.allowEditExecutionTime = true;
  await updateState(fixture.store, "a", state => {
    const cached = state.cache.find(entry => entry.key === `assignments:${scope.startDate}`)!;
    cached.json = JSON.stringify(fixture.data);
  });
  const started = await queued(fixture.repository.status(scope, { status: "in_progress" }));
  fixture.advance(120000);
  const paused = await queued(fixture.repository.status(scope, { status: "paused" }));
  fixture.advance(60000);
  const resumed = await queued(fixture.repository.status(scope, { status: "in_progress" }));
  fixture.advance(120000);
  const delivered = await queued(fixture.repository.status(scope, { status: "delivered", isManual: true,
    executionDates: [scope.startDate], executionStartTime: "08:00", executionEndTime: "09:30", endDateOffset: 0 }));
  const before = await fixture.store.read("a");
  const completion = before.operations.find(operation => operation.id === delivered.operationId);
  assert.ok(completion?.kind === "completion");
  assert.equal(completion.payload.previousTimerOperationId, resumed.operationId);
  assert.deepEqual(completion.prerequisiteIds, [started.operationId, paused.operationId, resumed.operationId]);
  assert.equal(completion.localClock.elapsedSeconds, 5400);
  fixture.connect(true);
  await new OfflineEngine(fixture.dependencies).syncNow();
  assert.deepEqual(fixture.upstream.commands.map(command => command.operationId), [started.operationId, paused.operationId, resumed.operationId, delivered.operationId]);
  assert.ok((await fixture.store.read("a")).operations.every(operation => operation.status === "applied"));
});

for (const status of ["conflict", "needs_review", "blocked", "auth_required"] as const) test(`timer ${status} cannot be bypassed by its dependent pause or a new intention`, async () => {
  const f = await setup(); const first = await queued(f.repository.status(scope, { status: "in_progress" }));
  await queued(f.repository.status(scope, { status: "paused" }));
  await updateState(f.store, "a", (state) => { state.operations[0]!.status = status; state.operations[0]!.lastError = "MOBILE_SYNC_STATUS_CONFLICT"; });
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, f.dependencies);
  await assert.rejects(restarted.status(scope, { status: "in_progress" }), /REVIEW_REQUIRED/);
  await restarted.syncNow();
  assert.equal(f.upstream.commands.length, 0); assert.equal((await f.store.read("a")).operations.length, 2);
  await assert.rejects(restarted.retry(first.operationId), /REVIEW_REQUIRED/);
});

test("timer dependency in progress preserves retry delay, ordered commands and unchanged base", async () => {
  const f = await setup(); await queued(f.repository.status(scope, { status: "in_progress" })); await queued(f.repository.status(scope, { status: "paused" }));
  f.upstream.receiptError = new ApiError(409, "MOBILE_SYNC_IN_PROGRESS", "In progress");
  await f.repository.syncNow();
  const state = await f.store.read("a"); assert.equal(state.operations[1]!.attempts, 0); assert.equal(f.upstream.commands.length, 0);
  f.upstream.receiptError = undefined; await f.repository.syncNow(); assert.equal(f.upstream.commands.length, 0);
  f.advance(); await f.repository.syncNow(); assert.deepEqual(f.upstream.commands.map((command) => command.kind), ["timer", "timer"]);
});

test("lost timer response confirms by identical POST after receipt, never by GET alone", async () => {
  const f = await setup(); await queued(f.repository.status(scope, { status: "in_progress" }));
  const commands: OfflineCommand[] = []; let saved: OfflineReceipt | null = null;
  f.remote.offlineReceipt = async () => saved;
  f.remote.offlineCommand = async (command) => {
    commands.push(structuredClone(command)); saved = { operationId: command.operationId, state: "applied" };
    if (commands.length === 1) throw new NetworkError("network");
    return saved;
  };
  await f.repository.syncNow(); f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(commands.length, 2); assert.deepEqual(commands[0], commands[1]);
  assert.equal((await f.store.read("a")).operations[0]!.status, "applied");
});

test("receipt collision remains held through restart and cannot create a substitute timer UUID", async () => {
  const f = await setup(); await queued(f.repository.status(scope, { status: "in_progress" }));
  f.remote.offlineCommand = async (command) => ({ operationId: command.operationId, state: "needs_review", error: "MOBILE_SYNC_OPERATION_REUSED" });
  await f.repository.syncNow();
  let reads = 0; f.remote.offlineReceipt = async () => { reads++; return null; };
  await new OfflineEngine(f.dependencies).syncNow();
  await assert.rejects(f.repository.status(scope, { status: "paused" }), /REVIEW_REQUIRED/);
  assert.equal(reads, 0); assert.equal((await f.store.read("a")).operations.length, 1);
});

test("checklist reception reuses exact pending scope and catalog; canonical steps stay untouched", async () => {
  const f = await setup(); f.connect(false); f.store.conflicts = 2;
  const [first, duplicate] = await Promise.all([queued(f.repository.attachChecklist(scope, 17)), queued(f.repository.attachChecklist(scope, 17))]);
  assert.equal(first.operationId, duplicate.operationId); assert.equal(first.kind, "checklist");
  assert.deepEqual((await f.repository.localAssignments(scope, 1)).groups[0]!.works[0]!.checklists, f.data.groups[0]!.works[0]!.checklists);
  await assert.rejects(f.repository.attachChecklist(scope, 999), /OPTION_REQUIRED/);
  await assert.rejects(f.repository.attachChecklist({ ...scope, groupId: "local-work", workId: "local-work" }, 17), /SERVER_RESOURCE/);
  f.connect(true); await new OfflineEngine(f.dependencies).syncNow();
  assert.deepEqual(f.upstream.commands, [{ operationId: first.operationId, kind: "checklist", scope, payload: { checklistId: 17 } }]);
});

test("checklist catalog read caches its normalized query and falls back locally without hiding revocation", async () => {
  const f = await setup(); let calls = 0;
  f.remote.checklistOptions = async (_scope, query) => { calls++; assert.deepEqual(query, { search: "Available", page: 2 }); return { ...catalog, page: 2 }; };
  const page = await f.repository.checklistOptions(scope, { search: " Available ", page: 2 });
  f.connect(false); assert.deepEqual(await f.repository.checklistOptions(scope, { search: "Available", page: 2 }), page); assert.equal(calls, 1);
  f.connect(true); f.remote.checklistOptions = async () => { throw new ApiError(403, "FORBIDDEN", "Revoked"); };
  await assert.rejects(f.repository.checklistOptions(scope, { search: "Available", page: 2 }));
  await assert.rejects(f.repository.attachChecklist(scope, 17), /REVOKED/);
});

test("known resource revocation and catalog revocation also block duplicate acceptance", async () => {
  const f = await setup(); await queued(f.repository.attachChecklist(scope, 17));
  await updateState(f.store, "a", (state) => { state.revokedResources.push({ key: checklistCatalogCacheKey(scope, {}), status: 403 }); });
  await assert.rejects(f.repository.attachChecklist(scope, 17), /REVOKED/);
  await updateState(f.store, "a", (state) => { state.revokedResources.push({ key: resourceCacheKey("files", scope, "9"), status: 404 }); });
  await assert.rejects(f.repository.status(scope, { status: "in_progress" }), /REVOKED/);
  assert.equal((await f.store.read("a")).operations.length, 1);
});

test("revocation during a failed CAS is rechecked before an intention can commit", async () => {
  const f = await setup(); const compare = f.store.compareAndSwap.bind(f.store); let interrupted = false;
  f.store.compareAndSwap = async (namespace, revision, next) => {
    if (!interrupted) {
      interrupted = true;
      const revoked = await f.store.read(namespace);
      revoked.revision = revision + 1; revoked.revokedResources.push({ key: `assignments:${scope.startDate}`, status: 403 });
      assert.equal(await compare(namespace, revision, revoked), true);
      return false;
    }
    return compare(namespace, revision, next);
  };
  await assert.rejects(f.repository.status(scope, { status: "in_progress" }), /REVOKED/);
  assert.equal((await f.store.read("a")).operations.length, 0);
});

test("a missing timer predecessor after restart is not bypassed", async () => {
  const f = await setup(); await queued(f.repository.status(scope, { status: "in_progress" })); await queued(f.repository.status(scope, { status: "paused" }));
  await updateState(f.store, "a", (state) => { state.operations.shift(); });
  await new OfflineEngine(f.dependencies).syncNow();
  await assert.rejects(f.repository.status(scope, { status: "in_progress" }), /DEPENDENCY_UNRESOLVED/);
  assert.equal(f.upstream.commands.length, 0);
});

test("same work on a different cached day owns an independent timer chain", async () => {
  const f = await setup(); const other = { ...scope, startDate: "2026-09-09", endDate: "2026-09-09" };
  await updateState(f.store, "a", (state) => {
    const data = structuredClone(f.data); data.groups[0]!.works[0]!.scheduledDate = other.startDate;
    state.cache.push({ key: `assignments:${other.startDate}`, json: JSON.stringify(data), fetchedAt: 200,
      coverage: { date: other.startDate, branchId: 1, fetchedAt: 200 } });
  });
  const first = await queued(f.repository.status(scope, { status: "in_progress" }));
  const second = await queued(f.repository.status(other, { status: "in_progress" }));
  assert.notEqual(first.operationId, second.operationId);
  assert.ok((await f.store.read("a")).operations.every((op) => op.dependencyId === undefined));
});

test("new kinds decode additively in version one while existing commands, file bindings and creation IDs survive", async () => {
  const f = await setup();
  await queued(f.repository.createRecord(creation(66))); await queued(f.repository.addComment(scope, "Keep legacy comment"));
  await queued(f.repository.answer(scope, "9", answer)); await queued(f.repository.uploadDocuments(scope, [photo]));
  const old = (await f.store.read("a")).operations;
  await queued(f.repository.status(scope, { status: "in_progress" })); await queued(f.repository.attachChecklist(scope, 17));
  const state = await f.store.read("a"); const decoded = decodeState(JSON.stringify(state));
  assert.equal(decoded.version, 1); assert.deepEqual(decoded.operations.slice(0, old.length), old);
  assert.deepEqual(decoded.operations, state.operations); assert.deepEqual(decodeState(JSON.stringify(decoded)), decoded);
  const malformed = structuredClone(state);
  const timer = malformed.operations.find((op) => op.kind === "timer"); assert.ok(timer?.kind === "timer");
  timer.scope.workId = "local-work";
  assert.throws(() => decodeState(JSON.stringify(malformed)));
});

for (const failure of ["missing", "revoked", "auth", "worker", "permission", "final", "coverageDate", "branch", "coverageBranch", "duplicateGroup", "duplicateWork", "otherGroup", "otherWork"] as const) test(`cached ${failure} rejects timer and checklist before acceptance`, async () => {
  const f = await setup();
  await updateState(f.store, "a", (state) => {
    if (failure === "missing") state.cache = [];
    if (failure === "revoked") state.revokedResources.push({ key: `assignments:${scope.startDate}`, status: 404 });
    if (failure === "auth") state.authBlocked = true;
    const data = structuredClone(f.data);
    if (failure === "worker") data.technician.id = 100;
    if (failure === "permission") data.groups[0]!.works[0]!.canExecute = false;
    if (failure === "final") data.groups[0]!.works[0]!.status = "delivered";
    if (failure === "duplicateGroup") data.groups.push(structuredClone(data.groups[0]!));
    if (failure === "duplicateWork") data.groups[0]!.works.push(structuredClone(data.groups[0]!.works[0]!));
    if (failure === "otherGroup") data.groups[0]!.id = "external-80";
    if (failure === "otherWork") data.groups[0]!.works[0]!.id = "81";
    const entry = state.cache.find((item) => item.key.startsWith("assignments:")); if (entry) entry.json = JSON.stringify(data);
    if (failure === "coverageDate" && entry?.coverage) entry.coverage.date = "2026-09-07";
    if (failure === "coverageBranch" && entry?.coverage) entry.coverage.branchId = 2;
  });
  const target = failure === "branch" ? { ...scope, companyBranchId: 2 } : scope;
  for (const action of [() => f.repository.status(target, { status: "in_progress" }), () => f.repository.attachChecklist(target, 17)]) {
    await assert.rejects(action, (error: unknown) => error instanceof Error && !(error instanceof OfflineQueuedError));
  }
  assert.equal((await f.store.read("a")).operations.length, 0); assert.equal(f.upstream.verifyCount, 0);
});

for (const queryDate of ["2026-09-08", "2030-01-15"]) test(`visible overdue work accepts timer and checklist for cached query ${queryDate} without a clock clamp`, async () => {
  const f = await setup();
  const target = { ...scope, startDate: queryDate, endDate: queryDate };
  const scheduledDate = "2026-08-01";
  await updateState(f.store, "a", (state) => {
    const data = structuredClone(f.data);
    data.groups[0]!.works[0]!.scheduledDate = scheduledDate;
    data.groups[0]!.works[0]!.isOverdue = true;
    state.cache = [
      { key: `assignments:${queryDate}`, json: JSON.stringify(data), fetchedAt: 100, coverage: { branchId: 1, date: queryDate, fetchedAt: 100 } },
      { key: checklistCatalogCacheKey(target, {}), json: JSON.stringify(catalog), fetchedAt: 100 },
    ];
  });
  f.connect(false);
  const start = await queued(f.repository.status(target, { status: "in_progress", executionDates: [queryDate] }));
  const pause = await queued(f.repository.status(target, { status: "paused" }));
  const checklist = await queued(f.repository.attachChecklist(target, 17));
  const state = await f.store.read("a");
  assert.deepEqual(state.operations.map((operation) => { assert.ok(operation.kind !== "create"); return operation.scope; }), [target, target, target]);
  assert.equal(state.operations[1]!.dependencyId, start.operationId);
  assert.equal(state.operations[1]!.id, pause.operationId);
  assert.equal(state.operations[2]!.id, checklist.operationId);
  const canonical = (await f.repository.localAssignments(target, 1)).groups[0]!.works[0]!;
  assert.equal(canonical.scheduledDate, scheduledDate); assert.equal(canonical.status, "pending");
  assert.equal(f.upstream.verifyCount, 0); assert.equal(f.upstream.commands.length, 0);
});

for (const cache of ["absent", "other-work"] as const) test(`overdue query date ${cache} cannot borrow visibility or catalog from another cached day`, async () => {
  const f = await setup(); const target = { ...scope, startDate: "2026-09-09", endDate: "2026-09-09" };
  await updateState(f.store, "a", (state) => {
    state.cache.push({ key: checklistCatalogCacheKey(target, {}), json: JSON.stringify(catalog), fetchedAt: 100 });
    if (cache === "other-work") {
      const data = structuredClone(f.data); data.groups[0]!.works[0]!.id = "81";
      state.cache.push({ key: `assignments:${target.startDate}`, json: JSON.stringify(data), fetchedAt: 100 });
    }
  });
  await assert.rejects(f.repository.status(target, { status: "in_progress" }), /WORK_SNAPSHOT_REQUIRED/);
  await assert.rejects(f.repository.attachChecklist(target, 17), /WORK_SNAPSHOT_REQUIRED/);
  assert.equal((await f.store.read("a")).operations.length, 0); assert.equal(f.upstream.verifyCount, 0);
});

test("overdue intentions retain daily canonical scope and direct ID validation", async () => {
  const f = await setup();
  for (const target of [
    { ...scope, endDate: "2026-09-09" }, { ...scope, groupId: "direct-81" }, { ...scope, groupId: "direct-np-81" },
    { ...scope, workId: "local-80" }, { ...scope, startDate: "2026-02-30", endDate: "2026-02-30" },
  ]) {
    await assert.rejects(f.repository.status(target, { status: "in_progress" }), (error: unknown) => error instanceof Error && !(error instanceof OfflineQueuedError));
    await assert.rejects(f.repository.attachChecklist(target, 17), (error: unknown) => error instanceof Error && !(error instanceof OfflineQueuedError));
  }
  assert.equal((await f.store.read("a")).operations.length, 0);
});

test("multiple visible works with the same numeric ID in different groups keep separate overdue intentions", async () => {
  const f = await setup(); const other = { ...scope, groupId: "external-90" };
  await updateState(f.store, "a", (state) => {
    const data = structuredClone(f.data);
    data.groups[0]!.works[0]!.scheduledDate = "2026-08-01";
    data.groups.push({ ...structuredClone(data.groups[0]!), id: other.groupId, type: "external_ot" });
    state.cache.find((entry) => entry.key === `assignments:${scope.startDate}`)!.json = JSON.stringify(data);
    state.cache.push({ key: checklistCatalogCacheKey(other, {}), json: JSON.stringify(catalog), fetchedAt: 100 });
  });
  const first = await queued(f.repository.status(scope, { status: "in_progress" }));
  const second = await queued(f.repository.status(other, { status: "in_progress" }));
  const firstChecklist = await queued(f.repository.attachChecklist(scope, 17));
  const secondChecklist = await queued(f.repository.attachChecklist(other, 17));
  assert.notEqual(first.operationId, second.operationId); assert.notEqual(firstChecklist.operationId, secondChecklist.operationId);
  assert.deepEqual((await f.store.read("a")).operations.map((operation) => { assert.ok(operation.kind !== "create"); return operation.scope.groupId; }), [scope.groupId, other.groupId, scope.groupId, other.groupId]);
  assert.ok((await f.store.read("a")).operations.every((operation) => operation.dependencyId === undefined));
});

test("timer rejects initial pause, pending reset, manual clocks and multi-date input", async () => {
  const f = await setup(); f.connect(false);
  await assert.rejects(f.repository.status(scope, { status: "paused" }), /INVALID_TRANSITION/);
  await assert.rejects(f.repository.status(scope, { status: "pending" }), /INVALID_TRANSITION/);
  await assert.rejects(f.repository.status(scope, { status: "in_progress", executionStartTime: "09:00" }), /INVALID_INPUT/);
  await assert.rejects(f.repository.status(scope, { status: "in_progress", executionDates: [scope.startDate, "2026-09-09"] }), /INVALID_INPUT/);
  assert.equal((await f.store.read("a")).operations.length, 0);
});

test("localAssignments reads cached and queued creation overlays without network, write or invented coverage", async () => {
  const f = await setup(); const input = creation(77); input.schedule.date = "2026-09-10";
  await queued(f.repository.createRecord(input));
  f.dependencies.connectivity.current = async () => { throw new Error("NO_NETWORK"); };
  f.remote.assignments = async () => { throw new Error("NO_REMOTE_READ"); };
  const before = await f.store.read("a");
  const local = await f.repository.localAssignments({ startDate: "2026-09-08", endDate: "2026-09-11" }, 1);
  assert.deepEqual(local.groups.map((group) => group.id), ["direct-80", `local-${input.clientRequestId}`]);
  assert.equal(local.groups[1]!.works[0]!.canExecute, false);
  assert.deepEqual(f.repository.getSnapshot().missingDates, ["2026-09-09", "2026-09-10", "2026-09-11"]);
  assert.deepEqual(f.repository.getSnapshot().coverage.map((entry) => entry.date), [scope.startDate]);
  assert.deepEqual(await f.store.read("a"), before); assert.equal(f.upstream.verifyCount, 0);
  const missing = { startDate: "2026-09-12", endDate: "2026-09-12" };
  await assert.rejects(f.repository.localAssignments(missing, 1), /CACHE_MISS/);
  await assert.rejects(f.repository.localAssignments(scope, 2), /BRANCH_NAMESPACE/);
  await updateState(f.store, "a", (state) => { state.revokedResources.push({ key: `assignments:${scope.startDate}`, status: 403 }); });
  await assert.rejects(f.repository.localAssignments(scope, 1), /revocado/);
  await updateState(f.store, "a", (state) => { state.authBlocked = true; });
  await assert.rejects(f.repository.localAssignments(scope, 1), /AUTH_REQUIRED/);
});

test("cold localAssignments hydrates coverage, retains canonical creations and rejects cached identity mismatch", async () => {
  const f = await setup(); const input = creation(88); await queued(f.repository.createRecord(input)); await f.repository.syncNow();
  const fresh = new OfflineTechnicianRepository(f.remote, f.session, f.dependencies);
  f.dependencies.connectivity.current = async () => { throw new Error("NO_NETWORK"); };
  const data = await fresh.localAssignments(scope, 1);
  assert.equal(data.groups.filter((group) => group.id === "direct-80").length, 1);
  assert.equal(data.groups[0]!.works.filter((work) => work.id === "80").length, 1);
  assert.deepEqual(fresh.getSnapshot().coverage.map((entry) => entry.date), [scope.startDate]);
  const invalid = structuredClone(f.data); invalid.technician.id = 123;
  await updateState(f.store, "a", (state) => { state.cache.find((entry) => entry.key.startsWith("assignments:"))!.json = JSON.stringify(invalid); });
  await assert.rejects(fresh.localAssignments(scope, 1), /IDENTITY_MISMATCH/);
});

test("offline timer actions persist their capture time without changing confirmed work data", async () => {
  const current = await setup();
  current.connect(false);
  await queued(current.repository.status(scope, { status: "in_progress" }));
  current.advance(120_000);
  await queued(current.repository.status(scope, { status: "paused" }));
  current.advance(60_000);
  await queued(current.repository.status(scope, { status: "in_progress" }));
  const state = await current.store.read("a");
  const timers = state.operations.filter(operation => operation.kind === "timer");
  assert.equal(timers.length, 3);
  for (const operation of timers) {
    assert.ok("recordedAt" in operation.payload);
    assert.equal(operation.payload.recordedAt, new Date(operation.createdAt).toISOString());
  }
  const local = await current.repository.localAssignments(scope, 1);
  assert.equal(local.groups[0]?.works[0]?.elapsedSeconds, current.data.groups[0]?.works[0]?.elapsedSeconds);
  assert.equal(current.upstream.commands.length, 0);
  assert.equal(decodeState(JSON.stringify(state)).operations.length, 3);
  const restored = decodeState(JSON.stringify(state)).operations.filter(operation => operation.kind === "timer");
  const baseline = current.data.groups[0]!.works[0]!.elapsedSeconds;
  assert.equal(localTimerElapsedSeconds(restored[0]!, 121_000), baseline + 120);
  assert.equal(localTimerElapsedSeconds(restored[1]!, 181_000), baseline + 120);
  assert.equal(localTimerElapsedSeconds(restored[2]!, 211_000), baseline + 150);
  assert.equal(restored[1]!.payload.previousOperationId, restored[0]!.id);
  assert.equal(restored[2]!.payload.previousOperationId, restored[1]!.id);
});

test("offline completion survives restart without changing the confirmed work or duplicating submission", async () => {
  const current = await setup(); current.connect(false);
  const original = await current.store.read("a");
  const input = { status: "delivered" as const, executionDates: [scope.startDate], workedDates: ["2026-09-01", scope.startDate], isManual: false };
  const first = await queued(current.repository.status(scope, input));
  const restarted = new OfflineTechnicianRepository(current.remote, current.session, current.dependencies);
  const second = await queued(restarted.status(scope, input));
  assert.equal(second.operationId, first.operationId);
  const saved = decodeState(JSON.stringify(await current.store.read("a")));
  assert.equal(saved.operations.filter(operation => operation.id === first.operationId).length, 1);
  assert.deepEqual(saved.cache, original.cache);
  assert.equal(current.upstream.commands.length, 0);
});

test("completion waits for every queued prerequisite and keeps the same receipt on retry", async () => {
  const current = await setup(); current.connect(false);
  await queued(current.repository.status(scope, { status: "in_progress" }));
  await queued(current.repository.answer(scope, "9", answer));
  await queued(current.repository.uploadDocuments(scope, [photo]));
  await queued(current.repository.addComment(scope, "Preservar nota"));
  const finished = await queued(current.repository.status(scope, { status: "completed", executionDates: [scope.startDate] }));
  const saved = await current.store.read("a");
  const closure = saved.operations.find(operation => operation.id === finished.operationId);
  assert.ok(closure?.kind === "completion");
  assert.equal(closure.prerequisiteIds.length, 4);
  current.connect(true); await current.repository.syncNow();
  assert.equal(current.upstream.commands.at(-1)?.kind, "completion");
  assert.equal(current.upstream.documents.length, 1);
  assert.equal((await current.store.read("a")).operations.find(operation => operation.id === finished.operationId)?.status, "applied");
  await current.repository.status(scope, { status: "completed", executionDates: [scope.startDate] });
  assert.equal(current.upstream.commands.filter(command => command.kind === "completion").length, 1);
});

test("completion never passes a conflicting prerequisite and preserves its frozen time", async () => {
  const current = await setup();
  const timer = await queued(current.repository.status(scope, { status: "in_progress" }));
  current.advance(120_000);
  const closure = await queued(current.repository.status(scope, { status: "delivered" }));
  await updateState(current.store, "a", state => { state.operations.find(operation => operation.id === timer.operationId)!.status = "conflict"; });
  await current.repository.syncNow();
  const saved = (await current.store.read("a")).operations.find(operation => operation.id === closure.operationId);
  assert.ok(saved?.kind === "completion");
  assert.equal(saved.status, "pending");
  assert.equal(saved.localClock.elapsedSeconds, 120);
  assert.equal(current.upstream.commands.length, 0);
  await assert.rejects(current.repository.status(scope, { status: "paused" }), /COMPLETION_ALREADY_QUEUED/);
});

test("completion storage failure does not report acceptance and invalid dates never enter the queue", async () => {
  const current = await setup(); current.store.failWrites = true;
  await assert.rejects(current.repository.status(scope, { status: "delivered" }), /DISK_FULL/);
  assert.equal((await current.store.read("a")).operations.length, 0);
  current.store.failWrites = false;
  await assert.rejects(current.repository.status(scope, { status: "delivered", executionDates: ["2026-09-01"] }), /INVALID_DATES/);
  await assert.rejects(current.repository.status(scope, { status: "delivered", isManual: true, executionStartTime: "08:00", executionEndTime: "09:00" }), /MANUAL_FORBIDDEN/);
});

test("lost completion response recovers with the same UUID and frozen payload after restart", async () => {
  const current = await setup();
  const finish = await queued(current.repository.status(scope, { status: "delivered" }));
  current.upstream.failAfterApply = true;
  await current.repository.syncNow();
  const first = current.upstream.commands.find(command => command.operationId === finish.operationId);
  assert.ok(first?.kind === "completion");
  const saved = await current.store.read("a");
  assert.notEqual(saved.operations[0]?.status, "applied");
  current.upstream.failAfterApply = false;
  await updateState(current.store, "a", state => { state.operations[0]!.status = "pending"; state.operations[0]!.nextAttemptAt = 0; });
  const restarted = new OfflineEngine(current.dependencies);
  await restarted.syncNow();
  assert.deepEqual(current.upstream.commands.at(-1), first);
  assert.equal(current.upstream.receipts.size, 1);
  assert.equal((await current.store.read("a")).operations[0]?.status, "applied");
});

test("a fresh reopened work permits a new closure without deleting its earlier receipt", async () => {
  const current = await setup();
  const input = { status: "delivered" as const, executionDates: [scope.startDate] };
  const first = await queued(current.repository.status(scope, input));
  await current.repository.syncNow();
  current.data.groups[0]!.works[0]!.status = "paused";
  await current.repository.assignments(scope, 1);
  const second = await queued(current.repository.status(scope, input));
  assert.notEqual(first.operationId, second.operationId);
  const saved = await current.store.read("a");
  assert.equal(saved.operations.find(operation => operation.id === first.operationId)?.status, "applied");
  assert.equal(saved.operations.find(operation => operation.id === second.operationId)?.status, "pending");
});

test("maintenance report is durable text, reused on retry and sent before completion", async () => {
  const current = await setup(); current.connect(false);
  const maintenanceScope = { ...scope, groupId: "maintenance-80" };
  await updateState(current.store, "a", state => {
    const data = structuredClone(current.data); data.groups[0]!.id = maintenanceScope.groupId; data.groups[0]!.type = "internal_maintenance";
    state.cache[0]!.json = JSON.stringify(data);
  });
  const first = await queued(current.repository.report(maintenanceScope, "Trabajo realizado y observaciones"));
  const second = await queued(current.repository.report(maintenanceScope, "Trabajo realizado y observaciones"));
  assert.equal(first.operationId, second.operationId); assert.equal(current.files.files.size, 1);
  const closure = await queued(current.repository.status(maintenanceScope, { status: "delivered" }));
  const state = await current.store.read("a");
  const pending = state.operations.find(operation => operation.id === closure.operationId);
  assert.ok(pending?.kind === "completion"); assert.deepEqual(pending.prerequisiteIds, [first.operationId]);
  const report = state.operations.find(operation => operation.id === first.operationId);
  assert.ok(report?.kind === "document");
  assert.equal(new TextDecoder().decode(current.files.contents.get(report.file.id)), "Trabajo realizado y observaciones");
  current.connect(true); await current.repository.syncNow();
  assert.equal(current.upstream.documents.length, 1);
  assert.equal(current.upstream.commands.at(-1)?.kind, "completion");
});