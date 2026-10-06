import { Appearance, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { reloadAppAsync } from "expo";
import { applyColorScheme, type ColorScheme } from "./theme";

/** Preferencia de apariencia del técnico: claro (por defecto), oscuro o la del teléfono. */
export type ColorPreference = "light" | "dark" | "system";
const KEY = "qualitzer.colorScheme";

export function readColorPreference(): ColorPreference {
  try {
    const value = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : SecureStore.getItem(KEY);
    return value === "dark" || value === "system" ? value : "light";
  } catch { return "light"; }
}

export function resolveColorScheme(preference: ColorPreference, system = Appearance.getColorScheme()): ColorScheme {
  return preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
}

/** Se llama una vez al iniciar, antes de cargar cualquier pantalla. */
export function initColorScheme(): ColorScheme {
  const scheme = resolveColorScheme(readColorPreference());
  applyColorScheme(scheme);
  return scheme;
}

/** Guarda la preferencia y recarga la app para recalcular todos los estilos con la nueva paleta. */
export async function changeColorPreference(preference: ColorPreference): Promise<void> {
  if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, preference);
  else await SecureStore.setItemAsync(KEY, preference);
  if (Platform.OS === "web") { globalThis.location?.reload(); return; }
  await reloadAppAsync("Cambio de apariencia");
}
