import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAssignmentsChecklistProgress, normalizeWorkChecklistProgress, workChecklistProgress } from "../src/domain/assignmentChecklistProgress";
import { assignmentProgress, assignmentWorkForDay, assignmentWorkRange, mergeDailyAssignments } from "../src/domain/assignmentSchedule";
import { checklistFillProgress } from "../src/domain/checklistProgress";
import type { OfflineAttachment } from "../src/domain/offline";
import { assignmentsSchema } from "../server/contracts";
import { step } from "../server/tests/fixtures";
import { checklistDate as date, equipmentChecklistPayload } from "./helpers/assignment-checklist";

test("gateway-normalized 0/47 complementary payload projects to the wizard's 7/46 (15%)", () => {
  const wire = equipmentChecklistPayload();
  const original = structuredClone(wire);
  const gateway = assignmentsSchema.parse(wire);
  assert.equal(gateway.groups[0].works[0].checklistDone, 0);
  assert.equal(gateway.groups[0].works[0].checklistTotal, 47);
  const data = mergeDailyAssignments([{ date, data: gateway }], date);
  const card = data.groups[0].works[0];
  const detail = assignmentWorkForDay(card, date);
  assert.equal(detail.checklists[0].steps[8].order, 9);
  assert.equal(detail.checklists[0].steps.length, 47);
  const expected = { completed: 7, total: 46, remaining: 39, percentage: 15 };
  assert.deepEqual(workChecklistProgress(card), expected);
  assert.deepEqual(checklistFillProgress(detail.checklists[0].steps), expected);
  assert.equal(card.checklistDone, 7); assert.equal(card.checklistTotal, 46);
  assert.equal(detail.checklistDone, 7); assert.equal(detail.checklistTotal, 46);
  assert.equal(detail.checklists[0].required, false);
  assert.deepEqual(wire, original);
});

test("missing evidence, comments alone, false, zero, NC and optional fields retain wizard semantics", () => {
  const payload = equipmentChecklistPayload();
  const work = payload.groups[0].works[0];
  const list = work.checklists[0];
  list.steps.push(step({ stepId: 2001, isRequired: false, selectValue: "approved" }));
  list.steps.push(step({ stepId: 2002, isRequired: false }));
  assert.equal(workChecklistProgress(work).completed, 7);
  assert.equal(workChecklistProgress(work).total, 46);
  list.steps[7].attachments = [{ id: 1, name: "Confirmado", url: "https://example.com/proof.png" }];
  assert.equal(workChecklistProgress(work).completed, 8);
  assert.equal(workChecklistProgress(work).percentage, 17);
  assert.equal(list.steps[0].isCompleted, false);
  assert.equal(list.steps[2].responseValue, "0");
  assert.equal(list.steps[4].selectValue, "NC");
});

test("pending local evidence cannot satisfy a required file even with a numeric placeholder id", () => {
  const work = equipmentChecklistPayload().groups[0].works[0];
  const pending: OfflineAttachment = { id: 99, name: "Pendiente", url: "", offline: { confirmed: false, downloaded: true } };
  for (const file of [pending, { id: "local-99", name: "Pendiente", url: "" }]) {
    work.checklists[0].steps[7].attachments = [file];
    assert.equal(workChecklistProgress(work).completed, 7);
  }
  const confirmed: OfflineAttachment = { ...pending, offline: { confirmed: true, downloaded: true } };
  work.checklists[0].steps[7].attachments = [confirmed];
  assert.equal(workChecklistProgress(work).completed, 8);
});

test("multiple associated forms aggregate within one parent work without creating mirrored works", () => {
  const data = equipmentChecklistPayload();
  data.groups[0].works[0].checklists.push({ checklistId: 502, name: "Otro formulario", code: "OTHER", required: true,
    steps: [step({ stepId: 3001, type: "number", responseValue: "0" }), step({ stepId: 3002 })] });
  const merged = mergeDailyAssignments([{ date, data }, { date, data }]);
  assert.equal(merged.summary.totalWorks, 1);
  assert.equal(merged.groups.length, 1);
  const work = merged.groups[0].works[0];
  assert.equal(work.checklists.length, 2);
  assert.equal(work.checklistDone, 8); assert.equal(work.checklistTotal, 48);
  assert.equal(work.schedules?.length, 1);
});

test("work identity prevents another parent's identical work/checklist ids from donating progress", () => {
  const data = equipmentChecklistPayload();
  const independent = structuredClone(data.groups[0]);
  independent.id = "direct-81"; independent.type = "direct_assignment";
  independent.works[0].checklists[0].steps = [step({ stepId: 1001 })];
  data.groups.push(independent);
  const merged = mergeDailyAssignments([{ date, data }]);
  assert.equal(merged.summary.totalWorks, 2);
  assert.equal(merged.groups.find((group) => group.id === "maintenance-80")?.works[0].checklistDone, 7);
  assert.equal(merged.groups.find((group) => group.id === "direct-81")?.works[0].checklistDone, 0);
});

test("newer overdue checklist survives preferred older schedule without transferring timing or status", () => {
  const older = equipmentChecklistPayload();
  const newer = structuredClone(older);
  newer.generatedAt = "2026-09-12T10:00:00.000Z";
  const incoming = newer.groups[0].works[0];
  incoming.checklists[0].steps[8].selectValue = "approved";
  incoming.executedMinutes = 900; incoming.elapsedSeconds = 54000; incoming.status = "paused";
  const merged = mergeDailyAssignments([{ date: "2026-09-12", data: newer }, { date, data: older }], date);
  const selected = assignmentWorkForDay(merged.groups[0].works[0], date);
  assert.equal(selected.checklistDone, 8);
  assert.equal(selected.checklists[0].steps[8].selectValue, "approved");
  assert.equal(selected.executedMinutes, older.groups[0].works[0].executedMinutes);
  assert.equal(selected.elapsedSeconds, older.groups[0].works[0].elapsedSeconds);
  assert.equal(selected.status, older.groups[0].works[0].status);
  assert.deepEqual(assignmentWorkRange(selected, date), { startDate: date, endDate: date });
});

test("newer cleared answer replaces progress rather than keeping a historical maximum", () => {
  const older = equipmentChecklistPayload();
  const newer = structuredClone(older);
  newer.generatedAt = "2026-09-12T10:00:00.000Z";
  newer.groups[0].works[0].checklists[0].steps[2].responseValue = "";
  const merged = mergeDailyAssignments([{ date, data: older }, { date: "2026-09-12", data: newer }]);
  assert.equal(merged.groups[0].works[0].checklistDone, 6);
});

test("normalization preserves non-checklist business fields, per-day execution and empty work semantics", () => {
  const data = equipmentChecklistPayload();
  const original = structuredClone(data);
  const normalized = normalizeAssignmentsChecklistProgress(data);
  const before = data.groups[0].works[0];
  const after = normalized.groups[0].works[0];
  assert.deepEqual(assignmentProgress(after), assignmentProgress(before));
  assert.deepEqual({ ...after, checklistDone: before.checklistDone, checklistTotal: before.checklistTotal }, before);
  assert.deepEqual(normalized.summary, data.summary);
  assert.deepEqual(data, original);
  assert.deepEqual(normalizeAssignmentsChecklistProgress(normalized), normalized);
  const empty = normalizeWorkChecklistProgress({ ...before, workType: "non_productive", checklists: [] });
  assert.equal(empty.checklistDone, 0); assert.equal(empty.checklistTotal, 0);
  assert.deepEqual(assignmentProgress(empty), assignmentProgress(before));
});