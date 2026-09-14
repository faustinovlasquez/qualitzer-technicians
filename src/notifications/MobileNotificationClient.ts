import {
  notificationDeviceInputSchema, notificationDeviceResultSchema, notificationInboxSchema, notificationPreferencesSchema,
  notificationReadResultSchema, notificationDeleteResultSchema, notificationStatusSchema, notificationTestResultSchema,
  type NotificationData, type NotificationInboxItem, type NotificationPreferences, type NotificationStatus,
} from "../domain/notifications";
import type { NativeNotificationResponse, NativePushToken, NotificationClientOptions, NotificationPermission } from "./contracts";
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationEventDeduper, notificationFailure, notificationForSession, permissionAllowsPush, sameNotification } from "./notificationSafety";

export async function notificationReadWithTimeout<T>(pending: Promise<T>, milliseconds = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("MOBILE_PUSH_NATIVE_TIMEOUT")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

interface InboxPageStore {
  items: NotificationInboxItem[];
  page: number;
  hasMore: boolean;
  total: number | null;
}

export interface MobileNotificationState {
  ready: boolean;
  busy: boolean;
  inboxBusy: boolean;
  filterLocal: boolean;
  inboxError: string | null;
  permission: NotificationPermission;
  optedIn: boolean;
  registered: boolean;
  installationId: string | null;
  status: NotificationStatus | null;
  preferences: NotificationPreferences;
  inbox: NotificationInboxItem[];
  unreadCount: number | null;
  total: number | null;
  canDelete: boolean;
  unreadOnly: boolean;
  page: number;
  hasMore: boolean;
  error: string | null;
  notice: string | null;
}

export class MobileNotificationClient {
  private state: MobileNotificationState = {
    ready: false, busy: false, inboxBusy: false, filterLocal: true, inboxError: null, permission: "unknown", optedIn: false, registered: false,
    installationId: null, status: null, preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    inbox: [], unreadCount: null, total: null, canDelete: false, unreadOnly: false, page: 0, hasMore: false, error: null, notice: null,
  };
  private readonly subscribers = new Set<() => void>();
  private readonly events = new NotificationEventDeduper();
  private tail: Promise<unknown> = Promise.resolve();
  private inboxTail: Promise<unknown> = Promise.resolve();
  private inboxOperations = 0;
  private inboxLoad: { more: boolean; unreadOnly: boolean; pending: Promise<boolean> } | null = null;
  private refreshPending: Promise<boolean> | null = null;
  private statusPending: Promise<NotificationStatus> | null = null;
  private filterRejected = false;
  private allInbox: InboxPageStore = { items: [], page: 0, hasMore: false, total: null };
  private unreadInbox: InboxPageStore = { items: [], page: 0, hasMore: false, total: null };
  private badgeCount: number | null = null;
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
  private readonly receivedEvents = new NotificationEventDeduper();
  private testPending: Promise<boolean> | null = null;

  constructor(readonly options: NotificationClientOptions) {}

  getSnapshot = (): MobileNotificationState => this.state;
  subscribe = (callback: () => void): (() => void) => {
    this.subscribers.add(callback);
    return () => { this.subscribers.delete(callback); };
  };
  isCurrent = (): boolean => this.active && !this.revoked && this.options.isCurrent();
  private interactionAllowed(): boolean { return this.options.isInteractionAllowed?.() ?? true; }
  private requireInteraction(): void { if (!this.interactionAllowed()) throw new Error("MOBILE_PUSH_APP_LOCKED"); }
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

  private runInbox(operation: () => Promise<void>): Promise<boolean> {
    this.inboxLoad = null;
    this.inboxOperations += 1;
    this.update({ inboxBusy: true });
    const pending = this.inboxTail.then(async () => {
      if (!this.isCurrent()) return false;
      this.update({ inboxError: null, notice: null });
      try {
        const { session } = this.options;
        if (session.mode !== "live" || session.branchId === null || session.user.workerId === null) throw new Error("MOBILE_PUSH_SESSION_NOT_READY");
        await operation();
        return this.isCurrent();
      } catch (error: unknown) {
        this.update({ inboxError: notificationFailure(error) });
        return false;
      }
    }).finally(() => {
      this.inboxOperations -= 1;
      this.update({ inboxBusy: this.inboxOperations > 0 });
    });
    this.inboxTail = pending;
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
      shouldPresent: (notification) => {
        if (!this.isCurrent() || this.revocationRequired || !this.state.optedIn || !this.state.registered || !permissionAllowsPush(this.state.permission)) return false;
        const data = notificationForSession(notification.data, session);
        return data !== null && !this.events.has(data.eventId) && (data.recipient !== undefined || this.state.inbox.some(item => sameNotification(item.data, data)));
      },
      response: (response) => { void this.handleResponse(response); },
      received: (notification) => {
        const payload = notificationForSession(notification.data, session);
        if (!this.isCurrent() || this.revocationRequired || !payload || !this.receivedEvents.begin(payload.eventId)) return;
        void this.runInbox(async () => {
          let confirmed = false;
          try {
            const owned = await this.findOwnedEvent(notification.data);
            this.requireCurrent();
            if (owned) {
              confirmed = true;
              await this.fetchInbox(false, this.state.unreadOnly);
              this.update({ notice: owned.kind === "RUNNING_TIMER_REMINDER" ? "Hay un cronómetro pendiente de revisión." : owned.kind === "MOBILE_PUSH_TEST" ? "Se recibió una notificación de prueba en esta app." : "Hay una nueva asignación técnica. Actualiza tus trabajos." });
              void Promise.resolve(this.options.onForegroundRefresh?.({ session: this.options.session, storageKey: this.options.storageKey, isCurrent: this.isCurrent })).catch(() => {});
            }
          } finally { this.receivedEvents.finish(payload.eventId, confirmed); }
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

  private loadStatus(): Promise<NotificationStatus> {
    if (this.statusPending) return this.statusPending;
    const pending = (async () => {
      const status = notificationStatusSchema.parse(await this.options.api.notificationStatus(this.options.session));
      this.requireCurrent();
      const registered = this.state.registered && status.enabled && status.device?.active === true && status.device.installationId === this.state.installationId;
      this.update({ status, registered });
      return status;
    })().finally(() => { if (this.statusPending === pending) this.statusPending = null; });
    this.statusPending = pending;
    return pending;
  }

  private project(status: NotificationStatus): string {
    if (!status.enabled) throw new Error("MOBILE_PUSH_SERVER_PREREQUISITES");
    if (!this.options.adapter.projectId) throw new Error("MOBILE_PUSH_PROJECT_MISSING");
    if (this.options.adapter.projectId !== status.projectId) throw new Error("MOBILE_PUSH_PROJECT_MISMATCH");
    return this.options.adapter.projectId;
  }

  private async synchronize(explicit: boolean, devicePushToken?: NativePushToken, preferences?: NotificationPreferences): Promise<void> {
    const interactive = explicit || preferences !== undefined;
    if (this.revocationRequired) throw new Error("MOBILE_PUSH_REVOCATION_PENDING");
    const { adapter, storageKey } = this.options;
    const status = await this.loadStatus();
    if (adapter.platform === "unsupported") {
      this.update({ ready: true, permission: "unsupported", registered: false });
      return;
    }
    const installationId = await notificationReadWithTimeout(adapter.getInstallationId());
    this.requireCurrent();
    if (!this.consentLoaded) {
      const optedIn = await notificationReadWithTimeout(adapter.readConsent(storageKey));
      this.requireCurrent();
      this.consentLoaded = true;
      this.update({ optedIn });
    }
    const ownDevice = status.device?.installationId === installationId ? status.device : null;
    if (ownDevice?.active) this.bindingMayExist = true;
    this.update({ installationId, ...(ownDevice ? { preferences: ownDevice.preferences } : {}) });
    let permission = await notificationReadWithTimeout(adapter.getPermission());
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
      this.requireInteraction();
      if (permission === "blocked") throw new Error("MOBILE_PUSH_PERMISSION_BLOCKED");
      await adapter.prepareChannel();
      this.requireCurrent();
      this.requireInteraction();
      if (!permissionAllowsPush(permission)) permission = await adapter.requestPermission();
      this.requireCurrent();
      this.update({ permission });
      if (!permissionAllowsPush(permission)) throw new Error("MOBILE_PUSH_PERMISSION_DENIED");
      this.requireInteraction();
      await adapter.writeConsent(storageKey, true);
      this.requireCurrent();
      this.update({ optedIn: true });
    } else {
      await adapter.prepareChannel();
      this.requireCurrent();
    }
    const expoPushToken = await notificationReadWithTimeout(adapter.getExpoToken(projectId, devicePushToken));
    this.requireCurrent();
    const selectedPreferences = preferences ?? this.state.preferences;
    const input = notificationDeviceInputSchema.parse({ installationId, expoPushToken, projectId, platform: adapter.platform,
      companyBranchId: this.options.session.branchId, preferences: selectedPreferences });
    if (interactive) this.requireInteraction();
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

  refresh = (): Promise<boolean> => {
    const inbox = this.queueInboxLoad(false, this.state.unreadOnly);
    if (!this.refreshPending) {
      const pending = this.run(async () => {
        try { await this.synchronize(false); }
        finally { this.update({ ready: true }); }
        const response = await notificationReadWithTimeout(this.options.adapter.lastResponse(), 2_000);
        this.requireCurrent();
        if (response) await this.handleResponse(response);
      }).finally(() => { if (this.refreshPending === pending) this.refreshPending = null; });
      this.refreshPending = pending;
    }
    return Promise.all([inbox, this.refreshPending]).then(results => results.every(Boolean));
  };

  retryEnable = (): Promise<boolean> => this.run(async () => {
    this.requireInteraction();
    await this.synchronize(true);
    if (this.state.registered) this.update({ notice: "Notificaciones activadas para esta sesión." });
  });

  savePreferences = (preferences: NotificationPreferences): Promise<boolean> => this.run(async () => {
    this.requireInteraction();
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
    this.requireInteraction();
    await this.options.adapter.writeConsent(this.options.storageKey, false);
    this.requireCurrent();
    this.update({ optedIn: false });
    await this.unregister();
    await this.cleanupOwnedNotifications(false);
    this.update({ notice: "Registro de notificaciones desactivado." });
  });

  openSettings = (): Promise<boolean> => this.run(async () => { this.requireInteraction(); await this.options.adapter.openSettings(); });

  private async fetchInbox(more: boolean, unreadOnly: boolean): Promise<void> {
    if (!this.state.status?.enabled) await this.loadStatus();
    if (!this.state.status?.enabled) throw new Error("MOBILE_PUSH_SERVER_PREREQUISITES");
    const serverFilter = unreadOnly && this.state.canDelete && !this.filterRejected;
    const store = serverFilter ? this.unreadInbox : this.allInbox;
    const page = more ? store.page + 1 : 1;
    if (page > 1000 || (more && !store.hasMore)) return;
    const result = notificationInboxSchema.parse(await this.options.api.notificationInbox(this.options.session, page, serverFilter));
    this.requireCurrent();
    if (result.page !== page) throw new Error("MOBILE_PUSH_INVALID_INBOX_PAGE");
    if (serverFilter && (result.canDelete !== true || result.items.some(item => item.readAt !== null))) {
      this.filterRejected = true;
      this.unreadInbox = { items: [], page: 0, hasMore: false, total: null };
      this.update({ unreadCount: null, canDelete: result.canDelete === true });
      this.publishInbox();
      await this.fetchInbox(false, unreadOnly);
      return;
    }
    const visible = result.items.filter((item) => notificationForSession(item.data, this.options.session));
    const merged = new Map((page > 1 ? store.items : []).map((item) => [item.id, item]));
    visible.forEach((item) => merged.set(item.id, item));
    const unreadCount = result.unreadCount ?? null;
    const next = { items: [...merged.values()], page, total: result.total ?? null,
      hasMore: (result.total == null ? result.items.length === 25 : page * 25 < result.total) && page < 1000 };
    if (serverFilter) this.unreadInbox = next;
    else this.allInbox = next;
    this.update({ unreadCount, canDelete: result.canDelete === true });
    this.publishInbox();
    await this.updateBadge(unreadCount);
    if (!serverFilter && this.state.unreadOnly && !this.state.filterLocal && this.unreadInbox.page === 0) await this.fetchInbox(false, true);
  }

  private publishInbox(): void {
    const filterLocal = !this.state.canDelete || this.filterRejected;
    const store = this.state.unreadOnly && !filterLocal ? this.unreadInbox : this.allInbox;
    this.update({ filterLocal, inbox: this.state.unreadOnly ? store.items.filter(item => item.readAt === null) : store.items,
      page: store.page, hasMore: store.hasMore, total: this.state.unreadOnly && filterLocal ? null : store.total });
  }

  private async updateBadge(count: number | null): Promise<void> {
    if (count === null || count === this.badgeCount || !this.isCurrent() || !this.options.adapter.setBadge) return;
    this.badgeCount = count;
    try { await notificationReadWithTimeout(this.options.adapter.setBadge(count), 2_000); }
    catch {}
  }

  private queueInboxLoad(more: boolean, unreadOnly: boolean, interactive = false): Promise<boolean> {
    if (this.inboxLoad?.more === more && (this.inboxLoad.unreadOnly === unreadOnly || this.state.filterLocal)) return this.inboxLoad.pending;
    const pending = this.runInbox(async () => {
      if (interactive) this.requireInteraction();
      await this.fetchInbox(more, this.state.unreadOnly);
    }).finally(() => {
      if (this.inboxLoad?.pending === pending) this.inboxLoad = null;
    });
    this.inboxLoad = { more, unreadOnly, pending };
    return pending;
  }

  loadInbox = (more = false, unreadOnly = this.state.unreadOnly): Promise<boolean> => {
    if (!this.isCurrent() || !this.interactionAllowed()) return Promise.resolve(false);
    const changed = unreadOnly !== this.state.unreadOnly;
    this.update({ unreadOnly });
    this.publishInbox();
    if (changed && this.state.filterLocal && this.allInbox.page > 0 && !more) return Promise.resolve(true);
    return this.queueInboxLoad(more, unreadOnly, true);
  };

  markRead = (eventId: string): Promise<boolean> => this.runInbox(async () => {
    this.requireInteraction();
    if (!this.state.inbox.some((item) => item.id === eventId)) throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
    await this.readEvent(eventId);
  });

  private async readEvent(eventId: string): Promise<void> {
    this.requireCurrent();
    this.requireInteraction();
    const previous = this.state.inbox.find(item => item.id === eventId) ?? this.allInbox.items.find(item => item.id === eventId) ?? this.unreadInbox.items.find(item => item.id === eventId);
    const result = notificationReadResultSchema.parse(await this.options.api.notificationRead(this.options.session, eventId));
    this.requireCurrent();
    if (result.id !== eventId) throw new Error("MOBILE_PUSH_INVALID_EVENT");
    const unread = previous?.readAt === null;
    const unreadCount = this.state.unreadCount === null ? null : Math.max(0, this.state.unreadCount - (unread ? 1 : 0));
    const owned = previous?.data;
    this.allInbox.items = this.allInbox.items.map(item => item.id === eventId ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item);
    this.unreadInbox.items = this.unreadInbox.items.filter(item => item.id !== eventId);
    if (unread && this.unreadInbox.total !== null) this.unreadInbox.total = Math.max(0, this.unreadInbox.total - 1);
    this.update({ unreadCount });
    this.publishInbox();
    await this.updateBadge(unreadCount);
    if (owned) await this.dismissEvent(owned);
    try { await this.fetchInbox(false, this.state.unreadOnly); } catch { this.update({ notice: "Lectura guardada. Actualiza la bandeja para consultar el contador actual." }); }
  }

  deleteNotification = (eventId: string): Promise<boolean> => this.runInbox(async () => {
    this.requireInteraction();
    const owned = this.state.inbox.find(item => item.id === eventId);
    if (!owned) throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
    if (!this.state.canDelete) throw new Error("MOBILE_PUSH_INBOX_UPDATE_REQUIRED");
    const result = notificationDeleteResultSchema.parse(await this.options.api.notificationDelete(this.options.session, eventId));
    this.requireCurrent();
    if (result.id !== eventId) throw new Error("MOBILE_PUSH_INVALID_EVENT");
    const unreadCount = this.state.unreadCount === null ? null : Math.max(0, this.state.unreadCount - (owned.readAt === null ? 1 : 0));
    this.allInbox.items = this.allInbox.items.filter(item => item.id !== eventId);
    this.unreadInbox.items = this.unreadInbox.items.filter(item => item.id !== eventId);
    if (this.allInbox.total !== null) this.allInbox.total = Math.max(0, this.allInbox.total - 1);
    if (owned.readAt === null && this.unreadInbox.total !== null) this.unreadInbox.total = Math.max(0, this.unreadInbox.total - 1);
    this.update({ unreadCount });
    this.publishInbox();
    this.events.finish(eventId, true);
    await this.updateBadge(unreadCount);
    await this.dismissEvent(owned.data);
    try { await this.fetchInbox(false, this.state.unreadOnly); this.update({ notice: "Notificación eliminada de tu bandeja." }); }
    catch { this.update({ notice: "Notificación eliminada. Actualiza la bandeja para consultar el contador actual." }); }
  });

  private async dismissEvent(owned: NotificationData): Promise<void> {
    try {
      const adapter = this.options.adapter;
      const last = await notificationReadWithTimeout(adapter.lastResponse(), 2_000);
      this.requireCurrent();
      const payload = last ? notificationForSession(last.data, this.options.session) : null;
      if (last && payload && sameNotification(payload, owned)) await notificationReadWithTimeout(adapter.clearResponse(last.identifier), 2_000);
      for (const item of await notificationReadWithTimeout(adapter.presented(), 2_000)) {
        this.requireCurrent();
        const data = notificationForSession(item.data, this.options.session);
        if (data && sameNotification(data, owned)) await notificationReadWithTimeout(adapter.dismiss(item.identifier), 2_000);
      }
    } catch {}
  }

  sendTest = (): Promise<boolean> => {
    if (this.testPending) return this.testPending;
    const pending = this.run(async () => {
      this.requireInteraction();
      if (!this.state.registered) throw new Error("MOBILE_PUSH_DEVICE_NOT_REGISTERED");
      notificationTestResultSchema.parse(await this.options.api.notificationTest(this.options.session));
      this.requireCurrent();
      try { if (!await this.queueInboxLoad(false, this.state.unreadOnly)) throw new Error("MOBILE_PUSH_INBOX_REFRESH_FAILED"); }
      catch { this.update({ notice: "Prueba registrada. Actualiza la bandeja; no vuelvas a enviarla por un fallo de actualización." }); return; }
      this.update({ notice: "Prueba pendiente en el servidor. Respeta el horario silencioso; no confirma entrega al teléfono." });
    }).finally(() => { if (this.testPending === pending) this.testPending = null; });
    this.testPending = pending;
    return pending;
  };

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
    if (!this.interactionAllowed()) return;
    if (!response.defaultAction) return;
    const payload = notificationForSession(response.data, this.options.session);
    if (!payload) return;
    if (this.events.has(payload.eventId)) { await notificationReadWithTimeout(this.options.adapter.clearResponse(response.identifier), 2_000).catch(() => {}); return; }
    if (!this.events.begin(payload.eventId)) return;
    let accepted = false;
    try {
      const owned = await this.findOwnedEvent(payload);
      this.requireCurrent();
      this.requireInteraction();
      if (!owned) return;
      accepted = await this.options.onOpen(owned, { session: this.options.session, storageKey: this.options.storageKey, isCurrent: this.isCurrent });
      this.requireCurrent();
      if (accepted) {
        await notificationReadWithTimeout(this.options.adapter.clearResponse(response.identifier), 2_000);
        this.requireCurrent();
        await this.readEvent(payload.eventId);
      }
    } finally { this.events.finish(payload.eventId, accepted); }
  }

  handleResponse = (response: NativeNotificationResponse): Promise<boolean> => this.runInbox(() => this.openResponse(response));
  openInboxItem = (eventId: string): Promise<boolean> => this.runInbox(async () => {
    this.requireInteraction();
    const item = this.state.inbox.find((entry) => entry.id === eventId);
    if (!item) throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
    const owned = await this.findOwnedEvent(item.data);
    this.requireCurrent();
    this.requireInteraction();
    if (!owned) throw new Error("MOBILE_PUSH_EVENT_NOT_FOUND");
    const accepted = await this.options.onOpen(owned, { session: this.options.session, storageKey: this.options.storageKey, isCurrent: this.isCurrent });
    this.requireCurrent();
    if (accepted) {
      this.events.finish(item.id, true);
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
      await Promise.all([this.tail, this.inboxTail]);
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
      await this.options.adapter.setBadge?.(0).catch(() => false);
      this.detach?.();
      this.detach = null;
      const status = this.state.status;
      this.publish({ status: status ? { ...status, device: status.device?.installationId === this.state.installationId ? { ...status.device, active: false } : status.device } : null });
      try { await this.cleanupOwnedNotifications(true, !unsupported && status?.enabled !== false); }
      catch { throw new Error("MOBILE_PUSH_NOTIFICATION_CLEANUP_FAILED"); }
      this.publish({ busy: false, inboxBusy: false, notice: null });
    })().catch((error: unknown) => {
      this.revokePending = null;
      if (!this.remotelyRevoked) this.revoked = false;
      this.publish({ busy: false, inboxBusy: this.inboxOperations > 0, registered: false, notice: null, error: notificationFailure(error) });
      throw new Error(notificationFailure(error));
    });
    return this.revokePending;
  };
}

export function revokeForSession(client: MobileNotificationClient): Promise<void> { return client.revokeForSession(); }