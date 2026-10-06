import { isFinished, shiftDate } from "./format";
import { normalizeWorkChecklistProgress } from "./assignmentChecklistProgress";
import type { AssignmentGroup, Assignments, AssignmentWork, DateRange } from "./models";

export interface DailyAssignmentSnapshot { date: string; data: Assignments; }
export interface AssignmentWorkQuerySnapshot { date: string; generatedAt: string; work: AssignmentWork; }
export interface AssignmentWorkSnapshot extends AssignmentWorkQuerySnapshot { queryDates: string[]; dailyVersions?: AssignmentWorkQuerySnapshot[]; }
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

/** Minutos reportados (registrados por cronómetro o ejecución manual); no incluye el tiempo en curso aún no guardado. */
export function assignmentExecutedMinutes(work: ScheduledAssignmentWork): number {
  return work.schedules?.reduce((sum, snapshot) => sum + minutes(snapshot.work.executedMinutes), 0) ?? minutes(work.executedMinutes);
}

/** Horas-hombre con máximo un decimal: 480 min → "8", 90 min → "1,5". */
export function manHours(totalMinutes: number): string {
  const hours = Math.round(Math.max(0, totalMinutes) / 6) / 10;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".", ",");
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
      for (const sourceWork of group.works) {
        const work = normalizeWorkChecklistProgress(sourceWork);
        const item = entry.works.get(work.id) ?? { dates: new Set<string>(), snapshots: new Map<string, AssignmentWorkSnapshot>() };
        const day = assignmentDay(work.scheduledDate);
        for (const value of [...(work.plannedDates ?? []), day]) {
          const date = assignmentDay(value);
          if (date) item.dates.add(date);
        }
        const current = item.snapshots.get(day);
        const queryDates = [...new Set([...(current?.queryDates ?? []), snapshot.date])].sort();
        const candidate = { date: snapshot.date, queryDates, generatedAt: snapshot.data.generatedAt, work };
        const dailyVersions = [...(current?.dailyVersions ?? []).filter((version) => version.date !== snapshot.date),
          { date: snapshot.date, generatedAt: snapshot.data.generatedAt, work }].sort((left, right) => left.date.localeCompare(right.date));
        const selected = !current || preferredSnapshot(candidate, current) ? candidate : {
          ...current, queryDates,
          work: generatedTime(candidate.generatedAt) > generatedTime(current.generatedAt)
            ? normalizeWorkChecklistProgress({ ...current.work, checklists: work.checklists }) : current.work,
        };
        item.snapshots.set(day, { ...selected, dailyVersions });
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

export function assignmentWorkSnapshotForQueryDate(work: ScheduledAssignmentWork, queryDate: string): AssignmentWorkQuerySnapshot | undefined {
  const schedule = work.schedules?.find((item) => assignmentDay(item.work.scheduledDate) === assignmentDay(work.scheduledDate));
  if (!schedule?.queryDates.includes(queryDate)) return undefined;
  return schedule.dailyVersions ? schedule.dailyVersions.find((version) => version.date === queryDate) : schedule.date === queryDate ? schedule : undefined;
}

export function assignmentWorkForQueryDate(work: ScheduledAssignmentWork, queryDate: string): ScheduledAssignmentWork | undefined {
  if (!work.schedules) return work;
  const snapshot = assignmentWorkSnapshotForQueryDate(work, queryDate);
  return snapshot ? { ...snapshot.work, plannedDates: work.plannedDates, schedules: work.schedules } : undefined;
}

export function assignmentWorkRange(work: ScheduledAssignmentWork, fallbackDay: string): DateRange {
  const snapshot = work.schedules?.find((item) => assignmentDay(item.work.scheduledDate) === assignmentDay(work.scheduledDate));
  return dailyRange(snapshot?.queryDates.includes(fallbackDay) ? fallbackDay : snapshot?.date ?? fallbackDay);
}

export function assignmentWorkQueryRange(work: ScheduledAssignmentWork, range: DateRange): DateRange {
  if (range.startDate === range.endDate) return dailyRange(range.startDate);
  const scheduledDate = assignmentDay(work.scheduledDate);
  return assignmentWorkRange(work, scheduledDate >= range.startDate && scheduledDate <= range.endDate ? scheduledDate : range.startDate);
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

// --- Ubicar el trabajo de un aviso (asignación o cronómetro) en la agenda ---
type Group = Assignments["groups"][number];
type Work = Group["works"][number];
export interface NoticeTarget { groupType: "work" | "negotiation" | "maintenance"; groupId: number; workId: number | null; }
export interface LocatedNotice { group: Group; work: Work | null; scheduledDate: string | null; }


export function noticeGroupMatches(group: Group, target: NoticeTarget): boolean {
  return target.groupType === "maintenance" ? group.type === "internal_maintenance" && group.id === `maintenance-${target.groupId}`
    : target.groupType === "negotiation" ? group.type === "external_ot" && group.id === `external-${target.groupId}`
      : group.type === "direct_assignment" && (group.id === `direct-${target.groupId}` || group.id === `direct-np-${target.groupId}`);
}

function noticeWork(group: Group, target: NoticeTarget): Work | undefined {
  return group.works.find((item) => item.id === String(target.workId) && (target.groupType !== "work"
    || (group.id === `direct-${item.id}` && item.workType === "productive")
    || (group.id === `direct-np-${item.id}` && item.workType === "non_productive")));
}

/** Grupo y trabajo del aviso dentro de las asignaciones de un día. `null` si no está ese día. */
export function locateNotice(data: Assignments, target: NoticeTarget, day: string): LocatedNotice | null {
  const group = data.groups.find((item) => noticeGroupMatches(item, target));
  if (!group) return null;
  if (target.workId === null) return { group, work: null, scheduledDate: null };
  const work = noticeWork(group, target);
  if (!work) return null;
  const snapshots = work.schedules?.filter((item) => item.queryDates.includes(day));
  const snapshot = snapshots?.find((item) => assignmentDay(item.work.scheduledDate) === day) ?? snapshots?.[0];
  if (work.schedules && !snapshot) return null;
  return { group, work, scheduledDate: assignmentDay(snapshot?.work.scheduledDate ?? work.scheduledDate) };
}

/**
 * Rango para buscar un trabajo que no aparece en la fecha del aviso. El servidor informa la primera fecha planificada,
 * pero un cronómetro puede seguir corriendo días después: se busca entre esa fecha y hoy, con un máximo de 31 días.
 */
export function noticeSearchRange(day: string, today: string): DateRange {
  const start = day < today ? day : today;
  const end = day < today ? today : day;
  const earliest = shiftDate(end, -30);
  return { startDate: start < earliest ? earliest : start, endDate: end };
}

/** Día en que mostrar el trabajo encontrado en un rango: hoy si está, si no el más reciente hasta hoy, si no el más próximo. */
export function noticeDayInRange(data: Assignments, target: NoticeTarget, range: DateRange, today: string): string | null {
  if (target.workId === null) return null;
  const days = new Set<string>();
  for (const group of data.groups) {
    if (!noticeGroupMatches(group, target)) continue;
    const work = noticeWork(group, target);
    if (!work) continue;
    for (const schedule of work.schedules ?? []) for (const day of schedule.queryDates) days.add(day);
    const scheduled = assignmentDay(work.scheduledDate ?? "");
    if (!work.schedules?.length && scheduled) days.add(scheduled);
  }
  const candidates = [...days].filter((day) => day >= range.startDate && day <= range.endDate).sort();
  if (candidates.includes(today)) return today;
  const past = candidates.filter((day) => day < today);
  return past.at(-1) ?? candidates[0] ?? null;
}
