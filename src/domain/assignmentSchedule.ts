import { isFinished, shiftDate } from "./format";
import type { AssignmentGroup, Assignments, AssignmentWork, DateRange } from "./models";

export interface DailyAssignmentSnapshot { date: string; data: Assignments; }
export interface AssignmentWorkSnapshot { date: string; queryDates: string[]; generatedAt: string; work: AssignmentWork; }
export interface ScheduledAssignmentWork extends AssignmentWork { schedules?: AssignmentWorkSnapshot[]; }
export interface ScheduledAssignmentGroup extends AssignmentGroup { works: ScheduledAssignmentWork[]; }
export interface ScheduledAssignments extends Assignments { groups: ScheduledAssignmentGroup[]; }
export interface AssignmentProgress {
  elapsedSeconds: number;
  executedMinutes: number;
  plannedMinutes: number;
  totalExecutedMinutes: number;
  totalPlannedMinutes: number;
  percentage: number | null;
  barPercentage: number;
  overtimeMinutes: number;
}

export function assignmentDay(value: string): string {
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : "";
}

export function dailyRange(day: string): DateRange {
  if (assignmentDay(day) !== day) throw new Error("INVALID_ASSIGNMENT_DATE");
  return { startDate: day, endDate: day };
}

export function assignmentDays(range: DateRange): string[] {
  dailyRange(range.startDate);
  dailyRange(range.endDate);
  if (range.endDate < range.startDate) throw new Error("INVALID_ASSIGNMENT_RANGE");
  const days: string[] = [];
  for (let day = range.startDate; day <= range.endDate; day = shiftDate(day, 1)) {
    if (days.length >= 31) throw new Error("INVALID_ASSIGNMENT_RANGE");
    days.push(day);
  }
  return days;
}

function minutes(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function generatedTime(value: string): number { return Date.parse(value) || 0; }

function preferredSnapshot(candidate: AssignmentWorkSnapshot, current: AssignmentWorkSnapshot): boolean {
  const candidateMatches = candidate.date === assignmentDay(candidate.work.scheduledDate);
  const currentMatches = current.date === assignmentDay(current.work.scheduledDate);
  if (candidateMatches !== currentMatches) return candidateMatches;
  return generatedTime(candidate.generatedAt) >= generatedTime(current.generatedAt);
}

export function assignmentPlannedMinutes(work: ScheduledAssignmentWork): number {
  return work.schedules?.reduce((sum, snapshot) => sum + minutes(snapshot.work.plannedMinutes), 0) ?? minutes(work.plannedMinutes);
}

export function mergeDailyAssignments(snapshots: readonly DailyAssignmentSnapshot[], selectedDate?: string): ScheduledAssignments {
  const ordered = [...snapshots].sort((left, right) => generatedTime(left.data.generatedAt) - generatedTime(right.data.generatedAt) || left.date.localeCompare(right.date));
  const newest = ordered.at(-1);
  if (!newest) throw new Error("ASSIGNMENT_SNAPSHOTS_REQUIRED");
  if (selectedDate !== undefined) dailyRange(selectedDate);
  const grouped = new Map<string, { group: AssignmentGroup; works: Map<string, { dates: Set<string>; snapshots: Map<string, AssignmentWorkSnapshot> }> }>();
  for (const snapshot of ordered) {
    dailyRange(snapshot.date);
    if (snapshot.data.technician.id !== newest.data.technician.id) throw new Error("ASSIGNMENT_WORKER_MISMATCH");
    for (const group of snapshot.data.groups) {
      const key = JSON.stringify([group.type, group.id]);
      const entry = grouped.get(key) ?? { group, works: new Map<string, { dates: Set<string>; snapshots: Map<string, AssignmentWorkSnapshot> }>() };
      entry.group = group;
      grouped.set(key, entry);
      for (const work of group.works) {
        const item = entry.works.get(work.id) ?? { dates: new Set<string>(), snapshots: new Map<string, AssignmentWorkSnapshot>() };
        const day = assignmentDay(work.scheduledDate);
        for (const value of [...(work.plannedDates ?? []), day]) {
          const date = assignmentDay(value);
          if (date) item.dates.add(date);
        }
        const current = item.snapshots.get(day);
        const queryDates = [...new Set([...(current?.queryDates ?? []), snapshot.date])].sort();
        const candidate = { date: snapshot.date, queryDates, generatedAt: snapshot.data.generatedAt, work };
        item.snapshots.set(day, !current || preferredSnapshot(candidate, current) ? candidate : { ...current, queryDates });
        entry.works.set(work.id, item);
      }
    }
  }
  const groups: ScheduledAssignmentGroup[] = Array.from(grouped.values(), ({ group, works }) => {
    const merged = Array.from(works.values(), (item): ScheduledAssignmentWork => {
      const schedules = [...item.snapshots.values()].sort((left, right) => left.work.scheduledDate.localeCompare(right.work.scheduledDate));
      const selected = schedules.find((snapshot) => assignmentDay(snapshot.work.scheduledDate) === selectedDate)
        ?? schedules.reduce((current, candidate) => preferredSnapshot(candidate, current) ? candidate : current);
      return { ...selected.work, plannedDates: [...item.dates].sort(), schedules };
    }).sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.scheduledStartTime.localeCompare(right.scheduledStartTime) || left.id.localeCompare(right.id));
    return { ...group, works: merged, plannedMinutes: merged.reduce((sum, work) => sum + assignmentPlannedMinutes(work), 0), isOverdue: merged.some((work) => work.isOverdue && !isFinished(work)) };
  }).sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.id.localeCompare(right.id));
  const works = groups.flatMap((group) => group.works);
  return {
    generatedAt: newest.data.generatedAt, technician: newest.data.technician, groups,
    summary: {
      totalGroups: groups.length, totalWorks: works.length,
      activeWorks: works.filter((work) => work.status === "in_progress" || work.status === "paused").length,
      overdueWorks: works.filter((work) => work.isOverdue && !isFinished(work)).length,
      plannedMinutes: groups.reduce((sum, group) => sum + group.plannedMinutes, 0),
    },
  };
}

