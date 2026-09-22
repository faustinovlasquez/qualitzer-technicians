import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Assignments, StepAnswer, WorkScope } from "../src/domain/models";
import type { CreationInput } from "../src/domain/creation";
import { OfflineQueuedError, type OfflineOperation, type OfflineQueuedOutcome } from "../src/domain/offline";
import { overlayCreations } from "../src/offline/overlay";
import { creation, result, uuid } from "../src/offline/tests/fakes";
import { agendaFixture, frozenNow } from "./helpers/agenda-load-lifecycle";
import { checklistDate } from "./helpers/assignment-checklist";
import { deferred } from "./helpers/durable-ui";
import type { LocationAction } from "../src/domain/locationTracking";

test("business mutations publish locations for activities, files, reports, equipment and order lifecycle", async context => {
  const current = fixture(context); const loaded = await current.loadDay(); const group = loaded.data!.groups[0];
  const actions: LocationAction[] = [];
  loaded.bindLocationActions((action) => async state => { assert.equal(state, "CONFIRMED"); actions.push(action); });
  loaded.openWork(group, group.works[0]); let app = await current.flush();
  const mutations: Array<{ expected: LocationAction; execute(app: typeof loaded): Promise<unknown> }> = [
    { expected: "ACTIVITY_CREATED", execute: app => app.createActivity({ activity: "Revisar", executionTime: 10 }) },
    { expected: "ACTIVITY_UPDATED", execute: app => app.updateActivity(77, { activity: "Ajustar", executionTime: 20 }) },
    { expected: "ACTIVITY_COMPLETED", execute: app => app.completeActivity(77) },
    { expected: "ACTIVITY_REOPENED", execute: app => app.completeActivity(77, false) },
    { expected: "ACTIVITY_DELETED", execute: app => app.deleteActivity(77) },
    { expected: "WORK_REOPENED", execute: app => app.reopenWork() },
    { expected: "FILE_UPLOADED", execute: app => app.uploadDocuments([]) },
    { expected: "FILE_DELETED", execute: app => app.deleteFile("8") },
    { expected: "REPORT_SAVED", execute: app => app.report("Informe") },
    { expected: "COMMENT_ADDED", execute: app => app.addComment("Comentario") },
    { expected: "EQUIPMENT_LOCATION_CHANGED", execute: app => app.equipmentLocation.save("work", { expected: null, address: { address: "Paine", country: "Chile", region: "", county: "", city: "", postalCode: "", lat: "-33", lon: "-70" } }) },
  ];
  for (const mutation of mutations) {
    await mutation.execute(app); await current.flush();
    for (const read of current.reads.filter(read => !read.settled)) read.resolve();
    app = await current.flush(); assert.equal(actions.at(-1), mutation.expected);
  }
  app.closeWork(); app = await current.flush(); app.openGroup(app.data!.groups[0]); app = await current.flush();
  await app.startOrder(); await current.flush();
  for (const read of current.reads.filter(read => !read.settled)) read.resolve();
  app = await current.flush(); assert.equal(actions.at(-1), "ORDER_STARTED");
  await app.deliverOrder({ acknowledgeDelivery: true, technicianSignature: "data:image/png;base64,fixture" } as Parameters<typeof app.deliverOrder>[0]);
  assert.equal(actions.at(-1), "ORDER_DELIVERED");
  assert.equal(actions.length, mutations.length + 2);
});

for (const outcome of ["confirmed", "queued", "failed"] as const) test(`action location captures the original scope once for ${outcome} work pause`, async context => {
  const current = fixture(context); const loaded = await current.loadDay(); const group = loaded.data!.groups[0];
  const calls: { action: LocationAction; groupId: string; state?: string; operationId?: string }[] = [];
  loaded.bindLocationActions((action, scope) => {
    const call = { action, groupId: scope.groupId, state: undefined as string | undefined, operationId: undefined as string | undefined }; calls.push(call);
    return async (state, operationId) => { call.state = state; call.operationId = operationId; };
  });
  const gate = deferred<void>(); current.setStatusGate(() => gate.promise);
  const pause = loaded.onWorkStatus(group, group.works[0], { status: "paused" });
  const checked = outcome === "confirmed" ? pause : assert.rejects(pause);
  await current.flush();
  await assert.rejects(current.render().onWorkStatus(group, group.works[0], { status: "paused" }), /operación en curso/);
  assert.equal(calls.length, 1); assert.equal(calls[0].action, "WORK_PAUSED"); assert.equal(calls[0].state, undefined);
  if (outcome === "confirmed") gate.resolve(); else gate.reject(outcome === "queued" ? queued("timer") : new Error("FAILED"));
  await checked; await current.flush();
  assert.equal(calls[0].state, outcome === "failed" ? undefined : outcome === "queued" ? "QUEUED" : "CONFIRMED");
  assert.equal(calls[0].operationId, outcome === "queued" ? uuid(301) : undefined);
});

