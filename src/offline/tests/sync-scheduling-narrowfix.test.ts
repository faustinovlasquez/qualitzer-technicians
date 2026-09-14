/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineOperation } from "../../domain/offline";
import { ApiError } from "../../infrastructure/errors";
import { OfflineEngine } from "../engine";
import { decodeState, updateState } from "../state";
import { deploymentWaits, protectDeploymentCooldown } from "../syncScheduling";
import { assignmentsWithStep, creation, fixture, uuid } from "./fakes";

const actionsError = "MOBILE_SYNC_ACTIONS_UNAVAILABLE";
const creationError = "MOBILE_CREATION_SCHEMA_NOT_READY";
const base = (id: number) => ({ id: uuid(id), status: "pending" as const, createdAt: 100, attempts: 0, nextAttemptAt: 0 });
const scope = (id: number) => ({ companyBranchId: 1, groupId: `direct-${id}`, workId: String(id), startDate: "2026-09-08", endDate: "2026-09-08" });
const timer = (id: number): Extract<OfflineOperation, { kind: "timer" }> => ({ ...base(id), kind: "timer", scope: scope(id), payload: { status: "in_progress", baseStatus: "pending" } });
const create = (id: number): Extract<OfflineOperation, { kind: "create" }> => ({ ...base(id), kind: "create", input: creation(id), localGroupId: `local-${uuid(id)}`, localWorkId: `local-${uuid(id)}` });
const settle = async () => { for (let index = 0; index < 2_000; index++) await Promise.resolve(); };
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

for (const kind of ["timer", "create"] as const) {
  const make = kind === "timer" ? timer : create;
  const code = kind === "timer" ? actionsError : creationError;
  test(`${kind}: independent 60s root probes after upgrade without waiting for the older 300s root`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture();
    const original: OfflineOperation[] = [
      { ...make(1), attempts: 9, lastError: code, nextAttemptAt: 301_000 },
      { ...make(2), attempts: 1, lastError: code, nextAttemptAt: 61_000 },
    ];
    await updateState(f.store, "a", (state) => { state.operations = original; });
    assert.equal(deploymentWaits(original).get(kind), 61_000);
    const engine = new OfflineEngine(f.dependencies); t.after(() => engine.stop());
    engine.start(); t.mock.timers.tick(0); await settle();
    const probes = f.upstream.verifyCount;
    f.advance(59_999); t.mock.timers.tick(59_999); await settle();
    assert.equal(f.upstream.verifyCount, probes);
    assert.equal(f.upstream.commands.length + f.upstream.creates.length, 0);
    f.advance(1); t.mock.timers.tick(1); await settle();
    assert.equal(f.upstream.commands.length + f.upstream.creates.length, 1);
    assert.equal(engine.getSnapshot().operations[1]!.status, "applied");
    assert.deepEqual(engine.getSnapshot().operations[0], original[0]);
    assert.equal(engine.getSnapshot().operations[1]!.id, uuid(2));
  });

  test(`${kind}: an actual failure protects every expired root, caps backoff, and survives restart`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture();
    f.upstream.sendError = new ApiError(kind === "timer" ? 503 : 409, code, "Deployment required");
    await updateState(f.store, "a", (state) => {
      state.operations = [
        { ...make(1), attempts: 1, lastError: code, nextAttemptAt: 1_000 },
        { ...make(2), attempts: 2, lastError: code, nextAttemptAt: 500 },
        { ...make(3), attempts: 9, lastError: code, nextAttemptAt: 301_000 },
        make(4),
      ];
    });
    const engine = new OfflineEngine(f.dependencies);
    engine.start(); t.mock.timers.tick(0); await settle();
    assert.equal(f.upstream.commands.length + f.upstream.creates.length, 1);
    const stored = await f.store.read("a");
    assert.deepEqual(stored.operations.map((op) => op.nextAttemptAt), [61_000, 61_000, 301_000, 61_000]);
    assert.deepEqual(stored.operations.map((op) => op.attempts), [2, 2, 9, 0]);
    assert.deepEqual(decodeState(JSON.stringify(stored)).operations, stored.operations);
    engine.stop();
    const restored = new OfflineEngine(f.dependencies); t.after(() => restored.stop());
    restored.start(); t.mock.timers.tick(0); await settle();
    assert.deepEqual((await f.store.read("a")).operations, stored.operations);
    const probes = f.upstream.verifyCount;
    for (let step = 0; step < 29; step++) { f.advance(2_000); t.mock.timers.tick(2_000); await settle(); }
    assert.equal(f.upstream.verifyCount, probes);
    assert.equal(f.upstream.commands.length + f.upstream.creates.length, 1);
    f.advance(2_000); t.mock.timers.tick(2_000); await settle();
    assert.equal(f.upstream.commands.length + f.upstream.creates.length, 2);
    assert.deepEqual(restored.getSnapshot().operations.map((op) => op.nextAttemptAt), [121_000, 121_000, 301_000, 121_000]);
    for (let cycle = 0; cycle < 10; cycle++) {
      const wait = deploymentWaits(restored.getSnapshot().operations).get(kind)! - f.dependencies.now();
      assert.ok(wait >= 60_000 && wait <= 300_000);
      const sends = f.upstream.commands.length + f.upstream.creates.length;
      f.advance(wait); t.mock.timers.tick(wait); await settle();
      assert.equal(f.upstream.commands.length + f.upstream.creates.length, sends + 1);
    }
    assert.equal(deploymentWaits(restored.getSnapshot().operations).get(kind)! - f.dependencies.now(), 300_000);
  });
}

