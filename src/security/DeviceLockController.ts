import type {
  DeviceLockPreference,
  DeviceLockSnapshot,
  DeviceSecurityAdapter,
} from "./contracts";

const messages = {
  load: "No se pudo leer la configuración de seguridad. Reintenta para continuar.",
  save: "No se pudo guardar la configuración de seguridad. Reintenta para confirmar el cambio.",
  configuration: "Configura un PIN, patrón o contraseña en la seguridad del teléfono y vuelve a intentarlo.",
  canceled: "Autenticación cancelada. Si la aplicación está bloqueada, seguirá bloqueada. Pulsa Reintentar para continuar.",
  failed: "No se pudo verificar tu identidad. Si la aplicación está bloqueada, seguirá bloqueada. Pulsa Reintentar.",
  lockout: "La autenticación está temporalmente bloqueada. Usa el PIN, patrón o contraseña del teléfono, o reintenta más tarde.",
  expired: "La aplicación volvió a segundo plano. Pulsa Reintentar para desbloquearla.",
};

interface AuthenticationGrant {
  generation: number;
  backgroundEpoch: number;
}

function authenticationMessage(error: string): string {
  switch (error) {
    case "not_enrolled":
    case "passcode_not_set":
    case "not_available":
    case "NONE":
      return messages.configuration;
    case "user_cancel":
    case "system_cancel":
    case "app_cancel":
    case "cancel":
    case "canceled":
      return messages.canceled;
    case "lockout":
      return messages.lockout;
    default:
      return messages.failed;
  }
}

export class DeviceLockController {
  private snapshot: DeviceLockSnapshot;
  private readonly listeners = new Set<() => void>();
  private preference: DeviceLockPreference | null = null;
  private initialization: Promise<void> | null = null;
  private flight: Promise<void> | null = null;
  private pendingGrant: AuthenticationGrant | null = null;
  private generation = 0;
  private backgroundEpoch = 0;
  private offerSeen = false;
  private disposed = false;
  private authenticating = false;

  constructor(private readonly adapter: DeviceSecurityAdapter) {
    this.snapshot = Object.freeze({
      ready: !adapter.platformSupported,
      enabled: false,
      locked: false,
      offered: false,
      busy: false,
      foreground: adapter.initialForeground,
      error: null,
      supported: adapter.platformSupported,
    });
  }

  getSnapshot = (): DeviceLockSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  initialize = (): Promise<void> => {
    if (this.disposed || this.snapshot.ready) return Promise.resolve();
    if (this.initialization) return this.initialization;
    if (this.flight) return this.flight;
    this.initialization = this.run(async () => {
      try {
        const preference = await this.adapter.readPreference();
        if (this.disposed) return;
        if (preference !== null && preference !== "enabled" && preference !== "declined") {
          this.update({ error: messages.load });
          return;
        }
        this.preference = preference;
        this.update({ ready: true, enabled: preference === "enabled", locked: preference === "enabled" });
      } catch {
        this.update({ error: messages.load });
      }
    });
    return this.initialization;
  };

  retry = (): Promise<void> => {
    if (this.disposed || this.snapshot.ready) return Promise.resolve();
    if (this.flight) return this.flight;
    this.initialization = null;
    return this.initialize();
  };

  setForeground = (foreground: boolean): void => {
    if (this.disposed || this.snapshot.foreground === foreground) return;
    if (!foreground) {
      this.backgroundEpoch += 1;
      this.pendingGrant = null;
      this.update({ foreground, locked: this.snapshot.enabled || this.snapshot.locked });
      return;
    }
    const grant = this.pendingGrant;
    this.pendingGrant = null;
    this.update({
      foreground,
      ...(grant && this.validGrant(grant) ? { locked: false, error: null } : {}),
    });
  };

  offer = (): void => {
    if (!this.canAct() || this.snapshot.enabled || this.snapshot.locked || this.preference !== null || this.offerSeen) return;
    this.offerSeen = true;
    this.update({ offered: true, error: null });
  };

  unlock = (): Promise<void> => {
    if (this.flight) return this.flight;
    if (!this.canAct() || !this.snapshot.locked || this.pendingGrant) return Promise.resolve();
    return this.run(async () => {
      const grant = await this.authenticate();
      if (grant) this.applyGrant(grant);
    });
  };

