/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TechnicianRepository } from "../../domain/TechnicianRepository";
import type { Assignments, ChecklistStep, DateRange, LocalPhoto, Session, StepAnswer, WorkScope } from "../../domain/models";
import type { CreationOptions, CreationOptionsQuery } from "../../domain/creation";
import { OfflineQueuedError } from "../../domain/offline";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { OfflineTechnicianRepository } from "../OfflineTechnicianRepository";
import { decodeState, emptyState, updateState } from "../state";
import { assignmentsWithStep, creation, fixture, user, uuid } from "./fakes";
import { syncAnswerFromStep, syncCommandSchema, toSyncAnswer } from "../../domain/offlineProtocol";
import { answerFromStep } from "../../domain/format";
import { resourceCacheKey } from "../cacheSchemas";
import { OFFLINE_LIMITS } from "../contracts";

const scope: WorkScope = { groupId: "direct-80", workId: "80", companyBranchId: 1, startDate: "2026-09-08", endDate: "2026-09-08" };
const draftPhoto: LocalPhoto = { id: "persisted-draft-photo", uri: "source:photo", name: "proof.png", mimeType: "image/png", size: 10 };
async function queued(action: Promise<unknown>): Promise<OfflineQueuedError> {
  try { await action; } catch (error) { assert.ok(error instanceof OfflineQueuedError); return error; }
  throw new Error("EXPECTED_QUEUED_OUTCOME");
}
const empty: Assignments = { generatedAt: "2026-09-08T00:00:00Z", technician: { id: 7, name: "Test", allowEditExecutionTime: false }, summary: { totalGroups: 0, totalWorks: 0, activeWorks: 0, overdueWorks: 0, plannedMinutes: 0 }, groups: [] };
function repositoryFixture() {
  const f = fixture();
  let readError: Error | undefined;
  const dates: string[] = [];
  const unavailable = async (): Promise<never> => { throw new Error("NOT_USED_BY_TEST"); };
  const remote: TechnicianRepository = {
    me: () => f.upstream.me(), createRecord: (input) => f.upstream.createRecord(input),
    offlineCommand: (command) => f.upstream.offlineCommand(command), offlineReceipt: (id) => f.upstream.offlineReceipt(id), offlineDocument: (metadata) => f.upstream.offlineDocument(metadata),
    assignments: async (range: DateRange) => { dates.push(range.startDate); if (readError) throw readError; return structuredClone(empty); },
    files: async () => { if (readError) throw readError; return []; }, comments: async () => { if (readError) throw readError; return { data: [], totalRows: 0, totalPages: 0 }; },
    creationOptions: unavailable, health: unavailable, login: unavailable, logout: unavailable, forcePassword: unavailable,
    notificationStatus: unavailable, notificationInbox: unavailable, registerNotificationDevice: unavailable, unregisterNotificationDevice: unavailable, readNotification: unavailable, deleteNotification: unavailable, testNotification: unavailable,
    status: unavailable, answer: unavailable, stepFiles: unavailable, upload: unavailable, report: unavailable, addComment: unavailable,
    uploadDocuments: unavailable, deleteFile: unavailable, groupFiles: unavailable, uploadGroupFiles: unavailable, deleteGroupFile: unavailable,
    orderDelivery: unavailable, startOrder: unavailable, deliverOrder: unavailable,
  };
  const session: Session = { token: "test-only", tenant: user.tenant!, user, branchId: 1, mode: "live" };
  const dependencies = { ...f.dependencies, upstream: remote };
  return { ...f, remote, session, dates, repository: new OfflineTechnicianRepository(remote, session, dependencies), setReadError: (error?: Error) => { readError = error; } };
}

test("remote read readiness, 503, unknown link and cache reads preserve honest connection state", async () => {
  const f = repositoryFixture();
  f.dependencies.connectivity.current = async () => null;
  await f.repository.assignments(scope, 1);
  assert.equal(f.repository.getSnapshot().connection?.status, "ready");
  assert.equal(f.repository.getSnapshot().connection?.networkConnected, null);
  f.setReadError(new ApiError(503, "UPSTREAM_UNAVAILABLE", "Unavailable"));
  await assert.rejects(f.repository.assignments(scope, 1));
  assert.equal(f.repository.getSnapshot().connection?.status, "service_error");
  assert.equal(f.repository.getSnapshot().online, false);
  f.setReadError(new NetworkError("network")); await f.repository.assignments(scope, 1);
  assert.equal(f.repository.getSnapshot().connection?.status, "unreachable");
  const connection = f.repository.getSnapshot().connection;
  await f.repository.engine.refresh(); assert.deepEqual(f.repository.getSnapshot().connection, connection);
  f.setReadError(); await f.repository.assignments(scope, 1);
  assert.equal(f.repository.getSnapshot().online, true);
});

test("deployment route 404 does not revoke cached resource authorization", async () => {
  const f = repositoryFixture(); await f.repository.files(scope);
  f.setReadError(new ApiError(404, "OFFLINE_SYNC_ROUTE_NOT_FOUND", "Missing route"));
  await assert.rejects(f.repository.files(scope));
  assert.equal((await f.store.read("a")).revokedResources.length, 0);
  f.setReadError(new NetworkError("network")); assert.deepEqual(await f.repository.files(scope), []);
});

test("local child reads do not override worker service failure with fictitious connectivity", async () => {
  const f = repositoryFixture(); f.upstream.sendError = new ApiError(409, "MOBILE_CREATION_SCHEMA_NOT_READY", "Deployment");
  await assert.rejects(f.repository.createRecord(creation()), OfflineQueuedError);
  await f.repository.engine.syncNow();
  const local = { ...scope, groupId: `local-${uuid(1)}`, workId: `local-${uuid(1)}` };
  const connection = f.repository.getSnapshot().connection;
  assert.equal(connection?.status, "service_error");
  await f.repository.comments(local, 0); await f.repository.files(local);
  assert.deepEqual(f.repository.getSnapshot().connection, connection);
  await f.repository.assignments(scope, 1);
  assert.equal(f.repository.getSnapshot().connection?.status, "service_error");
  assert.equal(f.repository.getSnapshot().online, false);
});

