import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentsSchema } from "../server/contracts";
import { assignments, group, work } from "../server/tests/fixtures";
import { mergeDailyAssignments } from "../src/domain/assignmentSchedule";
import { buildWeeklySchedule, layoutScheduleBlocks, scheduleClock, scheduleDateOffset } from "../src/domain/weeklySchedule";
import { scheduleDayLabel } from "../src/screens/schedule/schedulePresentation";

const range = { startDate: "2026-09-07", endDate: "2026-09-13" };

test("synthetic normalized 1000 overlapping works across seven snapshots preserve finite schedule geometry", () => {
  const data = assignmentsSchema.parse(assignments([group({ works: Array.from({ length: 1000 }, (_, index) => work({
    id: String(index + 1), scheduledDate: range.startDate, scheduledStartTime: "08:00", scheduledEndTime: "10:00", plannedMinutes: 120,
  })) })]));
  const merged = mergeDailyAssignments(Array.from({ length: 7 }, (_, offset) => ({ date: scheduleDateOffset(range.startDate, offset), data })));
  const model = buildWeeklySchedule(merged, range);
  assert.equal(model.days[0]!.blocks.length, 1000);
  assert.equal(model.plannedMinutes, 120000);
  assert.equal(model.overlapMinutes, 120);
  const placements = layoutScheduleBlocks(model.days[0]!.blocks, 64 / 1.2);
  assert.equal(placements.length, 1000);
  assert.ok(placements.every((item) => item.columns === 1000 && Number.isFinite(item.startMinute) && Number.isFinite(item.endMinute) && item.endMinute > item.startMinute));
});

test("gateway-normalized absent date and text remain unscheduled rather than causing string or date exceptions", () => {
  const data = assignmentsSchema.parse({ ...assignments([]), groups: [{ ...group(), works: [{ ...work(), scheduledDate: null, scheduledStartTime: null, scheduledEndTime: null, title: null }] }] });
  const model = buildWeeklySchedule(data, range);
  assert.equal(model.unscheduled.length, 1);
  assert.equal(model.unscheduled[0]!.reason, "missing_date");
  assert.equal(model.unscheduled[0]!.work.title, "");
  assert.equal(model.plannedMinutes, 0);
});

test("agenda calendar labels cover the week while unknown timezone has no clock", () => {
  for (let offset = 0; offset < 7; offset += 1) assert.ok(scheduleDayLabel(scheduleDateOffset(range.startDate, offset)).length > 0);
  assert.equal(scheduleClock("invalid/timezone"), null);
  assert.equal(scheduleClock("UTC", new Date(Number.NaN)), null);
});