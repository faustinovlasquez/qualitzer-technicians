import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { readForeground } from "../offline/foreground";
import type { DeviceSecurityAdapter } from "./contracts";

const preferenceKey = "qualitzer.mobile.device-security.v1";

export function createDeviceSecurityAdapter(): DeviceSecurityAdapter {
  return {
    platformSupported: Platform.OS === "android" || Platform.OS === "ios",
    initialForeground: readForeground(),
    async readPreference() {
      const value = await SecureStore.getItemAsync(preferenceKey);
      if (value !== null && value !== "enabled" && value !== "declined") throw new Error("DEVICE_SECURITY_PREFERENCE_INVALID");
      return value;
    },
    async writePreference(value) {
      await SecureStore.setItemAsync(preferenceKey, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    },
    async available() {
      return await LocalAuthentication.getEnrolledLevelAsync() !== LocalAuthentication.SecurityLevel.NONE;
    },
    async authenticate() {
      return LocalAuthentication.authenticateAsync({
        promptMessage: "Desbloquear Qualitzer técnicos",
        promptSubtitle: "Confirma que eres tú",
        promptDescription: "Usa la huella o la seguridad configurada en tu teléfono.",
        cancelLabel: "Cancelar",
        fallbackLabel: "Usar código del teléfono",
        disableDeviceFallback: false,
        biometricsSecurityLevel: Platform.OS === "android" && Number(Platform.Version) < 30 ? "weak" : "strong",
        requireConfirmation: true,
      });
    },
    async cancel() {
      if (Platform.OS === "android") await LocalAuthentication.cancelAuthenticate();
    },
  };
}