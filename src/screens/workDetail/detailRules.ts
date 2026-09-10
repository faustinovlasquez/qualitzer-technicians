import { answerFromStep, dateKey, isFinished } from "../../domain/format";
import { checklistAnswerError, hasChecklistStepAnswer, isChecklistStepSatisfied, normalizeChecklistAnswer } from "../../domain/checklistProgress";
import { executionDatesAllowed, executionDuration, executionIntervalCovered, MAX_EXECUTION_DATES } from "../../domain/workExecution";
import type { AssignmentGroup, AssignmentWork, Attachment, ChecklistStep, DateRange, StepAnswer, StatusInput } from "../../domain/models";

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "No se pudo completar la operación. Los cambios pendientes se conservan.";
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && dateKey(date) === value;
}

export function withinRange(value: string, range: DateRange): boolean {
  return validDate(value) && validDate(range.startDate) && validDate(range.endDate) && value >= range.startDate && value <= range.endDate;
}

export function executionDate(work: AssignmentWork, range: DateRange): string {
  const scheduled = work.scheduledDate.slice(0, 10);
  return withinRange(scheduled, range) ? scheduled : withinRange(dateKey(), range) ? dateKey() : range.startDate;
}

export function readOnlyWork(_group: AssignmentGroup, work: AssignmentWork): boolean {
  return isFinished(work);
}

export function stepAnswered(step: ChecklistStep): boolean {
  return hasChecklistStepAnswer(step);
}

export function answerSignature(step: ChecklistStep): string {
  return JSON.stringify(answerFromStep(step));
}

export function changedAnswer(step: ChecklistStep, current: StepAnswer, value: StepAnswer["responseValue"]): StepAnswer {
  return normalizeChecklistAnswer(step, { ...current, responseValue: value });
}

export function answerError(step: ChecklistStep, answer: StepAnswer): string | null {
  return checklistAnswerError(step, answer);
}

export function completionReasons(group: AssignmentGroup, work: AssignmentWork, files: Attachment[] | null, filesError: string | null): string[] {
  const reasons: string[] = [];
  if (readOnlyWork(group, work)) reasons.push("La asignación está cerrada y es de solo lectura.");
  if (!work.canExecute) reasons.push("Qualitzer no habilita la ejecución de este trabajo.");
  for (const checklist of work.checklists) {
    if (checklist.required === true && !checklist.steps.every(isChecklistStepSatisfied)) reasons.push(`Completa y guarda las respuestas de «${checklist.name}».`);
    for (const step of checklist.steps) {
      if (step.isFilesRequired && step.attachments.length === 0) reasons.push(`Falta evidencia confirmada: ${step.title}.`);
    }
  }
  if (work.isFilesRequired && (filesError !== null || files === null)) reasons.push("Actualiza las evidencias para verificar los archivos obligatorios.");
  else if (work.isFilesRequired && files?.length === 0) reasons.push("Adjunta al menos una evidencia al trabajo.");
  return reasons;
}

export function manualCompletion(date: string | string[], start: string, end: string, nextDay: boolean | number, range: DateRange, status: "completed" | "delivered" = "delivered", work?: AssignmentWork): { input: StatusInput | null; error: string | null; minutes: number } {
  const invalid = (error: string) => ({ input: null, error, minutes: 0 });
  const dates = (typeof date === "string" ? [date] : [...date]).sort();
  if (!(work ? executionDatesAllowed(work, range, dates) : dates.length === 1 && withinRange(dates[0]!, range))) return invalid(`Selecciona de 1 a ${MAX_EXECUTION_DATES} fechas válidas; varias fechas deben pertenecer a la planificación de este trabajo.`);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)) return invalid("Ingresa inicio y término en formato HH:mm (00:00 a 23:59).");
  const endDateOffset = typeof nextDay === "number" ? nextDay : nextDay ? 1 : 0;
  if (!Number.isInteger(endDateOffset) || endDateOffset < 0 || endDateOffset > 30) return invalid("El término puede estar entre 0 y 30 días después del inicio.");
  if (dates.length > 1 && !executionIntervalCovered(dates, endDateOffset)) return invalid("Selecciona también todos los días del intervalo nocturno. No se añadirán fechas automáticamente.");
  const input: StatusInput = { status, executionDates: dates, executionStartTime: start, executionEndTime: end, endDateOffset, isManual: true };
  const minutes = executionDuration(input);
  if (minutes === null) return invalid("La duración debe ser positiva. Si cruzaste medianoche, indica los días transcurridos.");
  return { input, error: null, minutes };
}

export function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}