test("checklist catalog preserves arguments and cached results; attachment queues before explicit synchronization", async () => {
  const f = repositoryFixture(); const calls: unknown[] = [];
  const page = { items: [{ id: 7, name: "Motor", code: null, description: null, alreadyAssigned: false }], page: 0, pageSize: 20 as const, hasMore: false };
  const attached = { checklistId: 7, alreadyAssigned: false };
  f.remote.checklistOptions = async (actual, query) => { calls.push([actual, query]); return page; };
  f.remote.attachChecklist = async (actual, id) => { calls.push([actual, id]); return attached; };
  const data = assignmentsWithStep(); data.groups[0]!.works[0]!.canExecute = true;
  f.remote.assignments = async () => data;
  await f.repository.assignments(scope, 1);
  assert.deepEqual(await f.repository.checklistOptions(scope, { search: "motor", page: 0 }), page);
  assert.equal((await f.store.read("a")).operations.length, 0);
  f.connect(false);
  assert.deepEqual(await f.repository.checklistOptions(scope, { search: "motor", page: 0 }), page);
  await assert.rejects(f.repository.checklistOptions(scope, {}), /CACHE_MISS/);
  const outcome = await queued(f.repository.attachChecklist(scope, 7));
  assert.equal(outcome.kind, "checklist");
  assert.equal(f.upstream.commands.length, 0);
  assert.deepEqual(calls, [[scope, { search: "motor", page: 0 }]]);
  for (const invalid of [{ ...scope, companyBranchId: 2 }, { ...scope, workId: "local-1" }, { ...scope, groupId: "local-1" }, { ...scope, groupId: "direct-0" }]) {
    await assert.rejects(f.repository.checklistOptions(invalid, {})); await assert.rejects(f.repository.attachChecklist(invalid, 7));
  }
  assert.equal(calls.length, 1); assert.equal((await f.store.read("a")).operations.length, 1);
  f.connect(true); await f.repository.engine.syncNow();
  assert.equal(f.upstream.commands.length, 1);
  assert.deepEqual(f.upstream.commands[0], { operationId: outcome.operationId, kind: "checklist", scope, payload: { checklistId: 7 } });
  assert.equal((await f.store.read("a")).operations[0]!.status, "applied");
});

test("checklist missing port and failed service do not fabricate results or queue writes", async () => {
  const f = repositoryFixture();
  await assert.rejects(f.repository.checklistOptions(scope, {}), /servidor/);
  assert.equal(f.repository.getSnapshot().connection?.status, "service_error");
  f.remote.attachChecklist = async () => { throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "Unavailable"); };
  await assert.rejects(f.repository.attachChecklist(scope, 7)); assert.equal(f.repository.getSnapshot().online, false);
  assert.equal((await f.store.read("a")).operations.length, 0);
});

test("daily cache coverage survives offline range changes without faking missing days", async () => {
  const f = repositoryFixture();
  await f.repository.assignments({ startDate: "2026-09-08", endDate: "2026-09-10" }, 1);
  assert.deepEqual(f.dates, ["2026-09-08", "2026-09-09", "2026-09-10"]);
  f.connect(false);
  assert.equal((await f.repository.assignments({ startDate: "2026-09-09", endDate: "2026-09-09" }, 1)).groups.length, 0);
  assert.equal(f.repository.getSnapshot().coverage.length, 3);
  await assert.rejects(f.repository.assignments({ startDate: "2026-09-11", endDate: "2026-09-11" }, 1), /CACHE_MISS/);
});