  enable = (): Promise<void> => {
    if (this.flight) return this.flight;
    if (!this.canAct() || this.snapshot.enabled || this.snapshot.locked) return Promise.resolve();
    return this.run(async () => {
      const grant = await this.authenticate();
      if (!grant || this.disposed) return;
      if (!this.validGrant(grant)) {
        this.update({ error: messages.expired });
        return;
      }
      if (!await this.persist("enabled")) return;
      this.preference = "enabled";
      this.update({ enabled: true, locked: true, offered: false });
      this.applyGrant(grant);
    });
  };

  decline = (): Promise<void> => {
    if (this.flight) return this.flight;
    if (!this.canAct() || this.snapshot.enabled || this.snapshot.locked || !this.snapshot.offered) return Promise.resolve();
    return this.run(async () => {
      if (!await this.persist("declined")) return;
      this.preference = "declined";
      this.update({ offered: false });
    });
  };

  disable = (): Promise<void> => {
    if (this.flight) return this.flight;
    if (!this.canAct() || !this.snapshot.enabled) return Promise.resolve();
    return this.run(async () => {
      const grant = await this.authenticate();
      if (!grant || this.disposed) return;
      if (!this.validGrant(grant)) {
        this.update({ error: messages.expired });
        return;
      }
      if (!await this.persist("declined")) return;
      this.preference = "declined";
      this.pendingGrant = null;
      this.update({ enabled: false, locked: true, offered: false });
      this.applyGrant(grant);
    });
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pendingGrant = null;
    this.listeners.clear();
    if (this.authenticating) {
      try {
        void this.adapter.cancel().catch(() => {});
      } catch {}
    }
  };

  private canAct(): boolean {
    return !this.disposed && this.snapshot.supported && this.snapshot.ready && this.snapshot.foreground && !this.flight;
  }

  private run(operation: () => Promise<void>): Promise<void> {
    this.generation += 1;
    this.pendingGrant = null;
    const flight = Promise.resolve().then(async () => {
      if (!this.disposed) await operation();
    }).finally(() => {
      if (this.flight !== flight) return;
      this.flight = null;
      this.update({ busy: false });
    });
    this.flight = flight;
    this.update({ busy: true, error: null });
    return flight;
  }

  private async authenticate(): Promise<AuthenticationGrant | null> {
    try {
      const available = await this.adapter.available();
      if (this.disposed) return null;
      if (available !== true) {
        this.update({ error: messages.configuration });
        return null;
      }
      if (!this.snapshot.foreground) {
        this.update({ error: messages.expired });
        return null;
      }
      this.authenticating = true;
      const result = await this.adapter.authenticate();
      if (this.disposed) return null;
      if (result.success !== true) {
        this.update({ error: authenticationMessage(result.error) });
        return null;
      }
      // El PIN del sistema puede devolver éxito antes de que la actividad vuelva a primer plano.
      return { generation: this.generation, backgroundEpoch: this.backgroundEpoch };
    } catch {
      this.update({ error: messages.failed });
      return null;
    } finally {
      this.authenticating = false;
    }
  }

  private async persist(preference: DeviceLockPreference): Promise<boolean> {
    try {
      await this.adapter.writePreference(preference);
      return !this.disposed;
    } catch {
      this.update({ error: messages.save, locked: this.snapshot.enabled || this.snapshot.locked });
      return false;
    }
  }

  private validGrant(grant: AuthenticationGrant): boolean {
    return !this.disposed && grant.generation === this.generation && grant.backgroundEpoch === this.backgroundEpoch;
  }

  private applyGrant(grant: AuthenticationGrant): void {
    if (this.disposed) return;
    if (!this.validGrant(grant)) {
      this.update({ locked: true, error: messages.expired });
    } else if (this.snapshot.foreground) {
      this.update({ locked: false, error: null });
    } else {
      this.pendingGrant = grant;
      this.update({ locked: true });
    }
  }

  private update(patch: Partial<DeviceLockSnapshot>): void {
    if (this.disposed) return;
    const next = { ...this.snapshot, ...patch };
    if (next.ready === this.snapshot.ready && next.enabled === this.snapshot.enabled
      && next.locked === this.snapshot.locked && next.offered === this.snapshot.offered
      && next.busy === this.snapshot.busy && next.foreground === this.snapshot.foreground
      && next.error === this.snapshot.error && next.supported === this.snapshot.supported) return;
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) {
      if (this.disposed) break;
      if (!this.listeners.has(listener)) continue;
      try { listener(); } catch {}
    }
  }
}