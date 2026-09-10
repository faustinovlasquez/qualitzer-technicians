import {
  notificationDeviceInputSchema, notificationDeviceResultSchema, notificationInboxSchema, notificationPreferencesSchema,
  notificationReadResultSchema, notificationStatusSchema, notificationTestResultSchema,
  type NotificationData, type NotificationInboxItem, type NotificationPreferences, type NotificationStatus,
} from "../domain/notifications";
import type { NativeNotificationResponse, NativePushToken, NotificationClientOptions, NotificationPermission } from "./contracts";
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationEventDeduper, notificationFailure, notificationForSession, permissionAllowsPush, sameNotification } from "./notificationSafety";

export interface MobileNotificationState {
  ready: boolean;
  busy: boolean;
  permission: NotificationPermission;
  optedIn: boolean;
  registered: boolean;
  installationId: string | null;
  status: NotificationStatus | null;
  preferences: NotificationPreferences;
  inbox: NotificationInboxItem[];
  page: number;
  hasMore: boolean;
  error: string | null;
  notice: string | null;
}

export class MobileNotificationClient {
  private state: MobileNotificationState = {
    ready: false, busy: false, permission: "unknown", optedIn: false, registered: false,
    installationId: null, status: null, preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    inbox: [], page: 0, hasMore: false, error: null, notice: null,
  };
  private readonly subscribers = new Set<() => void>();
  private readonly events = new NotificationEventDeduper();
  private tail: Promise<unknown> = Promise.resolve();
  private detach: (() => void) | null = null;
  private active = false;
  private revoked = false;
  private revokePending: Promise<void> | null = null;
  private expoToken: string | null = null;
  private lastNativeToken: string | null = null;
  private consentLoaded = false;
  private bindingMayExist = false;
  private revocationRequired = false;
  private remotelyRevoked = false;

  constructor(readonly options: NotificationClientOptions) {}

  getSnapshot = (): MobileNotificationState => this.state;
  subscribe = (callback: () => void): (() => void) => {
    this.subscribers.add(callback);
    return () => { this.subscribers.delete(callback); };
  };
  isCurrent = (): boolean => this.active && !this.revoked && this.options.isCurrent();
  private requireCurrent(): void { if (!this.isCurrent()) throw new Error("MOBILE_PUSH_SESSION_CHANGED"); }
  private update(value: Partial<MobileNotificationState>): void {
    if (!this.isCurrent()) return;
    this.publish(value);
  }
  private publish(value: Partial<MobileNotificationState>): void {
    if (!this.active || !this.options.isCurrent()) return;
    this.state = { ...this.state, ...value };
    this.subscribers.forEach((callback) => callback());
  }
  private run(operation: () => Promise<void>): Promise<boolean> {
    const pending = this.tail.then(async () => {
      if (!this.isCurrent()) return false;
      this.update({ busy: true, error: null, notice: null });
      try { await operation(); return this.isCurrent(); }
      catch (error: unknown) { this.update({ error: notificationFailure(error) }); return false; }
      finally { this.update({ busy: false }); }
    });
    this.tail = pending;
    return pending;
  }

  start(): () => void {
    this.active = true;
    const { session, adapter } = this.options;
    if (session.mode !== "live" || session.branchId === null || session.user.workerId === null) {
      this.update({ ready: true, permission: "unsupported", error: "MOBILE_PUSH_SESSION_NOT_READY" });
      return () => { this.active = false; };
    }
    this.detach = adapter.subscribe({
      shouldPresent: (notification) => this.isCurrent() && !this.revocationRequired && this.state.optedIn && this.state.registered
        && permissionAllowsPush(this.state.permission) && notificationForSession(notification.data, session) !== null,
      response: (response) => { void this.handleResponse(response); },
      received: (notification) => {
        if (!this.isCurrent() || this.revocationRequired || !notificationForSession(notification.data, session)) return;
        void this.run(async () => {
          const owned = await this.findOwnedEvent(notification.data);
          this.requireCurrent();
          if (owned) {
            this.update({ notice: owned.kind === "RUNNING_TIMER_REMINDER" ? "Hay un cronómetro pendiente de revisión." : owned.kind === "MOBILE_PUSH_TEST" ? "Se recibió una notificación de prueba en esta app." : "Hay una nueva asignación técnica. Actualiza tus trabajos." });
            await this.options.onForegroundRefresh?.({ session: this.options.session, storageKey: this.options.storageKey, isCurrent: this.isCurrent });
          }
        });
      },
      token: (token) => {
        if (!this.isCurrent() || !this.state.optedIn || token.data === this.lastNativeToken) return;
        void this.run(async () => { await this.synchronize(false, token); });
      },
      foreground: () => { void this.refresh(); },
    });
    void this.refresh();
    return () => { this.active = false; this.detach?.(); this.detach = null; this.expoToken = null; this.lastNativeToken = null; };
  }