test("exact equipment lookup is forwarded and cached separately from broad search and other numbers", async () => {
  const f = repositoryFixture();
  const queries: CreationOptionsQuery[] = [];
  const options: CreationOptions = { companyBranchId: 1, userId: 1, workerId: 7, timezone: "UTC", priorities: ["medium"], nonProductiveReasons: [], maintenanceTypes: [], schedule: { sameDayOnly: true, conflictPolicy: "warning" } };
  f.remote.creationOptions = async (query) => {
    queries.push(query);
    return { ...options, equipment: { items: [{ id: 71, label: "N.º interno EQ-001 · PLACA-9", internalNumber: "EQ-001" }], page: query.page ?? 0, pageSize: 25, hasMore: false } };
  };
  const query: CreationOptionsQuery = { companyBranchId: 1, kind: "equipment", internalNumber: " EQ-001 ", page: 0 };
  const first = await f.repository.creationOptions(query);
  assert.deepEqual(queries, [{ companyBranchId: 1, kind: "equipment", search: "", page: 0, internalNumber: "eq-001" }]);
  f.connect(false);
  assert.deepEqual(await f.repository.creationOptions({ ...query, internalNumber: "eq-001" }), first);
  await assert.rejects(f.repository.creationOptions({ ...query, internalNumber: "EQ-002" }), /CACHE_MISS/);
  await assert.rejects(f.repository.creationOptions({ companyBranchId: 1, kind: "equipment", search: "EQ-001" }), /CACHE_MISS/);
  assert.equal(queries.length, 1);
});
for (const status of [401, 403, 404, 503]) test(`cached assignments do not hide HTTP ${status}`, async () => {
  const f = repositoryFixture(); await f.repository.assignments(scope, 1);
  f.setReadError(new ApiError(status, "FORBIDDEN", "Denied"));
  await assert.rejects(f.repository.assignments(scope, 1), (error: unknown) => error instanceof ApiError && error.status === status);
  if (status === 401) assert.equal(f.repository.getSnapshot().authBlocked, true);
});
test("cached assignments fallback for typed network loss only", async () => {
  const f = repositoryFixture(); await f.repository.assignments(scope, 1);
  f.setReadError(new NetworkError("network")); await f.repository.assignments(scope, 1);
  f.setReadError(new SyntaxError("JSON")); await assert.rejects(f.repository.assignments(scope, 1), SyntaxError);
});
test("offline creation throws queued outcome after durable commit and remains in schedule", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.createRecord(creation()), (error: unknown) => error instanceof OfflineQueuedError && error.operationId === uuid(1));
  const data = await f.repository.assignments(scope, 1);
  assert.equal(data.groups[0]?.id, `local-${uuid(1)}`); assert.equal(data.groups[0]?.works[0]?.canExecute, false);
  assert.equal(f.upstream.creates.length, 0);
});
test("online creation returns canonical result only after persisted applied state", async () => {
  const f = repositoryFixture(); await queued(f.repository.createRecord(creation()));
  assert.equal(f.upstream.creates.length, 0);
  await f.repository.engine.syncNow();
  const value = await f.repository.createRecord(creation());
  assert.equal(value.groupId, "direct-80"); assert.equal((await f.store.read("a")).operations[0]?.status, "applied");
});
test("photo batch owns all durable files before returning queued outcome", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.uploadDocuments(scope, [1, 2].map((id) => ({ id: String(id), uri: "fake:", name: `${id}.png`, mimeType: "image/png" }))), (error: unknown) => error instanceof OfflineQueuedError && error.ownsFiles && error.operationIds.length === 2);
  assert.equal(f.files.files.size, 2); assert.equal((await f.store.read("a")).operations.length, 2);
  const files = await f.repository.files(scope); assert.equal(files.length, 2); assert.match(files[0]!.url, /^memory:/);
});
test("partial local copy failure rolls back uncommitted copies not the user's originals", async () => {
  const f = repositoryFixture(); f.files.failOn = 2;
  await assert.rejects(f.repository.uploadDocuments(scope, [1, 2].map((id) => ({ id: String(id), uri: "fake:", name: `${id}.png`, mimeType: "image/png" }))), /COPY_FAILED/);
  assert.equal(f.files.files.size, 0); assert.equal((await f.store.read("a")).operations.length, 0); assert.equal(f.files.removes.length, 1);
});
test("failed queue commit releases newly copied files and never sends", async () => {
  const f = repositoryFixture(); f.store.failWrites = true;
  await assert.rejects(f.repository.uploadDocuments(scope, [{ id: "1", uri: "fake:", name: "1.png", mimeType: "image/png" }]));
  assert.equal(f.files.files.size, 0); assert.equal(f.upstream.documents.length, 0);
});
test("throwing UI observer cannot delete already committed photo", async () => {
  const f = repositoryFixture(); f.connect(false); f.repository.subscribe(() => { throw new Error("UI_BUG"); });
  await assert.rejects(f.repository.uploadDocuments(scope, [{ id: "1", uri: "fake:", name: "1.png", mimeType: "image/png" }]), OfflineQueuedError);
  assert.equal(f.files.files.size, 1); assert.equal((await f.store.read("a")).operations.length, 1);
});
test("offline status report and delete never pretend success or enqueue", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.status(scope, { status: "delivered" }), /REQUIRES_CONNECTION/);
  await assert.rejects(f.repository.report(scope, "Report"), /REQUIRES_CONNECTION/);
  await assert.rejects(f.repository.deleteFile(scope, "1"), /REQUIRES_CONNECTION/);
  assert.equal((await f.store.read("a")).operations.length, 0);
});
test("cached reads cannot cross branch namespace", async () => {
  const f = repositoryFixture(); await f.repository.assignments(scope, 1);
  await assert.rejects(f.repository.assignments(scope, 2), /BRANCH_NAMESPACE/);
});
test("missing canonical answer base preserves caller draft by rejecting before queue", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.answer(scope, "1", { responseValue: "yes", isCompleted: true, comment: null, executionStatus: "completed" }), /BASE_MISSING/);
  assert.equal((await f.store.read("a")).operations.length, 0);
});
test("offline logout refuses pending work in other namespace", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.createRecord(creation()), OfflineQueuedError);
  const state = await f.store.read("a");
  await updateState(f.store, "different-user", (target) => { target.operations = state.operations; });
  await updateState(f.store, "a", (target) => { target.operations = []; });
  await assert.rejects(f.repository.logout(), /LOGOUT_HAS_PENDING/);
});
test("failed read after confirmed remote creation still reports queue ownership", async () => {
  const f = repositoryFixture(); f.upstream.afterCreate = () => { f.store.failWrites = true; };
  await assert.rejects(f.repository.createRecord(creation()), OfflineQueuedError);
  await assert.rejects(f.repository.engine.syncNow(), /DISK_FULL/);
  assert.equal(f.upstream.creates.length, 1);
  f.store.failWrites = false;
  assert.equal((await f.store.read("a")).operations.length, 1);
});

const answerCases: Array<{ type: ChecklistStep["type"]; responseValue: StepAnswer["responseValue"] }> = [
  { type: "text", responseValue: "Detalle" }, { type: "number", responseValue: "2.50" }, { type: "validation", responseValue: true },
  { type: "validation", responseValue: false }, { type: "validation", responseValue: null }, { type: "validation", responseValue: "not_applicable" },
  { type: "select", responseValue: "a" }, { type: "approval", responseValue: "b" },
  { type: "multiselect", responseValue: [{ value: "b", label: "B" }, { value: "a", label: "A" }] },
];
for (const { type, responseValue } of answerCases) test(`canonical ${type} ${JSON.stringify(responseValue)} is durable while UI answer stays lossless`, async () => {
  const f = repositoryFixture(); const data = assignmentsWithStep(type);
  const step = data.groups[0]!.works[0]!.checklists[0]!.steps[0]!;
  f.remote.assignments = async () => structuredClone(data);
  await f.repository.assignments(scope, 1); f.connect(false);
  const answer: StepAnswer = { responseValue, isCompleted: true, comment: "Nota", executionStatus: "partial" };
  await assert.rejects(f.repository.answer(scope, "9", answer), OfflineQueuedError);
  const op = (await f.store.read("a")).operations[0]!;
  assert.ok(op.kind === "answer"); assert.deepEqual(op.answer, answer); assert.deepEqual(op.base, answerFromStep(step));
  assert.deepEqual(op.wire, { answer: toSyncAnswer(type, answer), base: syncAnswerFromStep(step) });
  f.connect(true); await f.repository.syncNow();
  const command = f.upstream.commands[0]!;
  assert.doesNotThrow(() => syncCommandSchema.parse(command));
  assert.deepEqual(command.payload, { stepId: "9", ...op.wire });
});

