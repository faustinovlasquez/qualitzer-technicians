import type { OfflineConnection, OfflineSnapshot } from "../domain/offline";

export function snapshotConnection(snapshot: OfflineSnapshot): OfflineConnection {
  return snapshot.connection ?? {
    status: snapshot.authBlocked ? "auth_required" : snapshot.online ? "ready" : "checking",
    networkConnected: null, foreground: true, checkedAt: null,
  };
}

export function connectionPresentation(snapshot: OfflineSnapshot | null): {
  title: string; label: string; secondary: string; tone: "success" | "error" | "warning" | "info"; canSync: boolean; ready: boolean;
} {
  if (!snapshot) return { title: "Recuperando estado local…", label: "Recuperando estado local…", secondary: "No se ha verificado la cola.", tone: "info", canSync: false, ready: false };
  const connection = snapshotConnection(snapshot);
  const status = snapshot.authBlocked ? "auth_required" : connection.status;
  const title = status === "ready" ? "Conectado a Qualitzer"
    : status === "offline" ? "Sin red"
    : status === "unreachable" ? "Sin acceso a Qualitzer"
    : status === "auth_required" ? "Verificar sesión"
    : status === "service_error" ? "Sincronización no disponible"
    : "Verificando conexión con Qualitzer…";
  const cachedAt = snapshot.coverage.reduce<number | null>((latest, entry) => Number.isFinite(entry.fetchedAt) ? Math.max(latest ?? entry.fetchedAt, entry.fetchedAt) : latest, null);
  const secondary = [!connection.foreground ? "Sincronización en pausa: vuelve a la app para continuar." : snapshot.syncing ? "Sincronizando pendientes…" : "",
    cachedAt === null ? "Sin agenda disponible offline." : `Agenda disponible offline · datos al ${new Date(cachedAt).toLocaleString("es-CL")}`].filter(Boolean).join(" ");
  return { title, label: `${title} · ${snapshot.pending} pendientes${snapshot.conflicts ? ` · ${snapshot.conflicts} por revisar` : ""}`, secondary,
    tone: status === "ready" ? "success" : status === "offline" ? "error" : status === "checking" ? "info" : "warning",
    canSync: connection.foreground && status !== "auth_required" && status !== "offline" && !snapshot.syncing,
    ready: status === "ready" };
}

export function compactConnectionPresentation(snapshot: OfflineSnapshot | null): { title: string; detail: string } {
  const presentation = connectionPresentation(snapshot);
  if (!snapshot) return { title: "Recuperando estado local…", detail: "Comprobando pendientes" };
  const connection = snapshotConnection(snapshot);
  const title = presentation.title === "Verificando conexión con Qualitzer…" ? "Verificando conexión…"
    : presentation.title;
  const pending = snapshot.pending === 1 ? "1 pendiente" : `${snapshot.pending} pendientes`;
  const counts = snapshot.conflicts > 0 ? `${pending} · ${snapshot.conflicts} por revisar` : pending;
  const detail = snapshot.pending > 0 || snapshot.conflicts > 0 ? counts
    : !connection.foreground ? "En pausa · vuelve a la app"
    : snapshot.syncing ? "Sincronizando…"
    : snapshot.coverage.length > 0 ? "Sin pendientes · copia offline" : "Sin pendientes · sin copia offline";
  return { title, detail };
}