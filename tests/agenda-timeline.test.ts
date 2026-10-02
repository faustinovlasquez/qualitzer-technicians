import assert from "node:assert/strict";
import { test } from "node:test";
import { agendaTimeline, buildAgenda } from "../src/domain/agendaTimeline";
import { group, work } from "../server/tests/fixtures";

const range = { startDate: "2026-09-28", endDate: "2026-10-04" };

function fixtureGroups() {
  return [group({ works: [
    work({ id: "1", title: "Mantención preventiva", status: "in_progress", scheduledDate: "2026-10-02", scheduledStartTime: "08:00", scheduledEndTime: "10:00", plannedMinutes: 120, executedMinutes: 60, hasBreakTime: true, breakStartTime: "13:00:00", breakEndTime: "14:00:00" }),
    work({ id: "2", title: "Inspección equipo", status: "pending", scheduledDate: "2026-10-02", scheduledStartTime: "10:15", scheduledEndTime: "11:15", plannedMinutes: 60, executedMinutes: 0, hasBreakTime: true, breakStartTime: "13:00", breakEndTime: "14:00" }),
    work({ id: "3", title: "Revisión sin hora", status: "pending", scheduledDate: "2026-10-01", scheduledStartTime: "", scheduledEndTime: "", plannedMinutes: 30, executedMinutes: 0 }),
    work({ id: "4", title: "Cambio de aceite", status: "completed", scheduledDate: "2026-09-30", scheduledStartTime: "09:00", scheduledEndTime: "10:00", plannedMinutes: 60, executedMinutes: 75 }),
    work({ id: "5", title: "Fuera del rango", status: "pending", scheduledDate: "2026-10-10", scheduledStartTime: "09:00", scheduledEndTime: "10:00", plannedMinutes: 600 }),
  ] })];
}

test("agenda splits works into scheduled, without time and completed, and adds hours by status", () => {
  const summary = buildAgenda(fixtureGroups(), range);
  assert.deepEqual(summary.counts, { scheduled: 2, unscheduled: 1, completed: 1 });
  assert.deepEqual(summary.hours, { pending: 90, active: 120, completed: 60, planned: 270, reported: 135 });
});

test("the scheduled timeline is ordered by time and shows each day's break once", () => {
  const days = agendaTimeline(buildAgenda(fixtureGroups(), range).items, "scheduled");
  assert.equal(days.length, 1);
  assert.deepEqual(days[0]!.items.map(item => item.kind === "break" ? `break ${item.start}-${item.end}` : `${item.start} ${item.work.title}`),
    ["08:00 Mantención preventiva", "10:15 Inspección equipo", "break 13:00-14:00"]);
});

test("the header search filters the agenda and its totals", () => {
  const summary = buildAgenda(fixtureGroups(), range, "aceite");
  assert.deepEqual(summary.counts, { scheduled: 0, unscheduled: 0, completed: 1 });
  assert.equal(summary.hours.planned, 60);
  assert.deepEqual(agendaTimeline(summary.items, "completed").map(day => day.day), ["2026-09-30"]);
});
