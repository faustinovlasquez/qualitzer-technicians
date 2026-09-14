import type { Session } from "../domain/models";
import { notificationDataSchema, type NotificationData, type NotificationPreferences } from "../domain/notifications";
import type { NotificationPermission } from "./contracts";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  assignments: true, timers: true, remindAfterMinutes: 30, repeatEveryMinutes: 120,
  quietHoursStart: "22:00", quietHoursEnd: "07:00",
};

export function permissionAllowsPush(permission: NotificationPermission): boolean {
  return permission === "granted" || permission === "provisional" || permission === "ephemeral";
}

export function notificationForSession(value: unknown, session: Session): NotificationData | null {
  const parsed = notificationDataSchema.safeParse(value);
  if (!parsed.success || session.mode !== "live" || session.user.workerId === null || session.branchId === null) return null;
  if (parsed.data.tenantOrigin !== session.tenant.portalOrigin || parsed.data.companyBranchId !== session.branchId) return null;
  if (parsed.data.recipient && (parsed.data.recipient.userId !== session.user.id || parsed.data.recipient.workerId !== session.user.workerId)) return null;
  return parsed.data;
}

export function sameNotification(left: NotificationData, right: NotificationData): boolean {
  return left.eventId === right.eventId && left.tenantOrigin === right.tenantOrigin && left.companyBranchId === right.companyBranchId
    && left.kind === right.kind && left.groupType === right.groupType && left.groupId === right.groupId
    && left.workId === right.workId && left.date === right.date
    && left.recipient?.userId === right.recipient?.userId && left.recipient?.workerId === right.recipient?.workerId;
}

export function sameNotificationSession(left: Session, right: Session): boolean {
  return left.token === right.token && left.mode === right.mode && left.user.id === right.user.id
    && left.user.workerId === right.user.workerId && left.branchId === right.branchId
    && left.tenant.id === right.tenant.id && left.tenant.portalOrigin === right.tenant.portalOrigin
    && left.tenant.environment === right.tenant.environment;
}

export class NotificationEventDeduper {
  private readonly handled = new Set<string>();
  private readonly pending = new Set<string>();
  constructor(private readonly limit = 256) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("MOBILE_PUSH_INVALID_DEDUPE_LIMIT");
  }
  begin(eventId: string): boolean {
    if (this.handled.has(eventId) || this.pending.has(eventId) || this.pending.size >= this.limit) return false;
    this.pending.add(eventId);
    return true;
  }
  has(eventId: string): boolean { return this.handled.has(eventId); }
  finish(eventId: string, accepted: boolean): void {
    this.pending.delete(eventId);
    if (!accepted) return;
    this.handled.add(eventId);
    while (this.handled.size > this.limit) {
      const first = this.handled.values().next().value;
      if (first !== undefined) this.handled.delete(first);
    }
  }
}

export function notificationFailure(error: unknown): string {
  if (error instanceof Error && /^MOBILE_PUSH_[A-Z_]{1,100}$/.test(error.message)) return error.message;
  return "MOBILE_PUSH_CLIENT_OPERATION_FAILED";
}