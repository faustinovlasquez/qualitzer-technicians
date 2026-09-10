import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentCodes } from "../src/domain/assignmentCodes";
import { assignmentWorkForDay, assignmentWorkRange, mergeDailyAssignments } from "../src/domain/assignmentSchedule";
import { assignments, group, work } from "../server/tests/fixtures";

const date = "2026-09-09";
const nextDate = "2026-09-10";
const equipment = { label: "Equipo", identifier: "2515111", internalNumber: null, ownerLabel: "Interno" };

test("canonical maintenance snapshots count actual children only, retaining OT context and timers", () => {
  const child = work({ id: "1", title: "Revisar", scheduledDate: date, plannedMinutes: 30, executedMinutes: 30, elapsedSeconds: 1834 });
  const parent = group({ id: "maintenance-1", type: "internal_maintenance", maintenanceType: "preventivo", title: "Revisar", equipment, works: [child] });
  const merged = mergeDailyAssignments([{ date, data: assignments([parent]) }]);
  const current = merged.groups[0]!;
  const actual = current.works[0]!;

  assert.equal(merged.summary.totalWorks, 1);
  assert.equal(merged.summary.plannedMinutes, 30);
  assert.equal(actual.id, "1");
  assert.equal(actual.elapsedSeconds, 1834);
  assert.equal(actual.executedMinutes, 30);
  assert.equal(current.id, "maintenance-1");
  assert.equal(assignmentCodes(current, actual).workOrderCode, "OT-PRE-0001");
});

test("identical titles and equipment never merge independent works or IDs from different tables", () => {
  const sameTitle = work({ id: "1", title: "Revisar", scheduledDate: date, workEquipment: equipment });
  const groups = [
    group({ id: "maintenance-1", type: "internal_maintenance", works: [sameTitle], equipment }),
    group({ id: "direct-1", type: "direct_assignment", works: [sameTitle], equipment }),
    group({ id: "direct-11444", type: "direct_assignment", works: [{ ...sameTitle, id: "11444" }], equipment }),
  ];
  const merged = mergeDailyAssignments([{ date, data: assignments(groups) }]);

  assert.equal(merged.summary.totalWorks, 3);
  assert.deepEqual(merged.groups.flatMap((entry) => entry.works.map((item) => `${entry.id}/${item.id}`)).sort(), ["direct-1/1", "direct-11444/11444", "maintenance-1/1"]);
});

test("a direct work remains visible and actionable in its own scope when no maintenance is assigned", () => {
  const direct = group({ id: "direct-11443", type: "direct_assignment", works: [work({ id: "11443", title: "Revisar", scheduledDate: date, elapsedSeconds: 60 })] });
  const merged = mergeDailyAssignments([{ date, data: assignments([direct]) }]);
  const actual = merged.groups[0]!.works[0]!;

  assert.equal(merged.summary.totalWorks, 1);
  assert.equal(merged.groups[0]!.id, "direct-11443");
  assert.equal(actual.canExecute, true);
  assert.equal(actual.elapsedSeconds, 60);
  assert.deepEqual(assignmentWorkRange(actual, date), { startDate: date, endDate: date });
});

test("repeated canonical daily responses do not duplicate a maintenance child or transfer another day's timer", () => {
  const daily = (day: string, elapsedSeconds: number) => ({ date: day, data: assignments([
    group({ id: "maintenance-1", type: "internal_maintenance", works: [work({ id: "1", title: "Revisar", scheduledDate: day, plannedMinutes: 30, elapsedSeconds })] }),
  ]) });
  const first = daily(date, 1800);
  const next = daily(nextDate, 120);
  const merged = mergeDailyAssignments([first, first, next, next]);
  const actual = merged.groups[0]!.works[0]!;

  assert.equal(merged.summary.totalWorks, 1);
  assert.equal(merged.summary.plannedMinutes, 60);
  assert.equal(actual.schedules?.length, 2);
  assert.equal(assignmentWorkForDay(actual, date).elapsedSeconds, 1800);
  assert.equal(assignmentWorkForDay(actual, nextDate).elapsedSeconds, 120);
  assert.deepEqual(assignmentWorkRange(assignmentWorkForDay(actual, nextDate), date), { startDate: nextDate, endDate: nextDate });
});

test("a repeated overdue canonical child is one card with all authorized query dates", () => {
  const parent = group({ id: "maintenance-1", type: "internal_maintenance", works: [work({ id: "1", title: "Revisar", scheduledDate: "2026-09-08", isOverdue: true, status: "paused", plannedMinutes: 30 })] });
  const merged = mergeDailyAssignments([{ date, data: assignments([parent]) }, { date: nextDate, data: assignments([parent]) }]);

  assert.equal(merged.summary.totalWorks, 1);
  assert.equal(merged.summary.plannedMinutes, 30);
  assert.deepEqual(merged.groups[0]!.works[0]!.schedules?.[0]?.queryDates, [date, nextDate]);
});