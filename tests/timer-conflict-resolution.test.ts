import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineOperation } from "../src/domain/offline";
import { emptyState } from "../src/offline/state";
import { conflictedTimerScopes, isStatusConflict, rebaseTimerChain } from "../src/offline/timerConflicts";
import { runnableOperations } from "../src/offline/syncScheduling";

const scope = { groupId: "direct-11", workId: "11", companyBranchId: 1, startDate: "2026-10-05", endDate: "2026-10-05" };
const ids = () => { let next = 0; return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`; };
type Timer = Extract<OfflineOperation, { kind: "timer" }>;
type Completion = Extract<OfflineOperation, { kind: "completion" }>;
const conflict = { status: "conflict" as const, lastError: "MOBILE_SYNC_STATUS_CONFLICT", receipt: { operationId: "start", state: "conflict" as const, error: "MOBILE_SYNC_STATUS_CONFLICT" } };
const timer = (id: string, status: "in_progress" | "paused", baseStatus: "pending" | "in_progress" | "paused", minute: number, extra: Partial<Timer> = {}): Timer => ({
  id, createdAt: Date.parse(`2026-10-05T12:${String(minute).padStart(2, "0")}:00Z`), status: "pending", attempts: 0, nextAttemptAt: 0, kind: "timer", scope,
  payload: { status, baseStatus, recordedAt: `2026-10-05T12:${String(minute).padStart(2, "0")}:00.000Z`, observedAt: "2026-10-05T08:00:00.000Z" }, localClock: { elapsedSeconds: minute * 60 }, ...extra,
});

test("offline start rejected only because the job changed is resent on the real status keeping the tap time", () => {
  const state = emptyState();
  const start = timer("start", "in_progress", "pending", 10, conflict);
  const pause = timer("pause", "paused", "in_progress", 40, { dependencyId: "start", payload: { status: "paused", baseStatus: "in_progress", recordedAt: "2026-10-05T12:40:00.000Z", observedAt: "2026-10-05T08:00:00.000Z", previousOperationId: "start" } });
  const comment: OfflineOperation = { id: "comment", createdAt: 1, status: "pending", attempts: 0, nextAttemptAt: 0, kind: "comment", scope, text: "Sin novedad" };
  state.operations = [comment, start, pause];
  assert.deepEqual(conflictedTimerScopes(state), [scope]);
  const result = rebaseTimerChain(state, scope, "pending", ids());
  assert.equal(result.replaced.length, 2);
  const [, newStart, newPause] = state.operations as [OfflineOperation, Timer, Timer];
  assert.notEqual(newStart.id, "start");
  assert.equal(newStart.status, "pending"); assert.equal(newStart.receipt, undefined); assert.equal(newStart.lastError, undefined);
  assert.equal(newStart.payload.recordedAt, "2026-10-05T12:10:00.000Z");
  assert.equal(newStart.payload.baseStatus, "pending");
  assert.equal(newStart.payload.previousOperationId, undefined);
  assert.equal(newPause.dependencyId, newStart.id);
  assert.equal(newPause.payload.previousOperationId, newStart.id);
  assert.equal(newPause.payload.recordedAt, "2026-10-05T12:40:00.000Z");
  assert.equal(state.operations[0], comment);
  // La cola vuelve a avanzar: primero el inicio, luego la pausa.
  assert.deepEqual(runnableOperations(state.operations).map(entry => entry.id), [comment.id, newStart.id]);
  assert.equal(isStatusConflict(newStart), false);
});

test("an intention the server already reflects is retired and releases the actions queued after it", () => {
  const state = emptyState();
  const start = timer("start", "in_progress", "pending", 10, conflict);
  const pause = timer("pause", "paused", "in_progress", 40, { dependencyId: "start", payload: { status: "paused", baseStatus: "in_progress", recordedAt: "2026-10-05T12:40:00.000Z", observedAt: "2026-10-05T08:00:00.000Z", previousOperationId: "start" } });
  const finish: Completion = { id: "finish", createdAt: Date.parse("2026-10-05T13:00:00Z"), status: "pending", attempts: 0, nextAttemptAt: 0, kind: "completion", scope,
    payload: { input: { status: "delivered", isManual: false }, recordedAt: "2026-10-05T13:00:00.000Z", observedAt: "2026-10-05T08:00:00.000Z", baseStatus: "paused", previousTimerOperationId: "pause" },
    prerequisiteIds: ["start", "pause", "comment"], localClock: { elapsedSeconds: 1800 } };
  state.operations = [start, pause, finish];
  const result = rebaseTimerChain(state, scope, "in_progress", ids());
  assert.deepEqual(result.resolved, ["start"]);
  const [newPause, newFinish] = state.operations as [Timer, Completion];
  assert.equal(state.operations.length, 2);
  assert.equal(newPause.payload.baseStatus, "in_progress");
  assert.equal(newPause.dependencyId, undefined);
  assert.equal(newPause.payload.previousOperationId, undefined);
  assert.equal(newFinish.payload.baseStatus, "paused");
  assert.equal(newFinish.payload.previousTimerOperationId, newPause.id);
  assert.deepEqual(newFinish.prerequisiteIds, [newPause.id, "comment"]);
});

test("a delivery already completed on the server is not resent and nothing stays blocked", () => {
  const state = emptyState();
  state.operations = [timer("start", "in_progress", "pending", 10, conflict)];
  rebaseTimerChain(state, scope, "completed", ids());
  assert.equal(state.operations.length, 0);
});

test("chains are not rewritten while one of their operations is being sent", () => {
  const state = emptyState();
  state.operations = [timer("start", "in_progress", "pending", 10, conflict), timer("pause", "paused", "in_progress", 40, { status: "syncing" })];
  assert.deepEqual(conflictedTimerScopes(state), []);
  assert.deepEqual(rebaseTimerChain(state, scope, "pending", ids()), { replaced: [], resolved: [] });
});

test("other review reasons are not treated as a status conflict", () => {
  assert.equal(isStatusConflict(timer("t", "in_progress", "pending", 1, { status: "needs_review", lastError: "MOBILE_SYNC_REQUIRES_REVIEW" })), false);
  assert.equal(isStatusConflict(timer("t", "in_progress", "pending", 1, { status: "conflict", lastError: "MOBILE_SYNC_OPERATION_REUSED" })), false);
  assert.equal(isStatusConflict(timer("t", "in_progress", "pending", 1, { status: "blocked", lastError: "MOBILE_SYNC_INVALID_STATUS" })), true);
});
