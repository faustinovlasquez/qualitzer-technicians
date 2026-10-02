import { useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import type { MobileNotificationsModel } from "./useMobileNotifications";

const MISSING_PERMISSION = new Set(["undetermined", "denied", "blocked"]);

/**
 * Igual que la ubicación: si las notificaciones están activadas pero el teléfono no concedió el permiso,
 * se explica el motivo y se abre el diálogo del sistema (o Ajustes si quedó bloqueado). Una vez por sesión.
 */
export function useNotificationPermissionPrompt(notifications: MobileNotificationsModel, allowPrompt: boolean, isUnlocked: () => boolean): void {
  const prompted = useRef<string | null>(null);
  const { client, state, storageKey } = notifications;
  const latest = useRef({ client, isUnlocked }); latest.current = { client, isUnlocked };
  useEffect(() => {
    if (!client || !state || !allowPrompt || !state.ready || state.busy || !state.optedIn || state.registered || state.status?.enabled !== true) return;
    if (!MISSING_PERMISSION.has(state.permission) || prompted.current === storageKey || AppState.currentState !== "active" || !isUnlocked()) return;
    prompted.current = storageKey;
    const current = (): boolean => latest.current.client === client && client.isCurrent() && latest.current.isUnlocked();
    if (state.permission === "blocked") {
      Alert.alert("Activa las notificaciones", "Las notificaciones de Qualitzer están bloqueadas en este teléfono. Actívalas en Ajustes para recibir nuevas asignaciones, recordatorios del cronómetro y materiales por recibir.", [
        { text: "Ahora no", style: "cancel" }, { text: "Abrir ajustes", onPress: () => { if (current()) void client.openSettings(); } },
      ]);
      return;
    }
    Alert.alert("Activa las notificaciones", "Qualitzer te avisará de nuevas asignaciones, recordatorios del cronómetro y materiales por recibir. A continuación el teléfono te pedirá permiso.", [
      { text: "Ahora no", style: "cancel" }, { text: "Permitir", onPress: () => { if (current()) void client.retryEnable(); } },
    ], { cancelable: false });
  }, [client, state?.ready, state?.busy, state?.optedIn, state?.registered, state?.permission, state?.status?.enabled, allowPrompt, storageKey]);
}
