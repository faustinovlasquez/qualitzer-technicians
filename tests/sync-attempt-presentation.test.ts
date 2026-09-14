/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineController, OfflineOperation, OfflineSnapshot } from "../src/domain/offline";
import { ApiError } from "../src/infrastructure/errors";
import { captureSyncAttempt, deploymentPendingCount, requestManualSync, syncAttemptMessage, syncAttemptPresentation, syncSnapshotKey } from "../src/screens/offline/syncAttemptPresentation";

const scope = { groupId: "direct-1", workId: "1", companyBranchId: 1, startDate: "2026-09-14", endDate: "2026-09-14" };
function operation(id: string, status: OfflineOperation["status"] = "pending"): OfflineOperation {
  return { id, kind: "comment", text: id, scope, status, attempts: 0, createdAt: 1, nextAttemptAt: 0 };
}
function snapshot(operations: OfflineOperation[], patch: Partial<OfflineSnapshot> = {}): OfflineSnapshot {
  return { online: true, preparing: false, syncing: false, authBlocked: false, pending: operations.filter((entry) => entry.status !== "applied").length,
    conflicts: 0, lastError: null, lastSyncedAt: 1, coverage: [], operations, ...patch };
}

test("partial application counts newly applied IDs, all deployment kinds and unchanged dependent children", () => {
  const operations = [operation("prior", "applied"), ...Array.from({ length: 9 }, (_, index) => operation(String(index)))];
  const before = snapshot(operations);
  const after = snapshot(operations.map((entry) => ["0", "1"].includes(entry.id) ? { ...entry, status: "applied" } : entry), {
    online: false, lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE",
    awaitingDeploymentByKind: { create: 0, comment: 2, answer: 1, document: 1, timer: 2, checklist: 1 },
  });
  const saved = JSON.stringify([before, after]);
  const feedback = syncAttemptPresentation({ before: captureSyncAttempt(before) }, after);
  assert.equal(feedback.applied, 2); assert.equal(deploymentPendingCount(after), 7);
  assert.equal(feedback.title, "Se enviaron 2 cambios; quedan 7 pendientes");
  assert.equal(feedback.detail, "7 cambios requieren actualizar el servicio. Contacta a soporte.");
  assert.doesNotMatch(syncAttemptMessage(feedback), /MOBILE_|OFFLINE_|no se envi|no se pudo/i);
  assert.equal(JSON.stringify([before, after]), saved);
});

test("full success needs a known, idle and consistent queue; an unknown baseline never fabricates newly sent IDs", () => {
  const before = captureSyncAttempt(snapshot([operation("one")]));
  const after = snapshot([operation("one", "applied")]);
  assert.equal(syncAttemptPresentation({ before }, after).title, "Se envió 1 cambio; no quedan pendientes");
  assert.equal(syncAttemptPresentation({ before }, after).tone, "success");
  for (const candidate of [null, snapshot([], { online: false }), snapshot([], { syncing: true }), snapshot([operation("pending")], { pending: 0 }),
    snapshot([], { connection: { status: "checking", networkConnected: null, foreground: true, checkedAt: null } })]) {
    assert.notEqual(syncAttemptPresentation({ before }, candidate).tone, "success");
  }
  assert.equal(syncAttemptPresentation({ before: captureSyncAttempt(null) }, after).applied, 0);
});

test("manual throttling presents pending automatic retry and rounds remaining seconds upward without retrying", () => {
  const waiting = snapshot([{ ...operation("one"), nextAttemptAt: 2501, attempts: 0 }]);
  const feedback = syncAttemptPresentation({ before: captureSyncAttempt(waiting) }, waiting);
  assert.equal(feedback.title, "Hay 1 pendiente"); assert.equal(feedback.detail, "Reintento automático.");
  assert.match(syncAttemptMessage(feedback, 1000), /previsto en 2 s/);
  assert.doesNotMatch(syncAttemptMessage(feedback, 3000), /previsto en|éxito|enviaron/);
  assert.equal(waiting.operations[0].attempts, 0);
});

test("failed storage, snapshot errors and 401 take precedence over success and deployment notices", () => {
  const after = snapshot([operation("one", "applied")]);
  const before = captureSyncAttempt(snapshot([operation("one")]));
  const failure = syncAttemptPresentation({ before, failure: { error: new Error("OFFLINE_STORAGE_FULL") } }, after);
  assert.equal(failure.tone, "error"); assert.equal(failure.applied, 1);
  assert.match(syncAttemptMessage(failure), /Se envió 1 cambio; ocurrió un error.*almacenamiento local está lleno/);
  assert.equal(syncAttemptPresentation({ before }, { ...after, lastError: "OFFLINE_STORAGE_BUSY" }).tone, "error");
  for (const state of [{ ...after, authBlocked: true }, after]) {
    const feedback = syncAttemptPresentation({ before, failure: { error: new ApiError(401, "UNAUTHORIZED", "Unauthorized") } }, state);
    assert.equal(feedback.title, "Verifica tu sesión"); assert.equal(feedback.tone, "error");
    assert.doesNotMatch(syncAttemptMessage(feedback), /UNAUTHORIZED|éxito/);
  }
});

test("legacy snapshots use explicit deployment errors only; unrelated children are not guessed", () => {
  const blocked = { ...operation("parent"), lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" };
  const child = { ...operation("child"), dependencyId: blocked.id };
  assert.equal(deploymentPendingCount(snapshot([blocked, child])), 1);
  assert.equal(deploymentPendingCount(snapshot([{ ...blocked, status: "applied" }])), 0);
});

test("automatic operation/connection updates invalidate a result while unrelated coverage updates do not", () => {
  const before = snapshot([operation("one")]);
  assert.notEqual(syncSnapshotKey(before), syncSnapshotKey(snapshot([operation("one", "applied")])));
  assert.notEqual(syncSnapshotKey(before), syncSnapshotKey({ ...before, authBlocked: true }));
  assert.equal(syncSnapshotKey(before), syncSnapshotKey({ ...before, cachedAt: 2, coverage: [{ date: scope.startDate, branchId: 1, fetchedAt: 2 }] }));
});

test("controller manual API is preferred and old fixtures retain syncNow fallback without double calls", async () => {
  const calls: string[] = [];
  const controller: OfflineController = {
    getSnapshot: () => snapshot([]), subscribe: () => () => {}, start: () => {}, stop: () => {}, setForeground: () => {},
    syncNow: async () => { calls.push("legacy"); }, hasPendingChanges: async () => false, retry: async () => {}, prepareWeek: async () => {},
    readLocalFile: async () => { throw new Error("UNEXPECTED_READ"); },
  };
  await requestManualSync(controller);
  controller.requestSync = async () => { calls.push("manual"); };
  await requestManualSync(controller);
  assert.deepEqual(calls, ["legacy", "manual"]);
  const diskError = new Error("DISK_FULL"); controller.requestSync = async () => { throw diskError; };
  await assert.rejects(requestManualSync(controller), (caught: unknown) => caught === diskError);
  assert.deepEqual(calls, ["legacy", "manual"]);
});