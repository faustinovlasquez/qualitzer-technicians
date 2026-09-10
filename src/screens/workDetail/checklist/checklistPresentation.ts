import { checklistStepOptions, hasChecklistStepAnswer, isChecklistStepProgressRelevant, isChecklistStepSatisfied } from "../../../domain/checklistProgress";
import { plainText } from "../../../domain/format";
import type { ChecklistStep, StepAnswer } from "../../../domain/models";
import type { BadgeTone } from "../../../ui/components";

export function checklistAnswerLabel(step: ChecklistStep, answer: StepAnswer): string {
  const value = answer.responseValue;
  if (typeof value === "boolean") return value ? "Sí" : "No · validación negativa";
  if (value === "not_applicable") return "No aplica";
  const options = checklistStepOptions(step);
  if (Array.isArray(value)) return value.map((item) => plainText(options.find((option) => option.value === item.value)?.label ?? item.label)).join(", ") || "Sin respuesta";
  if (typeof value === "string" && value.trim()) return plainText(options.find((option) => option.value === value)?.label ?? value);
  return "Sin respuesta";
}

export function checklistStepStatus(step: ChecklistStep): { label: string; tone: BadgeTone } {
  if (hasChecklistStepAnswer(step)) {
    if (!isChecklistStepSatisfied(step)) return { label: "Falta evidencia", tone: "warning" };
    return { label: "Respuesta confirmada", tone: "info" };
  }
  if (step.type === "text") return { label: "Informativo", tone: "neutral" };
  return isChecklistStepProgressRelevant(step) ? { label: "Sin responder", tone: "neutral" } : { label: "Opcional", tone: "neutral" };
}