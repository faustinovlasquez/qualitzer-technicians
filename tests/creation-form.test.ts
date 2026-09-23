import assert from "node:assert/strict";
import { test } from "node:test";
import { creationConflictPreview, creationDuration, creationPayload, emptyCreationForm, readCreationDraft, validateCreationForm, type CreationForm } from "../src/screens/creation/creationForm";
import { mergeDailyAssignments } from "../src/domain/assignmentSchedule";
import { assignments, group, work } from "../server/tests/fixtures";
import { workEditDocumentSchema, workEditInputSchema } from "../src/domain/creation";
import { workEditForm, workEditPayload } from "../src/screens/creation/creationForm";

const requestId = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
test("maintenance child creation keeps parent scope across draft reload and omits equipment overrides", () => {
  const values = { ...form(), maintenanceId: 7, equipment: { id: 99, label: "Ignored" } };
  const input = creationPayload("work", values, 1, requestId);
  assert.equal(input.kind, "work");
  assert.equal(input.kind === "work" && input.maintenanceId, 7);
  assert.equal(input.kind === "work" && input.work.rentalEquipmentId, undefined);
  const restored = readCreationDraft(JSON.stringify({ version: 1, kind: "work", phase: "pending", form: values, input }), "work", 1);
  assert.equal(restored?.form.maintenanceId, 7);
});
test("work edit preloads the creation form and updates only allowed fields without creating another work", () => {
  const document = workEditDocumentSchema.parse({ groupId: "direct-11", workId: 11, companyBranchId: 1, revision: "a".repeat(64),
    fields: { title: "Original", summary: "Description", priority: "medium", specialtyId: null, rentalEquipmentId: null, schedule: { date: "2026-09-22", startTime: "", endTime: "" } },
    equipment: null, specialty: null, equipmentInherited: false, scheduleEditable: true });
  const form = workEditForm(document);
  assert.equal(form.title, "Original"); assert.equal(form.date, "2026-09-22");
  const input = workEditPayload(document, { ...form, title: "Changed", date: "2026-09-23", equipment: { id: 9, label: "EQ-9" } });
  assert.equal(input.fields.title, "Changed"); assert.equal(input.fields.schedule.date, "2026-09-23"); assert.equal(input.fields.rentalEquipmentId, 9);
  assert.equal("clientRequestId" in input, false);
  const inherited = { ...document, equipmentInherited: true, scheduleEditable: false, fields: { ...document.fields, rentalEquipmentId: 7 } };
  const guarded = workEditPayload(inherited, { ...form, date: "2026-09-25", equipment: { id: 99, label: "Wrong" } });
  assert.equal(guarded.fields.rentalEquipmentId, 7); assert.equal(guarded.fields.schedule.date, "2026-09-22");
  assert.equal(workEditInputSchema.safeParse({ ...input, userId: 9 }).success, false);
  assert.equal(workEditInputSchema.safeParse({ ...input, expectedRevision: "" }).success, false);
  assert.equal(workEditInputSchema.safeParse({ ...input, fields: { ...input.fields, schedule: { date: "2026-02-30", startTime: "", endTime: "" } } }).success, false);
});
function form(overrides: Partial<CreationForm> = {}): CreationForm {
  return { ...emptyCreationForm("2026-09-10"), title: " Reparar ", summary: " Revisar conexiones ", motive: " Fuga detectada ", startTime: "09:00", endTime: "10:30", ...overrides };
}

test("work payload has exact backend keys, trims text, and omits optional empty ids", () => {
  assert.deepEqual(creationPayload("work", form(), 1, requestId), {
    kind: "work", companyBranchId: 1, clientRequestId: requestId,
    schedule: { date: "2026-09-10", startTime: "09:00", endTime: "10:30" },
    work: { title: "Reparar", summary: "Revisar conexiones", priority: "medium" },
  });
  const input = creationPayload("work", form({ specialty: { id: 2, label: "Mecánica" }, equipment: { id: 5, label: "EQ-5" } }), 1, requestId);
  assert.equal(input.kind === "work" && input.work.rentalEquipmentId, 5);
  assert.equal(input.kind === "work" && input.work.specialtyId, 2);
});

test("maintenance requires equipment and sends correct type without unused variants", () => {
  assert.ok(validateCreationForm("maintenance", form()).equipment);
  assert.throws(() => creationPayload("maintenance", form(), 1, requestId));
  const input = creationPayload("maintenance", form({ equipment: { id: 5, label: "EQ-5" }, maintenanceType: "detencion", damageType: "desgaste" }), 1, requestId);
  assert.equal(input.kind, "maintenance");
  if (input.kind !== "maintenance") throw new Error("Unexpected variant");
  assert.equal(input.maintenance.type, "detencion");
  assert.equal(input.maintenance.equipmentId, 5);
  assert.equal(input.maintenance.damageType, "desgaste");
  assert.equal("work" in input, false);
  assert.equal("timezone" in input.schedule, false);
});

test("non productive other requires an explanation; comment and explanation are optional otherwise", () => {
  assert.ok(validateCreationForm("non_productive", form({ reason: "other" })).reasonText);
  assert.throws(() => creationPayload("non_productive", form({ reason: "other" }), 1, requestId));
  const input = creationPayload("non_productive", form({ reason: "other", reasonText: " Esperando revisión ", initialComment: " Avisado " }), 1, requestId);
  assert.equal(input.kind, "non_productive");
  if (input.kind !== "non_productive") throw new Error("Unexpected variant");
  assert.deepEqual(input.nonProductive, { reason: "other", reasonText: "Esperando revisión", initialComment: "Avisado" });
  const optional = creationPayload("non_productive", form(), 1, requestId);
  assert.equal(optional.kind === "non_productive" && "initialComment" in optional.nonProductive, false);
});

