import { assignmentDay } from "./assignmentSchedule";
import type { AssignmentWork, DateRange, StatusInput, WorkStatus } from "./models";

export const MAX_EXECUTION_DATES = 30;

export interface ExecutionTiming {
  executionStartTime: string;
  executionEndTime: string;
  endDateOffset: number;
  minutes: number;
}

export function isExecutionFinalization(status: WorkStatus): boolean {
  return status === "completed" || status === "delivered";
}

export function canTransitionExecution(work: Pick<AssignmentWork, "status" | "canExecute">, status: WorkStatus): boolean {
  if (!work.canExecute || isExecutionFinalization(work.status)) return false;
  if (isExecutionFinalization(status)) return ["pending", "in_progress", "paused"].includes(work.status);
  return (status === "in_progress" && (work.status === "pending" || work.status === "paused")) || (status === "paused" && work.status === "in_progress");
}

export function executionTimeMinutes(time: string | null | undefined): number | null {
  if (time == null || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function executionElapsedSeconds(work: Pick<AssignmentWork, "elapsedSeconds" | "status">, generatedAt?: string, now?: number): number {
  const baseline = Number.isFinite(work.elapsedSeconds) ? Math.max(0, work.elapsedSeconds) : 0;
  const snapshot = generatedAt === undefined ? NaN : Date.parse(generatedAt);
  const extra = work.status === "in_progress" && now !== undefined && Number.isFinite(now) && Number.isFinite(snapshot)
    ? Math.max(0, Math.floor((now - snapshot) / 1000)) : 0;
  return baseline + extra;
}

export function executionStartTime(work: Pick<AssignmentWork, "firstInProgressTime" | "scheduledStartTime">): string {
  if (executionTimeMinutes(work.firstInProgressTime) !== null) return work.firstInProgressTime ?? "";
  return executionTimeMinutes(work.scheduledStartTime) !== null ? work.scheduledStartTime : "";
}

export function automaticExecutionTiming(work: AssignmentWork, elapsedSeconds = executionElapsedSeconds(work)): ExecutionTiming | null {
  const start = executionStartTime(work);
  const startMinutes = executionTimeMinutes(start);
  if (startMinutes === null || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
  const minutes = Math.round(elapsedSeconds / 60);
  const endTotal = startMinutes + minutes;
  const endDateOffset = Math.floor(endTotal / 1440);
  if (endDateOffset > 30) return null;
  return {
    executionStartTime: start,
    executionEndTime: `${String(Math.floor(endTotal / 60) % 24).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`,
    endDateOffset, minutes,
  };
}

export function executionDuration(input: Pick<StatusInput, "executionStartTime" | "executionEndTime" | "endDateOffset">): number | null {
  const start = executionTimeMinutes(input.executionStartTime);
  const end = executionTimeMinutes(input.executionEndTime);
  const offset = input.endDateOffset ?? 0;
  if (start === null || end === null || !Number.isInteger(offset) || offset < 0 || offset > 30) return null;
  const minutes = end + offset * 1440 - start;
  return minutes > 0 ? minutes : null;
}

export function executionDateAllowed(work: AssignmentWork, range: DateRange, date: string): boolean {
  if (assignmentDay(date) !== date) return false;
  return (date >= range.startDate && date <= range.endDate) || (work.plannedDates ?? []).includes(date);
}

export function availableExecutionDates(work: AssignmentWork, range: DateRange): string[] {
  const dates = [range.startDate, ...(work.plannedDates ?? []), ...(work.schedules ?? []).flatMap((snapshot) => snapshot.queryDates)];
  return [...new Set(dates.filter((date) => executionDateAllowed(work, range, date)))].sort();
}

export function executionDatesAllowed(work: AssignmentWork, range: DateRange, dates: string[], maintenance = false): boolean {
  if (dates.length === 0 || dates.length > MAX_EXECUTION_DATES || new Set(dates).size !== dates.length) return false;
  if (dates.length === 1) return executionDateAllowed(work, range, dates[0]!);
  return !maintenance && dates.every((date) => assignmentDay(date) === date && work.plannedDates?.includes(date));
}

export function executionIntervalCovered(dates: string[], offset: number): boolean {
  const sorted = [...dates].sort();
  const first = sorted[0];
  if (!first || !Number.isInteger(offset) || offset < 0 || offset > 30) return false;
  const start = Date.parse(`${first}T00:00:00Z`);
  return Number.isFinite(start) && Array.from({ length: offset + 1 }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  ).every((date, index) => sorted[index] === date);
}