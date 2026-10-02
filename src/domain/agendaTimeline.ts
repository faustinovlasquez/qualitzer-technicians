import { assignmentDay, assignmentDays, assignmentWorkForDay } from "./assignmentSchedule";
import { matchesAssignmentSearch } from "./assignmentCodes";
import { isFinished } from "./format";
import type { AssignmentGroup, AssignmentWork, DateRange } from "./models";

export type AgendaTab = "scheduled" | "unscheduled" | "completed";

export interface AgendaWorkItem {
  kind: "work";
  key: string;
  day: string;
  start: string | null;
  end: string | null;
  group: AssignmentGroup;
  work: AssignmentWork;
  tab: AgendaTab;
}

export interface AgendaBreakItem { kind: "break"; key: string; day: string; start: string; end: string; }

export type AgendaItem = AgendaWorkItem | AgendaBreakItem;

export interface AgendaHours { pending: number; active: number; completed: number; planned: number; reported: number; }

export interface AgendaSummary {
  items: AgendaWorkItem[];
  counts: { [K in AgendaTab]: number };
  /** Minutos planificados por estado y totales planificados/reportados del período. */
  hours: AgendaHours;
}

function hhmm(value: string | null | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : null;
}

const minutes = (value: number | undefined): number => value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;

/** Trabajos del período, uno por día planificado, con la versión de ese día. Respeta la búsqueda de la cabecera. */
export function buildAgenda(groups: readonly AssignmentGroup[], range: DateRange, query = ""): AgendaSummary {
  const days = new Set(assignmentDays(range));
  const items: AgendaWorkItem[] = [];
  for (const group of groups) {
    for (const base of group.works) {
      if (query.trim() && !matchesAssignmentSearch(group, base, query)) continue;
      const planned = new Set([assignmentDay(base.scheduledDate), ...(base.plannedDates ?? []).map(assignmentDay)].filter(day => days.has(day)));
      for (const day of planned) {
        const work = assignmentWorkForDay(base, day);
        const start = hhmm(work.scheduledStartTime);
        const tab: AgendaTab = isFinished(work) ? "completed" : start ? "scheduled" : "unscheduled";
        items.push({ kind: "work", key: `${group.type}:${group.id}:${work.id}:${day}`, day, start, end: hhmm(work.scheduledEndTime), group, work, tab });
      }
    }
  }
  items.sort((a, b) => a.day.localeCompare(b.day) || (a.start ?? "99:99").localeCompare(b.start ?? "99:99") || a.key.localeCompare(b.key));
  const hours: AgendaHours = { pending: 0, active: 0, completed: 0, planned: 0, reported: 0 };
  for (const { work } of items) {
    const plannedMinutes = minutes(work.plannedMinutes);
    hours.planned += plannedMinutes;
    hours.reported += minutes(work.executedMinutes);
    if (isFinished(work)) hours.completed += plannedMinutes;
    else if (work.status === "in_progress" || work.status === "paused") hours.active += plannedMinutes;
    else hours.pending += plannedMinutes;
  }
  const counts = { scheduled: 0, unscheduled: 0, completed: 0 };
  for (const item of items) counts[item.tab] += 1;
  return { items, counts, hours };
}

/** Línea de tiempo de una pestaña agrupada por día; en "scheduled" intercala la colación de cada día una sola vez. */
export function agendaTimeline(items: readonly AgendaWorkItem[], tab: AgendaTab): Array<{ day: string; items: AgendaItem[] }> {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    if (item.tab !== tab) continue;
    const list = byDay.get(item.day) ?? [];
    list.push(item);
    byDay.set(item.day, list);
  }
  const result: Array<{ day: string; items: AgendaItem[] }> = [];
  for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const breaks = new Map<string, AgendaBreakItem>();
    if (tab === "scheduled") {
      for (const item of list) {
        if (item.kind !== "work" || item.work.hasBreakTime !== true) continue;
        const start = hhmm(item.work.breakStartTime);
        const end = hhmm(item.work.breakEndTime);
        if (start && end) breaks.set(`${start}-${end}`, { kind: "break", key: `break:${day}:${start}-${end}`, day, start, end });
      }
    }
    const merged: AgendaItem[] = [...list, ...breaks.values()];
    merged.sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99") || (a.kind === "break" ? 1 : 0) - (b.kind === "break" ? 1 : 0));
    result.push({ day, items: merged });
  }
  return result;
}
