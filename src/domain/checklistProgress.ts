import type { ChecklistStep, Choice, StepAnswer } from "./models";

export interface ChecklistFillProgress {
  total: number;
  completed: number;
  remaining: number;
  percentage: number;
}

const approvalOptions: Choice[] = [
  { value: "approved", label: "Aprobado" },
  { value: "rejected", label: "Rechazado" },
  { value: "not_applicable", label: "No aplica" },
];

export function checklistStepOptions(step: Pick<ChecklistStep, "type" | "options">): readonly Choice[] {
  return step.type === "approval" && step.options.length === 0 ? approvalOptions : step.options;
}

export function hasChecklistStepAnswer(step: ChecklistStep): boolean {
  switch (step.type) {
    case "validation": return typeof step.isCompleted === "boolean" || step.selectValue === "not_applicable";
    case "select":
    case "approval": return (step.selectValue ?? "").trim() !== "";
    case "multiselect": return (step.optionsSelectValue ?? []).length > 0;
    default: return (step.responseValue ?? "").trim() !== "";
  }
}

export function isChecklistStepProgressRelevant(step: Pick<ChecklistStep, "type" | "isRequired">): boolean {
  return step.type !== "text" && step.isRequired !== false;
}

export function isChecklistStepSatisfied(step: ChecklistStep): boolean {
  if (step.type === "text") return true;
  const answered = hasChecklistStepAnswer(step);
  if (step.isRequired === false && !answered) return true;
  if (step.isFilesRequired === true && answered && (step.attachments ?? []).length === 0) return false;
  return step.isRequired === false || answered;
}

export function checklistFillProgress(steps: readonly ChecklistStep[]): ChecklistFillProgress {
  const relevant = steps.filter(isChecklistStepProgressRelevant);
  const total = relevant.length;
  const completed = relevant.filter(isChecklistStepSatisfied).length;
  return { total, completed, remaining: total - completed, percentage: total > 0 ? Math.round(completed / total * 100) : 0 };
}

function hasResponse(value: StepAnswer["responseValue"]): boolean {
  return typeof value === "boolean" || (typeof value === "string" && value.trim() !== "") || (Array.isArray(value) && value.length > 0);
}

export function normalizeChecklistAnswer(step: ChecklistStep, answer: StepAnswer): StepAnswer {
  const value = hasResponse(answer.responseValue) ? answer.responseValue : null;
  const answered = hasResponse(value);
  const completed = step.type === "validation" ? value === true : answered;
  return { ...answer, responseValue: value, isCompleted: completed, executionStatus: completed ? "completed" : value === "not_applicable" ? null : answered ? "not_completed" : null };
}

export function checklistAnswerError(step: ChecklistStep, answer: StepAnswer): string | null {
  const value = answer.responseValue;
  if (!["validation", "text", "number", "select", "multiselect", "approval"].includes(step.type)) return "Este tipo de respuesta no está disponible en esta aplicación.";
  if (!hasResponse(value)) return isChecklistStepProgressRelevant(step) ? "Completa una respuesta válida antes de guardar. Puedes pasar a otro paso sin guardar." : null;
  const options = checklistStepOptions(step);
  let valid: boolean;
  switch (step.type) {
    case "validation": valid = typeof value === "boolean" || value === "not_applicable"; break;
    case "text": valid = typeof value === "string"; break;
    case "number": valid = typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value) && Number.isFinite(Number(value)); break;
    case "select":
    case "approval": valid = typeof value === "string" && options.some((option) => option.value === value); break;
    case "multiselect": valid = Array.isArray(value) && new Set(value.map((option) => option.value)).size === value.length && value.every((option) => options.some((candidate) => candidate.value === option.value)); break;
    default: return "Este tipo de respuesta no está disponible en esta aplicación.";
  }
  if (!valid) return step.type === "number" ? "Ingresa un número válido; usa punto para los decimales." : "Selecciona una respuesta válida con las opciones de esta asignación.";
  if (step.type === "validation" && typeof value === "boolean" && (answer.isCompleted !== value || (value === false && answer.executionStatus !== "not_completed"))) return "La validación negativa debe conservarse como no completada.";
  if (step.type !== "text" && step.isFilesRequired === true && (step.attachments ?? []).length === 0) return "Falta evidencia confirmada para este paso. Adjunta los archivos y actualiza la asignación; el borrador se conserva.";
  return null;
}