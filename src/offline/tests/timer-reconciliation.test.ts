/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TechnicianRepository } from "../../domain/TechnicianRepository";
import type { Assignments, Session, WorkScope } from "../../domain/models";
import { assignmentDays, assignmentWorkForQueryDate, assignmentWorkQueryRange, dailyRange } from "../../domain/assignmentSchedule";
import { OfflineQueuedError, type OfflineOperation, type TimerReadAssignmentWork } from "../../domain/offline";
import { NetworkError } from "../../infrastructure/errors";
import { pendingTimerForWork } from "../../screens/offline/offlineUi";
import { OfflineTechnicianRepository } from "../OfflineTechnicianRepository";
import { OfflineEngine } from "../engine";
import { decodeState, updateState } from "../state";
import { assignmentsWithStep, creation, fixture, user, uuid } from "./fakes";

const scope: WorkScope = { companyBranchId: 1, groupId: "direct-80", workId: "80", startDate: "2026-09-08", endDate: "2026-09-08" };
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function queued(action: Promise<unknown>): Promise<OfflineQueuedError> {
  try { await action; } catch (error) { assert.ok(error instanceof OfflineQueuedError); return error; }
  throw new Error("EXPECTED_DURABLE_QUEUE");
}
const firstWork = (data: Assignments): TimerReadAssignmentWork => data.groups[0]!.works[0]!;
async function setup() {
  const f = fixture();
  const data = assignmentsWithStep();
  firstWork(data).canExecute = true;
  const unavailable = async (): Promise<never> => { throw new Error("UNEXPECTED_REMOTE_ACTION"); };
  const remote: TechnicianRepository = {
    me: () => f.upstream.me(), createRecord: (input) => f.upstream.createRecord(input),
    offlineReceipt: (id) => f.upstream.offlineReceipt(id), offlineCommand: (command) => f.upstream.offlineCommand(command),
    assignments: async () => structuredClone(data), checklistOptions: unavailable, attachChecklist: unavailable,
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
  });
  return { ...f, data, remote, dependencies, session, repository };
}

test("preflight GET finishing after applied cannot reconcile UI or change the next timer base", { timeout: 5000 }, async () => {
  const f = await setup(); const entered = deferred<void>(); const response = deferred<Assignments>();
  f.remote.assignments = async () => { entered.resolve(); return response.promise; };
  const reading = f.repository.assignments(scope, 1); await entered.promise;
  const start = await queued(f.repository.status(scope, { status: "in_progress" }));
  await f.repository.syncNow();
  assert.equal(f.repository.getSnapshot().operations[0]!.status, "applied");
  f.advance(); response.resolve(structuredClone(f.data));
  const stale = firstWork(await reading);
  assert.deepEqual(stale.offlineTimerRead?.appliedOperationIds, []);
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), scope, stale)?.id, start.operationId);
  assert.equal(stale.status, "pending"); assert.equal(stale.elapsedSeconds, firstWork(f.data).elapsedSeconds);
  await queued(f.repository.status(scope, { status: "paused" }));
  const pause = (await f.store.read("a")).operations.at(-1); assert.ok(pause?.kind === "timer");
  assert.deepEqual(pause.payload, { status: "paused", baseStatus: "in_progress" });
  assert.equal(pause.dependencyId, start.operationId);
});

test("GET starting while the applied CAS is uncommitted remains stale even with equal local timestamps", { timeout: 5000 }, async () => {
  const f = await setup(); await queued(f.repository.status(scope, { status: "in_progress" }));
  const entered = deferred<void>(); const release = deferred<void>();
  const compare = f.store.compareAndSwap.bind(f.store); let held = false;
  f.store.compareAndSwap = async (namespace, revision, next) => {
    if (!held && next.operations.some((operation) => operation.kind === "timer" && operation.status === "applied")) {
      held = true; entered.resolve(); await release.promise;
    }
    return compare(namespace, revision, next);
  };
  const cycle = f.repository.syncNow(); await entered.promise;
  try {
    const stale = firstWork(await f.repository.assignments(scope, 1));
    assert.deepEqual(stale.offlineTimerRead?.appliedOperationIds, []);
    release.resolve(); await cycle;
    assert.ok(pendingTimerForWork(f.repository.getSnapshot(), scope, stale));
  } finally { release.resolve(); await cycle; }
});