test("legacy v1 UI answers migrate using cached step type without modifying original fields", () => {
  const state = emptyState(); const data = assignmentsWithStep("select");
  const step = data.groups[0]!.works[0]!.checklists[0]!.steps[0]!;
  const answer: StepAnswer = { responseValue: "b", isCompleted: true, comment: "Draft", executionStatus: "partial" };
  const base = answerFromStep(step);
  state.cache.push({ key: "assignments:2026-09-08", json: JSON.stringify(data), fetchedAt: 100 });
  state.operations.push({ id: uuid(4), kind: "answer", scope, stepId: "9", answer, base, status: "pending", createdAt: 1, attempts: 0, nextAttemptAt: 0 });
  const migrated = decodeState(JSON.stringify(state));
  const op = migrated.operations[0]!; assert.ok(op.kind === "answer");
  assert.deepEqual(op.answer, answer); assert.deepEqual(op.base, base); assert.equal(op.status, "pending");
  assert.deepEqual(op.wire, { answer: toSyncAnswer("select", answer), base: syncAnswerFromStep(step) });
  assert.deepEqual(decodeState(JSON.stringify(migrated)), migrated);
});

test("legacy answer migration preserves original base even if cached server value changed", () => {
  const state = emptyState(); const data = assignmentsWithStep("text");
  const base: StepAnswer = { responseValue: "Original", isCompleted: true, comment: "Old", executionStatus: "completed" };
  const answer = { ...base, responseValue: "Draft" };
  data.groups[0]!.works[0]!.checklists[0]!.steps[0]!.responseValue = "Changed server";
  state.cache.push({ key: "assignments:2026-09-08", json: JSON.stringify(data), fetchedAt: 100 });
  state.operations.push({ id: uuid(4), kind: "answer", scope, stepId: "9", answer, base, status: "pending", createdAt: 1, attempts: 0, nextAttemptAt: 0 });
  const op = decodeState(JSON.stringify(state)).operations[0]!; assert.ok(op.kind === "answer");
  assert.equal(op.wire?.base.responseValue, "Original"); assert.equal(op.wire?.base.comment, "Old");
});

test("legacy missing step holds needs_review preserving answer payload and all other data", async () => {
  const f = repositoryFixture();
  const answer: StepAnswer = { responseValue: false, isCompleted: false, comment: "Keep", executionStatus: "not_completed" };
  const original = { id: uuid(4), kind: "answer" as const, scope, stepId: "unknown", answer, base: answer, status: "pending" as const, createdAt: 1, attempts: 0, nextAttemptAt: 0 };
  await updateState(f.store, "a", (state) => { state.operations.push(original); state.cache.push({ key: "other", json: "{}", fetchedAt: 1 }); });
  await f.repository.syncNow();
  const state = await f.store.read("a"); const op = state.operations[0]!; assert.ok(op.kind === "answer");
  assert.equal(op.status, "needs_review"); assert.deepEqual(op.answer, answer); assert.deepEqual(op.base, answer); assert.equal(op.wire, undefined);
  assert.equal(op.id, original.id); assert.equal(state.cache[0]!.json, "{}"); assert.equal(f.upstream.commands.length, 0);
  await assert.rejects(f.repository.retry(op.id), /REVIEW/);
});

test("persisted canonical answer without wire is accepted and gains a canonical wire envelope", () => {
  const state = emptyState();
  const answer = toSyncAnswer("validation", { responseValue: false, isCompleted: false, comment: null, executionStatus: null });
  state.operations.push({ id: uuid(4), kind: "answer", scope, stepId: "9", answer, base: answer, status: "pending", createdAt: 1, attempts: 0, nextAttemptAt: 0 });
  const op = decodeState(JSON.stringify(state)).operations[0]!; assert.ok(op.kind === "answer");
  assert.deepEqual(op.wire, { answer, base: answer }); assert.equal(op.status, "pending");
});

