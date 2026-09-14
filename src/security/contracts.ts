export type DeviceLockPreference = "enabled" | "declined";

export type TrustedNativePicker = <T>(operation: () => Promise<T>) => Promise<T>;

export type NativeInteractionPrivacyBarrier = (signal: AbortSignal) => Promise<void>;

export interface NativeInteractionClock {
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}

export type DeviceAuthenticationResult =
  | { success: true }
  | { success: false; error: string };

export interface DeviceSecurityAdapter {
  readPreference(): Promise<"enabled" | "declined" | null>;
  writePreference(value: "enabled" | "declined"): Promise<void>;
  authenticate(): Promise<{ success: true } | { success: false; error: string }>;
  available(): Promise<boolean>;
  platformSupported: boolean;
  initialForeground: boolean;
  cancel(): Promise<void>;
}

export interface DeviceLockSnapshot {
  readonly ready: boolean;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly offered: boolean;
  readonly busy: boolean;
  readonly foreground: boolean;
  readonly error: string | null;
  readonly supported: boolean;
  readonly nativeInteractionPending?: boolean;
}