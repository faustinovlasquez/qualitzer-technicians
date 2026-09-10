import { z } from "zod";
import type { Assignments, Attachment, LoginResult, User } from "../src/domain/models";
import { GatewayError } from "./errors";

const text = z.string().nullish().transform((value) => value ?? "");
const number = z.number().finite();
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const resourceId = z.union([id, z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value)))]);
const nullableText = z.string().nullable();
const webLink = z.string().refine((value) => {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}).catch("");
const optionalLink = webLink.nullish();
const choice = z.object({ value: z.string(), label: z.string() });
export const attachmentSchema: z.ZodType<Attachment> = z.object({
  id: resourceId, name: text, url: webLink.nullish().transform((value) => value ?? ""),
  thumbnailUrl: optionalLink, thumbnailPath: optionalLink, type: nullableText.optional(), createdAt: nullableText.optional(),
  responsible: z.object({ id, name: text, avatarThumbnail: optionalLink }).nullish(),
});
export const stepSchema = z.object({
  stepId: resourceId, order: number.default(0), title: text, description: text, tag: text,
  type: z.enum(["validation", "text", "number", "select", "multiselect", "approval"]),
  options: z.array(choice).default([]), isFilesRequired: z.boolean().default(false), isRequired: z.boolean().optional(),
  isCompleted: z.boolean().nullable().default(null), selectValue: text,
  optionsSelectValue: z.array(choice).default([]), responseValue: text, comment: text,
  executionStatus: z.enum(["completed", "partial", "not_completed"]).nullable().default(null),
  attachments: z.array(attachmentSchema).default([]),
});
const checklist = z.object({
  checklistId: id, name: text, code: text, required: z.boolean().optional(), steps: z.array(stepSchema),
});
const material = z.object({
  id: z.string(), name: text, ref: nullableText, quantity: number, stockStatus: z.enum(["in_stock", "requested", "reserved"]),
});
const equipment = z.object({ label: text, identifier: text, internalNumber: nullableText, ownerLabel: nullableText });
const activity = z.object({
  id, activity: text, executionTime: number.default(0), isStarted: z.boolean().default(false), isCompleted: z.boolean().default(false),
  technicalDocuments: z.array(z.object({ id, documentName: text, notes: nullableText, file: attachmentSchema.nullable() })).default([]),
});
const status = z.enum(["pending", "in_progress", "paused", "completed", "delivered"]);
const work = z.object({
  id: resourceId.transform(String), workType: z.enum(["productive", "non_productive"]), title: text, summary: text, specialty: text,
  status, priority: z.enum(["low", "medium", "high"]), scheduledDate: text, scheduledStartTime: text, scheduledEndTime: text,
  plannedMinutes: number, executedMinutes: number, elapsedSeconds: number,
  totalPlannedMinutes: number.optional(), totalExecutedMinutes: number.optional(),
  firstInProgressTime: nullableText.optional(), isManualExecution: z.boolean().optional(), endDateOffset: number.optional(),
  commentsCount: number, filesCount: number, isFilesRequired: z.boolean().optional(), checklistDone: number, checklistTotal: number,
  isOverdue: z.boolean(), canExecute: z.boolean(), canEditDefinition: z.boolean(), missingRequiredInfo: z.array(z.string()),
  materials: z.array(material), checklists: z.array(checklist), activities: z.array(activity).optional(),
  responsibles: z.array(z.object({ id: resourceId, name: text, avatarThumbnail: optionalLink })),
  workCustomerName: nullableText.optional(), workEquipment: equipment.nullable().optional(), plannedDates: z.array(z.string()).optional(),
  systemName: nullableText.optional(), componentName: nullableText.optional(),
});
export const assignmentsSchema: z.ZodType<Assignments> = z.object({
  generatedAt: z.string(),
  technician: z.object({ id: id.nullable(), name: text, allowEditExecutionTime: z.boolean(), avatarThumbnail: optionalLink }),
  summary: z.object({ totalGroups: number, totalWorks: number, activeWorks: number, overdueWorks: number, plannedMinutes: number }),
  groups: z.array(z.object({
    id: z.string(), type: z.enum(["external_ot", "internal_maintenance", "direct_assignment"]), code: text, title: text, status,
    customerName: nullableText, locationName: text, locationAddress: nullableText,
    scheduledDate: text, scheduledStartTime: text, scheduledEndTime: text, plannedMinutes: number,
    isOverdue: z.boolean(), isResponsible: z.boolean(), canManage: z.boolean(), equipment: equipment.nullable(),
    products: z.array(material), works: z.array(work), maintenanceType: nullableText.optional(),
    negotiationCode: nullableText.optional(), businessModality: nullableText.optional(), businessTypeName: nullableText.optional(),
    negotiationCorrelative: number.nullable().optional(), workOrderNumber: number.nullable().optional(),
    workOrderInternalNumber: number.nullable().optional(), isWorkOrderInternal: z.boolean().nullable().optional(),
  })),
});
export const userSchema: z.ZodType<User> = z.object({
  id, workerId: id.nullish().transform((value) => value ?? null), name: text, lastnames: text, email: text,
  avatarThumbnail: webLink.optional(), role: z.object({ name: text, isTechnician: z.boolean().optional() }),
  accessBranchs: z.array(z.object({ id, name: text, main: z.boolean().default(false), isEnabled: z.boolean().optional(), isDeleted: z.boolean().optional() })),
  system: z.object({ name: text, timezone: text }),
});
export const loginResultSchema: z.ZodType<LoginResult> = z.object({
  token: z.string().min(1), username: z.string(), email: z.string(), nextStep: z.enum(["DONE", "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"]),
});
export const filesSchema = z.object({ data: z.array(attachmentSchema), totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() });

export function parseUpstream<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
  return parsed.data;
}