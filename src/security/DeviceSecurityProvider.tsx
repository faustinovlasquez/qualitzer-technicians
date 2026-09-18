import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BackHandler, Keyboard, Platform, StyleSheet, View } from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import { readForeground, subscribeForeground } from "../offline/foreground";
import { DeviceLockController } from "./DeviceLockController";
import { createDeviceSecurityAdapter } from "./deviceSecurityAdapter";
import { DeviceSecurityContext, type DeviceSecurityUi } from "./DeviceSecurityContext";
import { DeviceLockScreen } from "./DeviceLockScreen";
import { palette } from "../ui/theme";
import type { NativeInteractionPrivacyBarrier, TrustedNativePicker } from "./contracts";

export function DeviceSecurityProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new DeviceLockController(createDeviceSecurityAdapter()));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const privacy = useRef({ mode: state.supported ? "" : "false:false", revision: 0, readyRevision: state.supported ? -1 : 0, active: !state.supported, failed: false });
  const privacyListeners = useRef(new Set<() => void>());
  const [, refreshPrivacy] = useState(0);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [nativePickerActive, setNativePickerActive] = useState(false);
  const mounted = useRef(false);
  const initializationAttempted = useRef(false);
  const protectionTail = useRef<Promise<void>>(Promise.resolve());
  const lifetime = useRef(0);
  const isUnlocked = useCallback((): boolean => {
    const current = controller.getSnapshot();
    const captureBlocked = Boolean(current.nativeInteractionPending) || current.enabled && (current.locked || !current.foreground);
    return privacy.current.active && privacy.current.readyRevision === privacy.current.revision && !privacy.current.failed
      && privacy.current.mode === `${current.enabled}:${captureBlocked}`
      && current.ready && !current.locked && !current.offered && !current.busy && !current.nativeInteractionPending
      && (!current.supported || current.foreground);
  }, [controller]);
  const notifyPrivacy = useCallback(() => {
    refreshPrivacy(value => value + 1);
    for (const listener of [...privacyListeners.current]) listener();
  }, []);
  const synchronizePrivacy = useCallback(() => {
    const current = controller.getSnapshot();
    if (!privacy.current.active || !current.ready) return;
    const captureBlocked = Boolean(current.nativeInteractionPending) || current.enabled && (current.locked || !current.foreground);
    const mode = `${current.enabled}:${captureBlocked}`;
    if (privacy.current.mode === mode) return;
    privacy.current.mode = mode;
    const revision = ++privacy.current.revision;
    const generation = lifetime.current;
    privacy.current.failed = false;
    notifyPrivacy();
    if (!current.supported) { privacy.current.readyRevision = revision; notifyPrivacy(); return; }
    protectionTail.current = protectionTail.current.catch(() => undefined).then(async () => {
      if (!privacy.current.active || generation !== lifetime.current) return;
      if (captureBlocked) await ScreenCapture.preventScreenCaptureAsync("qualitzer-device-security");
      else await ScreenCapture.allowScreenCaptureAsync("qualitzer-device-security");
      if (Platform.OS === "ios") {
        if (current.enabled) await ScreenCapture.enableAppSwitcherProtectionAsync(1);
        else await ScreenCapture.disableAppSwitcherProtectionAsync();
      }
      if (!privacy.current.active || generation !== lifetime.current || revision !== privacy.current.revision) return;
      privacy.current.readyRevision = revision;
      setPrivacyError(null);
      notifyPrivacy();
    }).catch(() => {
      if (!privacy.current.active || generation !== lifetime.current || revision !== privacy.current.revision) return;
      privacy.current.failed = true;
      setPrivacyError("No se pudo activar la protección visual del teléfono.");
      if (controller.getSnapshot().nativeInteractionPending) controller.invalidateTrustedNativeInteraction();
      notifyPrivacy();
    });
  }, [controller, notifyPrivacy]);
  const waitForPrivacy = useCallback((preparing: boolean): NativeInteractionPrivacyBarrier => signal => {
    synchronizePrivacy();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { privacyListeners.current.delete(check); signal.removeEventListener("abort", check); };
      const check = () => {
        const current = controller.getSnapshot();
        if (signal.aborted || !privacy.current.active || privacy.current.failed) {
          cleanup(); reject(new Error("TRUSTED_NATIVE_INTERACTION_PRIVACY_UNAVAILABLE"));
        } else if (preparing
          ? current.ready && current.foreground && current.nativeInteractionPending && !current.busy && !current.offered
            && privacy.current.mode === `${current.enabled}:true` && privacy.current.readyRevision === privacy.current.revision
          : isUnlocked()) { cleanup(); resolve(); }
      };
      privacyListeners.current.add(check);
      signal.addEventListener("abort", check, { once: true });
      check();
    });
  }, [controller, isUnlocked, synchronizePrivacy]);
  const runTrustedNativePicker = useCallback<TrustedNativePicker>(async operation => {
    if (!isUnlocked()) throw new Error("TRUSTED_NATIVE_INTERACTION_NOT_ALLOWED");
    setNativePickerActive(true);
    try { return await controller.runTrustedNativePicker(operation, waitForPrivacy(false), waitForPrivacy(true)); }
    finally { setNativePickerActive(false); }
  }, [controller, isUnlocked, waitForPrivacy]);
  const blocked = !isUnlocked();
  const security = useMemo<DeviceSecurityUi>(() => ({ controller, state, blocked, isUnlocked, runTrustedNativePicker, nativePickerActive }), [controller, state, blocked, isUnlocked, runTrustedNativePicker, nativePickerActive]);
  if (!blocked) mounted.current = true;

  useEffect(() => {
    const generation = ++lifetime.current;
    privacy.current.active = true;
    privacy.current.mode = "";
    let previous = controller.getSnapshot();
    const detachState = controller.subscribe(() => {
      const before = previous;
      previous = controller.getSnapshot();
      synchronizePrivacy();
      if (privacy.current.active && !privacy.current.failed && (before.nativeInteractionPending && !previous.nativeInteractionPending || !before.locked && previous.locked)
        && previous.foreground && previous.enabled && previous.locked && !previous.busy && !previous.error
        && !previous.nativeInteractionPending) void controller.unlock();
    });
    controller.setForeground(readForeground());
    synchronizePrivacy();
    const unsubscribe = subscribeForeground(active => {
      const before = controller.getSnapshot();
      controller.setForeground(active);
      if (active && !before.foreground && !before.busy && !before.error && !controller.getSnapshot().nativeInteractionPending && controller.getSnapshot().locked) void controller.unlock();
    });
    void controller.initialize();
    return () => {
      privacy.current.active = false;
      controller.invalidateTrustedNativeInteraction();
      for (const listener of [...privacyListeners.current]) listener();
      detachState();
      unsubscribe();
      void Promise.resolve().then(() => { if (generation === lifetime.current) controller.dispose(); });
    };
  }, [controller, synchronizePrivacy, notifyPrivacy]);

  useEffect(() => {
    if (!state.ready || !state.foreground || state.busy || state.nativeInteractionPending || initializationAttempted.current) return;
    initializationAttempted.current = true;
    if (state.enabled && state.locked) void controller.unlock();
  }, [controller, state.ready, state.foreground, state.busy, state.enabled, state.locked, state.nativeInteractionPending]);

  useEffect(() => {
    if (!blocked) return;
    Keyboard.dismiss();
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [blocked]);

  return <DeviceSecurityContext.Provider value={security}>
    <View style={styles.root}>
      <View style={[styles.root, blocked && styles.hidden]} pointerEvents={blocked ? "none" : "auto"}
        accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}>
        {mounted.current ? children : null}
      </View>
      {blocked ? <View style={styles.cover} accessibilityViewIsModal><DeviceLockScreen security={security} privacyError={privacyError} /></View> : null}
    </View>
  </DeviceSecurityContext.Provider>;
}

const styles = StyleSheet.create({ root: { flex: 1, minHeight: 0, backgroundColor: palette.background }, hidden: { display: "none" }, cover: { ...StyleSheet.absoluteFill, backgroundColor: palette.background } });