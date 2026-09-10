import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentDay, assignmentDays, assignmentIncludesDay, assignmentPlannedMinutes, assignmentProgress, assignmentWorkForDay, assignmentWorkRange, dailyRange, mergeDailyAssignments, type DailyAssignmentSnapshot } from "../../src/domain/assignmentSchedule";
import { weekRange } from "../../src/domain/format";
import { assignments, group, work } from "./fixtures";

function snapshot(date: string, scheduledDate: string, plannedMinutes = 60, generatedAt = `${date}T10:00:00Z`): DailyAssignmentSnapshot {
  return {
    date,
    data: { ...assignments([group({ works: [work({ scheduledDate, plannedMinutes, plannedDates: [], isOverdue: scheduledDate < date })] })]), generatedAt },
  };
}

test("daily query ranges and week strip dates remain separate, including month and leap boundaries", () => {
  assert.deepEqual(dailyRange("2026-09-07"), { startDate: "2026-09-07", endDate: "2026-09-07" });
  assert.deepEqual(assignmentDays(weekRange("2026-09-07")), ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  assert.deepEqual(assignmentDays({ startDate: "2024-02-28", endDate: "2024-03-01" }), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.equal(assignmentDay("2026-09-07T00:00:00Z"), "2026-09-07");
  assert.equal(assignmentDay("2026-02-30"), "");
  assert.throws(() => dailyRange("2026-02-30"), /INVALID_ASSIGNMENT_DATE/);
  assert.throws(() => dailyRange("2026-09-07T00:00:00Z"), /INVALID_ASSIGNMENT_DATE/);
  assert.throws(() => assignmentDays({ startDate: "2026-09-08", endDate: "2026-09-07" }), /INVALID_ASSIGNMENT_RANGE/);
});

test("seven daily snapshots keep 13 maintenance works rather than multiplying repeated overdue schedules", () => {
  const works = Array.from({ length: 13 }, (_, index) => work({ id: String(index + 701), scheduledDate: "2026-08-31", plannedDates: [], isOverdue: true, responsibles: index < 2 ? [{ id: 42, name: "Técnico" }] : [] }));
  const daily = assignmentDays(weekRange("2026-09-07")).map((date): DailyAssignmentSnapshot => ({
    date, data: { ...assignments([group({ id: "maintenance-50", type: "internal_maintenance", works })]), generatedAt: `${date}T10:00:00Z` },
  }));
  const before = structuredClone(daily);
  const merged = mergeDailyAssignments(daily);
  assert.equal(merged.generatedAt, "2026-09-13T10:00:00Z");
  assert.equal(merged.groups.length, 1);
  assert.equal(merged.groups[0]?.works.length, 13);
  assert.deepEqual(merged.summary, { totalGroups: 1, totalWorks: 13, activeWorks: 13, overdueWorks: 13, plannedMinutes: 780 });
  for (const item of merged.groups[0]!.works) {
    assert.deepEqual(item.plannedDates, ["2026-08-31"]);
    assert.equal(item.schedules?.length, 1);
    assert.equal(assignmentPlannedMinutes(item), 60);
    assert.deepEqual(assignmentWorkRange(item, "2026-09-07"), dailyRange("2026-09-07"));
  }
  assert.deepEqual(daily, before);
});

test("merge retains each real schedule once and prefers the request matching scheduledDate over later overdue copies", () => {
  const monday = snapshot("2026-09-07", "2026-09-07", 60, "2026-09-07T10:00:01Z");
  monday.data.groups[0]!.works[0]!.scheduledStartTime = "08:00";
  monday.data.groups[0]!.works[0]!.plannedDates = ["2026-09-11", "2026-09-07", "2026-09-11"];
  const overdue = snapshot("2026-09-08", "2026-09-07", 999, "2026-09-07T10:00:05Z");
  overdue.data.groups[0]!.works[0]!.scheduledStartTime = "12:00";
  const wednesday = snapshot("2026-09-09", "2026-09-09", 120, "2026-09-07T10:00:03Z");
  wednesday.data.groups[0]!.works[0]!.scheduledStartTime = "14:00";
  wednesday.data.groups[0]!.works[0]!.totalPlannedMinutes = 180;
  wednesday.data.groups[0]!.works[0]!.totalExecutedMinutes = 90;
  const daily = [overdue, monday, wednesday];
  const merged = mergeDailyAssignments(daily);
  const item = merged.groups[0]!.works[0]!;
  assert.equal(merged.generatedAt, overdue.data.generatedAt);
  assert.equal(merged.summary.totalGroups, 1);
  assert.equal(merged.summary.totalWorks, 1);
  assert.equal(merged.summary.plannedMinutes, 180);
  assert.equal(item.scheduledDate, "2026-09-09");
  assert.equal(item.plannedMinutes, 120);
  assert.equal(item.totalPlannedMinutes, 180);
  assert.equal(item.totalExecutedMinutes, 90);
  assert.deepEqual(item.plannedDates, ["2026-09-07", "2026-09-09", "2026-09-11"]);
  assert.equal(item.schedules?.length, 2);
  const selected = assignmentWorkForDay(item, "2026-09-07");
  assert.equal(selected.scheduledStartTime, "08:00");
  assert.equal(selected.plannedMinutes, 60);
  assert.deepEqual(assignmentWorkRange(selected, "2026-09-07"), dailyRange("2026-09-07"));
  assert.deepEqual(assignmentWorkRange(item, "2026-09-11"), dailyRange("2026-09-09"));
  assert.equal(mergeDailyAssignments(daily, "2026-09-07").groups[0]?.works[0]?.scheduledDate, "2026-09-07");
  assert.equal(assignmentIncludesDay(item, "2026-09-08"), true);
  const pending = assignmentWorkForDay(item, "2026-09-08");
  assert.equal(pending.scheduledDate, "2026-09-07");
  assert.equal(pending.isOverdue, true);
  assert.deepEqual(assignmentWorkRange(pending, "2026-09-08"), dailyRange("2026-09-08"));
});

test("newest matching snapshot wins without duplicating groups, work IDs or explicit dates", () => {
  const old = snapshot("2026-09-07", "2026-09-07", 60, "2026-09-07T10:00:00Z");
  const latest = snapshot("2026-09-07", "2026-09-07", 75, "2026-09-07T11:00:00Z");
  latest.data.groups[0]!.title = "Título nuevo";
  latest.data.groups[0]!.works[0]!.status = "completed";
  const merged = mergeDailyAssignments([latest, old, latest]);
  assert.equal(merged.groups[0]?.title, "Título nuevo");
  assert.equal(merged.groups[0]?.works[0]?.status, "completed");
  assert.deepEqual(merged.groups[0]?.works[0]?.plannedDates, ["2026-09-07"]);
  assert.equal(merged.summary.plannedMinutes, 75);
  assert.equal(merged.summary.activeWorks, 0);
  assert.equal(merged.summary.totalWorks, 1);
});

test("work IDs stay scoped to their group and mixed technician snapshots fail closed", () => {
  const first = snapshot("2026-09-07", "2026-09-07");
  const second = snapshot("2026-09-08", "2026-09-08");
  second.data.groups[0]!.id = "maintenance-50";
  second.data.groups[0]!.type = "internal_maintenance";
  assert.equal(mergeDailyAssignments([first, second]).summary.totalWorks, 2);
  second.data.technician.id = 84;
  assert.throws(() => mergeDailyAssignments([first, second]), /ASSIGNMENT_WORKER_MISMATCH/);
  assert.throws(() => mergeDailyAssignments([]), /ASSIGNMENT_SNAPSHOTS_REQUIRED/);
});

test("agenda day selection retains overdue works and all actual planned dates", () => {
  assert.equal(assignmentIncludesDay(work({ scheduledDate: "2026-08-31", isOverdue: true }), "2026-09-07"), true);
  assert.equal(assignmentIncludesDay(work({ scheduledDate: "2026-08-31", isOverdue: true, status: "completed" }), "2026-09-07"), false);
  assert.equal(assignmentIncludesDay(work({ scheduledDate: "2026-09-01", plannedDates: ["2026-09-07", "2026-09-09"] }), "2026-09-09"), true);
  assert.equal(assignmentIncludesDay(work({ scheduledDate: "2026-09-10", plannedDates: [] }), "2026-09-07"), false);
  assert.deepEqual(assignmentWorkRange(work({ scheduledDate: "2026-08-31" }), "2026-09-07"), dailyRange("2026-09-07"));
});

test("total execution progress displays 300 percent while its visual bar stays at 100 percent", () => {
  const timing = assignmentProgress(work({ plannedMinutes: 60, executedMinutes: 30, totalPlannedMinutes: 120, totalExecutedMinutes: 330, elapsedSeconds: 3600 }));
  assert.equal(timing.executedMinutes, 60);
  assert.equal(timing.totalExecutedMinutes, 360);
  assert.equal(timing.totalPlannedMinutes, 120);
  assert.equal(timing.percentage, 300);
  assert.equal(timing.barPercentage, 100);
  assert.equal(timing.overtimeMinutes, 240);
});

test("live elapsed updates only add the unrecorded delta and never double count persisted execution", () => {
  const running = work({ executedMinutes: 30, totalExecutedMinutes: 150, elapsedSeconds: 1800 });
  assert.equal(assignmentProgress(running).totalExecutedMinutes, 150);
  assert.equal(assignmentProgress(running, 2400).totalExecutedMinutes, 160);
  assert.equal(assignmentProgress({ ...running, status: "paused" }, 2400).totalExecutedMinutes, 160);
  assert.equal(assignmentProgress({ ...running, isManualExecution: true }, 2400).totalExecutedMinutes, 150);
  assert.equal(assignmentProgress({ ...running, status: "completed" }, 2400).totalExecutedMinutes, 150);
  assert.equal(assignmentProgress({ ...running, status: "delivered" }, 2400).totalExecutedMinutes, 150);
});

test("legacy times and zero planned time have finite progress and no invented percentage", () => {
  const legacy = assignmentProgress(work({ plannedMinutes: 60, executedMinutes: 180, elapsedSeconds: 0, status: "completed" }));
  assert.equal(legacy.percentage, 300);
  assert.equal(legacy.totalExecutedMinutes, 180);
  const unplanned = assignmentProgress(work({ plannedMinutes: 0, executedMinutes: 20, elapsedSeconds: 1200 }));
  assert.equal(unplanned.percentage, null);
  assert.equal(unplanned.barPercentage, 0);
  for (const value of Object.values(assignmentProgress(work({ plannedMinutes: -1, executedMinutes: -10, elapsedSeconds: Number.NaN })))) {
    if (typeof value === "number") assert.ok(Number.isFinite(value) && value >= 0);
  }
});