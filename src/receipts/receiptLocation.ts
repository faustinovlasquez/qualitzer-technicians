import * as Location from "expo-location";
import { AppState } from "react-native";
import type { MaterialReceiptLocation } from "../domain/materialReceipts";

export async function captureMaterialReceiptLocation(isAllowed: () => boolean): Promise<MaterialReceiptLocation> {
  if (!isAllowed() || AppState.currentState !== "active") throw new Error("MATERIAL_RECEIPT_LOCKED");
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!isAllowed() || AppState.currentState !== "active") throw new Error("MATERIAL_RECEIPT_LOCKED");
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
    if (!isAllowed() || AppState.currentState !== "active") throw error;
    return { status: "UNAVAILABLE", reason: "UNAVAILABLE" };
  }
}