import type { AssignmentWork, DateRange } from "../../domain/models";
import type { OfflineOperation } from "../../domain/offline";
import { automaticExecutionTiming, executionStartTime, executionTimeMinutes } from "../../domain/workExecution";
import { manualCompletion } from "./detailRules";

export function completionStartTime(work: AssignmentWork, timer: Extract<OfflineOperation, { kind: "timer" }> | null, operations: readonly OfflineOperation[], timezone?: string): string {
  if (executionTimeMinutes(work.firstInProgressTime) !== null) return work.firstInProgressTime!;
  let current = timer;
  let startedAt: string | undefined;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.payload.status === "in_progress" && current.payload.recordedAt) startedAt = current.payload.recordedAt;
    const previous = operations.find(operation => operation.id === current?.payload.previousOperationId);
    current = previous?.kind === "timer" && previous.scope.groupId === timer?.scope.groupId && previous.scope.workId === timer.scope.workId
      && previous.scope.companyBranchId === timer.scope.companyBranchId && previous.scope.startDate === timer.scope.startDate ? previous : null;
  }
  if (startedAt && timezone && Number.isFinite(Date.parse(startedAt))) {
    try { return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(startedAt)); }
    catch { return executionStartTime(work); }
  }
  return executionStartTime(work);
}

export function manualDurationCompletion(dates: string[], hours: string, minutes: string, start: string, range: DateRange, work: AssignmentWork, status: "completed" | "delivered" = "delivered") {
  if (!/^\d{1,3}$/.test(hours) || !/^\d{1,2}$/.test(minutes) || Number(hours) > 743 || Number(minutes) > 59) {
    return { input: null, error: "Selecciona una duración válida en horas y minutos.", minutes: 0 };
  }
  const total = Number(hours) * 60 + Number(minutes);
  if (executionTimeMinutes(start) === null) return { input: null, error: "Selecciona la hora real de inicio para registrar esta duración.", minutes: total };
  const timing = automaticExecutionTiming({ ...work, firstInProgressTime: start }, total * 60);
  if (!timing) return { input: null, error: "La duración debe ser mayor que cero y terminar dentro de 30 días.", minutes: 0 };
  return manualCompletion(dates, timing.executionStartTime, timing.executionEndTime, timing.endDateOffset, range, status, work);
}