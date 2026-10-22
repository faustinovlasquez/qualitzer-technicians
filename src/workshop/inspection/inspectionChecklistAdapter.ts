import type { Checklist, ChecklistStep, StepAnswer } from "../../domain/models";
import { decodeInspectionAnswer, encodeInspectionAnswer, isValidInspectionResponse, type InspectionChecklist, type InspectionStep } from "../../domain/workshopInspection";

/**
 * Traduce las listas de la inspección del taller a la forma de los checklists de los trabajos, para responderlas con la
 * misma pantalla (StepEditor, ResponseInput, resumen de pasos) y volver a traducir la respuesta al formato de la web.
 */
export function inspectionChecklists(checklists: InspectionChecklist[]): Checklist[] {
  return checklists.map((checklist) => ({
    checklistId: checklist.checklistId, name: checklist.name, code: "", required: checklist.isRequired || checklist.locked,
    steps: checklist.steps.map(toStep)
  }));
}

function toStep(step: InspectionStep): ChecklistStep {
  const decoded = decodeInspectionAnswer(step, step.answer?.responseValue ?? null);
  const answered = step.answer?.responseValue != null && step.answer.responseValue !== "";
  const base: ChecklistStep = {
    stepId: step.checklistStepId, order: step.order, title: step.title, description: step.description ?? "", tag: "", type: step.type,
    options: step.options, isFilesRequired: step.isFilesRequired, isRequired: step.isRequired, isCompleted: null, selectValue: "", optionsSelectValue: [],
    responseValue: "", comment: step.answer?.comment ?? "", executionStatus: answered ? "completed" : null,
    attachments: (step.answer?.files ?? []).map((file) => ({ id: file.fileId, name: "Foto", url: file.fullUrl ?? file.url, thumbnailUrl: file.url, type: "image/jpeg" }))
  };
  if (decoded.type === "validation") {
    if (decoded.value === "not_applicable") return { ...base, selectValue: "not_applicable" };
    if (decoded.value === "false") return { ...base, isCompleted: false, executionStatus: "not_completed" };
    return { ...base, isCompleted: decoded.value === "true" ? true : null };
  }
  if (decoded.type === "select" || decoded.type === "approval") return { ...base, selectValue: decoded.value ?? "" };
  if (decoded.type === "multiselect") return { ...base, optionsSelectValue: decoded.value };
  return { ...base, responseValue: typeof decoded.value === "string" ? decoded.value : "" };
}

/** Respuesta de la pantalla de checklist en el formato que guarda la web; error en español si no es válida para la inspección. */
export function inspectionResponse(step: InspectionStep, answer: StepAnswer): string | null {
  const value = answer.responseValue;
  let encoded: string | null;
  if (step.type === "validation") encoded = value === true ? "true" : value === false ? "false" : value === "not_applicable" ? "not_applicable" : null;
  else if (step.type === "multiselect") encoded = encodeInspectionAnswer({ type: "multiselect", value: Array.isArray(value) ? value : [] });
  else if (step.type === "text" || step.type === "number") encoded = encodeInspectionAnswer({ type: step.type, value: typeof value === "string" ? value : "" });
  else encoded = typeof value === "string" && value !== "" ? value : null;
  if (step.type === "number" && encoded !== null) encoded = encoded.replace(/^\+/, "");
  if (!isValidInspectionResponse(step, encoded)) {
    throw new Error(step.type === "number" ? "Escribe un número válido, por ejemplo 1250 o 12,5." : "La respuesta no corresponde a la pregunta.");
  }
  return encoded;
}

/** Pregunta de la inspección (y su lista) a partir del paso de la pantalla de checklist. */
export function inspectionStepOf(checklists: InspectionChecklist[], stepId: number | string): { checklist: InspectionChecklist; step: InspectionStep } | null {
  for (const checklist of checklists) {
    const step = checklist.steps.find((item) => String(item.checklistStepId) === String(stepId));
    if (step) return { checklist, step };
  }
  return null;
}
