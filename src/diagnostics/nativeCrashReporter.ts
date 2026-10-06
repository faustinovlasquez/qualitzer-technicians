import { Platform } from "react-native";

/**
 * Cierres nativos de Android (fuera de JavaScript) con Firebase Crashlytics, el mismo proyecto Firebase de los avisos push.
 * Solo se asocia el id numérico del usuario y la empresa; nunca correo ni nombre. En web o Expo Go no hace nada.
 */
interface CrashlyticsModule { setUserId(id: string): Promise<void>; setAttribute(name: string, value: string): Promise<void>; recordError(error: Error, name?: string): void; log(message: string): void; }
let cached: CrashlyticsModule | null | undefined;

function crashlytics(): CrashlyticsModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === "web") return cached = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- módulo nativo opcional: no existe en web ni en Expo Go.
    const module = require("@react-native-firebase/crashlytics") as { getCrashlytics?: () => CrashlyticsModule; default?: () => CrashlyticsModule };
    cached = module.getCrashlytics?.() ?? module.default?.() ?? null;
  } catch { cached = null; }
  return cached;
}

export function setCrashContext(context: { userId: number | null; tenant: string | null; branchId: number | null }): void {
  const native = crashlytics();
  if (!native) return;
  void native.setUserId(context.userId === null ? "" : String(context.userId)).catch(() => undefined);
  void native.setAttribute("tenant", context.tenant ?? "").catch(() => undefined);
  void native.setAttribute("branch", context.branchId === null ? "" : String(context.branchId)).catch(() => undefined);
}

export function setCrashScreen(screen: string): void {
  try { crashlytics()?.log(`screen:${screen.slice(0, 60)}`); } catch { /* opcional */ }
}

/** Errores de pantalla capturados por la app (no fatales) también quedan en Crashlytics con su stack. */
export function recordNonFatal(error: unknown, name: string): void {
  try { if (error instanceof Error) crashlytics()?.recordError(error, name); } catch { /* opcional */ }
}