const answer: StepAnswer = { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: "Keep draft" };
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture(); t.after(() => f.unmount()); return f;
}
function queued(kind: "answer" | "timer", id = uuid(301)): OfflineQueuedError {
  return new OfflineQueuedError({ kind, operationId: id, operationIds: [id], date: checklistDate, ownsFiles: false });
}

for (const outcome of ["queued", "persist-failed"] as const) test(`hook answer ${outcome} releases action without waiting for remote refresh or confirming progress`, async (t) => {
  const f = fixture(t); const loaded = await f.loadDay();
  const group = loaded.data!.groups[0]; loaded.openWork(group, group.works[0], { tab: "checklist" });
  const opened = await f.flush(); const selected = opened.selected;
  const before = structuredClone(opened.canonicalDetailWork); const gate = deferred<void>();
  f.setAnswerGate(() => gate.promise);
  const error = outcome === "queued" ? queued("answer") : new Error("DISK_FULL");
  const save = opened.saveAnswer("1009", answer);
  const checked = assert.rejects(save, (caught: unknown) => caught === error);
  assert.equal((await f.flush()).busy, true);
  await assert.rejects(f.render().saveAnswer("1009", answer), /operación en curso/);
  gate.reject(error); await checked;
  const after = await f.flush();
  assert.equal(after.busy, false); assert.equal(after.loading, false);
  assert.equal(f.calls.answers, 1); assert.equal(f.reads.length, 1);
  assert.deepEqual(after.canonicalDetailWork, before); assert.deepEqual(after.selected, selected);
  assert.equal(after.canonicalDetailWork?.checklistDone, 7);
  const second = queued("answer", uuid(302)); f.setAnswerGate(async () => { throw second; });
  await assert.rejects(after.saveAnswer("1009", answer), (caught: unknown) => caught === second);
  assert.equal(f.calls.answers, 2); assert.equal((await f.flush()).busy, false);
});

test("post-applied refresh leaves busy/loading clear and cannot block a subsequent timer action", async (t) => {
  const f = fixture(t); const loaded = await f.loadDay(); const group = loaded.data!.groups[0]; const work = group.works[0];
  const scope: WorkScope = { companyBranchId: 1, groupId: group.id, workId: work.id, startDate: checklistDate, endDate: checklistDate };
  f.wrappers[0].update({ operations: [{ id: uuid(303), kind: "comment", text: "Applied", scope, status: "applied", createdAt: frozenNow, attempts: 1, nextAttemptAt: 0 }] });
  const refreshing = await f.flush();
  assert.equal(f.reads.length, 2); assert.equal(f.reads[1].settled, false);
  assert.equal(refreshing.busy, false); assert.equal(refreshing.loading, false);
  assert.deepEqual(refreshing.data, loaded.data);
  const accepted = queued("timer"); f.setStatusGate(async () => { throw accepted; });
  await assert.rejects(refreshing.onWorkStatus(group, work, { status: "in_progress" }), (error: unknown) => error === accepted);
  const after = await f.flush();
  assert.equal(f.calls.statuses, 1); assert.equal(after.busy, false); assert.equal(after.loading, false);
  assert.equal(f.reads[1].signal.aborted, true); assert.deepEqual(after.data, loaded.data);
});

async function creationFixture(t: TestContext, kind: "work" | "maintenance" = "work") {
  const f = fixture(t); const loaded = await f.loadDay();
  const input: CreationInput = kind === "maintenance" ? { kind, companyBranchId: 1, clientRequestId: uuid(304), schedule: { date: checklistDate, startTime: "09:00", endTime: "10:00" }, maintenance: { type: "correctivo", title: "Mantenimiento local", motive: "Revisar", equipmentId: 5 } } : creation(304);
  input.schedule.date = checklistDate;
  const operation: Extract<OfflineOperation, { kind: "create" }> = { id: input.clientRequestId, kind: "create", input,
    localGroupId: `local-${input.clientRequestId}`, localWorkId: `local-${input.clientRequestId}`, status: "pending", createdAt: frozenNow, attempts: 0, nextAttemptAt: 0 };
  const outcome: OfflineQueuedOutcome = { kind: "create", operationId: operation.id, operationIds: [operation.id], localGroupId: operation.localGroupId,
    localWorkId: operation.localWorkId, date: checklistDate, ownsFiles: false };
  f.wrappers[0].update({ pending: 1, operations: [operation] });
  f.ignoreNextAbort(); const remoteRead = loaded.refresh(); await f.flush();
  f.render().openCreate(kind); await f.flush();
  const local = overlayCreations(structuredClone(loaded.data!), checklistDate, [operation], loaded.session!);
  f.setLocalAssignments(async () => structuredClone(local));
  return { f, loaded, local, input, operation, outcome, remoteRead };
}