test("fresh authoritative external pause wins over an applied start and becomes the next resume base", async () => {
  const f = await setup(); const start = await queued(f.repository.status(scope, { status: "in_progress" }));
  await f.repository.syncNow();
  const stale = firstWork(await f.repository.localAssignments(scope, 1));
  firstWork(f.data).status = "paused"; firstWork(f.data).elapsedSeconds = 91;
  const fresh = firstWork(await f.repository.assignments(scope, 1));
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), scope, stale)?.id, start.operationId, "a cache publication must not reconcile a still-old rendered prop");
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), scope, fresh), null);
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), scope, fresh.schedules?.[0]?.work), null, "daily detail selection retains the same read proof");
  assert.equal(fresh.status, "paused"); assert.equal(fresh.elapsedSeconds, 91);
  await queued(f.repository.status(scope, { status: "in_progress" }));
  const resume = (await f.store.read("a")).operations.at(-1); assert.ok(resume?.kind === "timer");
  assert.deepEqual(resume.payload, { status: "in_progress", baseStatus: "paused" });
  assert.equal(resume.dependencyId, start.operationId);
  await f.repository.syncNow();
  assert.deepEqual(f.upstream.commands.at(-1)?.payload, resume.payload);
});

test("late pre-commit GET cannot overwrite a reconciled cache even with a newer generatedAt", { timeout: 5000 }, async () => {
  const f = await setup(); const entered = deferred<void>(); const response = deferred<Assignments>();
  f.remote.assignments = async () => { entered.resolve(); return response.promise; };
  const preflight = f.repository.assignments(scope, 1); await entered.promise;
  const start = await queued(f.repository.status(scope, { status: "in_progress" })); await f.repository.syncNow();
  const stale = structuredClone(f.data); stale.generatedAt = "2026-09-08T10:00:00Z";
  firstWork(f.data).status = "paused";
  f.remote.assignments = async () => structuredClone(f.data);
  const fresh = firstWork(await f.repository.assignments(scope, 1));
  response.resolve(stale);
  const late = firstWork(await preflight);
  assert.equal(late.status, "paused"); assert.deepEqual(late.offlineTimerRead, fresh.offlineTimerRead);
  assert.ok(late.offlineTimerRead?.appliedOperationIds.includes(start.operationId));
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), scope, late), null);
});

test("failed fresh read is visible, keeps applied intent, and manual successful read releases it across restart", async () => {
  const f = await setup(); const start = await queued(f.repository.status(scope, { status: "in_progress" })); await f.repository.syncNow();
  f.remote.assignments = async () => { throw new NetworkError("network"); };
  const cached = firstWork(await f.repository.assignments(scope, 1));
  assert.ok(f.repository.getSnapshot().lastError);
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), scope, cached)?.id, start.operationId);
  firstWork(f.data).status = "pending";
  f.remote.assignments = async () => structuredClone(f.data);
  await f.repository.assignments(scope, 1);
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, f.dependencies);
  const restored = firstWork(await restarted.localAssignments(scope, 1));
  assert.equal(pendingTimerForWork(restarted.getSnapshot(), scope, restored), null);
  const before = (await f.store.read("a")).operations;
  assert.equal(before.length, 1); assert.equal(before[0]!.status, "applied");
  await assert.rejects(restarted.status(scope, { status: "paused" }), /INVALID_TRANSITION/);
  assert.deepEqual((await f.store.read("a")).operations, before);
});

