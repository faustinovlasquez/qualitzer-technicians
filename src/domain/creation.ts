import { z } from "zod";

export const positiveCreationIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const mobileUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform((value) => value.toLowerCase());
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return value >= "2000-01-01" && value <= "2100-12-31" && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "MOBILE_CREATION_INVALID_DATE");
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) => z.string().max(max).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/).trim().min(1);
export const creationPrioritySchema = z.enum(["low", "medium", "high"]);
export const nonProductiveReasonSchema = z.enum(["waiting_parts", "waiting_authorization", "waiting_equipment", "travel", "safety_stop", "weather", "no_access", "administrative", "training", "other"]);
export const creationKindSchema = z.enum(["work", "maintenance", "non_productive"]);
export const creationScheduleSchema = z.object({ date: calendarDateSchema, startTime: clockTimeSchema, endTime: clockTimeSchema, endDateOffset: z.literal(0).optional() }).strict().refine((value) => value.startTime < value.endTime, "MOBILE_CREATION_INVALID_TIME_RANGE");
const base = { companyBranchId: positiveCreationIdSchema, clientRequestId: mobileUuidSchema, schedule: creationScheduleSchema };
export const creationInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("work"), work: z.object({ title: text(255), summary: text(5000), priority: creationPrioritySchema, specialtyId: positiveCreationIdSchema.optional(), rentalEquipmentId: positiveCreationIdSchema.optional() }).strict() }).strict(),
  z.object({ ...base, kind: z.literal("maintenance"), maintenance: z.object({ type: z.enum(["correctivo", "detencion"]), title: text(255), motive: text(5000), equipmentId: positiveCreationIdSchema, priority: creationPrioritySchema.optional(), specialtyId: positiveCreationIdSchema.optional(), damageType: z.enum(["operacional", "desgaste"]).optional() }).strict() }).strict(),
  z.object({ ...base, kind: z.literal("non_productive"), nonProductive: z.object({ reason: nonProductiveReasonSchema, reasonText: text(500).optional(), initialComment: text(5000).optional() }).strict().refine((value) => value.reason !== "other" || !!value.reasonText, "NON_PRODUCTIVE_REASON_TEXT_REQUIRED") }).strict(),
]);
export const normalizeEquipmentInternalNumber = (value: string): string => value.trim().toLowerCase();
export const creationOptionsQuerySchema = z.object({ companyBranchId: positiveCreationIdSchema, kind: z.enum(["equipment", "specialties"]).optional(), search: z.string().max(100).trim().optional(),
  internalNumber: z.string().max(100).regex(/^[^\x00-\x1f\x7f]*$/).trim().min(1).transform(normalizeEquipmentInternalNumber).optional(),
  page: z.number().int().min(0).max(1000).optional() }).strict().refine((query) => query.internalNumber === undefined || (query.kind === "equipment" && !query.search), "MOBILE_CREATION_INVALID_INTERNAL_NUMBER");
export const creationCatalogPageSchema = z.object({ items: z.array(z.object({ id: positiveCreationIdSchema, label: z.string(),
  internalNumber: z.string().nullable().optional(), identifier: z.string().nullable().optional(), equipmentType: z.string().nullable().optional(),
})).max(25), page: z.number().int().min(0).max(1000), pageSize: z.literal(25), hasMore: z.boolean() });
export const creationOptionsSchema = z.object({
  companyBranchId: positiveCreationIdSchema, userId: positiveCreationIdSchema, workerId: positiveCreationIdSchema, timezone: z.string().min(1),
  priorities: z.array(creationPrioritySchema), nonProductiveReasons: z.array(z.object({ value: nonProductiveReasonSchema, label: z.string() })),
  maintenanceTypes: z.array(z.object({ value: z.enum(["correctivo", "detencion", "preventivo", "rutinario", "checklist"]), enabled: z.boolean(), instruction: z.string().nullable() })),
  schedule: z.object({ sameDayOnly: z.literal(true), conflictPolicy: z.literal("warning") }),
  equipment: creationCatalogPageSchema.optional(), specialties: creationCatalogPageSchema.optional(),
});
export const creationResultSchema = z.object({
  kind: creationKindSchema, groupId: z.string(), workId: positiveCreationIdSchema, companyBranchId: positiveCreationIdSchema,
  schedule: z.object({ date: calendarDateSchema, startTime: clockTimeSchema, endTime: clockTimeSchema, plannedMinutes: z.number().int().positive().max(1439), timezone: z.string().min(1) }),
}).refine((value) => new RegExp(value.kind === "maintenance" ? "^maintenance-[1-9]\\d*$" : value.kind === "non_productive" ? "^direct-np-[1-9]\\d*$" : "^direct-[1-9]\\d*$").test(value.groupId), "MOBILE_CREATION_INVALID_RESULT");

export type CreationInput = z.infer<typeof creationInputSchema>;
export type CreationResult = z.infer<typeof creationResultSchema>;
export type CreationOptionsQuery = z.infer<typeof creationOptionsQuerySchema>;
export type CreationOptions = z.infer<typeof creationOptionsSchema>;
export type CreationKind = z.infer<typeof creationKindSchema>;
export type CreationSchedule = z.infer<typeof creationScheduleSchema>;
export type NonProductiveReason = z.infer<typeof nonProductiveReasonSchema>;