test("date and time validation does not normalize impossible or overnight schedules", () => {
  for (const date of ["2026-02-29", "2026-02-30", "1999-12-31", "2101-01-01", "2026-9-10", ""]) assert.ok(validateCreationForm("work", form({ date })).date, date);
  assert.equal(validateCreationForm("work", form({ date: "2024-02-29" })).date, undefined);
  for (const startTime of ["9:00", "24:00", "09:60"]) assert.ok(validateCreationForm("work", form({ startTime })).startTime, startTime);
  for (const endTime of ["09:00", "08:00", "00:30"]) assert.ok(validateCreationForm("work", form({ endTime })).endTime, endTime);
  assert.equal(creationDuration(form()), 90);
  assert.equal(creationDuration(form({ endTime: "08:00" })), null);
});

test("texts reject controls, missing required fields and oversize drafts", () => {
  assert.ok(validateCreationForm("work", form({ title: " " })).title);
  assert.equal(validateCreationForm("work", form({ summary: "" })).summary, undefined);
  assert.ok(validateCreationForm("work", form({ title: "x".repeat(256) })).title);
  assert.ok(validateCreationForm("work", form({ title: "\u0000unsafe" })).title);
  assert.equal(validateCreationForm("work", form({ summary: "primera\nsegunda\tlínea" })).summary, undefined);
  assert.equal(readCreationDraft("x".repeat(80_001), "work", 1), null);
});

test("work accepts missing description and either time without inventing a duration", () => {
  for (const times of [{ startTime: "", endTime: "" }, { startTime: "09:00", endTime: "" }, { startTime: "", endTime: "10:30" }]) {
    const value = form({ summary: "   ", ...times });
    assert.deepEqual(validateCreationForm("work", value), {});
    const input = creationPayload("work", value, 1, requestId);
    assert.equal(input.kind === "work" && input.work.summary, "");
    assert.deepEqual(input.schedule, { date: value.date, ...times });
    assert.equal(creationDuration(value), null);
    const draft = { version: 1, kind: "work", phase: "pending", form: value, input };
    assert.ok(readCreationDraft(JSON.stringify(draft), "work", 1));
  }
  for (const kind of ["maintenance", "non_productive"] as const) {
    assert.ok(validateCreationForm(kind, form({ startTime: "", endTime: "" })).startTime);
  }
});

test("pending draft restores the same UUID and exact canonical payload", () => {
  const draftForm = form();
  const input = creationPayload("work", draftForm, 1, requestId);
  const raw = JSON.stringify({ version: 1, kind: "work", phase: "pending", form: draftForm, input });
  const restored = readCreationDraft(raw, "work", 1);
  assert.ok(restored && restored.phase === "pending");
  assert.deepEqual(restored.input, input);
  assert.equal(restored.input.clientRequestId, requestId);
  assert.equal(readCreationDraft(raw, "work", 2), null);
  assert.equal(readCreationDraft(raw, "maintenance", 1), null);
  assert.equal(readCreationDraft(JSON.stringify({ version: 1, kind: "work", phase: "pending", form: { ...draftForm, title: "changed" }, input }), "work", 1), null);
});

test("persisted drafts reject secrets and foreign or unknown properties", () => {
  const editing = { version: 1, kind: "work", phase: "editing", form: form() };
  assert.equal(readCreationDraft(JSON.stringify({ ...editing, token: "not-allowed" }), "work", 1), null);
  assert.equal(readCreationDraft(JSON.stringify({ ...editing, form: { ...form(), password: "not-allowed" } }), "work", 1), null);
  const input = creationPayload("work", form(), 1, requestId);
  assert.equal(readCreationDraft(JSON.stringify({ ...editing, phase: "pending", input: { ...input, workerId: 99 } }), "work", 1), null);
  assert.equal(readCreationDraft("not json", "work", 1), null);
});

test("confirmed draft stays confirmed and does not become a retryable form", () => {
  const input = creationPayload("work", form(), 1, requestId);
  const result = { kind: "work", groupId: "direct-71", workId: 71, companyBranchId: 1, schedule: { ...input.schedule, plannedMinutes: 90, timezone: "America/Santiago" } };
  const saved = { version: 1, kind: "work", phase: "confirmed", form: form(), input, result };
  assert.equal(readCreationDraft(JSON.stringify(saved), "work", 1)?.phase, "confirmed");
  assert.equal(readCreationDraft(JSON.stringify({ ...saved, result: { ...result, companyBranchId: 2 } }), "work", 1), null);
});

test("conflict warning compares only actual query coverage and loaded timing metadata", () => {
  const schedule = { date: "2026-09-10", startTime: "09:00", endTime: "10:30" };
  const raw = assignments([group({ works: [work({ scheduledDate: schedule.date, scheduledStartTime: "10:00", scheduledEndTime: "11:00", title: "Trabajo coincidente" })] })]);
  assert.equal(creationConflictPreview(raw, schedule).overlaps.length, 0);
  assert.match(creationConflictPreview(raw, schedule).message, /incompleta/);
  const loaded = mergeDailyAssignments([{ date: schedule.date, data: raw }]);
  assert.deepEqual(creationConflictPreview(loaded, schedule).overlaps, ["Trabajo coincidente"]);
  assert.equal(creationConflictPreview(loaded, { ...schedule, date: "2026-09-11" }).overlaps.length, 0);
  assert.match(creationConflictPreview(null, schedule).message, /no confirma disponibilidad/);
});