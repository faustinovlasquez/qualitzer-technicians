import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWeeklySchedule } from "../src/domain/weeklySchedule";
import { agendaDaySummary, agendaEmptyMessage, scheduleBlockTime } from "../src/screens/schedule/schedulePresentation";
import { assignments, group, work } from "../server/tests/fixtures";

const range = { startDate: "2026-09-07", endDate: "2026-09-13" };
const task = work({ scheduledDate: range.startDate, plannedMinutes: 45, executedMinutes: 600, scheduledStartTime: "08:00", scheduledEndTime: "09:00" });

test("agenda summaries use planned load and do not claim capacity or execution", () => {
  const day = buildWeeklySchedule(assignments([group({ works: [task] })]), range).days[0]!;
  assert.equal(agendaDaySummary(day, false), "1 trabajo con horario · 45 min planificadas");
  assert.match(agendaDaySummary(day, true), /45 min planificadas · parcial$/);
  assert.doesNotMatch(agendaDaySummary(day, false), /600|capacidad|disponible|ejecutad/);
});

test("missing-day summaries never present missing coverage as zero load", () => {
  const day = buildWeeklySchedule(assignments([]), range).days[0]!;
  assert.equal(agendaDaySummary(day, true), "Carga no disponible · sin copia completa");
  assert.match(agendaEmptyMessage(true, 0, 0), /No equivale a un día sin tareas/);
  assert.doesNotMatch(agendaDaySummary(day, true), /0 trabajos|0 min/);
});

test("empty-day copy preserves the distinction between unplanned work, overdue and a genuinely empty snapshot", () => {
  assert.match(agendaEmptyMessage(false, 2, 3), /este día sin horas válidas/);
  assert.match(agendaEmptyMessage(false, 0, 1), /atrasados/);
  assert.match(agendaEmptyMessage(false, 0, 0), /información recibida/);
});

test("chronological cards retain second precision and night continuation with original work scope", () => {
  const model = buildWeeklySchedule(assignments([group({ works: [{ ...task, scheduledStartTime: "23:59:30", scheduledEndTime: "00:01", plannedMinutes: 1.5 }] })]), range);
  const first = model.days[0]!.blocks[0]!;
  const second = model.days[1]!.blocks[0]!;
  assert.equal(scheduleBlockTime(first), "23:59:30 – 24:00 ↪");
  assert.equal(scheduleBlockTime(second), "↳ 00:00 – 00:01");
  assert.equal(second.work.scheduledDate, range.startDate);
  assert.equal(model.plannedMinutes, 1.5);
});