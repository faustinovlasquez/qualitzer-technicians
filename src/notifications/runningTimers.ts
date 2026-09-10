import type { Assignments } from "../domain/models";

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