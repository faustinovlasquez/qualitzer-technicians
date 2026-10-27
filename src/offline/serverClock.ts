/** El almacenamiento del teléfono se carga al usarlo: este módulo también corre en la pasarela y en pruebas. */
const storage = async () => (await import("@react-native-async-storage/async-storage")).default;

/**
 * Diferencia entre la hora del servidor y la del teléfono. Lo que se guarda sin conexión (inicios, pausas, entregas) usa la
 * hora corregida: con el reloj del teléfono desajustado más de 5 minutos el servidor lo mandaba a revisión.
 * Se mide en cada respuesta (cabecera Date) y se guarda para usarla también sin señal.
 */
const KEY = "@qualitzer/offline/server-clock/v1";
/** La cabecera Date tiene precisión de 1 s: diferencias menores no se corrigen. */
const MIN_CORRECTION_MS = 2_000;
/** Un desfase mayor a un día es casi seguro un error de medición: se ignora. */
const MAX_OFFSET_MS = 24 * 60 * 60_000;

let offsetMs = 0;
let measuredAt: number | null = null;
let lastSaved = 0;

export function clockOffsetMs(): number { return offsetMs; }
export function clockMeasuredAt(): number | null { return measuredAt; }
/** Hora actual según el servidor (o la del teléfono si nunca se midió). */
export function serverNow(): number { return Date.now() + offsetMs; }

/** Registra la hora del servidor de una respuesta. `sentAt` y `receivedAt` son horas del teléfono. */
export function noteServerDate(header: string | null | undefined, sentAt: number, receivedAt: number): void {
  if (!header) return;
  const server = Date.parse(header);
  if (!Number.isFinite(server) || receivedAt < sentAt || receivedAt - sentAt > 10_000) return;
  // El servidor fijó la hora a mitad del viaje; la cabecera trunca al segundo (+500 ms en promedio).
  const measured = server + 500 - (sentAt + receivedAt) / 2;
  if (Math.abs(measured) > MAX_OFFSET_MS) return;
  offsetMs = Math.abs(measured) < MIN_CORRECTION_MS ? 0 : Math.round(measured);
  measuredAt = receivedAt;
  if (receivedAt - lastSaved > 60_000) {
    lastSaved = receivedAt;
    void storage().then((store) => store.setItem(KEY, JSON.stringify({ offsetMs, measuredAt }))).catch(() => undefined);
  }
}

/** Recupera la última diferencia medida (para usarla sin señal tras reiniciar la app). */
export async function loadServerClock(): Promise<void> {
  try {
    const raw = await (await storage()).getItem(KEY);
    if (!raw || measuredAt !== null) return;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "offsetMs" in value && typeof value.offsetMs === "number" && Math.abs(value.offsetMs) <= MAX_OFFSET_MS
      && "measuredAt" in value && typeof value.measuredAt === "number") { offsetMs = value.offsetMs; measuredAt = value.measuredAt; }
  } catch { /* Sin dato guardado se usa la hora del teléfono. */ }
}

/** Para pruebas. */
export function resetServerClock(): void { offsetMs = 0; measuredAt = null; lastSaved = 0; }
