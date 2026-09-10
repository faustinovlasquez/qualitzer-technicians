import type { Session } from "../domain/models";
import type { NotificationData, NotificationDeviceInput, NotificationDeviceResult, NotificationInbox, NotificationReadResult, NotificationStatus, NotificationTestResult } from "../domain/notifications";

export interface NotificationApi {
  notificationStatus(session: Session): Promise<NotificationStatus>;
  notificationRegister(session: Session, input: NotificationDeviceInput): Promise<NotificationDeviceResult>;
  notificationUnregister(session: Session, installationId: string): Promise<void>;
  notificationInbox(session: Session, page: number): Promise<NotificationInbox>;
  notificationRead(session: Session, eventId: string): Promise<NotificationReadResult>;
  notificationTest(session: Session): Promise<NotificationTestResult>;
}

export type NotificationPermission = "unknown" | "undetermined" | "granted" | "provisional" | "ephemeral" | "denied" | "blocked" | "unsupported";
export interface NativePushToken { type: "android" | "ios"; data: string; }
export interface NativeNotification { identifier: string; data: unknown; }
export interface NativeNotificationResponse extends NativeNotification { defaultAction: boolean; }
export interface NotificationAdapter {
  platform: "android" | "ios" | "unsupported";
  unsupportedReason: string | null;
  projectId: string | null;
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  prepareChannel(): Promise<void>;
  getExpoToken(projectId: string, devicePushToken?: NativePushToken): Promise<string>;
  getInstallationId(): Promise<string>;
  readConsent(storageKey: string): Promise<boolean>;
  writeConsent(storageKey: string, enabled: boolean): Promise<void>;
  subscribe(listeners: {
    shouldPresent?(notification: NativeNotification): boolean;
    response(response: NativeNotificationResponse): void;
    received(notification: NativeNotification): void;
    token(token: NativePushToken): void;
    foreground(): void;
  }): () => void;
  lastResponse(): Promise<NativeNotificationResponse | null>;
  clearResponse(identifier: string): Promise<void>;
  presented(): Promise<NativeNotification[]>;
  dismiss(identifier: string): Promise<void>;
  openSettings(): Promise<void>;
}

export interface NotificationOpenContext {
  session: Session;
  storageKey: string;
  isCurrent(): boolean;
}

export interface NotificationClientOptions {
  session: Session;
  storageKey: string;
  api: NotificationApi;
  adapter: NotificationAdapter;
  isCurrent(): boolean;
  onOpen(payload: NotificationData, context: NotificationOpenContext): boolean | Promise<boolean>;
  onForegroundRefresh?(context: NotificationOpenContext): void | Promise<void>;
}