export function assignmentWorkForDay(work: ScheduledAssignmentWork, day: string): ScheduledAssignmentWork {
  const snapshot = work.schedules?.find((item) => assignmentDay(item.work.scheduledDate) === day)
    ?? work.schedules?.find((item) => item.queryDates.includes(day) && assignmentDay(item.work.scheduledDate) < day && !isFinished(item.work));
  return snapshot ? {
    ...snapshot.work, plannedDates: work.plannedDates, schedules: work.schedules,
    isOverdue: snapshot.work.isOverdue || (assignmentDay(snapshot.work.scheduledDate) < day && !isFinished(snapshot.work)),
  } : work;
}

export function assignmentWorkRange(work: ScheduledAssignmentWork, fallbackDay: string): DateRange {
  const snapshot = work.schedules?.find((item) => assignmentDay(item.work.scheduledDate) === assignmentDay(work.scheduledDate));
  return dailyRange(snapshot?.queryDates.includes(fallbackDay) ? fallbackDay : snapshot?.date ?? fallbackDay);
}

export function assignmentIncludesDay(work: ScheduledAssignmentWork, day: string): boolean {
  const scheduled = assignmentDay(work.scheduledDate);
  return !scheduled || scheduled === day || (work.plannedDates ?? []).some((value) => assignmentDay(value) === day)
    || (work.isOverdue && !isFinished(work) && scheduled < day)
    || (work.schedules ?? []).some((item) => item.queryDates.includes(day) && assignmentDay(item.work.scheduledDate) < day && !isFinished(item.work));
}

export function assignmentProgress(work: AssignmentWork, liveElapsedSeconds = work.elapsedSeconds): AssignmentProgress {
  const recorded = minutes(work.executedMinutes);
  const timed = (work.status === "in_progress" || work.status === "paused") && !work.isManualExecution;
  const elapsedSeconds = timed ? minutes(liveElapsedSeconds) : recorded * 60;
  const executedMinutes = timed ? Math.max(recorded, elapsedSeconds / 60) : recorded;
  const totalExecutedMinutes = minutes(work.totalExecutedMinutes ?? recorded) + Math.max(0, executedMinutes - recorded);
  const totalPlannedMinutes = minutes(work.totalPlannedMinutes ?? work.plannedMinutes);
  const percentage = totalPlannedMinutes > 0 ? Math.round(totalExecutedMinutes / totalPlannedMinutes * 100) : null;
  return {
    elapsedSeconds, executedMinutes, plannedMinutes: minutes(work.plannedMinutes), totalExecutedMinutes, totalPlannedMinutes,
    percentage, barPercentage: Math.min(100, percentage ?? 0), overtimeMinutes: Math.max(0, totalExecutedMinutes - totalPlannedMinutes),
  };
}