test("partial week retains fetched days and local overlay without fabricated coverage", async () => {
  const f = repositoryFixture(); f.remote.assignments = async () => assignmentsWithStep();
  await f.repository.assignments(scope, 1); f.connect(false);
  const local = creation(20); local.schedule.date = "2026-09-10";
  await assert.rejects(f.repository.createRecord(local), OfflineQueuedError);
  const data = await f.repository.assignments({ startDate: "2026-09-07", endDate: "2026-09-13" }, 1);
  assert.ok(data.groups.some((group) => group.id === "direct-80"));
  assert.ok(data.groups.some((group) => group.id === `local-${uuid(20)}`));
  assert.deepEqual(f.repository.getSnapshot().coverage.map((entry) => entry.date), ["2026-09-08"]);
  assert.deepEqual(f.repository.getSnapshot().missingDates, ["2026-09-07", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  assert.equal((await f.store.read("a")).cache.filter((entry) => entry.key.startsWith("assignments:")).length, 1);
});

test("prepare caches combined creation options, first comment page and date-independent resource files", async () => {
  const f = repositoryFixture(); const queries: CreationOptionsQuery[] = []; const pages: number[] = [];
  const groupDates: string[] = [];
  const options: CreationOptions = { companyBranchId: 1, userId: 1, workerId: 7, timezone: "America/Santiago", priorities: ["medium"], nonProductiveReasons: [], maintenanceTypes: [], schedule: { sameDayOnly: true, conflictPolicy: "warning" } };
  f.remote.assignments = async () => assignmentsWithStep();
  f.remote.creationOptions = async (query) => { queries.push(query); return options; };
  f.remote.comments = async (_scope, page) => { pages.push(page); return { data: [], totalRows: 0, totalPages: 0 }; };
  f.remote.stepFiles = async () => [];
  f.remote.groupFiles = async (scope) => { groupDates.push(scope.startDate); return [{ id: 3, name: "group.pdf", url: "https://files.invalid/3" }]; };
  await f.repository.prepareWeek({ startDate: "2026-09-07", endDate: "2026-09-13" }, 1);
  assert.deepEqual(queries.map((query) => query.kind), [undefined, "equipment", "specialties"]); assert.deepEqual(pages, [0]);
  assert.deepEqual(groupDates, ["2026-09-08"]);
  f.connect(false);
  assert.deepEqual(await f.repository.creationOptions({ companyBranchId: 1 }), options);
  assert.equal((await f.repository.comments({ ...scope, startDate: "2026-09-11", endDate: "2026-09-11" }, 0)).totalRows, 0);
  assert.equal((await f.repository.groupFiles({ groupId: scope.groupId, companyBranchId: 1, startDate: "2026-09-12", endDate: "2026-09-12" }))[0]!.id, 3);
});

test("legacy range-specific file and comment cache keys migrate losslessly", async () => {
  const f = repositoryFixture(); f.connect(false);
  await updateState(f.store, "a", (state) => {
    state.cache.push({ key: `files:${JSON.stringify([scope, null])}`, json: JSON.stringify([{ id: 1, name: "x", url: "https://files.invalid/1", size: 42 }]), fetchedAt: 1 });
    state.cache.push({ key: `comments:${JSON.stringify([scope, 0])}`, json: JSON.stringify({ data: [], totalRows: 0, totalPages: 0 }), fetchedAt: 1 });
  });
  const changed = { ...scope, startDate: "2026-09-09", endDate: "2026-09-09" };
  assert.equal((await f.repository.files(changed))[0]!.size, 42);
  assert.equal((await f.repository.comments(changed, 0)).totalRows, 0);
});

test("confirmed upload binds receipt file ID, preserves its remote URL and keeps the local copy accessible", async () => {
  const f = repositoryFixture();
  f.upstream.offlineDocument = async (metadata) => ({ operationId: metadata.operationId, state: "applied", fileId: 88 });
  await queued(f.repository.uploadDocuments(scope, [{ id: "draft", uri: "source:", name: "same.png", mimeType: "image/png" }]));
  await f.repository.engine.syncNow();
  f.remote.files = async () => [{ id: 88, name: "server.png", url: "https://files.invalid/88" }, { id: 89, name: "same.png", url: "https://files.invalid/89" }];
  let files = await f.repository.files(scope); assert.equal(files.length, 2); assert.equal(files[0]!.url, "https://files.invalid/88"); assert.equal(files[0]!.name, "server.png");
  assert.equal((await f.store.read("a")).attachments[0]!.attachmentId, "88");
  f.connect(false); files = await f.repository.files({ ...scope, startDate: "2026-09-09", endDate: "2026-09-09" });
  assert.equal(files.length, 2); assert.equal(files[0]!.url, "https://files.invalid/88"); assert.match(files[1]!.url, /^https:/); assert.equal(f.files.removes.length, 0);
  const op = (await f.store.read("a")).operations[0]!; assert.ok(op.kind === "document");
  assert.match((await f.repository.readLocalFile(op.file.id)).uri, /^memory:/);
});

test("applied response without file ID remains queued, keeps bytes and never binds by name", async () => {
  const f = repositoryFixture();
  f.upstream.offlineDocument = async (metadata) => ({ operationId: metadata.operationId, state: "applied" });
  await queued(f.repository.uploadDocuments(scope, [{ id: "draft", uri: "source:", name: "same.png", mimeType: "image/png" }]));
  await f.repository.engine.syncNow();
  f.remote.files = async () => [{ id: 88, name: "same.png", url: "https://files.invalid/88" }];
  const files = await f.repository.files(scope); assert.equal(files.length, 2); assert.match(files[0]!.url, /^https:/);
  const op = (await f.store.read("a")).operations[0]!; assert.ok(op.kind === "document");
  assert.equal(files[1]!.id, `local-${op.file.id}`);
  assert.ok("offline" in files[1]!);
  assert.deepEqual(files[1]!.offline, { operationId: op.id, status: "needs_review", downloaded: true, confirmed: false, localFileId: op.file.id });
  assert.equal(op.status, "needs_review"); assert.equal(op.lastError, "OFFLINE_DOCUMENT_FILE_ID_INVALID");
  assert.equal(f.repository.getSnapshot().pending, 1);
  f.connect(false); assert.match((await f.repository.readLocalFile(op.file.id)).uri, /^memory:/);
  assert.equal((await f.store.read("a")).attachments.length, 0); assert.equal(f.files.removes.length, 0);
});

test("known file 403 prevents later offline fallback and local canonical access until fresh authorization", async () => {
  const f = repositoryFixture();
  f.upstream.offlineDocument = async (metadata) => ({ operationId: metadata.operationId, state: "applied", fileId: 88 });
  await queued(f.repository.uploadDocuments(scope, [{ id: "draft", uri: "source:", name: "same.png", mimeType: "image/png" }]));
  await f.repository.engine.syncNow();
  f.remote.files = async () => [{ id: 88, name: "same.png", url: "https://files.invalid/88" }];
  await f.repository.files(scope);
  f.remote.files = async () => { throw new ApiError(403, "FORBIDDEN", "Denied"); };
  await assert.rejects(f.repository.files(scope), ApiError);
  f.connect(false); await assert.rejects(f.repository.files(scope), /revocado/);
  const op = (await f.store.read("a")).operations[0]!; assert.ok(op.kind === "document");
  await assert.rejects(f.repository.readLocalFile(op.file.id), /REVOKED/); assert.equal(f.files.files.size, 1);
  f.connect(true); f.remote.files = async () => [{ id: 88, name: "same.png", url: "https://files.invalid/88" }];
  assert.equal((await f.repository.files(scope)).length, 1);
});

test("corrupt cache JSON and mismatched coverage metadata reject without clearing queue", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.createRecord(creation()), OfflineQueuedError);
  await updateState(f.store, "a", (state) => { state.cache.push({ key: "assignments:2026-09-08", json: '{"groups":null}', fetchedAt: 1 }); });
  await assert.rejects(f.repository.assignments(scope, 1)); assert.equal((await f.store.read("a")).operations.length, 1);
  await updateState(f.store, "a", (state) => { state.cache[0] = { key: "assignments:2026-09-08", json: JSON.stringify(empty), fetchedAt: 1, coverage: { date: "2026-09-08", branchId: 2, fetchedAt: 1 } }; });
  await assert.rejects(f.repository.assignments(scope, 1), /SCOPE_MISMATCH/);
  await updateState(f.store, "a", (state) => { state.cache.push({ key: resourceCacheKey("files", scope), json: '{"invalid":true}', fetchedAt: 1 }); });
  await assert.rejects(f.repository.files(scope)); assert.equal((await f.store.read("a")).operations.length, 1);
});

test("queued canonical answer retries exact wire even after cache changes", async () => {
  const f = repositoryFixture(); f.remote.assignments = async () => assignmentsWithStep("validation");
  await f.repository.assignments(scope, 1);
  let first = true;
  f.upstream.offlineCommand = async (command) => {
    f.upstream.commands.push(structuredClone(command));
    f.upstream.receipts.set(command.operationId, { operationId: command.operationId, state: "applied" });
    if (first) { first = false; throw new NetworkError("timeout"); }
    return { operationId: command.operationId, state: "applied" };
  };
  await assert.rejects(f.repository.answer(scope, "9", { responseValue: false, isCompleted: false, comment: null, executionStatus: "not_completed" }), OfflineQueuedError);
  await f.repository.engine.syncNow();
  assert.equal(f.upstream.commands.length, 1);
  f.remote.assignments = async () => assignmentsWithStep("text"); await f.repository.assignments(scope, 1); f.advance();
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  await restarted.syncNow(); assert.equal(f.upstream.commands.length, 2); assert.deepEqual(f.upstream.commands[1], f.upstream.commands[0]);
});

