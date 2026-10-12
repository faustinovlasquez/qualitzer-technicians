import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import type { MobileNotificationsModel } from "./useMobileNotifications";

const GRANTED = new Set(["granted", "provisional", "ephemeral"]);
/** Al volver a la app se revisa de nuevo, sin repetir antes de este intervalo (la ventana del sistema también pausa la app). */
export const PERMISSION_RECHECK_MS = 5 * 60_000;

interface DevicePermission { granted: boolean; canAskAgain?: boolean; status?: string }
type PermissionOutcome = "granted" | "denied" | "blocked" | "unavailable";

/** Muestra la ventana del teléfono si el permiso falta y todavía se puede preguntar; informa si quedó bloqueado. */
async function ensurePermission(read: () => Promise<DevicePermission>, ask: () => Promise<DevicePermission>): Promise<PermissionOutcome> {
  try {
    const current = await read();
    if (current.granted) return "granted";
    if (current.canAskAgain === false) return "blocked";
    const answer = await ask();
    return answer.granted ? "granted" : answer.canAskAgain === false ? "blocked" : "denied";
  } catch {
    // Un permiso que no se puede consultar no debe impedir los demás ni el uso de la app.
    return "unavailable";
  }
}

/** "Notificaciones", "Notificaciones y Cámara", "Notificaciones, Cámara y Ubicación". */
export function permissionList(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/**
 * Paso de seguridad al entrar: la app revisa notificaciones (y activa "Recibir avisos"), cámara y ubicación. Lo que falte
 * se pide con la ventana del teléfono, una tras otra. Se repite al volver a la app (como máximo cada 5 minutos) por si el
 * técnico desactivó algo en Ajustes. Lo bloqueado —el teléfono ya no deja preguntar— se avisa con un acceso a Ajustes.
 */
export function useNotificationPermissionPrompt(notifications: MobileNotificationsModel, allowPrompt: boolean, isUnlocked: () => boolean): void {
  const prompted = useRef<string | null>(null);
  const handledTick = useRef(0);
  const running = useRef(false);
  const lastCheck = useRef(0);
  const warned = useRef("");
  const [foregroundTick, setForegroundTick] = useState(0);
  const { client, state, storageKey } = notifications;
  const latest = useRef({ client, isUnlocked }); latest.current = { client, isUnlocked };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => {
      if (next === "active" && !running.current && Date.now() - lastCheck.current >= PERMISSION_RECHECK_MS) setForegroundTick(value => value + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!client || !state || !allowPrompt || !state.ready || state.busy || running.current) return;
    if ((prompted.current === storageKey && handledTick.current === foregroundTick) || AppState.currentState !== "active" || !isUnlocked()) return;
    prompted.current = storageKey;
    handledTick.current = foregroundTick;
    running.current = true;
    const current = (): boolean => latest.current.client === client && client.isCurrent() && latest.current.isUnlocked();
    void (async () => {
      const blocked: string[] = [];
      try {
        if (!current()) return;
        // La ventana del teléfono aparece aunque el servidor todavía no tenga listo el servicio de avisos.
        // Si el técnico apagó "Recibir avisos" en la app, se respeta: no se le pregunta ni se reactiva.
        const { permission, optedOut } = state.registered && state.optedIn && GRANTED.has(state.permission) ? { permission: state.permission, optedOut: false }
          : await client.requestDevicePermission().catch(() => ({ permission: state.permission, optedOut: !state.optedIn }));
        if (!optedOut && permission === "blocked") blocked.push("Notificaciones");
        else if (!optedOut && GRANTED.has(permission) && state.status?.enabled === true && !state.registered && current()) {
          // Con el permiso concedido, registra este teléfono para recibir los avisos de la empresa.
          await client.retryEnable().catch(() => false);
        }
        if (Platform.OS === "web" || !current()) return;
        if (await ensurePermission(() => ImagePicker.getCameraPermissionsAsync(), () => ImagePicker.requestCameraPermissionsAsync()) === "blocked") blocked.push("Cámara");
        if (!current()) return;
        if (await ensurePermission(() => Location.getForegroundPermissionsAsync(), () => Location.requestForegroundPermissionsAsync()) === "blocked") blocked.push("Ubicación");
        // Un solo aviso por cada combinación bloqueada: "Ahora no" no se repite hasta volver a abrir la app.
        const signature = blocked.join("|");
        if (blocked.length > 0 && signature !== warned.current && current()) {
          warned.current = signature;
          Alert.alert("Activa los permisos de Qualitzer", `${permissionList(blocked)} ${blocked.length === 1 ? "está bloqueado" : "están bloqueados"} en este teléfono. Sin ${blocked.length === 1 ? "este permiso" : "estos permisos"} no recibirás nuevas asignaciones ni recordatorios, y no podrás registrar fotos o ubicación en tus trabajos. Actívalos en Ajustes.`, [
            { text: "Ahora no", style: "cancel" },
            // Al volver desde Ajustes se revisa de inmediato y, si sigue bloqueado, se vuelve a avisar.
            { text: "Abrir ajustes", onPress: () => { warned.current = ""; lastCheck.current = 0; if (current()) void client.openSettings(); } },
          ]);
        }
      } finally {
        lastCheck.current = Date.now();
        running.current = false;
      }
    })();
  }, [client, state?.ready, state?.busy, state?.optedIn, state?.registered, state?.permission, state?.status?.enabled, allowPrompt, storageKey, foregroundTick]);
}
