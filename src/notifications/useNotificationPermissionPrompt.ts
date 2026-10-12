import { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import type { MobileNotificationsModel } from "./useMobileNotifications";

const GRANTED = new Set(["granted", "provisional", "ephemeral"]);

interface DevicePermission { granted: boolean; canAskAgain?: boolean; status?: string }

/** Pide un permiso del teléfono solo si todavía se puede preguntar (no concedido y sin bloqueo permanente). */
async function askIfNeeded(read: () => Promise<DevicePermission>, ask: () => Promise<DevicePermission>): Promise<void> {
  try {
    const current = await read();
    if (current.granted || current.canAskAgain === false) return;
    await ask();
  } catch {
    // Un permiso que no se puede consultar no debe impedir los demás ni el uso de la app.
  }
}

/**
 * Al iniciar sesión, la app pide con la ventana del teléfono los permisos que necesita, uno tras otro:
 * notificaciones (y activa "Recibir avisos"), cámara y ubicación. Una vez por sesión. Si las notificaciones quedaron
 * bloqueadas en Android se ofrece abrir Ajustes; la cámara y la ubicación bloqueadas se gestionan desde Mi perfil.
 */
export function useNotificationPermissionPrompt(notifications: MobileNotificationsModel, allowPrompt: boolean, isUnlocked: () => boolean): void {
  const prompted = useRef<string | null>(null);
  const { client, state, storageKey } = notifications;
  const latest = useRef({ client, isUnlocked }); latest.current = { client, isUnlocked };
  useEffect(() => {
    if (!client || !state || !allowPrompt || !state.ready || state.busy) return;
    if (prompted.current === storageKey || AppState.currentState !== "active" || !isUnlocked()) return;
    prompted.current = storageKey;
    const current = (): boolean => latest.current.client === client && client.isCurrent() && latest.current.isUnlocked();
    void (async () => {
      if (!current()) return;
      // La ventana del teléfono aparece aunque el servidor todavía no tenga listo el servicio de avisos.
      const permission = state.registered && state.optedIn ? state.permission : await client.requestDevicePermission().catch(() => state.permission);
      if (permission === "blocked" && current()) {
        Alert.alert("Activa las notificaciones", "Las notificaciones de Qualitzer están bloqueadas en este teléfono. Actívalas en Ajustes para recibir nuevas asignaciones, recordatorios del cronómetro y materiales por recibir.", [
          { text: "Ahora no", style: "cancel" }, { text: "Abrir ajustes", onPress: () => { if (current()) void client.openSettings(); } },
        ]);
      } else if (GRANTED.has(permission) && state.status?.enabled === true && !state.registered && current()) {
        // Con el permiso concedido, registra este teléfono para recibir los avisos de la empresa.
        await client.retryEnable().catch(() => false);
      }
      if (Platform.OS === "web" || !current()) return;
      await askIfNeeded(() => ImagePicker.getCameraPermissionsAsync(), () => ImagePicker.requestCameraPermissionsAsync());
      if (!current()) return;
      await askIfNeeded(() => Location.getForegroundPermissionsAsync(), () => Location.requestForegroundPermissionsAsync());
    })();
  }, [client, state?.ready, state?.busy, state?.optedIn, state?.registered, state?.permission, state?.status?.enabled, allowPrompt, storageKey]);
}
