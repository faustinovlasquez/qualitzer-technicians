import type { AssignmentWork, DateRange } from "../../domain/models";
import { automaticExecutionTiming } from "../../domain/workExecution";
import { manualCompletion } from "./detailRules";

export function manualDurationCompletion(dates: string[], hours: string, minutes: string, start: string, range: DateRange, work: AssignmentWork, status: "completed" | "delivered" = "delivered") {
  if (!/^\d{1,3}$/.test(hours) || !/^\d{1,2}$/.test(minutes) || Number(hours) > 743 || Number(minutes) > 59) {
    return { input: null, error: "Selecciona una duración válida en horas y minutos.", minutes: 0 };
  }
  const total = Number(hours) * 60 + Number(minutes);
  const timing = automaticExecutionTiming({ ...work, firstInProgressTime: start }, total * 60);
  if (!timing) return { input: null, error: "La duración debe ser mayor que cero y terminar dentro de 30 días.", minutes: 0 };
  return manualCompletion(dates, timing.executionStartTime, timing.executionEndTime, timing.endDateOffset, range, status, work);
}