  private async loadStatus(): Promise<NotificationStatus> {
    const status = notificationStatusSchema.parse(await this.options.api.notificationStatus(this.options.session));
    this.requireCurrent();
    const registered = this.state.registered && status.enabled && status.device?.active === true && status.device.installationId === this.state.installationId;
    this.update({ status, registered });
    return status;
  }

  private project(status: NotificationStatus): string {
    if (!status.enabled) throw new Error("MOBILE_PUSH_SERVER_PREREQUISITES");
    if (!this.options.adapter.projectId) throw new Error("MOBILE_PUSH_PROJECT_MISSING");
    if (this.options.adapter.projectId !== status.projectId) throw new Error("MOBILE_PUSH_PROJECT_MISMATCH");
    return this.options.adapter.projectId;
  }

  private async synchronize(explicit: boolean, devicePushToken?: NativePushToken, preferences?: NotificationPreferences): Promise<void> {
    if (this.revocationRequired) throw new Error("MOBILE_PUSH_REVOCATION_PENDING");
    const { adapter, storageKey } = this.options;
    const status = await this.loadStatus();
    if (adapter.platform === "unsupported") {
      this.update({ ready: true, permission: "unsupported", registered: false });
      return;
    }
    const installationId = await adapter.getInstallationId();
    this.requireCurrent();
    if (!this.consentLoaded) {
      const optedIn = await adapter.readConsent(storageKey);
      this.requireCurrent();
      this.consentLoaded = true;
      this.update({ optedIn });
    }
    const ownDevice = status.device?.installationId === installationId ? status.device : null;
    if (ownDevice?.active) this.bindingMayExist = true;
    this.update({ installationId, ...(ownDevice ? { preferences: ownDevice.preferences } : {}) });
    let permission = await adapter.getPermission();
    this.requireCurrent();
    this.update({ permission, ready: true });
    if (!permissionAllowsPush(permission) && ownDevice?.active) {
      await this.unregister();
      this.requireCurrent();
    }
    if (!explicit && (!this.state.optedIn || !permissionAllowsPush(permission))) {
      if (!this.state.optedIn && ownDevice?.active && permissionAllowsPush(permission)) await this.unregister();
      this.update({ registered: false });
      return;
    }
    const projectId = this.project(status);
    if (explicit) {
      if (permission === "blocked") throw new Error("MOBILE_PUSH_PERMISSION_BLOCKED");
      await adapter.prepareChannel();
      this.requireCurrent();
      if (!permissionAllowsPush(permission)) permission = await adapter.requestPermission();
      this.requireCurrent();
      this.update({ permission });
      if (!permissionAllowsPush(permission)) throw new Error("MOBILE_PUSH_PERMISSION_DENIED");
      await adapter.writeConsent(storageKey, true);
      this.requireCurrent();
      this.update({ optedIn: true });
    } else {
      await adapter.prepareChannel();
      this.requireCurrent();
    }
    const expoPushToken = await adapter.getExpoToken(projectId, devicePushToken);
    this.requireCurrent();
    const selectedPreferences = preferences ?? this.state.preferences;
    const input = notificationDeviceInputSchema.parse({ installationId, expoPushToken, projectId, platform: adapter.platform,
      companyBranchId: this.options.session.branchId, preferences: selectedPreferences });
    this.bindingMayExist = true;
    const response = await this.options.api.notificationRegister(this.options.session, input);
    if (!this.isCurrent()) {
      await this.options.api.notificationUnregister(this.options.session, installationId);
      this.bindingMayExist = false;
      throw new Error("MOBILE_PUSH_SESSION_CHANGED");
    }
    const result = notificationDeviceResultSchema.parse(response);
    if (result.installationId !== installationId) throw new Error("MOBILE_PUSH_INVALID_DEVICE_RESPONSE");
    this.expoToken = expoPushToken;
    if (devicePushToken) this.lastNativeToken = devicePushToken.data;
    this.update({ registered: true, preferences: result.preferences,
      status: { ...status, device: { installationId, active: true, disabledReason: null, preferences: result.preferences } } });
  }

  refresh = (): Promise<boolean> => this.run(async () => {
    try { await this.synchronize(false); }
    finally { this.update({ ready: true }); }
    const response = await this.options.adapter.lastResponse();
    this.requireCurrent();
    if (response) await this.openResponse(response);
  });

