import type { OfflineSnapshot } from "../../../domain/offline";

type SaveConnection = Pick<OfflineSnapshot, "online" | "authBlocked" | "connection">;

export function fileSavePresentation(mode: "live" | "demo", count: number, offline: SaveConnection | null | undefined) {
  if (mode === "demo") return {
    title: `Guardar ${count} archivo(s) en demo`,
    description: "Demostración: no se enviarán archivos a Qualitzer.",
  };
  if (offline === undefined) return {
    title: `Subir ${count} archivo(s)`,
    description: "Confirma la carga para enviar los archivos a Qualitzer.",
  };
  const title = `Guardar archivos · ${count}`;
  if (offline === null) return { title, description: "Recuperando el almacenamiento local antes de habilitar el guardado." };
  if (offline.authBlocked) return { title, description: "Los pendientes se conservan. Verifica tu sesión para reanudar la sincronización." };
  if (offline.connection?.status === "service_error" || offline.connection?.status === "unreachable") return {
    title,
    description: "Qualitzer no está disponible en este momento; esto no significa que el dispositivo esté sin internet. Puedes guardar los archivos en este dispositivo y la app reintentará la sincronización cuando el servicio esté disponible.",
  };
  if (offline.connection?.foreground === false) return {
    title,
    description: "La sincronización está pausada en segundo plano. Los archivos guardados se conservan; vuelve a la app para comprobar la conexión y continuar.",
  };
  if (offline.connection?.status === "checking") return {
    title,
    description: "Comprobando el acceso a Qualitzer. Puedes guardar los archivos en este dispositivo; se sincronizarán cuando se confirme la conexión y la sesión.",
  };
  return {
    title,
    description: offline.online
      ? "Con conexión: al guardar se conserva una copia local y se intenta enviar a Qualitzer. Si la conexión se interrumpe, se reintentará automáticamente con la app abierta."
      : "Sin conexión: al guardar los archivos quedan pendientes en este dispositivo. Se sincronizarán automáticamente al recuperar la conexión, con la app abierta.",
  };
}