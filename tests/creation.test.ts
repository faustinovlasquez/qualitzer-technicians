import assert from "node:assert/strict";
import { test } from "node:test";
import { creationInputSchema, creationOptionsQuerySchema, type CreationInput } from "../src/domain/creation";
import type { AssignmentGroup } from "../src/domain/models";
import { DemoCreationStore, demoCreationOptions } from "../src/infrastructure/creationDemo";
import { DemoNotifications } from "../src/infrastructure/notificationsDemo";
import { demoUser } from "../src/infrastructure/demoData";

const base = { companyBranchId: 1, clientRequestId: "52b5201d-4ea9-4dad-9f9d-191d11ea8461", schedule: { date: "2028-02-29", startTime: "09:00", endTime: "10:30" } };
const input: CreationInput = { ...base, kind: "work", work: { title: " Inspección ", summary: "Revisar equipo", priority: "medium", specialtyId: 2, rentalEquipmentId: 15 } };

test("creation Zod matches calendar, text limits before trim, UUID RFC and strict variants", () => {
  assert.equal(creationInputSchema.parse(input).kind, "work");
  for (const date of ["2026-02-29", "2026-04-31", "1999-12-31", "2101-01-01", "2026-2-01"]) assert.equal(creationInputSchema.safeParse({ ...input, schedule: { ...input.schedule, date } }).success, false);
  for (const title of [" ", "\u000bvalid", "x".repeat(255) + " "]) assert.equal(creationInputSchema.safeParse({ ...input, work: { ...input.work, title } }).success, false);
  assert.equal(creationInputSchema.safeParse({ ...input, work: { ...input.work, title: "Valid\ntext\t" } }).success, true);
  assert.equal(creationInputSchema.safeParse({ ...input, nonProductive: null }).success, false);
  assert.equal(creationOptionsQuerySchema.safeParse({ companyBranchId: 1, search: " ".repeat(101) }).success, false);
});

test("demo creates each canonical source with real selected dates and schedule snapshots", () => {
  const groups: AssignmentGroup[] = [];
  const store = new DemoCreationStore((group) => groups.push(group));
  const work = store.create(input);
  const maintenance = store.create({ ...base, clientRequestId: "1b9f5991-1788-4b5f-a3fc-7b4fce59a8e4", kind: "maintenance", maintenance: { type: "correctivo", title: "Reparar", motive: "Falla", equipmentId: 15, specialtyId: 2 } });
  const nonProductive = store.create({ ...base, clientRequestId: "45b5d6ec-1671-41ed-a209-b7b99a9604f5", kind: "non_productive", nonProductive: { reason: "other", reasonText: "Capacitación especial" } });
  assert.equal(work.groupId, `direct-${work.workId}`);
  assert.equal(nonProductive.groupId, `direct-np-${nonProductive.workId}`);
  assert.notEqual(maintenance.groupId, `maintenance-${maintenance.workId}`);
  assert.equal(groups.length, 3);
  for (const [index, result] of [work, maintenance, nonProductive].entries()) {
    const group = groups[index]!;
    assert.equal(group.works[0]!.id, String(result.workId));
    assert.equal(group.works[0]!.status, "pending");
    assert.deepEqual(group.works[0]!.plannedDates, ["2028-02-29"]);
    assert.equal(group.works[0]!.schedules?.[0]?.work.scheduledDate, "2028-02-29");
    assert.equal(group.works[0]!.schedules?.[0]?.work.plannedMinutes, 90);
    assert.equal(group.works[0]!.executedMinutes, 0);
    assert.equal(group.works[0]!.responsibles[0]?.id, demoUser.workerId);
    assert.equal(result.schedule.timezone, demoUser.system.timezone);
  }
});

test("demo replays cloned original result without duplicate records, rejects edited UUID, normalizes defaults", () => {
  const groups: AssignmentGroup[] = [];
  const store = new DemoCreationStore((group) => groups.push(group));
  const first = store.create(input);
  const expected = structuredClone(first);
  first.schedule.date = "2030-01-01";
  groups[0]!.works[0]!.status = "delivered";
  assert.deepEqual(store.create({ ...input, work: { ...input.work, title: "Inspección" }, schedule: { ...input.schedule, endDateOffset: 0 } }), expected);
  assert.equal(groups.length, 1);
  assert.throws(() => store.create({ ...input, work: { ...input.work, title: "Editado" } }), /MOBILE_CREATION_REQUEST_CONFLICT/);
  const maintenance: CreationInput = { ...base, clientRequestId: "1b9f5991-1788-4b5f-a3fc-7b4fce59a8e4", kind: "maintenance", maintenance: { type: "detencion", title: "Detención", motive: "Revisión", equipmentId: 15, specialtyId: 2 } };
  const created = store.create(maintenance);
  assert.deepEqual(store.create({ ...maintenance, maintenance: { ...maintenance.maintenance, priority: "medium" } }), created);
  assert.equal(groups.length, 2);
});

test("demo initial comment inserts once and options use the actual demo user with valid shared catalogs", () => {
  const comments: string[] = [];
  const store = new DemoCreationStore((_group, comment) => { if (comment) comments.push(comment); });
  const input: CreationInput = { ...base, kind: "non_productive", nonProductive: { reason: "waiting_parts", initialComment: " Pendiente " } };
  store.create(input); store.create(input);
  assert.deepEqual(comments, ["Pendiente"]);
  const options = demoCreationOptions({ companyBranchId: 1 });
  assert.equal(options.userId, demoUser.id);
  assert.equal(options.workerId, demoUser.workerId);
  assert.equal(options.nonProductiveReasons.length, 10);
  assert.deepEqual(options.maintenanceTypes.filter((item) => item.enabled).map((item) => item.value), ["correctivo", "detencion"]);
  assert.ok(options.equipment?.items.some((item) => item.id === 15));
  assert.ok(options.specialties?.items.some((item) => item.id === 2));
  assert.deepEqual(demoCreationOptions({ companyBranchId: 1, kind: "equipment", page: 1 }).equipment?.items, []);
  assert.throws(() => demoCreationOptions({ companyBranchId: 2 }), /BRANCH_FORBIDDEN/);
});

test("demo notifications are honestly disabled, never register or send real pushes, inbox is empty", async () => {
  const notifications = new DemoNotifications();
  assert.deepEqual((await notifications.notificationStatus(1)).reasons, ["DEMO"]);
  assert.equal((await notifications.notificationStatus(1)).enabled, false);
  assert.deepEqual(await notifications.notificationInbox(1, 1), { items: [], page: 1, pageSize: 25 });
  await assert.rejects(notifications.testNotification(1), /DEMO/);
  await assert.rejects(notifications.readNotification(1, base.clientRequestId), /MOBILE_PUSH_EVENT_NOT_FOUND/);
});