test("fresh snapshot cannot overwrite the base of an already-queued dependent timer", async () => {
  const f = await setup(); await queued(f.repository.status(scope, { status: "in_progress" })); await f.repository.syncNow();
  const pause = await queued(f.repository.status(scope, { status: "paused" }));
  firstWork(f.data).status = "pending"; await f.repository.assignments(scope, 1);
  await queued(f.repository.status(scope, { status: "in_progress" }));
  const timers = (await f.store.read("a")).operations.filter((operation) => operation.kind === "timer");
  assert.deepEqual(timers[1]!.payload, { status: "paused", baseStatus: "in_progress" });
  assert.deepEqual(timers[2]!.payload, { status: "in_progress", baseStatus: "paused" });
  assert.equal(timers[2]!.dependencyId, pause.operationId);
});

test("local access, branch, and review remain fail-closed despite a fresh timer read", async () => {
  const f = await setup(); await queued(f.repository.status(scope, { status: "in_progress" })); await f.repository.syncNow();
  firstWork(f.data).status = "paused"; await f.repository.assignments(scope, 1);
  f.dependencies.canAccessLocal = async () => false;
  await assert.rejects(f.repository.status(scope, { status: "in_progress" }), /AUTH_REQUIRED/);
  await assert.rejects(f.repository.assignments(scope, 1), /AUTH_REQUIRED/);
  f.dependencies.canAccessLocal = async () => true;
  await assert.rejects(f.repository.status({ ...scope, companyBranchId: 2 }, { status: "in_progress" }), /BRANCH_NAMESPACE/);
  await updateState(f.store, "a", (state) => { state.operations[0]!.status = "needs_review"; state.operations[0]!.lastError = "MOBILE_SYNC_OPERATION_REUSED"; });
  await assert.rejects(f.repository.status(scope, { status: "in_progress" }), /REVIEW_REQUIRED/);
  assert.equal((await f.store.read("a")).operations.length, 1);
});

test("all six old operation kinds decode unchanged without read metadata; new metadata is optional and durable", async () => {
  const f = await setup(); const input = creation(1);
  const base = { createdAt: 100, attempts: 0, nextAttemptAt: 0, status: "applied" as const };
  const operations: OfflineOperation[] = [
    { ...base, id: uuid(1), kind: "create", input, localGroupId: `local-${uuid(1)}`, localWorkId: `local-${uuid(1)}` },
    { ...base, id: uuid(2), kind: "comment", scope, text: "Keep" },
    { ...base, id: uuid(3), kind: "answer", scope, stepId: "9", answer: { responseValue: "ok", isCompleted: true, executionStatus: "completed", comment: null }, base: { responseValue: "", isCompleted: false, executionStatus: null, comment: null } },
    { ...base, id: uuid(4), kind: "document", scope, file: { id: uuid(44), namespace: "a", name: "Keep.png", size: 10, mimeType: "image/png", sha256: "a".repeat(64) } },
    { ...base, id: uuid(5), kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" } },
    { ...base, id: uuid(6), kind: "checklist", scope, payload: { checklistId: 17 } },
  ];
  const old = await f.store.read("a"); old.operations = operations;
  assert.deepEqual(decodeState(JSON.stringify(old)), old);
  old.cache[0]!.timerReadOperationIds = [uuid(5)];
  assert.deepEqual(decodeState(JSON.stringify(old)), old);
});

test("enqueue during lease release latches the next cycle without bypassing deployment or retry delays", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const engine = new OfflineEngine(f.dependencies); t.after(() => engine.stop());
  const entered = deferred<void>(); const release = deferred<void>();
  const compare = f.store.compareAndSwap.bind(f.store); let held = false;
  f.store.compareAndSwap = async (namespace, revision, next) => {
    if (!held && next.lease === null && (await f.store.read(namespace)).lease !== null) { held = true; entered.resolve(); await release.promise; }
    return compare(namespace, revision, next);
  };
  engine.start(); const cycle = engine.syncNow(); await entered.promise;
  try {
    await engine.enqueue([
      { id: uuid(91), kind: "comment", scope, text: "Must run next", createdAt: 1000, status: "pending", attempts: 0, nextAttemptAt: 0 },
      { id: uuid(92), kind: "comment", scope, text: "Deployment delay", createdAt: 1000, status: "pending", attempts: 2, nextAttemptAt: 61000, lastError: "MOBILE_SYNC_SCHEMA_NOT_READY" },
    ]);
    t.mock.timers.tick(0);
    release.resolve(); await cycle;
    assert.equal(f.upstream.commands.length, 0);
    t.mock.timers.tick(0);
    for (let turn = 0; turn < 200; turn++) await Promise.resolve();
    assert.deepEqual(f.upstream.commands.map((command) => command.operationId), [uuid(91)]);
    const delayed = (await f.store.read("a")).operations.find((operation) => operation.id === uuid(92));
    assert.equal(delayed?.nextAttemptAt, 61000); assert.equal(delayed?.attempts, 2);
  } finally { release.resolve(); await cycle; }
});

