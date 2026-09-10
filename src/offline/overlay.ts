import type { AssignmentGroup, Assignments, AssignmentWork, Session } from "../domain/models";
import type { OfflineAssignmentGroup, OfflineAssignmentWork, OfflineOperation } from "../domain/offline";

function localGroup(operation: Extract<OfflineOperation, { kind: "create" }>, session: Session): OfflineAssignmentGroup {
  const { input, result } = operation;
  const schedule = input.schedule;
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  const title = input.kind === "work" ? input.work.title : input.kind === "maintenance" ? input.maintenance.title : input.nonProductive.reasonText ?? input.nonProductive.reason;
  const summary = input.kind === "work" ? input.work.summary : input.kind === "maintenance" ? input.maintenance.motive : input.nonProductive.initialComment ?? "";
  const offline = { operationId: operation.id, status: operation.status, downloaded: true, confirmed: operation.status === "applied" };
  const work: OfflineAssignmentWork = {
    offline,
    id: result ? String(result.workId) : operation.localWorkId,
    workType: input.kind === "non_productive" ? "non_productive" : "productive",
    title, summary, specialty: "", status: "pending", priority: input.kind === "work" ? input.work.priority : input.kind === "maintenance" ? input.maintenance.priority ?? "medium" : "low",
    scheduledDate: schedule.date, scheduledStartTime: schedule.startTime, scheduledEndTime: schedule.endTime,
    plannedMinutes: minutes(schedule.endTime) - minutes(schedule.startTime), executedMinutes: 0, elapsedSeconds: 0,
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
export function overlayCreations(data: Assignments, date: string, operations: readonly OfflineOperation[], session: Session): Assignments {
  const groups = data.groups.map((group) => ({ ...group, works: [...group.works] }));
  for (const operation of operations) {
    if (operation.kind !== "create" || operation.input.schedule.date !== date || operation.input.companyBranchId !== session.branchId) continue;
    const local = localGroup(operation, session);
    const existing = groups.find((group) => group.id === local.id);
    if (!existing) groups.push(local);
    else if (!existing.works.some((work) => work.id === local.works[0].id)) existing.works.push(...local.works);
  }
  return { ...data, groups };
}