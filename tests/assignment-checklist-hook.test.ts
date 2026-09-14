import assert from "node:assert/strict";
import { test } from "node:test";
import type { Assignments, WorkScope } from "../src/domain/models";
import { OfflineQueuedError } from "../src/domain/offline";
import * as progress from "../src/domain/assignmentChecklistProgress";
import * as schedule from "../src/domain/assignmentSchedule";
import * as format from "../src/domain/format";
import * as tenantSession from "../src/domain/tenantSession";
import * as errors from "../src/infrastructure/errors";
import { user } from "../server/tests/fixtures";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";
import { checklistDate, equipmentChecklistPayload } from "./helpers/assignment-checklist";

type App = ReturnType<typeof import("../src/application/useTechnicianApp").useTechnicianApp>;
const answer = { responseValue: "approved", isCompleted: true, executionStatus: "completed" as const, comment: null };

async function appFixture(access?: { allowed: boolean; isAllowed(): boolean }) {
  const hooks = reactFixture();
  let data = equipmentChecklistPayload();
  let reads = 0;
  let saves = 0;
  let read: (() => Promise<Assignments>) | undefined;
  let send: (() => Promise<void>) | undefined;
  const confirm = () => { data = structuredClone(data); data.groups[0].works[0].checklists[0].steps[8].selectValue = "approved"; };
  class Repository {
    me = async () => user();
    assignments = async () => { reads++; return read ? read() : structuredClone(data); };
    answer = async (_scope: WorkScope, id: string) => { saves++; assert.equal(id, "1009"); if (send) await send(); else confirm(); };
  }
  const module = loadSource<typeof import("../src/application/useTechnicianApp")>("application/useTechnicianApp.ts", (id) => {
    if (id === "react") return hooks.react;
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "../infrastructure/DemoTechnicianRepository") return { DemoTechnicianRepository: Repository };
    if (id === "../infrastructure/HttpTechnicianRepository") return { HttpTechnicianRepository: class {} };
    if (id === "../infrastructure/gatewayConfig") return { gatewayConfiguration: { locked: true, url: "https://gateway.example.com/mobile", error: null } };
    if (id === "../infrastructure/gatewayConnection") return { requireConfiguredGateway: (_config: unknown, url: string) => url };
    if (id === "../infrastructure/errors") return errors;
    if (id === "../domain/tenantSession") return tenantSession;
    if (id === "../domain/assignmentChecklistProgress") return progress;
    if (id === "../domain/assignmentSchedule") return schedule;
    if (id === "../domain/format") return { ...format, dateKey: () => checklistDate };
    if (id === "../domain/weeklySchedule") return { scheduleClock: () => ({ day: checklistDate }) };
    if (id === "../notifications") return { useMobileNotifications: () => ({ client: null }), bindNotificationApi: () => null };
    if (id === "../offline") return { OfflineTechnicianRepository: class {} };
    if (id === "../infrastructure/sessionStorage") return { loadSession: async () => null };
    return {};
  });
  const render = () => hooks.render(() => module.useTechnicianApp(access));
  render(); hooks.restore(); await new Promise<void>((resolve) => setImmediate(resolve));
  await render().demo();
  await render().refresh();
  const loaded = render();
  loaded.openWork(loaded.data!.groups[0], loaded.data!.groups[0].works[0], { tab: "checklist" });
  return { render, confirm, reads: () => reads, saves: () => saves,
    setRead: (next?: () => Promise<Assignments>) => { read = next; }, setSend: (next?: () => Promise<void>) => { send = next; } };
}

test("actual hook publishes matching card/detail counters through background refresh after releasing busy", async () => {
  const f = await appFixture();
  const before = f.render();
  assert.equal(before.canonicalDetailWork?.checklistDone, 7);
  assert.equal(before.data?.groups[0].works[0].checklistTotal, 46);
  const reads = f.reads();
  await before.saveAnswer("1009", answer);
  assert.equal(f.render().busy, false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const after = f.render();
  assert.equal(f.reads(), reads + 1);
  assert.equal(after.canonicalDetailWork?.checklistDone, 8);
  assert.equal(after.data?.groups[0].works[0].checklistDone, 8);
  assert.equal(after.busy, false);
  assert.equal(f.saves(), 1);
});

test("late pre-answer refresh cannot replace the post-answer snapshot in the actual hook", async () => {
  const f = await appFixture();
  const stale = equipmentChecklistPayload();
  let release: (data: Assignments) => void = () => {};
  f.setRead(() => new Promise((resolve) => { release = resolve; }));
  const oldRead = f.render().refresh();
  await Promise.resolve();
  f.setRead();
  await f.render().saveAnswer("1009", answer);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.render().canonicalDetailWork?.checklistDone, 8);
  release(stale); await oldRead;
  assert.equal(f.render().canonicalDetailWork?.checklistDone, 8);
  assert.equal(f.render().loading, false);
});

test("queued outcome propagates unchanged and does not trigger an optimistic refresh or completed count", async () => {
  const f = await appFixture();
  const queued = new OfflineQueuedError({ operationId: "fixture-uuid", operationIds: ["fixture-uuid"], kind: "answer", date: checklistDate, localGroupId: "maintenance-80", localWorkId: "81", ownsFiles: false });
  f.setSend(async () => { throw queued; });
  const reads = f.reads();
  await assert.rejects(f.render().saveAnswer("1009", answer), (error: unknown) => error === queued);
  assert.equal(f.reads(), reads);
  assert.equal(f.render().canonicalDetailWork?.checklistDone, 7);
  assert.equal(f.render().busy, false);
});

test("confirmed answer plus failed refresh reports stale data without rejecting or encouraging another write", async () => {
  const f = await appFixture();
  f.setRead(async () => { throw new errors.NetworkError("network"); });
  await f.render().saveAnswer("1009", answer);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.saves(), 1);
  assert.equal(f.render().canonicalDetailWork?.checklistDone, 7);
  assert.match(f.render().error ?? "", /confirmado.*No repitas el envío/);
  assert.equal(f.render().busy, false);
});

test("device lock rejects retained work actions, reads and back navigation before a rerender", async () => {
  const access = { allowed: true, isAllowed: () => access.allowed };
  const f = await appFixture(access);
  const retained = f.render();
  const reads = f.reads();
  access.allowed = false;
  retained.closeWork();
  await assert.rejects(async () => retained.saveAnswer("1009", answer));
  await assert.rejects(retained.loadFiles());
  await retained.refresh();
  assert.equal(f.saves(), 0);
  assert.equal(f.reads(), reads);
  assert.deepEqual(f.render().selected, retained.selected);
  access.allowed = true;
  await f.render().saveAnswer("1009", answer);
  assert.equal(f.saves(), 1);
});

test("locking during an already submitted answer preserves its confirmation without a duplicate or refresh", async () => {
  const access = { allowed: true, isAllowed: () => access.allowed };
  const f = await appFixture(access);
  let complete: () => void = () => {};
  f.setSend(() => new Promise(resolve => { complete = resolve; }));
  const reads = f.reads();
  const send = f.render().saveAnswer("1009", answer);
  assert.equal(f.saves(), 1);
  access.allowed = false;
  complete();
  await send;
  assert.equal(f.saves(), 1);
  assert.equal(f.reads(), reads);
  assert.equal(f.render().busy, false);
  assert.ok(f.render().selected);
});