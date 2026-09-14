import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BackHandler, Keyboard, Platform, StyleSheet, View } from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import { readForeground, subscribeForeground } from "../offline/foreground";
import { DeviceLockController } from "./DeviceLockController";
import { createDeviceSecurityAdapter } from "./deviceSecurityAdapter";
import { DeviceSecurityContext, type DeviceSecurityUi } from "./DeviceSecurityContext";
import { DeviceLockScreen } from "./DeviceLockScreen";
import { palette } from "../ui/theme";

export function DeviceSecurityProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new DeviceLockController(createDeviceSecurityAdapter()));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const captureBlocked = state.enabled && (state.locked || !state.foreground);
  const privacyMode = `${state.enabled}:${captureBlocked}`;
  const privacyRequest = useRef({ mode: privacyMode, revision: 0 });
  if (privacyRequest.current.mode !== privacyMode) privacyRequest.current = { mode: privacyMode, revision: privacyRequest.current.revision + 1 };
  const privacyTarget = `${privacyRequest.current.revision}:${privacyMode}`;
  const [privacyEnabled, setPrivacyEnabled] = useState<string | null>(state.supported ? null : "0:false:false");
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const mounted = useRef(false);
  const initializationAttempted = useRef(false);
  const protectionTail = useRef<Promise<void>>(Promise.resolve());
  const lifetime = useRef(0);
  const blocked = privacyEnabled !== privacyTarget || !state.ready || state.locked || state.offered || state.busy || (state.supported && !state.foreground);
  const blockedNow = useRef(blocked);
  blockedNow.current = blocked;
  const isUnlocked = useCallback((): boolean => {
    const current = controller.getSnapshot();
    return !blockedNow.current && current.ready && !current.locked && !current.offered && !current.busy && (!current.supported || current.foreground);
  }, [controller]);
  const security = useMemo<DeviceSecurityUi>(() => ({ controller, state, blocked, isUnlocked }), [controller, state, blocked, isUnlocked]);
  if (!blocked) mounted.current = true;

  useEffect(() => {
    const generation = ++lifetime.current;
    controller.setForeground(readForeground());
    const unsubscribe = subscribeForeground(active => {
      const before = controller.getSnapshot();
      controller.setForeground(active);
      if (active && !before.foreground && !before.busy && !before.error && controller.getSnapshot().locked) void controller.unlock();
    });
    void controller.initialize();
    return () => {
      unsubscribe();
      void Promise.resolve().then(() => { if (generation === lifetime.current) controller.dispose(); });
    };
  }, [controller]);

  useEffect(() => {
    if (!state.ready || !state.foreground || state.busy || initializationAttempted.current) return;
    initializationAttempted.current = true;
    if (state.enabled && state.locked) void controller.unlock();
  }, [controller, state.ready, state.foreground, state.busy, state.enabled, state.locked]);

  useEffect(() => {
    if (!state.ready || !state.supported) return;
    let current = true;
    const enabled = state.enabled;
    protectionTail.current = protectionTail.current.catch(() => undefined).then(async () => {
      if (captureBlocked) await ScreenCapture.preventScreenCaptureAsync("qualitzer-device-security");
      else await ScreenCapture.allowScreenCaptureAsync("qualitzer-device-security");
      if (Platform.OS === "ios") {
        if (enabled) await ScreenCapture.enableAppSwitcherProtectionAsync(1);
        else await ScreenCapture.disableAppSwitcherProtectionAsync();
      }
      if (current) { setPrivacyError(null); setPrivacyEnabled(privacyTarget); }
    }).catch(() => { if (current) setPrivacyError("No se pudo activar la protección visual del teléfono."); });
    return () => { current = false; };
  }, [state.ready, state.supported, state.enabled, captureBlocked, privacyTarget]);

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