test("cache reads reject structurally valid assignments belonging to another technician", async () => {
  const f = repositoryFixture(); f.connect(false); const data = assignmentsWithStep(); data.technician.id = 99;
  await updateState(f.store, "a", (state) => { state.cache.push({ key: "assignments:2026-09-08", json: JSON.stringify(data), fetchedAt: 1 }); });
  await assert.rejects(f.repository.assignments(scope, 1), /IDENTITY_MISMATCH/);
  await assert.rejects(f.repository.answer(scope, "9", { responseValue: "draft", isCompleted: true, comment: null, executionStatus: null }), /IDENTITY_MISMATCH/);
  assert.equal((await f.store.read("a")).operations.length, 0);
});

test("cached file scopes do not leak between group, work, or checklist step", async () => {
  const f = repositoryFixture();
  f.remote.stepFiles = async () => [{ id: 7, name: "step.png", url: "https://files.invalid/7" }];
  await f.repository.stepFiles(scope, "9"); f.connect(false);
  await assert.rejects(f.repository.files(scope), /CACHE_MISS/);
  await assert.rejects(f.repository.stepFiles(scope, "10"), /CACHE_MISS/);
  await assert.rejects(f.repository.stepFiles({ ...scope, workId: "81" }, "9"), /CACHE_MISS/);
  await assert.rejects(f.repository.stepFiles({ ...scope, groupId: "direct-81" }, "9"), /CACHE_MISS/);
});

test("crash before UI confirms draft reuses the durable photo operation after repository replacement", async () => {
  const f = repositoryFixture(); f.connect(false);
  const lostOutcome = await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  const original = (await f.store.read("a")).operations[0]!;
  assert.ok(original.kind === "document"); assert.equal(original.sourceDraftId, draftPhoto.id);
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  const retried = await queued(restarted.uploadDocuments(scope, [draftPhoto]));
  assert.deepEqual(retried.operationIds, lostOutcome.operationIds); assert.equal(retried.ownsFiles, true);
  assert.equal(f.files.sequence, 1); assert.equal(f.files.files.size, 1);
  assert.deepEqual((await f.store.read("a")).operations, [original]);
  f.connect(true); await restarted.syncNow();
  await restarted.uploadDocuments(scope, [draftPhoto]);
  assert.equal(f.upstream.documents.length, 1); assert.equal(f.upstream.receipts.size, 1);
  assert.equal(f.upstream.documents[0]!.operationId, original.id); assert.equal(f.files.removes.length, 0);
});

test("source fingerprint detects equal-sized modified bytes and retains source plus original queue copy", async () => {
  const f = repositoryFixture(); f.connect(false);
  const originalBytes = new Uint8Array(10).fill(1);
  f.files.sources.set(draftPhoto.uri, originalBytes);
  await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  const original = (await f.store.read("a")).operations[0]!;
  const changedBytes = new Uint8Array(10).fill(2);
  f.files.sources.set(draftPhoto.uri, changedBytes);
  await assert.rejects(f.repository.uploadDocuments(scope, [draftPhoto]), /OFFLINE_SOURCE_DRAFT_COLLISION/);
  assert.deepEqual((await f.store.read("a")).operations, [original]);
  assert.ok(original.kind === "document"); assert.deepEqual(f.files.contents.get(original.file.id), originalBytes);
  assert.deepEqual(f.files.sources.get(draftPhoto.uri), changedBytes);
  assert.equal(f.files.files.size, 1); assert.equal(f.files.sequence, 1); assert.equal(f.files.removes.length, 0);
  assert.equal(f.upstream.documents.length, 0);
  f.files.sources.set(draftPhoto.uri, originalBytes);
  assert.equal((await queued(f.repository.uploadDocuments(scope, [draftPhoto]))).operationId, original.id);
});

test("known draft reuse needs no extra quota and accepts matching bytes at a different local URI", async () => {
  const f = repositoryFixture(); f.connect(false);
  f.files.sources.set(draftPhoto.uri, new Uint8Array(10).fill(3));
  const original = await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  f.files.used = OFFLINE_LIMITS.totalFileBytes;
  f.files.sources.set("source:restored", new Uint8Array(10).fill(3));
  const retried = await queued(f.repository.uploadDocuments(scope, [{ ...draftPhoto, uri: "source:restored" }]));
  assert.equal(retried.operationId, original.operationId); assert.equal(f.files.sequence, 1);
  assert.equal(f.files.used, OFFLINE_LIMITS.totalFileBytes);
});

for (const applied of [false, true]) test(`deleted original source reuses ${applied ? "applied" : "pending"} operation with matching metadata`, async () => {
  const f = repositoryFixture(); f.connect(false);
  const first = await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  if (applied) { f.connect(true); await f.repository.syncNow(); }
  f.files.sources.set(draftPhoto.uri, null); f.connect(false);
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  if (applied) await restarted.uploadDocuments(scope, [draftPhoto]);
  else assert.equal((await queued(restarted.uploadDocuments(scope, [draftPhoto]))).operationId, first.operationId);
  assert.equal(f.files.sequence, 1); assert.equal((await f.store.read("a")).operations.length, 1);
  assert.equal(f.upstream.documents.length, applied ? 1 : 0);
});

for (const change of [{ name: "changed.png" }, { mimeType: "application/pdf" }, { size: 11 }]) test(`missing source cannot bypass metadata collision ${JSON.stringify(change)}`, async () => {
  const f = repositoryFixture(); f.connect(false);
  await queued(f.repository.uploadDocuments(scope, [draftPhoto])); f.files.sources.set(draftPhoto.uri, null);
  await assert.rejects(f.repository.uploadDocuments(scope, [{ ...draftPhoto, ...change }]), /SOURCE_DRAFT_COLLISION/);
  assert.equal(f.files.files.size, 1); assert.equal(f.files.removes.length, 0); assert.equal(f.upstream.documents.length, 0);
});

