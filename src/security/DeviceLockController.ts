import type {
  DeviceLockPreference,
  DeviceLockSnapshot,
  DeviceSecurityAdapter,
  NativeInteractionClock,
  NativeInteractionPrivacyBarrier,
} from "./contracts";
import { nativeInteractionClock, nativeResultOrRevocation, NATIVE_INTERACTION_TIMEOUT_MS, waitForSecurityCondition } from "./trustedNativeInteraction";

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

interface NativeInteractionLease {
  generation: number;
  startedAt: number;
  lastObservedAt: number;
  stage: "preparing" | "native" | "settled";
  cancellation: AbortController;
  cancelTimer(): void;
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
  private nativeInteraction: NativeInteractionLease | null = null;

  constructor(private readonly adapter: DeviceSecurityAdapter, private readonly clock: NativeInteractionClock = nativeInteractionClock) {
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
    const lease = this.nativeInteraction;
    // Solo el SDK aún pendiente admite rebotes; primer plano por sí solo nunca concede acceso.
    if (lease && (!this.validNativeInteraction(lease) || (!foreground && lease.stage !== "native"))) {
      if (!foreground) this.update({ foreground, locked: this.snapshot.enabled || this.snapshot.locked });
      this.revokeNativeInteraction();
    }
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
    this.revokeNativeInteraction();
    if (this.flight) return this.flight;
    if (!this.canAct() || !this.snapshot.locked || this.pendingGrant) return Promise.resolve();
    return this.run(async () => {
      const grant = await this.authenticate();
      if (grant) this.applyGrant(grant);
    });
  };

  enable = (): Promise<void> => {
    this.revokeNativeInteraction();
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
    this.revokeNativeInteraction();
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

  invalidateTrustedNativeInteraction = (): void => {
    this.generation += 1;
    this.pendingGrant = null;
    this.revokeNativeInteraction();
  };

  runTrustedNativePicker = async <T>(
    operation: () => Promise<T>,
    waitForPrivacy: NativeInteractionPrivacyBarrier = async () => {},
    preparePrivacy?: NativeInteractionPrivacyBarrier,
  ): Promise<T> => {
    if (this.disposed || !this.snapshot.ready || !this.snapshot.foreground || this.snapshot.locked
      || this.snapshot.busy || this.snapshot.offered || this.flight || this.pendingGrant || this.nativeInteraction) {
      throw new Error("TRUSTED_NATIVE_INTERACTION_NOT_ALLOWED");
    }
    if (!this.snapshot.supported) return operation();
    const now = this.clock.now();
    if (!Number.isFinite(now)) throw new Error("TRUSTED_NATIVE_INTERACTION_CLOCK_INVALID");
    const lease: NativeInteractionLease = {
      generation: this.generation, startedAt: now, lastObservedAt: now, stage: preparePrivacy ? "preparing" : "native",
      cancellation: new AbortController(), cancelTimer: () => {},
    };
    this.nativeInteraction = lease;
    lease.cancelTimer = this.clock.schedule(() => {
      if (this.nativeInteraction === lease) this.revokeNativeInteraction();
    }, NATIVE_INTERACTION_TIMEOUT_MS);
    this.update({ nativeInteractionPending: true });
    try {
      if (preparePrivacy) {
        try {
          await nativeResultOrRevocation(() => preparePrivacy(lease.cancellation.signal), lease.cancellation.signal);
        } catch {
          throw new Error("TRUSTED_NATIVE_INTERACTION_PRIVACY_UNAVAILABLE");
        }
      }
      if (!this.validNativeInteraction(lease) || !this.snapshot.foreground || this.snapshot.busy || this.snapshot.offered) {
        throw new Error("TRUSTED_NATIVE_INTERACTION_REVOKED");
      }
      lease.stage = "native";
      const result = await nativeResultOrRevocation(operation, lease.cancellation.signal, () => { lease.stage = "settled"; });
      await waitForSecurityCondition(() => {
        if (!this.validNativeInteraction(lease)) throw new Error("TRUSTED_NATIVE_INTERACTION_REVOKED");
        return this.snapshot.foreground;
      }, this.subscribe, lease.cancellation.signal);
      if (!this.validNativeInteraction(lease) || !this.snapshot.foreground) throw new Error("TRUSTED_NATIVE_INTERACTION_REVOKED");
      this.update({ locked: false, nativeInteractionPending: false, error: null });
      await nativeResultOrRevocation(() => waitForPrivacy(lease.cancellation.signal), lease.cancellation.signal);
      if (!this.validNativeInteraction(lease) || !this.snapshot.foreground || this.snapshot.locked || this.snapshot.busy) {
        throw new Error("TRUSTED_NATIVE_INTERACTION_REVOKED");
      }
      this.nativeInteraction = null;
      return result;
    } catch (error) {
      if (!this.validNativeInteraction(lease)) throw new Error("TRUSTED_NATIVE_INTERACTION_REVOKED");
      throw error;
    } finally {
      lease.cancelTimer();
      if (this.nativeInteraction === lease) this.revokeNativeInteraction();
      lease.cancellation.abort();
    }
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.listeners.clear();
    this.invalidateTrustedNativeInteraction();
    this.disposed = true;
    if (this.authenticating) {
      try {
        void this.adapter.cancel().catch(() => {});
      } catch {}
    }
  };

  private canAct(): boolean {
    return !this.disposed && !this.nativeInteraction && this.snapshot.supported && this.snapshot.ready && this.snapshot.foreground && !this.flight;
  }

  private validNativeInteraction(lease: NativeInteractionLease): boolean {
    const now = this.clock.now();
    const valid = !this.disposed && this.nativeInteraction === lease && lease.generation === this.generation
      && !lease.cancellation.signal.aborted && Number.isFinite(now) && now >= lease.lastObservedAt
      && now - lease.startedAt < NATIVE_INTERACTION_TIMEOUT_MS;
    lease.lastObservedAt = now;
    return valid;
  }

  private revokeNativeInteraction(): void {
    const lease = this.nativeInteraction;
    if (!lease) return;
    this.nativeInteraction = null;
    lease.cancelTimer();
    lease.cancellation.abort();
    this.update({ nativeInteractionPending: false, locked: this.snapshot.enabled || this.snapshot.locked, error: null });
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
    const generation = this.generation;
    try {
      const available = await this.adapter.available();
      if (this.disposed || generation !== this.generation) return null;
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
      if (this.disposed || generation !== this.generation) return null;
      if (result.success !== true) {
        this.update({ error: authenticationMessage(result.error) });
        return null;
      }
      // El PIN del sistema puede devolver éxito antes de que la actividad vuelva a primer plano.
      return { generation, backgroundEpoch: this.backgroundEpoch };
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
      && next.nativeInteractionPending === this.snapshot.nativeInteractionPending
      && next.error === this.snapshot.error && next.supported === this.snapshot.supported) return;
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) {
      if (this.disposed) break;
      if (!this.listeners.has(listener)) continue;
      try { listener(); } catch {}
    }
  }
}