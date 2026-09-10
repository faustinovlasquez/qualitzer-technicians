import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentWorkForDay, assignmentWorkRange, mergeDailyAssignments, type AssignmentWorkSnapshot } from "../src/domain/assignmentSchedule";
import type { AssignmentWork, DateRange } from "../src/domain/models";
import { buildWeeklySchedule, layoutScheduleBlocks, scheduleClock, scheduleDateOffset, scheduleInterval, scheduleOverlapMinutes, scheduleTimeMinutes } from "../src/domain/weeklySchedule";
import { assignments, group, work } from "../server/tests/fixtures";

const range: DateRange = { startDate: "2026-09-07", endDate: "2026-09-13" };

function task(overrides: Partial<AssignmentWork> = {}): AssignmentWork {
  return work({ scheduledDate: range.startDate, plannedDates: [range.startDate], ...overrides });
}

function snapshot(day: string, overrides: Partial<AssignmentWork> = {}, queryDate = day): AssignmentWorkSnapshot {
  return { date: queryDate, queryDates: [queryDate], generatedAt: `${queryDate}T10:00:00Z`, work: task({ scheduledDate: day, ...overrides }) };
}

function schedule(works: AssignmentWork[], selectedRange = range) {
  return buildWeeklySchedule(assignments([group({ works })]), selectedRange);
}

test("strict time parsing accepts HH:mm and seconds without normalizing invalid input", () => {
  assert.equal(scheduleTimeMinutes("08:15"), 495);
  assert.equal(scheduleTimeMinutes("08:15:30"), 495.5);
  for (const value of ["", "8:15", "08:60", "24:00", "-1:00", "08:15:60", " 08:15", "08:15 ", "08:15Z", "08:15:00.1", "2026-09-07T08:15:00Z"]) assert.equal(scheduleTimeMinutes(value), null, value);
  assert.equal(scheduleTimeMinutes("24:00", true), 1440);
  assert.equal(scheduleTimeMinutes("24:00:00", true), 1440);
  assert.equal(scheduleTimeMinutes("24:01", true), null);
});