test("new draft with missing source is not accepted by metadata alone", async () => {
  const f = repositoryFixture(); f.connect(false); f.files.sources.set(draftPhoto.uri, null);
  await assert.rejects(f.repository.uploadDocuments(scope, [draftPhoto]), /SOURCE_FILE_MISSING/);
  assert.equal((await f.store.read("a")).operations.length, 0);
});

test("adapter without fingerprint fails closed on reuse without deleting the queued copy", async () => {
  const f = repositoryFixture(); f.connect(false);
  await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  const fileStore = { own: f.files.own.bind(f.files), resolveURI: f.files.resolveURI.bind(f.files), remove: f.files.remove.bind(f.files), releaseURLs: () => {} };
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, fileStore, upstream: f.remote });
  await assert.rejects(restarted.uploadDocuments(scope, [draftPhoto]), /SOURCE_VERIFICATION_UNAVAILABLE/);
  assert.equal(f.files.sequence, 1); assert.equal(f.files.removes.length, 0);
});

test("missing owned copy cannot authorize UI cleanup of the remaining source draft", async () => {
  const f = repositoryFixture(); f.connect(false);
  f.files.sources.set(draftPhoto.uri, new Uint8Array(10).fill(1));
  await queued(f.repository.uploadDocuments(scope, [draftPhoto])); f.files.files.clear();
  await assert.rejects(f.repository.uploadDocuments(scope, [draftPhoto]), /MISSING_FILE/);
  assert.ok(f.files.sources.get(draftPhoto.uri)); assert.equal(f.files.removes.length, 0);
  assert.equal((await f.store.read("a")).operations.length, 1); assert.equal(f.upstream.documents.length, 0);
});

test("same draft ID can target different step work group and date but not another branch in this namespace", async () => {
  const f = repositoryFixture(); f.connect(false);
  const ids: string[] = [];
  ids.push((await queued(f.repository.uploadDocuments(scope, [draftPhoto], "9"))).operationId);
  ids.push((await queued(f.repository.uploadDocuments(scope, [draftPhoto], "10"))).operationId);
  ids.push((await queued(f.repository.uploadDocuments(scope, [draftPhoto]))).operationId);
  ids.push((await queued(f.repository.uploadDocuments({ ...scope, workId: "81" }, [draftPhoto]))).operationId);
  ids.push((await queued(f.repository.uploadGroupFiles({ groupId: scope.groupId, companyBranchId: 1, startDate: scope.startDate, endDate: scope.endDate }, [draftPhoto]))).operationId);
  ids.push((await queued(f.repository.uploadDocuments({ ...scope, groupId: "direct-81" }, [draftPhoto]))).operationId);
  ids.push((await queued(f.repository.uploadDocuments({ ...scope, startDate: "2026-09-09", endDate: "2026-09-09" }, [draftPhoto]))).operationId);
  ids.push((await queued(f.repository.uploadDocuments({ ...scope, endDate: "2026-09-09" }, [draftPhoto]))).operationId);
  assert.equal(new Set(ids).size, ids.length);
  const reordered: WorkScope = { endDate: scope.endDate, startDate: scope.startDate, workId: scope.workId, groupId: scope.groupId, companyBranchId: 1 };
  assert.equal((await queued(f.repository.uploadDocuments(reordered, [draftPhoto], "9"))).operationId, ids[0]);
  await assert.rejects(f.repository.uploadDocuments({ ...scope, companyBranchId: 2 }, [draftPhoto]), /BRANCH_NAMESPACE/);
});

test("same source draft ID in another namespace owns a separate destination operation", async () => {
  const f = repositoryFixture(); f.connect(false);
  const first = await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  const other = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, namespace: "other", upstream: f.remote });
  const second = await queued(other.uploadDocuments(scope, [draftPhoto]));
  assert.notEqual(first.operationId, second.operationId); assert.equal(f.files.files.size, 2);
  assert.equal((await f.store.read("other")).operations.length, 1);
});

test("local dependency and remapped canonical target reuse the applied operation and canonical receipt file", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.createRecord(creation()), OfflineQueuedError);
  const localScope = { ...scope, groupId: `local-${uuid(1)}`, workId: `local-${uuid(1)}` };
  const first = await queued(f.repository.uploadDocuments(localScope, [draftPhoto]));
  f.connect(true); await f.repository.syncNow();
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  await restarted.uploadDocuments(scope, [draftPhoto]);
  await restarted.uploadDocuments(localScope, [draftPhoto]);
  const files = await restarted.files(scope);
  assert.equal(files.length, 1); assert.equal(files[0]!.id, Number(first.operationId.slice(-12)) + 100);
  assert.match(files[0]!.url, /^memory:/); assert.equal(f.files.sequence, 1);
  assert.equal(f.upstream.documents.length, 1); assert.equal(f.upstream.creates.length, 1);
  assert.equal(f.upstream.documents[0]!.scope.workId, scope.workId);
});

test("document batch returns ownership for one reused operation and one new operation", async () => {
  const f = repositoryFixture(); f.connect(false);
  const first = await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  const batch = await queued(f.repository.uploadDocuments(scope, [draftPhoto, { ...draftPhoto, id: "new-draft" }]));
  assert.equal(batch.ownsFiles, true); assert.equal(batch.operationIds.length, 2);
  assert.equal(batch.operationIds[0], first.operationId); assert.equal(f.files.files.size, 2); assert.equal(f.files.sequence, 2);
  f.connect(true); await f.repository.syncNow(); assert.equal(f.upstream.documents.length, 2);
});

test("mixed batch failure never releases a reused durable file or accepts ownership of the unsaved source", async () => {
  const f = repositoryFixture(); f.connect(false);
  await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  const original = (await f.store.read("a")).operations[0]!;
  f.files.sources.set("source:missing", null);
  await assert.rejects(f.repository.uploadDocuments(scope, [draftPhoto, { ...draftPhoto, id: "new" }, { ...draftPhoto, id: "missing", uri: "source:missing" }]), /SOURCE_FILE_MISSING/);
  assert.deepEqual((await f.store.read("a")).operations, [original]); assert.equal(f.files.files.size, 1);
  assert.equal(f.files.removes.length, 1); assert.ok(original.kind === "document"); assert.ok(f.files.files.has(original.file.id));
});

