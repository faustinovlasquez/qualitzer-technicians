import { z } from "zod";
import { clockTimeSchema, mobileUuidSchema, positiveCreationIdSchema } from "./creation";
import type { GroupScope } from "./models";

export const locationActionSchema = z.enum(["WORK_CREATED", "ORDER_CREATED", "WORK_UPDATED", "WORK_STARTED", "WORK_RESUMED", "WORK_PAUSED", "WORK_COMPLETED", "WORK_DELIVERED", "WORK_REOPENED", "ACTIVITY_CREATED", "ACTIVITY_UPDATED", "ACTIVITY_COMPLETED", "ACTIVITY_REOPENED", "ACTIVITY_DELETED", "CHECKLIST_SAVED", "CHECKLIST_ATTACHED", "EQUIPMENT_LOCATION_CHANGED", "ORDER_STARTED", "ORDER_DELIVERED", "FILE_UPLOADED", "FILE_DELETED", "COMMENT_ADDED", "REPORT_SAVED"]);
export type LocationAction = z.infer<typeof locationActionSchema>;
export interface LocationActionEvent { action: LocationAction; groupId: string; workId?: number; localWorkId?: string; targetId?: string; capturedAt: number; actionState: "CONFIRMED" | "QUEUED"; operationId?: string; }
export type LocationActionRecorder = (action: LocationAction, scope: GroupScope & { workId?: string }, targetId?: string) => (state: "CONFIRMED" | "QUEUED", operationId?: string, resource?: { groupId: string; workId?: string }) => Promise<void>;
export function locationDate(schedule: LocationSchedule, timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
}

export const locationScheduleSchema = z.object({
  startTime: clockTimeSchema, endTime: clockTimeSchema,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(days => new Set(days).size === days.length),
  timezone: z.string().max(100).refine(zone => { try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; } }),
}).strict().refine(value => value.startTime < value.endTime, "LOCATION_INVALID_WORKING_HOURS");
export type LocationSchedule = z.infer<typeof locationScheduleSchema>;
export function defaultLocationSchedule(timezone: string): LocationSchedule {
  return locationScheduleSchema.parse({ startTime: "08:00", endTime: "18:00", weekdays: [1, 2, 3, 4, 5, 6, 7], timezone });
}
export function locationWorkingDay(schedule: LocationSchedule, timestamp: number): string | null {
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
  const part = (key: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === key)?.value ?? "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  const time = `${part("hour")}:${part("minute")}`;
  return schedule.weekdays.includes(weekday) && time >= schedule.startTime && time < schedule.endTime ? day : null;
}
export const locationSettingsSchema = z.object({ enabled: z.boolean(), consentVersion: z.union([z.literal(1), z.literal(2)]), consentedAt: z.iso.datetime().nullable(), schedule: locationScheduleSchema }).strict();
export type LocationSettings = z.infer<typeof locationSettingsSchema>;
export const locationPointSchema = z.object({
  id: mobileUuidSchema, companyBranchId: positiveCreationIdSchema,
  capturedAt: z.iso.datetime(), locationAt: z.iso.datetime().nullable(),
  latitude: z.number().finite().min(-90).max(90).nullable(), longitude: z.number().finite().min(-180).max(180).nullable(), accuracy: z.number().finite().min(0).max(100).nullable(),
  kind: z.enum(["periodic", "work_started", "order_started", "action"]), outcome: z.enum(["located", "unavailable"]), mocked: z.boolean(),
  groupId: z.string().max(60).refine(value => /^(external|maintenance|direct|direct-np)-[1-9]\d*$/.test(value) || value.startsWith("local-") && mobileUuidSchema.safeParse(value.slice(6)).success).optional(), workId: positiveCreationIdSchema.optional(),
  operationId: mobileUuidSchema.optional(), schedule: locationScheduleSchema, consentedAt: z.iso.datetime(), consentVersion: z.union([z.literal(1), z.literal(2)]),
  action: locationActionSchema.optional(), actionState: z.enum(["CONFIRMED", "QUEUED"]).optional(), localWorkId: mobileUuidSchema.optional(), targetId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
}).strict().superRefine((point, context) => {
  const all = point.latitude !== null && point.longitude !== null && point.accuracy !== null && point.locationAt !== null;
  const none = point.latitude === null && point.longitude === null && point.accuracy === null && point.locationAt === null;
  if (point.outcome === "located" ? !all : !none) context.addIssue({ code: "custom", message: "LOCATION_INVALID_COORDINATES" });
  if (point.kind !== "action" && !locationWorkingDay(point.schedule, Date.parse(point.capturedAt))) context.addIssue({ code: "custom", message: "LOCATION_OUTSIDE_WORKING_HOURS" });
  if (point.kind === "action" ? point.consentVersion !== 2 || !point.action || !point.actionState || !point.groupId || point.actionState === "QUEUED" && !point.operationId
    : point.consentVersion !== 1 || point.action !== undefined || point.actionState !== undefined || point.localWorkId !== undefined || point.targetId !== undefined || point.groupId?.startsWith("local-")) context.addIssue({ code: "custom", message: "LOCATION_INVALID_ACTION" });
  if (Date.parse(point.consentedAt) > Date.parse(point.capturedAt)) context.addIssue({ code: "custom", message: "LOCATION_CONSENT_REQUIRED" });
  if (point.kind === "periodic" && (point.groupId || point.workId || point.operationId) || point.kind !== "periodic" && !point.groupId || point.kind === "work_started" && !point.workId) context.addIssue({ code: "custom", message: "LOCATION_INVALID_EVENT" });
  if (point.locationAt && Math.abs(Date.parse(point.capturedAt) - Date.parse(point.locationAt)) > 120000) context.addIssue({ code: "custom", message: "LOCATION_STALE_FIX" });
});
export type LocationPoint = z.infer<typeof locationPointSchema>;
const actionLabels: { [Action in LocationAction]: string } = {
  WORK_CREATED: "Trabajo creado", ORDER_CREATED: "Mantenimiento creado", WORK_UPDATED: "Datos del trabajo actualizados",
  WORK_STARTED: "Trabajo iniciado", WORK_RESUMED: "Trabajo reanudado", WORK_PAUSED: "Trabajo pausado", WORK_COMPLETED: "Trabajo completado", WORK_DELIVERED: "Trabajo entregado", WORK_REOPENED: "Trabajo reabierto",
  ACTIVITY_CREATED: "Actividad añadida", ACTIVITY_UPDATED: "Actividad modificada", ACTIVITY_COMPLETED: "Actividad completada", ACTIVITY_REOPENED: "Actividad reabierta", ACTIVITY_DELETED: "Actividad eliminada",
  CHECKLIST_SAVED: "Checklist guardado", CHECKLIST_ATTACHED: "Checklist añadido", EQUIPMENT_LOCATION_CHANGED: "Ubicación del equipo cambiada", ORDER_STARTED: "Orden iniciada", ORDER_DELIVERED: "Orden entregada",
  FILE_UPLOADED: "Archivo añadido", FILE_DELETED: "Archivo eliminado", COMMENT_ADDED: "Comentario añadido", REPORT_SAVED: "Reporte guardado",
};
export function locationEventLabel(point: LocationPoint): string {
  return point.action ? actionLabels[point.action] : point.kind === "periodic" ? "Recorrido anterior" : point.kind === "order_started" ? "Inicio de orden" : "Inicio de trabajo";
}
export const locationBatchSchema = z.object({ expectedActor: z.object({ userId: positiveCreationIdSchema, workerId: positiveCreationIdSchema }).strict(), companyBranchId: positiveCreationIdSchema, points: z.array(locationPointSchema).min(1).max(50) }).strict()
  .refine(batch => batch.points.every(point => point.companyBranchId === batch.companyBranchId) && new Set(batch.points.map(point => point.id)).size === batch.points.length);
