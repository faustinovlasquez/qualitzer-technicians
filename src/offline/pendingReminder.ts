import { Platform } from "react-native";

/**
 * Aviso del teléfono cuando se sale de la app con cambios sin enviar: la cola solo se envía con la app abierta, así que a las
 * 2 horas se recuerda abrirla con señal. Se cancela al volver a la app. Si no hay permiso de avisos, no hace nada.
 */
const IDENTIFIER = "qualitzer-offline-pending-reminder";
const DELAY_SECONDS = 2 * 60 * 60;

export async function schedulePendingReminder(pending: number): Promise<void> {
  if (Platform.OS === "web" || pending <= 0) return;
  try {
    const notifications = await import("expo-notifications");
    if (!(await notifications.getPermissionsAsync()).granted) return;
    await notifications.cancelScheduledNotificationAsync(IDENTIFIER).catch(() => undefined);
    await notifications.scheduleNotificationAsync({
      identifier: IDENTIFIER,
      content: {
        title: "Cambios sin enviar",
        body: pending === 1 ? "Tienes 1 cambio guardado en el teléfono. Abre Qualitzer con señal para enviarlo."
          : `Tienes ${pending} cambios guardados en el teléfono. Abre Qualitzer con señal para enviarlos.`,
      },
      trigger: { type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: DELAY_SECONDS, ...(Platform.OS === "android" ? { channelId: "technical-work" } : {}) },
    });
  } catch { /* El recordatorio es una ayuda: si el teléfono no lo permite, la cola sigue guardada. */ }
}

export async function cancelPendingReminder(): Promise<void> {
  if (Platform.OS === "web") return;
  try { await (await import("expo-notifications")).cancelScheduledNotificationAsync(IDENTIFIER); } catch { /* Nada que cancelar. */ }
}
