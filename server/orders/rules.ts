import type { ChecklistStep, WorkStatus } from "../../src/domain/models";
import { isChecklistStepSatisfied } from "../../src/domain/checklistProgress";
import { GatewayError } from "../errors";
import type { OrderScope } from "./authorization";
import type { MaintenanceStatus, MaintenanceStep, OrderDeliveryContext } from "./contracts";
import { faultTypeSchema } from "./contracts";
import { MAX_SIGNATURE_BYTES, type OrderDeliveryInput } from "./validation";

const productContainers = new Set(["Productos (supervisor)", "Productos utilizados"]);

export function maintenanceStatus(status: MaintenanceStatus): WorkStatus {
  switch (status) {
    case "por_planificar":
    case "planificada": return "pending";
    case "en_progreso": return "in_progress";
    case "entrega_tecnico": return "delivered";
    case "finalizada": return "completed";
  }
}

function checklistStep(step: MaintenanceStep): ChecklistStep {
  const response = step.responseValue;
  const hasResponse = response !== null && response !== "";
  return {
    stepId: step.id, type: step.type, order: 0, title: "", description: "", tag: "", options: [],
    isFilesRequired: step.isFilesRequired,
    isCompleted: step.type === "validation" && response !== "not_applicable"
      ? hasResponse ? Boolean(response) : step.isCompleted === true ? true : null
      : null,
    selectValue: hasResponse && (step.type === "select" || step.type === "approval" || response === "not_applicable") ? String(response) : "",
    optionsSelectValue: step.type === "multiselect" && Array.isArray(response) ? response : [],
    responseValue: hasResponse ? String(response) : "", comment: "", executionStatus: null,
    attachments: step.files.map((file) => ({ id: file.id, name: "", url: "" })),
  };
}

export function incompleteChecklists(scope: OrderScope, requiredOnly = true): string[] {
  const incomplete = new Set<string>();
  for (const work of scope.detail.works) {
    if (productContainers.has(work.title.trim())) continue;
    for (const checklist of work.checklists) {
      if ((!requiredOnly || checklist.isRequired) && !checklist.steps.every((step) => isChecklistStepSatisfied(checklistStep(step)))) {
        incomplete.add(`${work.title} — ${checklist.name ?? `Checklist #${checklist.checklistId ?? "-"}`}`);
      }
    }
  }
  for (const work of scope.group.works) {
    if (productContainers.has(work.title.trim())) continue;
    for (const checklist of work.checklists) {
      if ((!requiredOnly || checklist.required === true) && !checklist.steps.every(isChecklistStepSatisfied)) incomplete.add(`${work.title} — ${checklist.name}`);
    }
  }
  return [...incomplete];
}

function isFinal(scope: OrderScope): boolean {
  return scope.detail.isArchived || scope.group.status === "completed" || scope.group.status === "delivered";
}

export function assertStart(scope: OrderScope): void {
  if (isFinal(scope)) throw new GatewayError(409, "ORDER_READ_ONLY");
  if (scope.group.status !== "pending") throw new GatewayError(409, "ORDER_NOT_PENDING");
}

function requiresClient(scope: OrderScope): boolean { return scope.detail.type === "correctivo" || scope.detail.type === "detencion"; }

export function assertDelivery(scope: OrderScope, input: OrderDeliveryInput): void {
  if (isFinal(scope)) throw new GatewayError(409, "ORDER_READ_ONLY");
  if (input.acknowledgeDelivery === true) {
    if (input.clientSignature !== null || input.receivedByName !== null || input.faultType !== null) throw new GatewayError(400, "CLIENT_DELIVERY_FIELDS_NOT_APPLICABLE");
    return;
  }
  const incomplete = incompleteChecklists(scope);
  if (incomplete.length) throw new GatewayError(400, "REQUIRED_CHECKLISTS_INCOMPLETE", `Completa todos los checklists obligatorios: ${incomplete.join(", ")}`);
  if (requiresClient(scope)) {
    if (input.faultType === null) throw new GatewayError(400, "FAULT_TYPE_REQUIRED");
    if (!input.receivedByName) throw new GatewayError(400, "RECEIVED_BY_NAME_REQUIRED");
    if (input.clientSignature === null) throw new GatewayError(400, "CLIENT_SIGNATURE_REQUIRED");
  } else if (input.faultType !== null || input.receivedByName !== null || input.clientSignature !== null) {
    throw new GatewayError(400, "CLIENT_DELIVERY_FIELDS_NOT_APPLICABLE");
  }
}

export function deliveryContext(scope: OrderScope): OrderDeliveryContext {
  const incomplete = incompleteChecklists(scope);
  const seconds = scope.group.works.filter((work) => !productContainers.has(work.title.trim())).reduce((total, work) => {
    const recorded = Math.max(0, work.totalExecutedMinutes ?? work.executedMinutes) * 60;
    if (work.status === "in_progress" || work.status === "paused") return total + Math.max(recorded, Math.max(0, work.elapsedSeconds));
    return total + (work.status === "completed" || work.status === "delivered" ? recorded : 0);
  }, 0);
  if (scope.user.workerId === null) throw new GatewayError(403, "WORKER_REQUIRED");
  return {
    groupId: scope.group.id, maintenanceId: scope.maintenanceId, companyBranchId: scope.range.companyBranchId,
    generatedAt: scope.generatedAt, status: scope.group.status, maintenanceType: scope.detail.type,
    finalizationNote: scope.detail.finalizationNote, damageType: scope.detail.damageType,
    durationMinutes: scope.detail.durationMinutes, startedAt: scope.detail.startedAt ?? null, finalizedAt: scope.detail.finalizedAt,
    incompleteChecklists: incomplete, suggestedDurationMinutes: Math.round(seconds / 60),
    technicianDeliverySupported: true, canTechnicianDeliver: !isFinal(scope),
    totalWorks: scope.detail.works.filter(work => !productContainers.has(work.title.trim())).length,
    pendingWorkNames: scope.detail.works.filter(work => !productContainers.has(work.title.trim()) && (work.status !== undefined
      ? work.status !== "entrega_tecnico" : scope.group.works.find(candidate => Number(candidate.id) === work.id)?.status !== "delivered")).map(work => work.title),
    pendingDeliveryChecklists: incompleteChecklists(scope, false),
    canStart: !isFinal(scope) && scope.group.status === "pending", canDeliver: !isFinal(scope) && incomplete.length === 0,
    requiresClientSignature: requiresClient(scope), faultTypes: [...faultTypeSchema.options], maxSignatureBytes: MAX_SIGNATURE_BYTES,
    technician: { userId: scope.user.id, workerId: scope.user.workerId, name: `${scope.user.name} ${scope.user.lastnames}`.trim() },
    signatures: scope.detail.signatures.map((signature) => ({
      id: signature.id, role: signature.role, signedBy: signature.signedBy, signedByName: signature.signedByName,
      signedAt: signature.signedAt, hasSignature: Boolean(signature.signatureUrl),
    })),
  };
}