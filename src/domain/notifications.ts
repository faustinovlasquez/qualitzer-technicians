import { z } from "zod";
import { clockTimeSchema, mobileUuidSchema, positiveCreationIdSchema } from "./creation";

export const notificationPreferencesSchema = z.object({ assignments: z.boolean(), timers: z.boolean(), remindAfterMinutes: z.union([z.literal(30), z.literal(60), z.literal(120)]), repeatEveryMinutes: z.union([z.literal(60), z.literal(120), z.literal(240)]), quietHoursStart: clockTimeSchema, quietHoursEnd: clockTimeSchema }).strict();
export const notificationDeviceInputSchema = z.object({ installationId: mobileUuidSchema, expoPushToken: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/), projectId: mobileUuidSchema, platform: z.enum(["android", "ios"]), companyBranchId: positiveCreationIdSchema, preferences: notificationPreferencesSchema }).strict();
export const notificationKindSchema = z.enum(["WORK_TECHNICIAN_ASSIGNED", "RUNNING_TIMER_REMINDER", "MOBILE_PUSH_TEST"]);
export const notificationStateSchema = z.enum(["pending", "sending", "accepted", "receiving", "receipt_ok", "receipt_unknown", "cancelled", "expired", "dead"]);
export const notificationDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return value >= "0001-01-01" && Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
export const notificationOriginSchema = z.string().max(2048).refine((value) => {
  if (/[\s\x00-\x1f\x7f]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.origin === value; } catch { return false; }
});
export const notificationDataSchema = z.object({ recipient: z.object({ userId: positiveCreationIdSchema, workerId: positiveCreationIdSchema }).optional(), tenantOrigin: notificationOriginSchema, companyBranchId: positiveCreationIdSchema, eventId: mobileUuidSchema, kind: notificationKindSchema, groupType: z.enum(["work", "negotiation", "maintenance"]).nullable(), groupId: positiveCreationIdSchema.nullable(), workId: positiveCreationIdSchema.nullable(), date: notificationDateSchema.nullable() }).refine((value) => {
  if (value.kind === "MOBILE_PUSH_TEST") return value.groupType === null && value.groupId === null && value.workId === null && value.date === null;
  if (value.groupType === null || value.groupId === null) return false;
  return value.workId !== null || (value.kind === "WORK_TECHNICIAN_ASSIGNED" && value.groupType === "negotiation");
}, "MOBILE_PUSH_INVALID_DATA");
const isoDate = z.iso.datetime({ offset: true });
const reason = z.string().max(100).regex(/^(MOBILE_PUSH_[A-Z_]+|EXPO_[A-Z0-9_]+|DEVICE_NOT_REGISTERED|DEMO)$/);
const projectedPreferences = notificationPreferencesSchema.strip();
export const notificationStatusSchema = z.object({ enabled: z.boolean(), reasons: z.array(reason), projectId: mobileUuidSchema.nullable(), reconciliationSeconds: z.literal(120), deliveryGuaranteed: z.literal(false), reconciliationStale: z.boolean().optional(), device: z.object({ installationId: mobileUuidSchema, active: z.boolean(), disabledReason: reason.nullable(), preferences: projectedPreferences }).nullable().optional(), lastReconciledAt: isoDate.nullable().optional(), lastFailure: reason.nullable().optional(), deadLetters: z.number().int().nonnegative().optional() });
export const notificationDeviceResultSchema = z.object({ installationId: mobileUuidSchema, active: z.literal(true), preferences: projectedPreferences, baselineCapturedAt: isoDate.nullable() });
export const notificationInboxItemSchema = z.object({ id: mobileUuidSchema, kind: notificationKindSchema, state: notificationStateSchema, data: notificationDataSchema, lastFailure: reason.nullable(), readAt: isoDate.nullable(), createdAt: isoDate }).refine((value) => value.id === value.data.eventId && value.kind === value.data.kind, "MOBILE_PUSH_INVALID_EVENT");
export const notificationInboxSchema = z.object({ items: z.array(notificationInboxItemSchema).max(25), page: z.number().int().min(1).max(1000), pageSize: z.literal(25), unreadCount: z.number().int().nonnegative().optional(), total: z.number().int().nonnegative().optional(), canDelete: z.boolean().optional() });
export const notificationReadResultSchema = z.object({ id: mobileUuidSchema, read: z.literal(true) });
export const notificationDeleteResultSchema = z.object({ id: mobileUuidSchema, deleted: z.literal(true) });
export const notificationTestResultSchema = z.object({ eventId: mobileUuidSchema, state: z.literal("pending") });
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type NotificationDeviceInput = z.infer<typeof notificationDeviceInputSchema>;
export type NotificationData = z.infer<typeof notificationDataSchema>;
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;
export type NotificationDeviceResult = z.infer<typeof notificationDeviceResultSchema>;
export type NotificationInboxItem = z.infer<typeof notificationInboxItemSchema>;
export type NotificationInbox = z.infer<typeof notificationInboxSchema>;
export type NotificationReadResult = z.infer<typeof notificationReadResultSchema>;
export type NotificationDeleteResult = z.infer<typeof notificationDeleteResultSchema>;
export type NotificationTestResult = z.infer<typeof notificationTestResultSchema>;