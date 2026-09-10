import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Session } from "../domain/models";
import type { NotificationApi, NotificationClientOptions } from "./contracts";
import { MobileNotificationClient } from "./MobileNotificationClient";
import { createNotificationAdapter } from "./notificationAdapter";

export interface UseMobileNotificationsOptions {
  session: Session | null;
  storageKey: string;
  api: NotificationApi | null;
  enabled?: boolean;
  onOpen: NotificationClientOptions["onOpen"];
  onForegroundRefresh?: NotificationClientOptions["onForegroundRefresh"];
}

const subscribeNothing = (): (() => void) => () => {};
const emptySnapshot = (): null => null;

export function useMobileNotifications({ session, storageKey, api, enabled = true, onOpen, onForegroundRefresh }: UseMobileNotificationsOptions) {
  const current = useRef<MobileNotificationClient | null>(null);
  const client = useMemo(() => {
    if (!enabled || !session || !api || session.mode !== "live" || !session.branchId || !session.user.workerId || !storageKey) return null;
    const captured = session;
    const instance: MobileNotificationClient = new MobileNotificationClient({ session: captured, storageKey, api,
      adapter: createNotificationAdapter(), onOpen, onForegroundRefresh, isCurrent: (): boolean => current.current === instance });
    return instance;
  }, [enabled, Boolean(api), storageKey, session?.token, session?.mode, session?.branchId, session?.user.id, session?.user.workerId,
    session?.tenant.id, session?.tenant.portalOrigin, session?.tenant.environment]);
  current.current = client;
  useEffect(() => client?.start(), [client]);
  const state = useSyncExternalStore(client?.subscribe ?? subscribeNothing, client?.getSnapshot ?? emptySnapshot, client?.getSnapshot ?? emptySnapshot);
  return { client, state, storageKey, revokeForSession: () => client?.revokeForSession() ?? Promise.resolve() };
}

export type MobileNotificationsModel = ReturnType<typeof useMobileNotifications>;

export interface NotificationBridgeProps extends UseMobileNotificationsOptions {
  onClient(client: MobileNotificationClient | null): void;
}

export function NotificationBridge({ onClient, ...props }: NotificationBridgeProps): null {
  const notifications = useMobileNotifications(props);
  useEffect(() => { onClient(notifications.client); return () => onClient(null); }, [notifications.client, onClient]);
  return null;
}