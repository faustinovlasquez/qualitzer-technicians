import assert from "node:assert/strict";
import { test } from "node:test";
import type { TechnicianRepository } from "../../domain/TechnicianRepository";
import type { Assignments, Session, WorkScope } from "../../domain/models";
import { OfflineQueuedError } from "../../domain/offline";
import { checklistFillProgress } from "../../domain/checklistProgress";
import { OfflineTechnicianRepository } from "../OfflineTechnicianRepository";
import { fixture, user } from "./fakes";
import { checklistDate, equipmentChecklistPayload } from "../../../tests/helpers/assignment-checklist";

const scope: WorkScope = { companyBranchId: 1, groupId: "maintenance-80", workId: "81", startDate: checklistDate, endDate: checklistDate };
const answer = { responseValue: "approved", isCompleted: true, executionStatus: "completed" as const, comment: "Confirmar" };

function progressFixture() {
  const f = fixture();
  let data = equipmentChecklistPayload();
  data.technician.id = user.workerId;
  const unused = async (): Promise<never> => { throw new Error("UNEXPECTED_TEST_OPERATION"); };
  const remote: TechnicianRepository = {
    me: () => f.upstream.me(), assignments: async () => structuredClone(data),
    offlineCommand: (command) => f.upstream.offlineCommand(command), offlineReceipt: (id) => f.upstream.offlineReceipt(id),
    offlineDocument: (metadata) => f.upstream.offlineDocument(metadata),
    health: unused, login: unused, logout: unused, forcePassword: unused, status: unused, answer: unused,
    files: unused, stepFiles: unused, upload: unused, report: unused, comments: unused, addComment: unused,
    uploadDocuments: unused, deleteFile: unused, groupFiles: unused, uploadGroupFiles: unused, deleteGroupFile: unused,
    orderDelivery: unused, startOrder: unused, deliverOrder: unused, createRecord: unused, creationOptions: unused,
    notificationStatus: unused, notificationInbox: unused, registerNotificationDevice: unused, unregisterNotificationDevice: unused,
    readNotification: unused, deleteNotification: unused, testNotification: unused,
  };
  const session: Session = { token: "fixture-only", user, tenant: user.tenant!, branchId: 1, mode: "live" };
  const dependencies = { ...f.dependencies, upstream: remote };
  return { ...f, remote, repository: new OfflineTechnicianRepository(remote, session, dependencies),
    restart: () => new OfflineTechnicianRepository(remote, session, dependencies),
    confirmedAnswer: () => {
      data = structuredClone(data); data.generatedAt = `${checklistDate}T10:01:00.000Z`;
      data.groups[0].works[0].checklists[0].steps[8].selectValue = "approved";
    },
  };
}

function assertProgress(data: Assignments, completed: number): void {
  const work = data.groups[0].works[0];
  assert.equal(work.checklistDone, completed);
  assert.equal(work.checklistTotal, 46);
  assert.equal(checklistFillProgress(work.checklists[0].steps).completed, completed);
  assert.equal(data.summary.totalWorks, 1);
}

test("legacy cached 0/47 is recomputed online and on cold offline restore, without changing stored payload", async () => {
  const f = progressFixture();
  assertProgress(await f.repository.assignments(scope, 1), 7);
  const cached = (await f.store.read("a")).cache.find((entry) => entry.key === `assignments:${checklistDate}`)!;
  assert.equal(JSON.parse(cached.json).groups[0].works[0].checklistDone, 0);
  f.connect(false);
  assertProgress(await f.restart().assignments(scope, 1), 7);
  assert.equal((await f.store.read("a")).cache.find((entry) => entry.key === cached.key)?.json, cached.json);
});

test("pending answer survives restart as pending, without optimistic confirmed progress or changed UUID/payload", async () => {
  const f = progressFixture();
  await f.repository.assignments(scope, 1); f.connect(false);
  await assert.rejects(f.repository.answer(scope, "1009", answer), OfflineQueuedError);
  const before = (await f.store.read("a")).operations;
  assert.equal(before.length, 1); assert.equal(before[0].status, "pending");
  assert.equal(f.upstream.commands.length, 0);
  assertProgress(await f.repository.assignments(scope, 1), 7);
  assertProgress(await f.restart().assignments(scope, 1), 7);
  assert.deepEqual((await f.store.read("a")).operations, before);
});

test("receipt alone does not fabricate checklist fields; refreshed confirmed snapshot advances both views", async () => {
  const f = progressFixture();
  await f.repository.assignments(scope, 1); f.connect(false);
  await assert.rejects(f.repository.answer(scope, "1009", answer), OfflineQueuedError);
  const pending = (await f.store.read("a")).operations[0];
  assert.equal(pending.kind, "answer");
  if (pending.kind !== "answer") throw new Error("EXPECTED_ANSWER");
  f.connect(true); await f.repository.syncNow();
  const applied = (await f.store.read("a")).operations[0];
  assert.equal(applied.status, "applied"); assert.equal(applied.id, pending.id);
  if (applied.kind !== "answer") throw new Error("EXPECTED_ANSWER");
  assert.deepEqual(applied.wire, pending.wire);
  assert.deepEqual(applied.answer, pending.answer);
  assert.equal(f.upstream.commands.length, 1);
  assertProgress(await f.repository.assignments(scope, 1), 7);
  f.confirmedAnswer();
  assertProgress(await f.repository.assignments(scope, 1), 8);
  f.connect(false);
  assertProgress(await f.restart().assignments(scope, 1), 8);
  assert.equal(f.upstream.commands.length, 1);
});

test("online answer is reflected only by server snapshot and never counted twice on repeated reads", async () => {
  const f = progressFixture();
  await f.repository.assignments(scope, 1);
  const send = f.remote.offlineCommand!;
  f.remote.offlineCommand = async (command) => { const receipt = await send(command); f.confirmedAnswer(); return receipt; };
  await assert.rejects(f.repository.answer(scope, "1009", answer), OfflineQueuedError);
  assert.equal(f.upstream.commands.length, 0);
  await f.repository.engine.syncNow();
  assertProgress(await f.repository.assignments(scope, 1), 8);
  assertProgress(await f.repository.assignments(scope, 1), 8);
  assert.equal((await f.store.read("a")).operations[0].status, "applied");
  assert.equal(f.upstream.commands.length, 1);
});

test("late pre-answer GET cannot overwrite newer confirmed cache before a cold offline restore", async () => {
  const f = progressFixture();
  await f.repository.assignments(scope, 1);
  const load = f.remote.assignments;
  let started: () => void = () => {};
  const pending = new Promise<void>((resolve) => { started = resolve; });
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  f.remote.assignments = async (range, branch) => {
    const older = await load(range, branch); started(); await delayed; return older;
  };
  const olderRead = f.repository.assignments(scope, 1);
  await pending;
  f.remote.assignments = load;
  f.confirmedAnswer();
  assertProgress(await f.repository.assignments(scope, 1), 8);
  release();
  assertProgress(await olderRead, 8);
  f.connect(false);
  assertProgress(await f.restart().assignments(scope, 1), 8);
});