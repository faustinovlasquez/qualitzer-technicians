import { isChecklistStepSatisfied } from "../../../domain/checklistProgress";
import type { AssignmentGroup } from "../../../domain/models";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput, MaintenanceFaultType } from "../../../domain/orderLifecycle";
import { ApiError } from "../../../infrastructure/errors";
import { hasSignature, type SignatureStrokes } from "./signatureGeometry";

export interface DeliveryDraft {
  note: string;
  hours: string;
  minutes: string;
  faultType: MaintenanceFaultType | null;
  receivedByName: string;
  technicianStrokes: SignatureStrokes;
  clientStrokes: SignatureStrokes;
}

export interface DeliveryErrors {
  note?: string;
  duration?: string;
  faultType?: string;
  receivedByName?: string;
  technicianSignature?: string;
  clientSignature?: string;
}

export const DELIVERY_NOTE_LIMIT = 10000;
export const DELIVERY_RECEIVER_LIMIT = 200;

export function requiresClientSignature(maintenanceType: string | null | undefined): boolean {
  const type = (maintenanceType ?? "").toLowerCase();
  return type === "correctivo" || type === "detencion";
}

export function visibleMaintenanceWorks(group: AssignmentGroup) {
  return group.works.filter((work) => !["Productos (supervisor)", "Productos utilizados"].includes(work.title.trim()));
}

export function suggestedDurationMinutes(group: AssignmentGroup): number {
  return Math.round(visibleMaintenanceWorks(group).reduce((total, work) => {
    const recorded = Math.max(0, work.totalExecutedMinutes ?? work.executedMinutes) * 60;
    if (work.status === "in_progress" || work.status === "paused") {
      const elapsed = Math.max(0, work.elapsedSeconds);
      return total + (group.type === "internal_maintenance" ? Math.max(recorded, elapsed) : recorded + elapsed);
    }
    return total + (work.status === "completed" || work.status === "delivered" ? recorded : 0);
  }, 0) / 60);
}

export function incompleteDeliveryChecklists(group: AssignmentGroup): string[] {
  return visibleMaintenanceWorks(group).flatMap((work) => work.checklists
    .filter((checklist) => checklist.required === true && !checklist.steps.every(isChecklistStepSatisfied))
    .map((checklist) => `${work.title} — ${checklist.name}`));
}

export function initialDeliveryDraft(group: AssignmentGroup, context: MaintenanceDeliveryContext): DeliveryDraft {
  const minutes = context.durationMinutes !== null && context.durationMinutes > 0
    ? context.durationMinutes : context.suggestedDurationMinutes ?? suggestedDurationMinutes(group);
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  return {
    note: context.finalizationNote ?? "",
    hours: String(Math.floor(safeMinutes / 60)),
    minutes: String(safeMinutes % 60),
    faultType: context.damageType === "operacional" ? "operative" : context.damageType === "desgaste" ? "wear" : null,
    receivedByName: "",
    technicianStrokes: [],
    clientStrokes: [],
  };
}

export function deliveryDraftErrors(draft: DeliveryDraft, clientRequired: boolean): DeliveryErrors {
  const errors: DeliveryErrors = {};
  if (draft.note.length > DELIVERY_NOTE_LIMIT) errors.note = "Las observaciones admiten hasta 10.000 caracteres.";
  if (!/^\d{0,2}$/.test(draft.hours) || !/^\d{0,2}$/.test(draft.minutes) || Number(draft.minutes) > 59) errors.duration = "Ingresa de 0 a 99 horas y de 0 a 59 minutos, sin decimales.";
  if (!hasSignature(draft.technicianStrokes)) errors.technicianSignature = "Falta la firma del técnico. Dibuja un trazo, no solo un punto.";
  if (clientRequired) {
    if (draft.faultType !== "operative" && draft.faultType !== "wear") errors.faultType = "Selecciona falla operacional o desgaste.";
    if (!draft.receivedByName.trim() || draft.receivedByName.trim().length > DELIVERY_RECEIVER_LIMIT) errors.receivedByName = "Ingresa el nombre de quien recibe (máximo 200 caracteres).";
    if (!hasSignature(draft.clientStrokes)) errors.clientSignature = "Falta la firma de quien recibe.";
  }
  return errors;
}

export function deliveryInput(draft: DeliveryDraft, clientRequired: boolean, technicianSignature: string, clientSignature: string | null): MaintenanceDeliveryInput {
  const minutes = Number(draft.hours) * 60 + Number(draft.minutes);
  return {
    note: draft.note.trim() || null,
    durationMinutes: minutes > 0 ? minutes : null,
    faultType: clientRequired ? draft.faultType : null,
    receivedByName: clientRequired ? draft.receivedByName.trim() : null,
    technicianSignature,
    clientSignature: clientRequired ? clientSignature : null,
  };
}

export function lifecycleError(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : "";
  const checklistPrefix = "REQUIRED_CHECKLISTS_INCOMPLETE:";
  if (code.includes(checklistPrefix)) return `Completa y guarda los checklists obligatorios antes de entregar: ${code.slice(code.indexOf(checklistPrefix) + checklistPrefix.length)}. El borrador se conserva.`;
  if (error instanceof ApiError && (error.status >= 500 || error.code === "UPSTREAM_TIMEOUT")) return "No se pudo confirmar el resultado. Actualiza el estado de la OT antes de repetir la entrega: podría haberse guardado. El borrador se conserva.";
  return error instanceof Error && error.message.trim() ? error.message : "No se pudo completar la operación. El borrador se conserva.";
}