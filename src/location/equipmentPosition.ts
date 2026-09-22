import * as Location from "expo-location";
import { currentLocationFix } from "./locationRuntime";
import type { GoogleMapPoint } from "./googleMapProtocol";
import { usableLocationFix } from "../domain/locationTracking";

export async function requestEquipmentPosition(): Promise<GoogleMapPoint> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Permite la ubicación durante el uso para seleccionar tu posición actual.");
  const fix = await currentLocationFix();
  if (!fix || !usableLocationFix(fix, Date.now())) throw new Error("No se obtuvo una ubicación reciente con precisión suficiente. Selecciona el punto en el mapa.");
  return { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy ?? undefined };
}