  retryEnable = (): Promise<boolean> => this.run(async () => {
    await this.synchronize(true);
    if (this.state.registered) this.update({ notice: "Notificaciones activadas para esta sesión." });
  });

  savePreferences = (preferences: NotificationPreferences): Promise<boolean> => this.run(async () => {
    const validated = notificationPreferencesSchema.parse(preferences);
    if (!this.state.optedIn || !this.state.registered || !this.expoToken) throw new Error("MOBILE_PUSH_DEVICE_NOT_REGISTERED");
    await this.synchronize(false, undefined, validated);
    if (!this.state.registered) throw new Error("MOBILE_PUSH_DEVICE_NOT_REGISTERED");
    this.update({ notice: "Preferencias guardadas en el servidor." });
  });

  private async unregister(): Promise<void> {
    const installationId = this.state.installationId ?? await this.options.adapter.getInstallationId();
    this.requireCurrent();
    await this.options.api.notificationUnregister(this.options.session, installationId);
    this.bindingMayExist = false;
    this.requireCurrent();
    this.expoToken = null;
    this.lastNativeToken = null;
    const status = this.state.status;
    this.update({ registered: false, status: status ? { ...status, device: status.device?.installationId === installationId ? { ...status.device, active: false } : status.device } : null });
  }

  disable = (): Promise<boolean> => this.run(async () => {
    await this.options.adapter.writeConsent(this.options.storageKey, false);
    this.requireCurrent();
    this.update({ optedIn: false });
    await this.unregister();
    await this.cleanupOwnedNotifications(false);
    this.update({ notice: "Registro de notificaciones desactivado." });
  });

  openSettings = (): Promise<boolean> => this.run(async () => { await this.options.adapter.openSettings(); });

  loadInbox = (more = false): Promise<boolean> => this.run(async () => {
    if (!this.state.status?.enabled) await this.loadStatus();
    if (!this.state.status?.enabled) throw new Error("MOBILE_PUSH_SERVER_PREREQUISITES");
    const page = more ? this.state.page + 1 : 1;
    if (page > 1000 || (more && !this.state.hasMore)) return;
    const result = notificationInboxSchema.parse(await this.options.api.notificationInbox(this.options.session, page));
    this.requireCurrent();
    if (result.page !== page) throw new Error("MOBILE_PUSH_INVALID_INBOX_PAGE");
    const visible = result.items.filter((item) => notificationForSession(item.data, this.options.session));
    const merged = new Map((more ? this.state.inbox : []).map((item) => [item.id, item]));
    visible.forEach((item) => merged.set(item.id, item));
    this.update({ inbox: [...merged.values()], page, hasMore: result.items.length === 25 && page < 1000 });
  });

  markRead = (eventId: string): Promise<boolean> => this.run(async () => {
    if (!this.state.inbox.some((item) => item.id === eventId)) throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
    await this.readEvent(eventId);
  });

  private async readEvent(eventId: string): Promise<void> {
    const result = notificationReadResultSchema.parse(await this.options.api.notificationRead(this.options.session, eventId));
    this.requireCurrent();
    if (result.id !== eventId) throw new Error("MOBILE_PUSH_INVALID_EVENT");
    this.update({ inbox: this.state.inbox.map((item) => item.id === eventId ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item) });
  }

  sendTest = (): Promise<boolean> => this.run(async () => {
    if (!this.state.registered) throw new Error("MOBILE_PUSH_DEVICE_NOT_REGISTERED");
    notificationTestResultSchema.parse(await this.options.api.notificationTest(this.options.session));
    this.requireCurrent();
    this.update({ notice: "Prueba pendiente en el servidor. Respeta el horario silencioso; no confirma entrega al teléfono." });
  });

  // El payload no identifica al usuario: verificar siempre el evento almacenado de la sesión antes de abrirlo.
  private async findOwnedEvent(value: unknown, cleanup = false): Promise<NotificationData | null> {
    const payload = notificationForSession(value, this.options.session);
    if (!payload) return null;
    for (let page = 1; page <= 1000; page += 1) {
      if (!cleanup) this.requireCurrent();
      const result = notificationInboxSchema.parse(await this.options.api.notificationInbox(this.options.session, page));
      if (!cleanup) this.requireCurrent();
      if (result.page !== page) throw new Error("MOBILE_PUSH_INVALID_INBOX_PAGE");
      const item = result.items.find((entry) => entry.id === payload.eventId);
      if (item) return sameNotification(item.data, payload) ? item.data : null;
      if (result.items.length < 25) return null;
    }
    return null;
  }

