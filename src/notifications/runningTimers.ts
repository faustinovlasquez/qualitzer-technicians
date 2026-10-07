import type { Assignments } from "../domain/models";
import type { ActiveTimer } from "../domain/notifications";

export interface RunningTimerNoticeItem { groupId: string; workId: string; title: string; elapsedSeconds: number; }

export function runningTimersFromSnapshot(data: Assignments | null): RunningTimerNoticeItem[] {
  const found = new Map<string, RunningTimerNoticeItem>();
  for (const group of data?.groups ?? []) {
    for (const work of group.works) {
      if (work.status !== "in_progress" || work.isManualExecution === true) continue;
      const key = `${group.id}:${work.id}`;
      const elapsedSeconds = Number.isFinite(work.elapsedSeconds) ? Math.max(0, work.elapsedSeconds) : 0;
      const previous = found.get(key);
      if (!previous || elapsedSeconds > previous.elapsedSeconds) found.set(key, { groupId: group.id, workId: work.id, title: work.title, elapsedSeconds });
    }
  }
  return [...found.values()];
}

export interface SnapshotActiveTimer { groupId: string; workId: string; title: string; startedAt: string; }

/** Cronómetros en curso de la jornada cargada que el servidor aún no informa en su listado de cronómetros activos. */
export function snapshotActiveTimers(data: Assignments | null, excludedWorkIds: ReadonlySet<string>, now: number): SnapshotActiveTimer[] {
  const generatedAt = Date.parse(data?.generatedAt ?? "");
  const reference = Number.isFinite(generatedAt) ? generatedAt : now;
  return runningTimersFromSnapshot(data)
    .filter((timer) => !excludedWorkIds.has(timer.workId))
    .map((timer) => ({ groupId: timer.groupId, workId: timer.workId, title: timer.title, startedAt: new Date(reference - timer.elapsedSeconds * 1000).toISOString() }));
}

/** "1 h 04 min" / "12 min" desde el inicio informado por el servidor. */
export function activeTimerElapsed(startedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60000));
  if (!Number.isFinite(minutes)) return "";
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, "0")} min` : `${minutes} min`;
}

export function activeTimerReference(timer: ActiveTimer): string {
  const work = `Trabajo #${timer.workId}`;
  return timer.groupType === "negotiation" ? `OT #${timer.groupId} · ${work}` : timer.groupType === "maintenance" ? `Mantenimiento #${timer.groupId} · ${work}` : work;
}
