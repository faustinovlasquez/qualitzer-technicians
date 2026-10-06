import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { appErrorSchema, type AppError, type AppErrorPort } from "../domain/diagnostics";

const STORAGE_KEY = "qualitzer:app-errors:v1";
const MAX_QUEUED = 20;
let queue: AppError[] = [];
let loaded: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let screen: string | null = null;
let installed = false;

/** Datos sensibles fuera: correos, tokens y números largos se reemplazan antes de guardar o enviar. */
export function redactAppErrorText(value: string): string {
  return value.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo]").replace(/\b(Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
    .replace(/\b(?:ExponentPushToken|ExpoPushToken)\[[^\]]+\]/g, "[push]").replace(/\b\d{9,}\b/g, "[número]");
}

export function appErrorEntry(error: unknown, source: AppError["source"], fatal: boolean, now = new Date()): AppError | null {
  const raw = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Error desconocido");
  const message = redactAppErrorText(`${raw.name && raw.name !== "Error" ? `${raw.name}: ` : ""}${raw.message || "Error sin mensaje"}`).slice(0, 1000);
  const parsed = appErrorSchema.safeParse({
    message, stack: raw.stack ? redactAppErrorText(raw.stack).slice(0, 6000) : null, source, fatal, screen,
    appVersion: Constants.expoConfig?.version ?? "0.0.0", platform: Platform.OS === "ios" ? "ios" : Platform.OS === "web" ? "web" : "android", occurredAt: now.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

async function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(STORAGE_KEY).then(raw => {
    const stored: unknown = raw ? JSON.parse(raw) : [];
    const valid = Array.isArray(stored) ? stored.flatMap(item => { const parsed = appErrorSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }) : [];
    queue = [...valid, ...queue].slice(-MAX_QUEUED);
  }).catch(() => undefined);
  await loaded;
}

async function persist(): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED))); } catch { /* sin almacenamiento: se pierde solo el reporte */ }
}

/** Pestaña o pantalla activa: acompaña al error para saber dónde ocurrió. */
export function setAppErrorScreen(value: string | null): void { screen = value ? value.slice(0, 60) : null; }

/** Guarda el error en el teléfono; se envía al recuperar sesión y conexión. Nunca lanza. */
export async function recordAppError(error: unknown, source: AppError["source"], fatal = false): Promise<void> {
  try {
    const entry = appErrorEntry(error, source, fatal);
    if (!entry) return;
    await load();
    // Un mismo error repetido en bucle se guarda una vez por minuto.
    if (queue.some(item => item.message === entry.message && Date.parse(entry.occurredAt) - Date.parse(item.occurredAt) < 60_000)) return;
    queue = [...queue, entry].slice(-MAX_QUEUED);
    await persist();
  } catch { /* el reporte nunca debe romper la app */ }
}

/** Envía la cola en lotes de 10. Si falla, se conserva para el próximo intento. */
export async function flushAppErrors(port: Partial<AppErrorPort> | null | undefined): Promise<void> {
  if (!port?.reportAppErrors || flushing) return await flushing ?? undefined;
  const send = port.reportAppErrors.bind(port);
  flushing = (async () => {
    await load();
    while (queue.length > 0) {
      const batch = queue.slice(0, 10);
      try { await send(batch); } catch { return; }
      queue = queue.filter(item => !batch.includes(item));
      await persist();
    }
  })().finally(() => { flushing = null; });
  await flushing;
}

/** Captura errores no controlados de JavaScript (incluidos los fatales) sin cambiar el comportamiento original. */
export function installAppErrorReporting(): void {
  if (installed) return;
  installed = true;
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler(): (error: unknown, fatal?: boolean) => void; setGlobalHandler(handler: (error: unknown, fatal?: boolean) => void): void } }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    const saved = recordAppError(error, "global", fatal === true);
    if (!fatal) { previous(error, fatal); return; }
    // En un error fatal se espera hasta 1 s a que quede guardado antes de que la app se cierre.
    void Promise.race([saved, new Promise(resolve => setTimeout(resolve, 1000))]).finally(() => previous(error, fatal));
  });
}

export function resetAppErrorReporterForTests(): void { queue = []; loaded = null; flushing = null; screen = null; installed = false; }