test("actual offline wrapper merges seven overdue query days and reconciles only the fresh day-14 timer, including restart", async () => {
  const f = await setup();
  const range = { startDate: "2026-09-14", endDate: "2026-09-20" };
  const target = { ...scope, ...dailyRange(range.startDate) };
  const days = assignmentDays(range); const reads: string[] = [];
  let fresh = false; let failTarget = false;
  f.remote.assignments = async (query) => {
    reads.push(query.startDate);
    if (failTarget && query.startDate === target.startDate) throw new NetworkError("network");
    const data = structuredClone(f.data);
    data.generatedAt = `2026-09-14T10:00:0${days.indexOf(query.startDate)}.000Z`;
    const candidate = firstWork(data);
    candidate.isOverdue = true;
    candidate.status = query.startDate === target.startDate && fresh ? "paused" : "pending";
    candidate.elapsedSeconds = query.startDate === target.startDate ? fresh ? 91 : 45 : 206;
    candidate.canExecute = query.startDate !== "2026-09-15";
    return data;
  };
  const initial = firstWork(await f.repository.assignments(range, 1));
  assert.deepEqual([...reads].sort(), days); assert.equal(initial.schedules?.length, 1);
  const start = await queued(f.repository.status(target, { status: "in_progress" })); await f.repository.syncNow();
  assert.equal(f.repository.getSnapshot().operations[0]?.status, "applied");
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), target, assignmentWorkForQueryDate(initial, target.startDate))?.id, start.operationId);
  fresh = true; failTarget = true; reads.length = 0;
  const failed = firstWork(await f.repository.assignments(range, 1));
  assert.deepEqual([...reads].sort(), days);
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), target, assignmentWorkForQueryDate(failed, target.startDate))?.id, start.operationId,
    "six fresh other query dates cannot certify the failed target read");
  failTarget = false; reads.length = 0;
  const merged = firstWork(await f.repository.assignments(range, 1));
  assert.deepEqual([...reads].sort(), days); assert.equal(merged.schedules?.[0].date, "2026-09-20");
  assert.deepEqual(assignmentWorkQueryRange(merged, range), dailyRange("2026-09-14"));
  const selected = assignmentWorkForQueryDate(merged, target.startDate);
  assert.equal(selected?.status, "paused"); assert.equal(selected?.elapsedSeconds, 91);
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), target, selected), null);
  assert.equal(pendingTimerForWork(f.repository.getSnapshot(), target, merged)?.id, start.operationId);
  assert.equal(assignmentWorkForQueryDate(merged, "2026-09-15")?.canExecute, false);
  assert.equal(assignmentWorkForQueryDate(merged, "2026-09-20")?.status, "pending");
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, f.dependencies);
  const local = firstWork(await restarted.localAssignments(range, 1));
  await restarted.engine.refresh();
  assert.equal(assignmentWorkForQueryDate(local, target.startDate)?.elapsedSeconds, 91);
  assert.equal(pendingTimerForWork(restarted.getSnapshot(), target, assignmentWorkForQueryDate(local, target.startDate)), null);
  await queued(restarted.status(target, { status: "in_progress" }));
  const resume = (await f.store.read("a")).operations.at(-1); assert.ok(resume?.kind === "timer");
  assert.deepEqual(resume.payload, { status: "in_progress", baseStatus: "paused" });
  assert.equal(resume.dependencyId, start.operationId);
});