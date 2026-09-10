import type { AssignmentWork, ChecklistStep, DateRange, StepAnswer, WorkStatus } from "./models";

export const STATUS_LABELS: { [K in WorkStatus]: string } = {
  pending: "Pendiente", in_progress: "En curso", paused: "En pausa", completed: "Completado", delivered: "Entregado",
};
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function shiftDate(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}
export function weekRange(day = dateKey()): DateRange {
  const date = new Date(`${day}T12:00:00`);
  const startDate = shiftDate(day, -((date.getDay() + 6) % 7));
  return { startDate, endDate: shiftDate(startDate, 6) };
}
export function duration(minutes: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  return safe >= 60 ? `${Math.floor(safe / 60)} h ${safe % 60 ? `${safe % 60} min` : ""}`.trim() : `${safe} min`;
}
export function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3600), Math.floor(safe / 60) % 60, safe % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
export function shortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : date.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}
export function isFinished(work: AssignmentWork): boolean { return work.status === "completed" || work.status === "delivered"; }
export function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
export function answerFromStep(step: ChecklistStep): StepAnswer {
  let responseValue: StepAnswer["responseValue"] = step.responseValue;
  if (step.type === "validation") responseValue = step.selectValue === "not_applicable" ? "not_applicable" : step.isCompleted;
  if (step.type === "select" || step.type === "approval") responseValue = step.selectValue;
  if (step.type === "multiselect") responseValue = step.optionsSelectValue;
  return { responseValue, isCompleted: step.isCompleted === true, comment: step.comment, executionStatus: step.executionStatus };
}