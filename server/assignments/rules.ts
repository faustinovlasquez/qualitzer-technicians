import type { ChecklistStep, StepAnswer, StatusInput } from "../../src/domain/models";
import { checklistStepOptions, hasChecklistStepAnswer, isChecklistStepSatisfied, normalizeChecklistAnswer } from "../../src/domain/checklistProgress";
import { automaticExecutionTiming, canTransitionExecution, executionDatesAllowed, executionDuration, executionIntervalCovered, isExecutionFinalization } from "../../src/domain/workExecution";
import type { OwnedWork } from "./authorization";
import { GatewayError } from "../errors";

export function stepAnswered(step: ChecklistStep): boolean {
  return hasChecklistStepAnswer(step);
}

export function validateAnswer(step: ChecklistStep, answer: StepAnswer): StepAnswer {
  const value = answer.responseValue;
  let valid = value === null;
  let hasAnswer = false;
  const options = checklistStepOptions(step);
  const option = (candidate: string): boolean => options.some((item) => item.value === candidate);
  switch (step.type) {
    case "validation":
      valid = valid || typeof value === "boolean" || value === "not_applicable";
      hasAnswer = typeof value === "boolean" || value === "not_applicable";
      if (typeof value === "boolean" && answer.isCompleted !== value) valid = false;
      if (value === false && answer.executionStatus === "completed") valid = false;
      if (value === "not_applicable" && (answer.isCompleted || answer.executionStatus === "completed")) valid = false;
      break;
    case "select":
    case "approval":
      valid = valid || (typeof value === "string" && (value === "" || option(value)));
      hasAnswer = typeof value === "string" && value !== "" && option(value);
      break;
    case "multiselect":
      valid = valid || (Array.isArray(value) && value.every((item) => option(item.value)) && new Set(value.map((item) => item.value)).size === value.length);
      hasAnswer = Array.isArray(value) && value.length > 0;
      break;
    case "number":
      valid = valid || (typeof value === "string" && (value === "" || (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value) && Number.isFinite(Number(value)))));
      hasAnswer = typeof value === "string" && value.trim() !== "";
      break;
    case "text":
      valid = valid || typeof value === "string";
      hasAnswer = typeof value === "string" && value.trim() !== "";
  }
  if (!valid || (!hasAnswer && (answer.isCompleted || answer.executionStatus === "completed"))) {
    throw new GatewayError(400, "INVALID_STEP_ANSWER", "La respuesta no corresponde al tipo u opciones del paso.");
  }
  const normalized = normalizeChecklistAnswer(step, {
    ...answer,
    responseValue: Array.isArray(value) ? value.map((item) => ({ value: item.value, label: options.find((candidate) => candidate.value === item.value)?.label ?? "" })) : value,
  });
  if (step.type !== "text" && step.isFilesRequired && (normalized.isCompleted || normalized.executionStatus === "completed") && step.attachments.length === 0) {
    throw new GatewayError(400, "STEP_FILES_REQUIRED");
  }
  return normalized;
}

export function validateStatus(scope: OwnedWork, input: StatusInput): StatusInput {
  const normalized = validateStatusScope(scope, input);
  if (!isExecutionFinalization(input.status)) return normalized;
  const execution = resolveExecutionTimes(scope, normalized);
  if ((execution.executionDates?.length ?? 0) > 1 && !executionIntervalCovered(execution.executionDates!, execution.endDateOffset ?? 0)) {
    throw new GatewayError(400, "EXECUTION_INTERVAL_DATES_REQUIRED", "Selecciona también todos los días del intervalo nocturno; no se añadirán fechas implícitas.");
  }
  return execution;
}