test("fresh real enqueues cannot bypass the failure floor or cause repeated 2s probes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const data = assignmentsWithStep();
  data.groups[0]!.works[0]!.canExecute = true;
  const freshIds = [80, 81, 82];
  data.groups = freshIds.map((id) => ({ ...data.groups[0]!, id: `direct-${id}`, works: [{ ...data.groups[0]!.works[0]!, id: String(id) }] }));
  await updateState(f.store, "a", (state) => {
    state.cache.push({ key: "assignments:2026-09-08", fetchedAt: 100, json: JSON.stringify(data), coverage: { branchId: 1, date: "2026-09-08", fetchedAt: 100 } });
    state.operations = [{ ...timer(1), lastError: actionsError, nextAttemptAt: 0 }, { ...timer(2), lastError: actionsError, nextAttemptAt: 0 }];
  });
  f.upstream.sendError = new ApiError(503, actionsError, "Deployment required");
  const engine = new OfflineEngine(f.dependencies); t.after(() => engine.stop());
  engine.start(); t.mock.timers.tick(0); await settle();
  for (const id of freshIds) {
    await engine.enqueue([timer(id)]); t.mock.timers.tick(0); await settle();
    assert.equal(f.upstream.commands.length, 1);
    assert.equal(engine.getSnapshot().operations.find((op) => op.id === uuid(id))!.attempts, 0);
  }
  const probes = f.upstream.verifyCount;
  for (let step = 0; step < 30; step++) { f.advance(2_000); t.mock.timers.tick(2_000); await settle(); }
  assert.equal(f.upstream.verifyCount, probes + 1);
  assert.equal(f.upstream.commands.length, 2);
  assert.deepEqual(engine.getSnapshot().operations.map((op) => op.nextAttemptAt), [121_000, 121_000, 121_000, 121_000, 121_000]);
  assert.deepEqual(engine.getSnapshot().operations.map((op) => op.attempts), [2, 0, 0, 0, 0]);
  f.upstream.sendError = undefined;
  f.advance(60_000); t.mock.timers.tick(60_000); await settle();
  assert.equal(engine.getSnapshot().pending, 0);
  assert.deepEqual(f.upstream.commands[0], f.upstream.commands[2]);
});

test("dependency-held deployment errors do not freeze an independent eligible root", async () => {
  const f = fixture();
  const held: OfflineOperation = { ...timer(1), status: "needs_review", lastError: "MOBILE_SYNC_OPERATION_REUSED" };
  const child: OfflineOperation = { ...timer(2), dependencyId: held.id, lastError: actionsError, nextAttemptAt: 301_000 };
  await updateState(f.store, "a", (state) => { state.operations = [held, child, timer(3)]; });
  assert.equal(deploymentWaits([held, child]).size, 0);
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  assert.deepEqual(f.upstream.commands.map((command) => command.operationId), [uuid(3)]);
  assert.deepEqual(engine.getSnapshot().operations.slice(0, 2), [held, child]);
});

