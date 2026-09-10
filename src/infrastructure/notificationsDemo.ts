import { mobileUuidSchema, positiveCreationIdSchema } from "../domain/creation";
import { notificationDeviceInputSchema, type NotificationDeviceInput, type NotificationDeviceResult, type NotificationInbox, type NotificationReadResult, type NotificationStatus, type NotificationTestResult } from "../domain/notifications";
import { demoUser } from "./demoData";

function branch(id: number): void {
  positiveCreationIdSchema.parse(id);
  if (!demoUser.accessBranchs.some((item) => item.id === id)) throw new Error("BRANCH_FORBIDDEN");
}

export class DemoNotifications {
  async notificationStatus(companyBranchId: number): Promise<NotificationStatus> {
    branch(companyBranchId);
    return { enabled: false, reasons: ["DEMO"], projectId: null, reconciliationSeconds: 120, deliveryGuaranteed: false };
  }
  async registerNotificationDevice(input: NotificationDeviceInput): Promise<NotificationDeviceResult> {
    const parsed = notificationDeviceInputSchema.parse(input);
    branch(parsed.companyBranchId);
    throw new Error("DEMO: las notificaciones push no están disponibles en demostración.");
  }
  async unregisterNotificationDevice(companyBranchId: number, installation: string): Promise<void> { branch(companyBranchId); mobileUuidSchema.parse(installation); }
  async notificationInbox(companyBranchId: number, page: number): Promise<NotificationInbox> {
    branch(companyBranchId);
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error("MOBILE_PUSH_INVALID_PAGE");
    return { items: [], page, pageSize: 25 };
  }
  async readNotification(companyBranchId: number, id: string): Promise<NotificationReadResult> {
    branch(companyBranchId); mobileUuidSchema.parse(id);
    throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
  }
  async testNotification(companyBranchId: number): Promise<NotificationTestResult> {
    branch(companyBranchId);
    throw new Error("DEMO: no se envían notificaciones push desde la demostración.");
  }
}