test("queued creation opens cached data and stable local draft IDs while remote read remains unresolved", async (t) => {
  const { f, loaded, local, input, operation, outcome, remoteRead } = await creationFixture(t);
  await f.render().onOfflineQueuedCreate(outcome);
  const opened = await f.flush();
  assert.equal(f.calls.localAssignments, 1); assert.equal(f.reads.length, 2); assert.equal(f.reads[1].settled, false);
  assert.equal(opened.selectedCreationKind, null); assert.equal(opened.busy, false); assert.equal(opened.loading, false);
  assert.equal(opened.creationNotice?.confirmed, false);
  assert.equal(opened.canonicalDetailWork?.id, operation.localWorkId); assert.equal(opened.work?.canExecute, false);
  assert.equal(opened.detailDraftIdentity?.groupId, operation.localGroupId);
  assert.equal(opened.detailDraftIdentity?.workId, operation.localWorkId);
  assert.ok(opened.data?.groups.some((group) => group.id === loaded.data!.groups[0].id));
  assert.equal(opened.data?.groups.length, local.groups.length);
  f.reads[1].resolve(); await remoteRead;
  assert.equal((await f.flush()).work?.id, operation.localWorkId, "late old remote data cannot erase the local selection");
  const applied = { ...operation, status: "applied" as const, result: result(input) };
  f.wrappers[0].update({ pending: 0, operations: [applied] }); await f.flush();
  assert.equal(f.reads.length, 3); assert.equal(f.render().busy, false); assert.equal(f.render().loading, false);
  f.reads[2].resolve(overlayCreations(structuredClone(loaded.data!), checklistDate, [applied], loaded.session!));
  const reconciled = await f.flush();
  assert.equal(reconciled.canonicalDetailWork?.id, "80"); assert.equal(reconciled.work?.id, operation.localWorkId);
  assert.deepEqual(reconciled.detailDraftIdentity, opened.detailDraftIdentity);
});

for (const boundary of ["lock-before", "lock-during", "session-stale", "unmount"] as const) test(`queued creation ${boundary} never automatically navigates after local read`, async (t) => {
  const { f, outcome, local, remoteRead } = await creationFixture(t);
  const gate = deferred<Assignments>(); f.setLocalAssignments(() => gate.promise);
  const retained = f.render();
  if (boundary === "lock-before") f.access.allowed = false;
  const open = retained.onOfflineQueuedCreate(outcome);
  await f.flush();
  assert.equal(f.calls.localAssignments, boundary === "lock-before" ? 0 : 1);
  if (boundary === "lock-during") { f.access.allowed = false; f.render(); }
  if (boundary === "session-stale") f.wrappers[0].remote.onUnauthorized?.();
  if (boundary === "unmount") f.unmount();
  gate.resolve(local); await open;
  f.reads[1].resolve(); await remoteRead;
  if (boundary === "unmount") { assert.equal(f.reads.length, 2); return; }
  const after = await f.flush();
  assert.equal(after.selected, null); assert.equal(after.selectedOrder, null); assert.equal(after.busy, false);
  assert.equal(after.selectedCreationKind, boundary === "session-stale" ? null : "work");
});

test("mismatched queued creation cannot open another local resource", async (t) => {
  const { f, outcome, remoteRead } = await creationFixture(t);
  await f.render().onOfflineQueuedCreate({ ...outcome, localWorkId: `local-${uuid(999)}` });
  const after = await f.flush(); assert.equal(f.calls.localAssignments, 0); assert.equal(after.selected, null);
  assert.equal(after.selectedCreationKind, "work"); assert.match(after.error ?? "", /no se pudo vincular/);
  f.reads[1].resolve(); await remoteRead;
});

test("an applied creation refresh never reopens a detail the user already closed", async (t) => {
  const { f, loaded, operation, outcome, input, remoteRead } = await creationFixture(t);
  await f.render().onOfflineQueuedCreate(outcome); (await f.flush()).closeWork(); await f.flush();
  const applied = { ...operation, status: "applied" as const, result: result(input) };
  f.wrappers[0].update({ pending: 0, operations: [applied] }); await f.flush();
  f.reads.at(-1)!.resolve(overlayCreations(structuredClone(loaded.data!), checklistDate, [applied], loaded.session!));
  const after = await f.flush(); assert.equal(after.selected, null); assert.equal(after.selectedOrder, null);
  assert.ok(after.data?.groups.some((group) => group.id === applied.result.groupId));
  f.reads[1].resolve(); await remoteRead;
  assert.equal((await f.flush()).selected, null);
});

test("queued maintenance opens its parent with a local-only creation notice", async context => {
  const { f, outcome, operation, remoteRead } = await creationFixture(context, "maintenance");
  await f.render().onOfflineQueuedCreate(outcome); const opened = await f.flush();
  assert.equal(opened.selected, null); assert.equal(opened.selectedOrder?.id, operation.localGroupId);
  assert.equal(opened.selectedOrder?.draftGroupId, operation.localGroupId); assert.equal(opened.creationNotice?.confirmed, false);
  assert.equal(opened.creationNotice?.kind, "maintenance"); assert.equal(opened.selectedCreationKind, null);
  f.reads[1].resolve(); await remoteRead;
  assert.equal((await f.flush()).selectedOrder?.id, operation.localGroupId);
});