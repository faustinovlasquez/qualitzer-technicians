import { assignmentDay, assignmentDays, assignmentWorkForDay, type AssignmentWorkSnapshot } from "./assignmentSchedule";
import { isFinished } from "./format";
import type { AssignmentGroup, Assignments, AssignmentWork, DateRange, GroupType } from "./models";

export type ScheduleSource = GroupType | "non_productive";
export interface ScheduleEntry {
  key: string;
  group: AssignmentGroup;
  work: AssignmentWork;
  scheduledDay: string;
  queryDate: string | null;
  source: ScheduleSource;
}
export interface ScheduleBlock extends ScheduleEntry {
  day: string;
  startMinute: number;
  endMinute: number;
  plannedMinutes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}
export interface UnscheduledEntry extends ScheduleEntry {
  reason: "overdue" | "missing_date" | "invalid_time";
}
export interface ScheduleDay {
  date: string;
  blocks: ScheduleBlock[];
  plannedMinutes: number;
  overlapMinutes: number;
}
export interface WeeklyScheduleData {
  days: ScheduleDay[];
  unscheduled: UnscheduledEntry[];
  plannedMinutes: number;
  overlapMinutes: number;
}
export interface SchedulePlacement {
  block: ScheduleBlock;
  startMinute: number;
  endMinute: number;
  column: number;
  columns: number;
}
export interface ScheduleClock { day: string; minute: number; timezone: string; }
interface Candidate { work: AssignmentWork; snapshot?: AssignmentWorkSnapshot; }
interface WorkCandidates { group: AssignmentGroup; works: AssignmentWork[]; }

export function scheduleDateOffset(day: string, offset: number): string {
  if (assignmentDay(day) !== day || !Number.isInteger(offset)) throw new Error("INVALID_ASSIGNMENT_DATE");
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function scheduleTimeMinutes(value: string, allowEndOfDay = false): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (allowEndOfDay && hour === 24 && minute === 0 && second === 0) return 1440;
  return hour < 24 && minute < 60 && second < 60 ? hour * 60 + minute + second / 60 : null;
}

export function scheduleInterval(work: AssignmentWork): { start: number; end: number } | null {
  const start = scheduleTimeMinutes(work.scheduledStartTime);
  const end = scheduleTimeMinutes(work.scheduledEndTime, true);
  const explicitOffset = work.endDateOffset ?? 0;
  if (start === null || end === null || !Number.isInteger(explicitOffset) || explicitOffset < 0 || explicitOffset > 30) return null;
  const offset = explicitOffset > 0 ? explicitOffset : end < start ? 1 : 0;
  const absoluteEnd = end + offset * 1440;
  return absoluteEnd > start ? { start, end: absoluteEnd } : null;
}