test("shared cooldown preserves receipts, syncing leases, 429, in-progress and unknown errors", () => {
  const failed = { ...timer(1), lastError: actionsError, nextAttemptAt: 61_000 };
  const protectedOperations: OfflineOperation[] = [
    { ...timer(2), lastError: "RATE_LIMITED", nextAttemptAt: 31_000 },
    { ...timer(3), lastError: "MOBILE_SYNC_IN_PROGRESS", nextAttemptAt: 6_000 },
    { ...timer(4), status: "syncing", lastError: actionsError, nextAttemptAt: 5_000 },
    { ...timer(5), receipt: { operationId: uuid(5), state: "applied" }, nextAttemptAt: 4_000 },
    { ...timer(6), status: "needs_review", lastError: actionsError },
    { ...timer(7), lastError: "UNKNOWN_FAILURE", nextAttemptAt: 3_000 },
    { ...timer(8), lastError: "MOBILE_SYNC_SCHEMA_NOT_READY", nextAttemptAt: 2_000 },
    create(9),
  ];
  const before = structuredClone(protectedOperations);
  const child = { ...timer(10), dependencyId: uuid(6) };
  const checklist: OfflineOperation = { ...base(11), kind: "checklist", scope: scope(11), payload: { checklistId: 17 } };
  protectDeploymentCooldown([failed, ...protectedOperations, child, checklist], failed);
  assert.deepEqual(protectedOperations, before);
  assert.equal(child.nextAttemptAt, 61_000);
  assert.equal(child.dependencyId, uuid(6));
  assert.equal(checklist.nextAttemptAt, 61_000);
  assert.equal(checklist.attempts, 0);
  const unknown = { ...timer(12), lastError: "UNKNOWN_FAILURE", nextAttemptAt: 301_000 };
  const fresh = timer(13);
  protectDeploymentCooldown([unknown, fresh], unknown);
  assert.equal(fresh.nextAttemptAt, 0);
});

for (const transition of ["background", "restart", "network"] as const) test(`stale manual waiting on a send cannot advance retries after ${transition} generation change`, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const gate = deferred(); let entered = false;
  await updateState(f.store, "a", (state) => { state.operations = [timer(1)]; });
  const send = f.upstream.offlineCommand.bind(f.upstream);
  let sends = 0;
  f.upstream.offlineCommand = async (command) => {
    sends++;
    if (sends === 1) { entered = true; await gate.promise; throw new ApiError(503, actionsError, "Deployment required"); }
    return send(command);
  };
  const engine = new OfflineEngine(f.dependencies); t.after(() => engine.stop());
  engine.start(); t.mock.timers.tick(0); await settle(); assert.equal(entered, true);
  const requested = engine.requestSync(); assert.equal(engine.requestSync(), requested);
  if (transition === "background") { engine.setForeground(false); engine.setForeground(true); }
  else if (transition === "restart") { engine.stop(); engine.start(); }
  else { engine.noteNetworkState(false); engine.noteNetworkState(true); }
  t.mock.timers.tick(0); await settle();
  gate.release(); await requested; await settle();
  t.mock.timers.tick(0); await settle();
  assert.equal(sends, 1);
  assert.equal(engine.getSnapshot().operations[0]!.nextAttemptAt, 61_000);
  assert.equal(engine.getSnapshot().operations[0]!.attempts, 1);
  f.advance(29_999); t.mock.timers.tick(29_999); await settle(); await engine.requestSync();
  assert.equal(sends, 1);
  f.advance(1); await engine.requestSync();
  assert.equal(sends, 2);
  assert.equal(engine.getSnapshot().pending, 0);
});

test("manual consumed before an asynchronous lease read cannot reset deadlines in a newer generation", async () => {
  const f = fixture(); const gate = deferred(); let pauseRead = false; let entered = false;
  const original = { ...timer(1), attempts: 9, lastError: actionsError, nextAttemptAt: 301_000 };
  await updateState(f.store, "a", (state) => { state.operations = [original]; });
  const read = f.store.read.bind(f.store);
  f.store.read = async (namespace) => {
    if (pauseRead) { pauseRead = false; entered = true; await gate.promise; }
    return read(namespace);
  };
  f.dependencies.connectivity.current = async () => { pauseRead = true; return true; };
  const engine = new OfflineEngine(f.dependencies);
  const request = engine.requestSync(); await settle(); assert.equal(entered, true);
  engine.setForeground(false); engine.setForeground(true);
  f.dependencies.connectivity.current = async () => true;
  gate.release(); await request;
  await engine.syncNow();
  assert.deepEqual((await f.store.read("a")).operations, [original]);
  assert.equal(f.upstream.commands.length, 0);
  await engine.requestSync(); assert.equal(f.upstream.commands.length, 0);
  f.advance(30_000); await engine.requestSync();
  assert.equal(f.upstream.commands.length, 1);
});