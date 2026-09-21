import { z } from "zod";
import type { Assignments, AssignmentWork, Attachment } from "../domain/models";
import type { OfflineScope } from "../domain/offline";

const nullableText = z.string().nullable();
const resourceId = z.union([z.string(), z.number()]);
const choice = z.object({ value: z.string(), label: z.string() });
export const cachedAttachmentSchema: z.ZodType<Attachment> = z.object({
  id: resourceId, name: z.string(), url: z.string(), thumbnailUrl: nullableText.optional(), thumbnailPath: nullableText.optional(),
  type: nullableText.optional(), size: z.number().nonnegative().optional(), unit: z.string().optional(), folderId: resourceId.nullish(), createdAt: nullableText.optional(),
  responsible: z.object({ id: z.number(), name: z.string(), avatarThumbnail: nullableText.optional() }).nullish(),
});
const step = z.object({
  stepId: resourceId, order: z.number(), title: z.string(), description: z.string(), tag: z.string(),
  type: z.enum(["validation", "text", "number", "select", "multiselect", "approval"]), options: z.array(choice),
  isFilesRequired: z.boolean(), isRequired: z.boolean().optional(), isCompleted: z.boolean().nullable(), selectValue: z.string(),
  optionsSelectValue: z.array(choice), responseValue: z.string(), comment: z.string(),
  executionStatus: z.enum(["completed", "partial", "not_completed"]).nullable(), attachments: z.array(cachedAttachmentSchema),
});
const material = z.object({ id: z.string(), name: z.string(), ref: nullableText, quantity: z.number(), stockStatus: z.enum(["in_stock", "requested", "reserved"]) });
const equipment = z.object({ label: z.string(), identifier: z.string(), internalNumber: nullableText, ownerLabel: nullableText });
const status = z.enum(["pending", "in_progress", "paused", "completed", "delivered"]);
const work: z.ZodType<AssignmentWork> = z.lazy(() => z.object({
  id: z.string(), workType: z.enum(["productive", "non_productive"]), title: z.string(), summary: z.string(), specialty: z.string(),
  status, priority: z.enum(["low", "medium", "high"]), scheduledDate: z.string(), scheduledStartTime: z.string(), scheduledEndTime: z.string(),
  plannedMinutes: z.number(), executedMinutes: z.number(), elapsedSeconds: z.number(), totalPlannedMinutes: z.number().optional(), totalExecutedMinutes: z.number().optional(),
  firstInProgressTime: nullableText.optional(), isManualExecution: z.boolean().optional(), endDateOffset: z.number().optional(),
  commentsCount: z.number(), filesCount: z.number(), isFilesRequired: z.boolean().optional(), checklistDone: z.number(), checklistTotal: z.number(),
  isOverdue: z.boolean(), canExecute: z.boolean(), canEditDefinition: z.boolean(), missingRequiredInfo: z.array(z.string()), materials: z.array(material),
  checklists: z.array(z.object({ checklistId: z.number(), name: z.string(), code: z.string(), required: z.boolean().optional(), steps: z.array(step) })),
  activities: z.array(z.object({ id: z.number(), activity: z.string(), executionTime: z.number(), isStarted: z.boolean(), isCompleted: z.boolean(),
    isChecklist: z.boolean().optional(), checklistId: z.number().nullish(),
    technicalDocuments: z.array(z.object({ id: z.number(), documentName: z.string(), notes: nullableText, file: cachedAttachmentSchema.nullable() })) })).optional(),
  responsibles: z.array(z.object({ id: resourceId, name: z.string(), avatarThumbnail: nullableText.optional() })),
  workCustomerName: nullableText.optional(), workEquipment: equipment.nullish(), plannedDates: z.array(z.string()).optional(),
  schedules: z.array(z.object({ date: z.string(), queryDates: z.array(z.string()), generatedAt: z.string(), work })).optional(),
  systemId: z.number().nullish(), componentId: z.number().nullish(), systemName: nullableText.optional(), componentName: nullableText.optional(),
}));
export const cachedAssignmentsSchema: z.ZodType<Assignments> = z.object({
  generatedAt: z.string(), technician: z.object({ id: z.number().nullable(), name: z.string(), allowEditExecutionTime: z.boolean(), avatarThumbnail: nullableText.optional() }),
  summary: z.object({ totalGroups: z.number(), totalWorks: z.number(), activeWorks: z.number(), overdueWorks: z.number(), plannedMinutes: z.number() }),
  groups: z.array(z.object({
    id: z.string(), type: z.enum(["external_ot", "internal_maintenance", "direct_assignment"]), code: z.string(), title: z.string(), status,
    customerName: nullableText, locationName: z.string(), locationAddress: nullableText, scheduledDate: z.string(), scheduledStartTime: z.string(), scheduledEndTime: z.string(),
    plannedMinutes: z.number(), isOverdue: z.boolean(), isResponsible: z.boolean(), canManage: z.boolean(), equipment: equipment.nullable(), products: z.array(material), works: z.array(work),
    maintenanceType: nullableText.optional(), negotiationCode: nullableText.optional(), businessModality: nullableText.optional(), businessTypeName: nullableText.optional(),
    startedAt: nullableText.optional(), finalizedAt: nullableText.optional(), durationMinutes: z.number().nullable().optional(), finalizationNote: nullableText.optional(), damageType: nullableText.optional(),
    negotiationCorrelative: z.number().nullish(), workOrderNumber: z.number().nullish(), workOrderInternalNumber: z.number().nullish(), isWorkOrderInternal: z.boolean().nullish(),
  })),
});
export const cachedCommentsSchema = z.object({
  data: z.array(z.object({ id: z.string(), text: z.string(), createdAt: nullableText,
    author: z.object({ id: z.number().nullable(), name: z.string(), avatarUrl: nullableText.optional() }), files: z.array(cachedAttachmentSchema) })),
  totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
});
export const cachedDeliverySchema = z.object({
  groupId: z.string(), status, maintenanceType: nullableText, finalizationNote: nullableText, damageType: z.enum(["operacional", "desgaste"]).nullable(),
  durationMinutes: z.number().nullable(), startedAt: nullableText, finalizedAt: nullableText, incompleteChecklists: z.array(z.string()),
  suggestedDurationMinutes: z.number().optional(), canStart: z.boolean().optional(), canDeliver: z.boolean().optional(),
  canTechnicianDeliver: z.boolean().optional(), technicianDeliverySupported: z.boolean().optional(),
  pendingWorkNames: z.array(z.string()).optional(), pendingDeliveryChecklists: z.array(z.string()).optional(), totalWorks: z.number().int().nonnegative().optional(),
});
export function resourceCacheKey(kind: "files" | "comments", scope: OfflineScope, detail?: string | number): string {
  return `${kind}:${JSON.stringify([scope.companyBranchId, scope.groupId, scope.workId ?? null, detail ?? null])}`;
}
export function sameResource(left: OfflineScope, right: OfflineScope): boolean {
  return left.companyBranchId === right.companyBranchId && left.groupId === right.groupId && left.workId === right.workId;
}