  private async openResponse(response: NativeNotificationResponse): Promise<void> {
    this.requireCurrent();
    if (!response.defaultAction) return;
    const payload = notificationForSession(response.data, this.options.session);
    if (!payload) return;
    if (this.events.has(payload.eventId)) { await this.options.adapter.clearResponse(response.identifier); return; }
    if (!this.events.begin(payload.eventId)) return;
    let accepted = false;
    try {
      const owned = await this.findOwnedEvent(payload);
      this.requireCurrent();
      if (!owned) return;
      accepted = await this.options.onOpen(owned, { session: this.options.session, storageKey: this.options.storageKey, isCurrent: this.isCurrent });
      this.requireCurrent();
      if (accepted) {
        await this.options.adapter.clearResponse(response.identifier);
        this.requireCurrent();
        await this.readEvent(payload.eventId);
      }
    } finally { this.events.finish(payload.eventId, accepted); }
  }

  handleResponse = (response: NativeNotificationResponse): Promise<boolean> => this.run(() => this.openResponse(response));
  openInboxItem = (eventId: string): Promise<boolean> => this.run(async () => {
    const item = this.state.inbox.find((entry) => entry.id === eventId);
    if (!item) throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
    const owned = await this.findOwnedEvent(item.data);
    this.requireCurrent();
    if (!owned) throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
    const accepted = await this.options.onOpen(owned, { session: this.options.session, storageKey: this.options.storageKey, isCurrent: this.isCurrent });
    this.requireCurrent();
    if (accepted) {
      this.events.finish(item.id, true);
      const last = await this.options.adapter.lastResponse();
      this.requireCurrent();
      const lastPayload = last ? notificationForSession(last.data, this.options.session) : null;
      if (last && lastPayload && sameNotification(lastPayload, owned)) await this.options.adapter.clearResponse(last.identifier);
      this.requireCurrent();
      await this.readEvent(item.id);
    }
  });

  private async cleanupOwnedNotifications(revoking: boolean, allowNetwork = true): Promise<void> {
    const adapter = this.options.adapter;
    const owned = (value: unknown): Promise<NotificationData | null> => {
      const payload = notificationForSession(value, this.options.session);
      if (!payload) return Promise.resolve(null);
      if (allowNetwork) return this.findOwnedEvent(payload, revoking);
      const cached = this.state.inbox.find((item) => item.id === payload.eventId && sameNotification(item.data, payload));
      return Promise.resolve(cached?.data ?? null);
    };
    const last = await adapter.lastResponse();
    if (last && await owned(last.data)) {
      if (!revoking) this.requireCurrent();
      await adapter.clearResponse(last.identifier);
    }
    for (const notification of await adapter.presented()) {
      if (await owned(notification.data)) {
        if (!revoking) this.requireCurrent();
        await adapter.dismiss(notification.identifier);
      }
    }
  }

  revokeForSession = (): Promise<void> => {
    if (this.revokePending) return this.revokePending;
    this.publish({ busy: true, registered: false, error: null, notice: "Cerrando el registro de notificaciones de esta sesión." });
    this.revoked = true;
    this.revocationRequired = true;
    this.revokePending = (async () => {
      await this.tail;
      this.expoToken = null;
      this.lastNativeToken = null;
      const { adapter, session } = this.options;
      const unsupported = adapter.platform === "unsupported";
      if (!this.remotelyRevoked && session.mode === "live" && session.branchId !== null) {
        const consent = this.state.optedIn || (!this.consentLoaded && !unsupported && await adapter.readConsent(this.options.storageKey));
        const noBinding = !this.bindingMayExist && !consent && this.state.status?.device?.active !== true;
        if (!(noBinding && (unsupported || this.state.status?.enabled === false))) {
          const installationId = this.state.installationId ?? await adapter.getInstallationId();
          await this.options.api.notificationUnregister(session, installationId);
        }
      }
      this.remotelyRevoked = true;
      this.bindingMayExist = false;
      this.detach?.();
      this.detach = null;
      const status = this.state.status;
      this.publish({ status: status ? { ...status, device: status.device?.installationId === this.state.installationId ? { ...status.device, active: false } : status.device } : null });
      try { await this.cleanupOwnedNotifications(true, !unsupported && status?.enabled !== false); }
      catch { throw new Error("MOBILE_PUSH_NOTIFICATION_CLEANUP_FAILED"); }
      this.publish({ busy: false, notice: null });
    })().catch((error: unknown) => {
      this.revokePending = null;
      if (!this.remotelyRevoked) this.revoked = false;
      this.publish({ busy: false, registered: false, notice: null, error: notificationFailure(error) });
      throw new Error(notificationFailure(error));
    });
    return this.revokePending;
  };
}

export function revokeForSession(client: MobileNotificationClient): Promise<void> { return client.revokeForSession(); }