export function validateStatusScope(scope: OwnedWork, input: StatusInput): StatusInput {
  if (!scope.work.canExecute) throw new GatewayError(409, "WORK_CANNOT_EXECUTE");
  if (!canTransitionExecution(scope.work, input.status)) throw new GatewayError(409, "INVALID_STATUS_TRANSITION");
  const executionDates = [...(input.executionDates ?? [scope.range.startDate])].sort();
  if (executionDates.length > 1 && (scope.maintenanceId !== null || !isExecutionFinalization(input.status))) throw new GatewayError(400, "SINGLE_EXECUTION_DATE_REQUIRED");
  if (!executionDatesAllowed(scope.work, scope.range, executionDates, scope.maintenanceId !== null)) throw new GatewayError(400, "EXECUTION_DATES_OUTSIDE_RANGE");
  if (!isExecutionFinalization(input.status)) {
    if (executionDates[0] !== scope.range.startDate) throw new GatewayError(400, "EXECUTION_DATES_OUTSIDE_RANGE");
    if (input.executionStartTime !== undefined || input.executionEndTime !== undefined || input.endDateOffset !== undefined || input.isManual !== undefined) {
      throw new GatewayError(400, "EXECUTION_TIMES_ONLY_ON_COMPLETION");
    }
    return { status: input.status, executionDates };
  }
  if (input.isManual === true && !scope.allowEditExecutionTime) throw new GatewayError(403, "MANUAL_EXECUTION_TIME_FORBIDDEN");
  for (const checklist of scope.work.checklists) {
    if (checklist.steps.some((step) => step.isFilesRequired && step.attachments.length === 0)) throw new GatewayError(400, "STEP_FILES_REQUIRED");
    if (checklist.required === true && !checklist.steps.every(isChecklistStepSatisfied)) throw new GatewayError(400, "REQUIRED_CHECKLISTS_INCOMPLETE");
  }
  return { ...input, executionDates };
}

function resolveExecutionTimes(scope: OwnedWork, input: StatusInput): StatusInput {
  const hasTimes = input.executionStartTime !== undefined || input.executionEndTime !== undefined;
  const manual = input.isManual === true || (input.isManual === undefined && hasTimes && scope.allowEditExecutionTime);
  if (manual && !scope.allowEditExecutionTime) throw new GatewayError(403, "MANUAL_EXECUTION_TIME_FORBIDDEN", "La sucursal no permite editar el tiempo de ejecución.");
  if (hasTimes || manual) {
    if (!input.executionStartTime || !input.executionEndTime) throw new GatewayError(400, "EXECUTION_TIMES_AND_DATES_REQUIRED");
    if (executionDuration(input) === null) throw new GatewayError(400, "INVALID_EXECUTION_DURATION");
  } else if (input.endDateOffset !== undefined) {
    throw new GatewayError(400, "EXECUTION_TIMES_AND_DATES_REQUIRED");
  }
  if (manual) return { ...input, endDateOffset: input.endDateOffset ?? 0, isManual: true };
  const timing = automaticExecutionTiming(scope.work);
  if (hasTimes && (timing === null || input.executionStartTime !== timing.executionStartTime || input.executionEndTime !== timing.executionEndTime || (input.endDateOffset ?? 0) !== timing.endDateOffset)) {
    throw new GatewayError(403, "MANUAL_EXECUTION_TIME_FORBIDDEN", "Las horas no coinciden con el cronómetro confirmado. Actualiza la asignación o entrega sin horas manuales.");
  }
  if (scope.maintenanceId !== null) return { status: input.status, executionDates: input.executionDates, isManual: false };
  if (timing === null) throw new GatewayError(400, "EXECUTION_TIMER_REQUIRED", "Inicia el cronómetro antes de entregar o registra horas manuales si tu sucursal lo permite.");
  if (timing.minutes <= 0) throw new GatewayError(400, "INVALID_EXECUTION_DURATION", "El cronómetro aún no registra un minuto redondeado. Espera o registra horas manuales si está permitido.");
  return {
    status: input.status, executionDates: input.executionDates,
    executionStartTime: timing.executionStartTime, executionEndTime: timing.executionEndTime, endDateOffset: timing.endDateOffset, isManual: false,
  };
}