test("intervals calculate duration and reject ambiguous zero length rather than inventing a full day", () => {
  assert.deepEqual(scheduleInterval(task({ scheduledStartTime: "08:15", scheduledEndTime: "10:45" })), { start: 495, end: 645 });
  assert.equal(scheduleInterval(task({ scheduledStartTime: "08:00", scheduledEndTime: "08:00" })), null);
  assert.deepEqual(scheduleInterval(task({ scheduledStartTime: "08:00", scheduledEndTime: "08:00", endDateOffset: 1 })), { start: 480, end: 1920 });
  for (const offset of [-1, 0.5, 31, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(scheduleInterval(task({ endDateOffset: offset })), null);
});

test("daily load uses snapshot planned minutes, never elapsed, executed, aggregate or summary totals", () => {
  const result = schedule([task({ plannedMinutes: 45, executedMinutes: 600, elapsedSeconds: 72000, totalPlannedMinutes: 3000, totalExecutedMinutes: 10000 })]);
  assert.equal(result.plannedMinutes, 45);
  assert.equal(result.days[0]!.plannedMinutes, 45);
  assert.equal(result.days[0]!.blocks[0]!.endMinute - result.days[0]!.blocks[0]!.startMinute, 60);
  assert.equal(result.days[1]!.plannedMinutes, 0);
});

test("cross-midnight blocks split on real dates and apportion planned load only once", () => {
  const result = schedule([task({ scheduledStartTime: "22:00", scheduledEndTime: "02:00", plannedMinutes: 180 })]);
  const first = result.days[0]!.blocks[0]!;
  const second = result.days[1]!.blocks[0]!;
  assert.deepEqual([first.startMinute, first.endMinute, first.plannedMinutes], [1320, 1440, 90]);
  assert.deepEqual([second.startMinute, second.endMinute, second.plannedMinutes], [0, 120, 90]);
  assert.equal(first.continuesBefore, false);
  assert.equal(first.continuesAfter, true);
  assert.equal(second.continuesBefore, true);
  assert.equal(second.continuesAfter, false);
  assert.equal(result.plannedMinutes, 180);
  assert.equal(second.work.scheduledDate, range.startDate);
});

test("explicit multi-day offsets split each covered date without fabricating extra planned minutes", () => {
  const result = schedule([task({ scheduledStartTime: "22:00", scheduledEndTime: "02:00", endDateOffset: 2, plannedMinutes: 1680 })]);
  assert.deepEqual(result.days.slice(0, 4).map((day) => day.plannedMinutes), [120, 1440, 120, 0]);
  assert.equal(result.plannedMinutes, 1680);
});

test("midnight end does not create a zero-length next-day block", () => {
  for (const end of ["00:00", "24:00"]) {
    const result = schedule([task({ scheduledStartTime: "23:00", scheduledEndTime: end, plannedMinutes: 60 })]);
    assert.equal(result.days[0]!.blocks.length, 1);
    assert.equal(result.days[1]!.blocks.length, 0);
    assert.equal(result.plannedMinutes, 60);
  }
});

test("range boundaries clip overnight load, retaining a genuine carry-in without cloning overdue work", () => {
  const carryIn = task({ scheduledDate: "2026-09-06", scheduledStartTime: "23:00", scheduledEndTime: "01:00", plannedMinutes: 120, isOverdue: true });
  const carryOut = task({ id: "12", scheduledDate: "2026-09-13", scheduledStartTime: "23:00", scheduledEndTime: "01:00", plannedMinutes: 120 });
  const result = schedule([carryIn, carryOut]);
  assert.equal(result.plannedMinutes, 120);
  assert.equal(result.days[0]!.plannedMinutes, 60);
  assert.equal(result.days[6]!.plannedMinutes, 60);
  assert.equal(result.unscheduled.length, 0);
});

test("calendar arithmetic handles leap days and year boundaries as branch date-only values", () => {
  assert.equal(scheduleDateOffset("2024-02-28", 1), "2024-02-29");
  assert.equal(scheduleDateOffset("2024-02-29", 1), "2024-03-01");
  assert.equal(scheduleDateOffset("2026-12-31", 1), "2027-01-01");
  assert.throws(() => scheduleDateOffset("2026-02-30", 1), /INVALID_ASSIGNMENT_DATE/);
  const result = schedule([task({ scheduledDate: "2026-12-31", scheduledStartTime: "23:30", scheduledEndTime: "00:30" })], { startDate: "2026-12-31", endDate: "2027-01-01" });
  assert.deepEqual(result.days.map((day) => day.plannedMinutes), [30, 30]);
});

test("invalid dates and times are separate sin horario entries and contribute no slot or load", () => {
  const result = schedule([
    task({ id: "1", scheduledDate: "", plannedMinutes: 500 }),
    task({ id: "2", scheduledDate: "2026-02-30" }),
    task({ id: "3", scheduledStartTime: "09:70" }),
    task({ id: "4", scheduledEndTime: "" }),
    task({ id: "5", scheduledStartTime: "08:00", scheduledEndTime: "08:00" }),
  ]);
  assert.equal(result.unscheduled.length, 5);
  assert.equal(result.unscheduled.filter((entry) => entry.reason === "missing_date").length, 2);
  assert.equal(result.unscheduled.filter((entry) => entry.reason === "invalid_time").length, 3);
  assert.equal(result.plannedMinutes, 0);
  assert.equal(result.days.flatMap((day) => day.blocks).length, 0);
});

test("seven overdue query snapshots remain a single vencido outside all day slots and totals", () => {
  const data = mergeDailyAssignments(Array.from({ length: 7 }, (_, index) => {
    const day = scheduleDateOffset(range.startDate, index);
    return { date: day, data: assignments([group({ works: [task({ scheduledDate: "2026-08-31", isOverdue: true })] })]) };
  }));
  const result = buildWeeklySchedule(data, range);
  assert.equal(result.unscheduled.length, 1);
  assert.equal(result.unscheduled[0]!.reason, "overdue");
  assert.equal(result.unscheduled[0]!.work.schedules?.[0]!.queryDates.length, 7);
  assert.equal(result.days.flatMap((day) => day.blocks).length, 0);
  assert.equal(result.plannedMinutes, 0);
});

test("finished history and future schedules outside the range are not reported as overdue", () => {
  const result = schedule([
    task({ id: "1", scheduledDate: "2026-08-31", isOverdue: true, status: "completed" }),
    task({ id: "2", scheduledDate: "2026-08-31", isOverdue: true, status: "delivered" }),
    task({ id: "3", scheduledDate: "2026-09-14" }),
  ]);
  assert.equal(result.unscheduled.length, 0);
  assert.equal(result.plannedMinutes, 0);
});

test("an overdue flag does not move a real in-range schedule to every later day", () => {
  const result = schedule([task({ isOverdue: true, plannedDates: ["2026-09-07", "2026-09-08", "2026-09-09"] })]);
  assert.equal(result.days[0]!.blocks.length, 1);
  assert.equal(result.days.slice(1).flatMap((day) => day.blocks).length, 0);
  assert.equal(result.plannedMinutes, 60);
});

test("multi-day schedules select daily hours and preserve canonical work, schedules and exact query scope", () => {
  const monday = snapshot("2026-09-07", { scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60 });
  const wednesday = snapshot("2026-09-09", { scheduledStartTime: "14:00", scheduledEndTime: "16:00", plannedMinutes: 120 }, "2026-09-10");
  const merged = task({ ...wednesday.work, schedules: [monday, wednesday], plannedDates: ["2026-09-07", "2026-09-09", "2026-09-11"] });
  const result = schedule([merged]);
  const mondayWork = result.days[0]!.blocks[0]!.work;
  const wednesdayBlock = result.days[2]!.blocks[0]!;
  assert.deepEqual(mondayWork, assignmentWorkForDay(merged, "2026-09-07"));
  assert.deepEqual(wednesdayBlock.work, assignmentWorkForDay(merged, "2026-09-09"));
  assert.deepEqual(assignmentWorkRange(wednesdayBlock.work, range.startDate), { startDate: "2026-09-10", endDate: "2026-09-10" });
  assert.equal(wednesdayBlock.queryDate, "2026-09-10");
  assert.deepEqual(result.days.map((day) => day.plannedMinutes), [60, 0, 120, 0, 0, 0, 0]);
  assert.equal(result.plannedMinutes, 180);
});

test("night continuation opens the original snapshot and not a different schedule on the following day", () => {
  const first = snapshot("2026-09-07", { scheduledStartTime: "23:00", scheduledEndTime: "01:00", plannedMinutes: 120 });
  const second = snapshot("2026-09-08", { scheduledStartTime: "08:00", scheduledEndTime: "09:00" });
  const result = schedule([task({ schedules: [first, second] })]);
  const continuation = result.days[1]!.blocks[0]!;
  assert.equal(continuation.work.scheduledDate, "2026-09-07");
  assert.equal(continuation.queryDate, "2026-09-07");
  assert.deepEqual(assignmentWorkRange(continuation.work, range.startDate), { startDate: "2026-09-07", endDate: "2026-09-07" });
  assert.equal(result.days[1]!.plannedMinutes, 120);
});

test("duplicate works and repeated groups deduplicate within group identity only", () => {
  const item = task();
  const duplicate = group({ works: [item, item] });
  const other = group({ id: "maintenance-11", type: "internal_maintenance", works: [item] });
  const result = buildWeeklySchedule(assignments([duplicate, duplicate, other]), range);
  assert.equal(result.days[0]!.blocks.length, 2);
  assert.equal(result.plannedMinutes, 120);
  assert.equal(result.overlapMinutes, 60);
});

test("exact daily snapshot wins over a newer overdue copy and duplicate query dates merge without added load", () => {
  const exact = snapshot("2026-09-07");
  const newerExact = { ...exact, generatedAt: "2026-09-07T11:00:00Z", work: task({ plannedMinutes: 75 }) };
  const overdue = snapshot("2026-09-07", { plannedMinutes: 999, scheduledStartTime: "12:00", scheduledEndTime: "13:00", isOverdue: true }, "2026-09-08");
  const result = schedule([task({ schedules: [overdue, exact, newerExact, overdue] }), task({ schedules: [exact] })]);
  assert.equal(result.plannedMinutes, 75);
  assert.equal(result.days[0]!.blocks[0]!.startMinute, 480);
  assert.deepEqual(result.days[0]!.blocks[0]!.work.schedules?.[0]!.queryDates, ["2026-09-07", "2026-09-08"]);
  assert.equal(result.days[0]!.blocks[0]!.queryDate, "2026-09-07");
});

test("overlapping intervals use side-by-side columns and count shared time rather than pairwise duplicated minutes", () => {
  const blocks = schedule([
    task({ id: "1", scheduledStartTime: "08:00", scheduledEndTime: "10:00" }),
    task({ id: "2", scheduledStartTime: "08:30", scheduledEndTime: "09:30" }),
    task({ id: "3", scheduledStartTime: "09:00", scheduledEndTime: "11:00" }),
  ]).days[0]!.blocks;
  const placed = layoutScheduleBlocks(blocks);
  assert.deepEqual(placed.map((item) => item.column), [0, 1, 2]);
  assert.ok(placed.every((item) => item.columns === 3));
  assert.equal(scheduleOverlapMinutes(blocks), 90);
});

test("touching interval boundaries are not overlaps and a later cluster regains full width", () => {
  const result = schedule([
    task({ id: "1", scheduledStartTime: "08:00", scheduledEndTime: "09:00" }),
    task({ id: "2", scheduledStartTime: "08:30", scheduledEndTime: "09:00" }),
    task({ id: "3", scheduledStartTime: "09:00", scheduledEndTime: "10:00" }),
  ]);
  const placed = layoutScheduleBlocks(result.days[0]!.blocks);
  assert.deepEqual(placed.map((item) => item.columns), [2, 2, 1]);
  assert.equal(result.overlapMinutes, 30);
});

test("connected overlap clusters reuse free lanes without placing intersecting intervals in the same column", () => {
  const blocks = schedule([
    task({ id: "1", scheduledStartTime: "08:00", scheduledEndTime: "09:00" }),
    task({ id: "2", scheduledStartTime: "08:30", scheduledEndTime: "10:00" }),
    task({ id: "3", scheduledStartTime: "09:00", scheduledEndTime: "11:00" }),
  ]).days[0]!.blocks;
  const placed = layoutScheduleBlocks(blocks);
  assert.deepEqual(placed.map((item) => item.column), [0, 1, 0]);
  assert.ok(placed.every((item) => item.columns === 2));
});

test("expanded touch areas stay within the 24-hour grid and use separate lanes without changing actual overlaps or load", () => {
  const result = schedule([
    task({ id: "1", scheduledStartTime: "23:58", scheduledEndTime: "23:59", plannedMinutes: 1 }),
    task({ id: "2", scheduledStartTime: "23:59", scheduledEndTime: "24:00", plannedMinutes: 1 }),
  ]);
  for (const targetHeight of [44, 64]) {
    const placed = layoutScheduleBlocks(result.days[0]!.blocks, targetHeight / 1.2);
    assert.ok(placed.every((item) => item.columns === 2 && item.endMinute <= 1440 && item.startMinute >= 0));
    assert.ok(placed.every((item) => (item.endMinute - item.startMinute) * 1.2 >= targetHeight - 0.0001));
  }
  assert.equal(result.overlapMinutes, 0);
  assert.equal(result.plannedMinutes, 2);
});

test("invalid or zero planned amounts never use executed time as a fallback", () => {
  for (const plannedMinutes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = schedule([task({ plannedMinutes, elapsedSeconds: 7200 })]);
    assert.equal(result.plannedMinutes, 0);
    assert.equal(result.days[0]!.blocks.length, 1);
  }
});

test("source categories distinguish productive origins and non-productive time", () => {
  const result = buildWeeklySchedule(assignments([
    group({ type: "external_ot", works: [task()] }),
    group({ type: "internal_maintenance", works: [task()] }),
    group({ type: "direct_assignment", works: [task(), task({ id: "2", workType: "non_productive" })] }),
  ]), range);
  assert.deepEqual(new Set(result.days[0]!.blocks.map((block) => block.source)), new Set(["external_ot", "internal_maintenance", "direct_assignment", "non_productive"]));
});

test("branch clock uses the supplied zone across UTC date boundaries and omits the line for unknown zones", () => {
  const now = new Date("2026-09-08T01:30:00Z");
  assert.deepEqual(scheduleClock("America/Bogota", now), { day: "2026-09-07", minute: 1230, timezone: "America/Bogota" });
  assert.deepEqual(scheduleClock("Asia/Tokyo", now), { day: "2026-09-08", minute: 630, timezone: "Asia/Tokyo" });
  assert.deepEqual(scheduleClock("UTC", new Date("2026-09-08T00:00:00Z")), { day: "2026-09-08", minute: 0, timezone: "UTC" });
  assert.equal(scheduleClock(undefined, now), null);
  assert.equal(scheduleClock("Not/AZone", now), null);
  assert.equal(scheduleClock("UTC", new Date("invalid")), null);
});

test("an empty range result includes each requested day and no invented capacity or availability", () => {
  const result = schedule([]);
  assert.equal(result.days.length, 7);
  assert.equal(result.plannedMinutes, 0);
  assert.equal(result.overlapMinutes, 0);
  assert.deepEqual(result.unscheduled, []);
  assert.throws(() => schedule([], { startDate: "2026-09-08", endDate: "2026-09-07" }), /INVALID_ASSIGNMENT_RANGE/);
});

test("building and laying out a schedule never mutate assignments, snapshots or query date arrays", () => {
  const data = assignments([group({ works: [task({ schedules: [snapshot("2026-09-07"), snapshot("2026-09-09")] })] })]);
  const before = structuredClone(data);
  const result = buildWeeklySchedule(data, range);
  const beforeLayout = structuredClone(result);
  for (const day of result.days) layoutScheduleBlocks(day.blocks, 44);
  assert.deepEqual(data, before);
  assert.deepEqual(result, beforeLayout);
});