test("duplicate IDs inside one batch return a single operation and a single owned copy", async () => {
  const f = repositoryFixture(); f.connect(false);
  const outcome = await queued(f.repository.uploadDocuments(scope, [draftPhoto, draftPhoto]));
  assert.equal(outcome.operationIds.length, 1); assert.equal(f.files.sequence, 1);
});

test("simultaneous repository writers converge at durable CAS and release only redundant copies", async () => {
  const f = repositoryFixture(); f.connect(false); f.store.conflicts = 3;
  const other = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  const [first, second] = await Promise.all([queued(f.repository.uploadDocuments(scope, [draftPhoto])), queued(other.uploadDocuments(scope, [draftPhoto]))]);
  assert.equal(first.operationId, second.operationId); assert.equal(f.files.files.size, 1);
  assert.equal(f.files.used, 10);
  assert.equal((await f.store.read("a")).operations.length, 1);
  f.connect(true); await f.repository.syncNow(); assert.equal(f.upstream.documents.length, 1);
});

test("comment retry after lost UI confirmation returns the original pending snapshot marker", async () => {
  const f = repositoryFixture(); f.connect(false);
  const first = await queued(f.repository.addComment(scope, "Nota pendiente"));
  const restarted = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  const retry = await queued(restarted.addComment(scope, "Nota pendiente"));
  assert.equal(retry.operationId, first.operationId); assert.equal(retry.ownsFiles, false);
  assert.deepEqual(restarted.getSnapshot().operations.map((op) => op.id), [first.operationId]);
  f.connect(true); await restarted.syncNow(); assert.equal(f.upstream.commands.length, 1);
  await queued(restarted.addComment(scope, "Nota pendiente"));
  await restarted.engine.syncNow();
  assert.equal(f.upstream.commands.length, 2); assert.notEqual(f.upstream.commands[0]!.operationId, f.upstream.commands[1]!.operationId);
});

test("pending comment reuse is atomic but distinct text and dates remain separate submissions", async () => {
  const f = repositoryFixture(); f.connect(false);
  const other = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  const [first, second] = await Promise.all([queued(f.repository.addComment(scope, "Nota")), queued(other.addComment(scope, " Nota "))]);
  assert.equal(first.operationId, second.operationId);
  await queued(f.repository.addComment(scope, "Otra nota"));
  await queued(f.repository.addComment({ ...scope, startDate: "2026-09-09", endDate: "2026-09-09" }, "Nota"));
  assert.equal((await f.store.read("a")).operations.length, 3);
});

test("blocked comment retry returns the same held operation without sending again", async () => {
  const f = repositoryFixture(); f.upstream.receiptState = "rejected";
  const first = await queued(f.repository.addComment(scope, "Nota bloqueada"));
  await f.repository.engine.syncNow();
  const retry = await queued(f.repository.addComment(scope, "Nota bloqueada"));
  assert.equal(retry.operationId, first.operationId); assert.equal(f.upstream.commands.length, 1);
  assert.equal(f.repository.getSnapshot().operations[0]!.status, "blocked");
});

test("concurrent source ID collision keeps the committed bytes and both caller sources", async () => {
  const f = repositoryFixture(); f.connect(false);
  const changed = { ...draftPhoto, uri: "source:different" };
  f.files.sources.set(draftPhoto.uri, new Uint8Array(10).fill(1));
  f.files.sources.set(changed.uri, new Uint8Array(10).fill(2));
  const other = new OfflineTechnicianRepository(f.remote, f.session, { ...f.dependencies, upstream: f.remote });
  const results = await Promise.allSettled([f.repository.uploadDocuments(scope, [draftPhoto]), other.uploadDocuments(scope, [changed])]);
  assert.ok(results.every((entry) => entry.status === "rejected"));
  const errors = results.flatMap((entry) => entry.status === "rejected" ? [entry.reason] : []);
  assert.equal(errors.filter((error: unknown) => error instanceof OfflineQueuedError).length, 1);
  assert.equal(errors.filter((error: unknown) => error instanceof Error && error.message === "OFFLINE_SOURCE_DRAFT_COLLISION").length, 1);
  const operations = (await f.store.read("a")).operations; assert.equal(operations.length, 1);
  const op = operations[0]!; assert.ok(op.kind === "document"); assert.ok(f.files.contents.has(op.file.id));
  assert.equal(f.files.files.size, 1); assert.equal(f.files.sources.size, 2); assert.equal(f.upstream.documents.length, 0);
});

test("mixed applied and new document batch reports all owned IDs and sends only the new file", async () => {
  const f = repositoryFixture(); await queued(f.repository.uploadDocuments(scope, [draftPhoto]));
  await f.repository.engine.syncNow();
  const original = (await f.store.read("a")).operations[0]!;
  f.connect(false); f.files.sources.set(draftPhoto.uri, null);
  const next = { ...draftPhoto, id: "new-draft", uri: "source:new" };
  const batch = await queued(f.repository.uploadDocuments(scope, [draftPhoto, next]));
  assert.equal(batch.operationIds[0], original.id); assert.equal(batch.ownsFiles, true); assert.equal(batch.operationIds.length, 2);
  f.connect(true); await f.repository.syncNow();
  assert.equal(f.upstream.documents.length, 2); assert.equal(new Set(f.upstream.documents.map((op) => op.operationId)).size, 2);
  assert.equal(f.files.files.size, 2);
});

test("pending comment on a remapped dependency returns its existing ID without resetting backoff", async () => {
  const f = repositoryFixture(); f.connect(false);
  await assert.rejects(f.repository.createRecord(creation()), OfflineQueuedError);
  const localScope = { ...scope, groupId: `local-${uuid(1)}`, workId: `local-${uuid(1)}` };
  const comment = await queued(f.repository.addComment(localScope, "Nota"));
  f.upstream.offlineCommand = async () => { throw new NetworkError("timeout"); };
  f.connect(true); await f.repository.syncNow();
  const prior = (await f.store.read("a")).operations.find((op) => op.id === comment.operationId)!;
  f.connect(false);
  const retry = await queued(f.repository.addComment(scope, "Nota"));
  assert.equal(retry.operationId, comment.operationId);
  assert.deepEqual((await f.store.read("a")).operations.find((op) => op.id === comment.operationId), prior);
});