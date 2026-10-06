import * as Location from "expo-location";
import { AppState } from "react-native";
import type { MaterialReceiptLocation } from "../domain/materialReceipts";

/** El diálogo de permiso o de GPS deja la app un instante fuera de primer plano: se espera a que vuelva antes de seguir. */
export async function waitForActiveApp(timeoutMs = 3000): Promise<boolean> {
  if (AppState.currentState === "active") return true;
  return await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => { subscription.remove(); resolve(AppState.currentState === "active"); }, timeoutMs);
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") return;
      clearTimeout(timer); subscription.remove(); resolve(true);
    });
  });
}

/**
 * Ubicación de la confirmación. `ensureReady` devuelve el motivo que impide seguir (sesión cambiada, teléfono bloqueado,
 * app en segundo plano) tras esperar a que se recupere, o null. El permiso solo se pide si nunca se respondió:
 * así un permiso ya concedido no abre diálogos que saquen la app de primer plano.
 */
export async function captureMaterialReceiptLocation(ensureReady: () => Promise<string | null>): Promise<MaterialReceiptLocation> {
  const blocked = await ensureReady();
  if (blocked) throw new Error(blocked);
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.status === "undetermined" && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync();
      const after = await ensureReady();
      if (after) throw new Error(after);
    }
    if (!permission.granted) return { status: "UNAVAILABLE", reason: "PERMISSION_DENIED" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const point = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 10000); })
      ]);
      if (!point) return { status: "UNAVAILABLE", reason: "TIMEOUT" };
      if (point.coords.accuracy === null) return { status: "UNAVAILABLE", reason: "UNAVAILABLE" };
      return { status: "AVAILABLE", latitude: point.coords.latitude, longitude: point.coords.longitude, accuracy: point.coords.accuracy, capturedAt: new Date(point.timestamp).toISOString() };
    } finally { if (timer) clearTimeout(timer); }
  } catch (error) {
    if (error instanceof Error && /^MATERIAL_RECEIPT_/.test(error.message)) throw error;
    const blockedAfter = await ensureReady();
    if (blockedAfter) throw new Error(blockedAfter);
    return { status: "UNAVAILABLE", reason: "UNAVAILABLE" };
  }
}
