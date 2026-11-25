import type { AssignmentGroup, Assignments, AssignmentWork, Session } from "../domain/models";
import type { OfflineAssignmentGroup, OfflineAssignmentWork, OfflineOperation } from "../domain/offline";
import { creationExpectedMinutes, maintenanceDisplayTitle, workPriority } from "../domain/creation";

function localGroup(operation: Extract<OfflineOperation, { kind: "create" }>, session: Session): OfflineAssignmentGroup {
  const { input, result } = operation;
  const schedule = input.schedule;
  const title = input.kind === "work" ? input.work.title : input.kind === "maintenance" ? maintenanceDisplayTitle(input.maintenance) : input.nonProductive.reasonText ?? input.nonProductive.reason;
  const summary = input.kind === "work" ? input.work.summary : input.kind === "maintenance" ? input.maintenance.motive : input.nonProductive.initialComment ?? "";
  const offline = { operationId: operation.id, status: operation.status, downloaded: true, confirmed: operation.status === "applied" };
  const work: OfflineAssignmentWork = {
    offline,
    id: result ? String(result.workId) : operation.localWorkId,
    workType: input.kind === "non_productive" ? "non_productive" : "productive",
    title, summary, specialty: "", status: "pending", priority: input.kind === "work" ? input.work.priority : input.kind === "maintenance" ? workPriority(input.maintenance.priority ?? "medium") : "low",
    scheduledDate: schedule.date, scheduledStartTime: schedule.startTime, scheduledEndTime: schedule.endTime,
    plannedMinutes: creationExpectedMinutes(schedule) ?? 0, executedMinutes: 0, elapsedSeconds: 0,
    commentsCount: 0, filesCount: 0, checklistDone: 0, checklistTotal: 0, isOverdue: false, canExecute: false, canEditDefinition: false,
    missingRequiredInfo: [operation.status === "applied" ? "OFFLINE_AWAITING_SERVER_SNAPSHOT" : "OFFLINE_PENDING_CONFIRMATION"],
    materials: [], checklists: [], responsibles: [{ id: session.user.workerId ?? session.user.id, name: `${session.user.name} ${session.user.lastnames}`.trim() }],
  };
  return {
    offline,
    id: result?.groupId ?? operation.localGroupId, type: input.kind === "maintenance" ? "internal_maintenance" : "direct_assignment",
    code: result ? "Confirmado · actualizando ficha" : "Local · pendiente", title, status: "pending", customerName: null,
    locationName: session.user.accessBranchs.find((branch) => branch.id === input.companyBranchId)?.name ?? "", locationAddress: null,
    scheduledDate: schedule.date, scheduledStartTime: schedule.startTime, scheduledEndTime: schedule.endTime,
    plannedMinutes: work.plannedMinutes, isOverdue: false, isResponsible: true, canManage: false, equipment: null, products: [], works: [work],
    ...(input.kind === "maintenance" ? { maintenanceType: input.maintenance.type } : {}),
  };
}
/** Margen cuando no se sabe cuándo se pidió la agenda (copias antiguas) o cuándo se confirmó la creación. */
export const CREATION_SNAPSHOT_MARGIN_MS = 60_000;

/** Horas (del teléfono) de la copia del día: cuándo se pidió al servidor y cuándo llegó. */
export interface SnapshotTimes { requestedAt?: number; fetchedAt?: number; }

/**
 * ¿La agenda del día ya refleja el estado del servidor posterior a confirmar la creación? Si es así y no la trae, el
 * servidor ya no la tiene para este técnico (se borró, se reasignó o la persona se quitó) y no debe seguir apareciendo.
 */
function snapshotAfterCreation(operation: Extract<OfflineOperation, { kind: "create" }>, times: SnapshotTimes): boolean {
  if (operation.appliedAt !== undefined && times.requestedAt !== undefined) return times.requestedAt > operation.appliedAt;
  return times.fetchedAt !== undefined && times.fetchedAt > (operation.appliedAt ?? operation.createdAt) + CREATION_SNAPSHOT_MARGIN_MS;
}

/** Suma a la agenda del día las creaciones del teléfono que el servidor aún no muestra (pendientes o recién confirmadas). */
export function overlayCreations(data: Assignments, date: string, operations: readonly OfflineOperation[], session: Session, snapshot: SnapshotTimes = {}): Assignments {
  const groups = data.groups.map((group) => ({ ...group, works: [...group.works] }));
  for (const operation of operations) {
    if (operation.kind !== "create" || operation.input.schedule.date !== date || operation.input.companyBranchId !== session.branchId) continue;
    if (operation.status === "applied" && snapshotAfterCreation(operation, snapshot)) continue;
    const local = localGroup(operation, session);
    const existing = groups.find((group) => group.id === local.id);
    if (!existing) groups.push(local);
    else if (!existing.works.some((work) => work.id === local.works[0].id)) existing.works.push(...local.works);
  }
  return { ...data, groups };
}