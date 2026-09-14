import type { Session } from "../domain/models";
import type { TechnicianRepository } from "../domain/TechnicianRepository";
import type { NotificationApi } from "./contracts";
import { sameNotificationSession } from "./notificationSafety";

export type NotificationRepository = Pick<TechnicianRepository, "notificationStatus" | "registerNotificationDevice" | "unregisterNotificationDevice" | "notificationInbox" | "readNotification" | "deleteNotification" | "testNotification">;

export function bindNotificationApi(capturedSession: Session, repository: NotificationRepository): NotificationApi {
  function branch(session: Session): number {
    if (!sameNotificationSession(session, capturedSession) || session.mode !== "live" || session.branchId === null || session.user.workerId === null) {
      throw new Error("MOBILE_PUSH_SESSION_CHANGED");
    }
    return session.branchId;
  }
  return {
    notificationStatus: (session) => repository.notificationStatus(branch(session)),
    notificationRegister: (session, input) => {
      if (input.companyBranchId !== branch(session)) throw new Error("MOBILE_PUSH_SESSION_CHANGED");
      return repository.registerNotificationDevice(input);
    },
    notificationUnregister: (session, installationId) => repository.unregisterNotificationDevice(branch(session), installationId),
    notificationInbox: (session, page, unreadOnly) => repository.notificationInbox(branch(session), page, unreadOnly),
    notificationRead: (session, eventId) => repository.readNotification(branch(session), eventId),
    notificationDelete: (session, eventId) => repository.deleteNotification(branch(session), eventId),
    notificationTest: (session) => repository.testNotification(branch(session)),
  };
}