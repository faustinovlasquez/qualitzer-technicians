import { z } from "zod";
import { tenantIdSchema } from "./config";

export const positiveId = z.string().regex(/^[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value)));
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && value >= "0001-01-01" && new Date(timestamp).toISOString().slice(0, 10) === value;
});
export const rangeQuerySchema = z.object({
  startDate: isoDate, endDate: isoDate, companyBranchId: positiveId.transform(Number),
}).strict().refine(({ startDate, endDate }) => endDate >= startDate && (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 < 31);
export type RangeQuery = z.infer<typeof rangeQuerySchema>;
export const branchQuerySchema = z.object({ companyBranchId: positiveId.transform(Number).optional() }).strict();
export const resourceParamsSchema = z.object({
  groupId: z.string().regex(/^(?:external|maintenance|direct|direct-np)-[1-9]\d*$/), workId: positiveId, stepId: positiveId.optional(),
}).strict();
export const emptySchema = z.object({}).strict();
export const healthQuerySchema = z.object({ tenantId: tenantIdSchema.optional() }).strict();
export const loginSchema = z.object({
  tenantId: tenantIdSchema,
  username: z.string().trim().min(1).max(254), password: z.string().min(1).max(256), remember: z.boolean().default(false),
}).strict();
export const loginStartSchema = z.object({
  username: z.string().trim().min(1).max(320), password: z.string().min(1).max(1024), remember: z.literal(true),
}).strict();
export const loginCompleteSchema = z.object({
  challenge: z.string().regex(/^qzc_[A-Za-z0-9_-]{43}$/), tenantId: tenantIdSchema,
}).strict();
export type LoginCredentials = z.infer<typeof loginStartSchema>;
export const passwordSchema = z.object({
  newPassword: z.string().min(1).max(256), confirmPassword: z.string().min(1).max(256), remember: z.boolean().default(false),
}).strict().refine((value) => value.newPassword === value.confirmPassword);
export const statusInputSchema = z.object({
  status: z.enum(["in_progress", "paused", "completed", "delivered"]),
  executionStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  executionEndTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  executionDates: z.array(isoDate).min(1).max(30).refine((dates) => new Set(dates).size === dates.length).optional(),
  endDateOffset: z.number().int().min(0).max(30).optional(),
  isManual: z.boolean().optional(),
}).strict();
export const stepAnswerSchema = z.object({
  responseValue: z.union([z.string().max(10000), z.boolean(), z.array(z.object({ value: z.string().max(500), label: z.string().max(500) }).strict()).max(100)]).nullable(),
  isCompleted: z.boolean(), executionStatus: z.enum(["completed", "partial", "not_completed"]).nullable(), comment: z.string().max(10000).nullable(),
}).strict();
export const reportSchema = z.object({ note: z.string().trim().min(1).max(10000) }).strict();