export function scheduleClock(timezone?: string, now = new Date()): ScheduleClock | null {
  if (!timezone?.trim() || !Number.isFinite(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    const minute = scheduleTimeMinutes(`${part("hour")}:${part("minute")}`);
    return assignmentDay(day) === day && minute !== null ? { day, minute, timezone } : null;
  } catch { return null; }
}

function preferCandidate(candidate: Candidate, current: Candidate): boolean {
  const day = assignmentDay(candidate.work.scheduledDate);
  const candidateExact = candidate.snapshot?.date === day;
  const currentExact = current.snapshot?.date === day;
  if (candidateExact !== currentExact) return candidateExact;
  const timestamp = (item: Candidate): number => Date.parse(item.snapshot?.generatedAt ?? "") || 0;
  return timestamp(candidate) >= timestamp(current);
}

function entriesForWork({ group, works }: WorkCandidates): ScheduleEntry[] {
  const candidates = new Map<string, Candidate>();
  for (const work of works) {
    const incoming: Candidate[] = work.schedules?.length ? work.schedules.map((snapshot) => ({ work: snapshot.work, snapshot })) : [{ work }];
    for (const candidate of incoming) {
      const key = assignmentDay(candidate.work.scheduledDate) || candidate.work.scheduledDate;
      const current = candidates.get(key);
      const preferred = !current || preferCandidate(candidate, current) ? candidate : current;
      const queryDates = [...new Set([...(current?.snapshot?.queryDates ?? []), ...(candidate.snapshot?.queryDates ?? [])])].sort();
      candidates.set(key, preferred.snapshot ? { ...preferred, snapshot: { ...preferred.snapshot, queryDates } } : preferred);
    }
  }
  const schedules = Array.from(candidates.values()).flatMap((candidate) => candidate.snapshot ? [candidate.snapshot] : []);
  const plannedDates = [...new Set(works.flatMap((work) => work.plannedDates ?? []))].sort();
  return Array.from(candidates.values(), (candidate): ScheduleEntry => {
    const scheduledDay = assignmentDay(candidate.work.scheduledDate);
    const work = assignmentWorkForDay({
      ...candidate.work,
      ...(plannedDates.length ? { plannedDates } : {}),
      ...(schedules.length ? { schedules } : {}),
    }, scheduledDay);
    return {
      key: JSON.stringify([group.type, group.id, work.id, scheduledDay || work.scheduledDate]),
      group, work, scheduledDay,
      queryDate: candidate.snapshot ? candidate.snapshot.queryDates.includes(scheduledDay) ? scheduledDay : candidate.snapshot.date : null,
      source: work.workType === "non_productive" ? "non_productive" : group.type,
    };
  });
}

export function scheduleOverlapMinutes(blocks: readonly ScheduleBlock[]): number {
  const changes = new Map<number, number>();
  for (const block of blocks) {
    changes.set(block.startMinute, (changes.get(block.startMinute) ?? 0) + 1);
    changes.set(block.endMinute, (changes.get(block.endMinute) ?? 0) - 1);
  }
  let active = 0;
  let previous = 0;
  let overlap = 0;
  for (const [minute, change] of [...changes].sort(([left], [right]) => left - right)) {
    if (active > 1) overlap += minute - previous;
    active += change;
    previous = minute;
  }
  return overlap;
}

export function layoutScheduleBlocks(blocks: readonly ScheduleBlock[], minimumMinutes = 0): SchedulePlacement[] {
  const minimum = Number.isFinite(minimumMinutes) ? Math.min(1440, Math.max(0, minimumMinutes)) : 0;
  const placements = blocks.map((block): SchedulePlacement => {
    const endMinute = Math.min(1440, Math.max(block.endMinute, block.startMinute + minimum));
    return { block, startMinute: Math.min(block.startMinute, endMinute - minimum), endMinute, column: 0, columns: 1 };
  }).sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.block.key.localeCompare(right.block.key));
  let cluster: SchedulePlacement[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  const finishCluster = (): void => { for (const item of cluster) item.columns = columnEnds.length; };
  for (const item of placements) {
    if (item.startMinute >= clusterEnd) { finishCluster(); cluster = []; columnEnds = []; }
    const free = columnEnds.findIndex((end) => end <= item.startMinute);
    item.column = free < 0 ? columnEnds.length : free;
    columnEnds[item.column] = item.endMinute;
    cluster.push(item);
    clusterEnd = Math.max(...columnEnds);
  }
  finishCluster();
  return placements;
}

export function buildWeeklySchedule(data: Assignments, range: DateRange): WeeklyScheduleData {
  const days = assignmentDays(range).map((date): ScheduleDay => ({ date, blocks: [], plannedMinutes: 0, overlapMinutes: 0 }));
  const byDay = new Map(days.map((day) => [day.date, day]));
  const grouped = new Map<string, WorkCandidates>();
  for (const group of data.groups) {
    for (const work of group.works) {
      const key = JSON.stringify([group.type, group.id, work.id]);
      const entry = grouped.get(key) ?? { group, works: [] };
      entry.works.push(work);
      grouped.set(key, entry);
    }
  }
  const unscheduled: UnscheduledEntry[] = [];
  for (const entry of Array.from(grouped.values()).flatMap(entriesForWork)) {
    const interval = scheduleInterval(entry.work);
    if (!entry.scheduledDay) { unscheduled.push({ ...entry, reason: "missing_date" }); continue; }
    const beforeRange = entry.scheduledDay < range.startDate;
    if (!interval) {
      if (byDay.has(entry.scheduledDay) || (beforeRange && !isFinished(entry.work))) unscheduled.push({ ...entry, reason: beforeRange && !isFinished(entry.work) ? "overdue" : "invalid_time" });
      continue;
    }
    const planned = Number.isFinite(entry.work.plannedMinutes) ? Math.max(0, entry.work.plannedMinutes) : 0;
    let visible = false;
    for (let offset = 0; offset < Math.ceil(interval.end / 1440); offset += 1) {
      const date = scheduleDateOffset(entry.scheduledDay, offset);
      const day = byDay.get(date);
      if (!day) continue;
      const startMinute = Math.max(0, interval.start - offset * 1440);
      const endMinute = Math.min(1440, interval.end - offset * 1440);
      if (endMinute <= startMinute) continue;
      visible = true;
      const plannedMinutes = planned * (endMinute - startMinute) / (interval.end - interval.start);
      day.blocks.push({ ...entry, key: `${entry.key}:${date}`, day: date, startMinute, endMinute, plannedMinutes, continuesBefore: offset > 0, continuesAfter: interval.end > (offset + 1) * 1440 });
      day.plannedMinutes += plannedMinutes;
    }
    if (!visible && beforeRange && !isFinished(entry.work)) unscheduled.push({ ...entry, reason: "overdue" });
  }
  for (const day of days) {
    day.blocks.sort((left, right) => left.startMinute - right.startMinute || left.key.localeCompare(right.key));
    day.overlapMinutes = scheduleOverlapMinutes(day.blocks);
  }
  unscheduled.sort((left, right) => left.scheduledDay.localeCompare(right.scheduledDay) || left.key.localeCompare(right.key));
  return { days, unscheduled, plannedMinutes: days.reduce((sum, day) => sum + day.plannedMinutes, 0), overlapMinutes: days.reduce((sum, day) => sum + day.overlapMinutes, 0) };
}