export const locationAckSchema = z.object({ acceptedIds: z.array(mobileUuidSchema).max(50) }).strict();
export interface LocationHistoryResource { groupId: string; workId?: number; }
export const locationHistoryQuerySchema = z.object({ companyBranchId: positiveCreationIdSchema, startDate: z.iso.date(), endDate: z.iso.date(), page: z.number().int().min(0).max(10000).default(0),
  groupId: z.string().regex(/^(external|maintenance|direct|direct-np)-[1-9]\d*$/).optional(), workId: positiveCreationIdSchema.optional() }).strict()
  .refine(value => value.startDate <= value.endDate && Date.parse(value.endDate) - Date.parse(value.startDate) <= 30 * 86400000 && (value.workId === undefined || value.groupId !== undefined));
export const locationHistorySchema = z.object({ items: z.array(z.object({ point: locationPointSchema, receivedAt: z.iso.datetime(), evidenceSource: z.literal("DEVICE_REPORTED") }).strict()).max(100), page: z.number().int().nonnegative(), hasMore: z.boolean() }).strict();
export interface LocationFix { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number | null }; mocked?: boolean; }
export function usableLocationFix(fix: LocationFix, now: number): boolean {
  return Number.isFinite(fix.timestamp) && Math.abs(now - fix.timestamp) <= 120000 && Number.isFinite(fix.coords.latitude) && Math.abs(fix.coords.latitude) <= 90
    && Number.isFinite(fix.coords.longitude) && Math.abs(fix.coords.longitude) <= 180 && fix.coords.accuracy !== null && Number.isFinite(fix.coords.accuracy) && fix.coords.accuracy >= 0 && fix.coords.accuracy <= 100;
}
export function shouldRecordPeriodic(schedule: LocationSchedule, fix: LocationFix, now: number, lastCapturedAt?: string): boolean {
  return !!locationWorkingDay(schedule, now) && usableLocationFix(fix, now) && (!lastCapturedAt || now - Date.parse(lastCapturedAt) >= 300000);
}