import type { NotificationInboxItem, NotificationPreferences } from "../../domain/notifications";
import type { IconName } from "../../ui/components";

export const notificationKinds: { [K in NotificationInboxItem["kind"]]: { title: string; icon: IconName; description: string } } = {
  WORK_TECHNICIAN_ASSIGNED: { title: "Nueva asignación", icon: "briefcase-outline", description: "Tienes una nueva asignación para revisar." },
  RUNNING_TIMER_REMINDER: { title: "Cronómetro activo", icon: "timer-outline", description: "Revisa el tiempo de tu trabajo en curso." },
  MOBILE_PUSH_TEST: { title: "Notificación de prueba", icon: "notifications-outline", description: "Una prueba de los avisos de este teléfono." },
};

export const notificationDeliveryLabels: { [K in NotificationInboxItem["state"]]: string } = {
  pending: "Pendiente de envío", sending: "En proceso de envío", accepted: "Aceptado por el servicio de envío",
  receiving: "Consultando confirmación del proveedor", receipt_ok: "Procesado por el proveedor",
  receipt_unknown: "Sin confirmación del proveedor", cancelled: "Envío cancelado", expired: "Aviso vencido", dead: "No se pudo enviar",
};

export function notificationWorkReference(item: NotificationInboxItem): string | null {
  const { groupType, groupId, workId } = item.data;
  if (item.kind === "MOBILE_PUSH_TEST") return null;
  if (groupType === "negotiation") return `OT #${groupId}${workId !== null ? ` · Trabajo #${workId}` : ""}`;
  if (groupType === "maintenance") return `Mantenimiento #${groupId}${workId !== null ? ` · Trabajo #${workId}` : ""}`;
  return workId !== null || groupId !== null ? `Trabajo #${workId ?? groupId}` : "Trabajo asignado";
}

export function notificationWorkDate(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return parsed.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function notificationTimestamp(value: string, now = Date.now()): string {
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  if (!Number.isFinite(timestamp)) return "Fecha no disponible";
  const elapsed = now - timestamp;
  if (elapsed >= 0 && elapsed < 60_000) return "Ahora";
  if (elapsed >= 60_000 && elapsed < 3_600_000) return `Hace ${Math.floor(elapsed / 60_000)} min`;
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = parsed.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (parsed.toDateString() === today.toDateString()) return `Hoy, ${time}`;
  if (parsed.toDateString() === yesterday.toDateString()) return `Ayer, ${time}`;
  return parsed.toLocaleDateString("es-CL", { day: "numeric", month: "short", ...(parsed.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

export function notificationCounts(unreadCount: number | null | undefined, total: number | null | undefined): string {
  const unread = unreadCount == null ? "… sin leer" : `${unreadCount} sin leer`;
  return `${unread} · ${total == null ? "… en total" : `${total} en total`}`;
}

const errorMessages: { [code: string]: string } = {
  MOBILE_PUSH_SERVER_PREREQUISITES: "El servicio de avisos todavía no está disponible. Puedes volver a intentarlo más tarde.",
  MOBILE_PUSH_PROJECT_MISSING: "Esta versión de la app necesita actualizar su configuración de avisos.",
  MOBILE_PUSH_PROJECT_MISMATCH: "La configuración de avisos de la app y del servicio no coincide. Contacta con soporte.",
  MOBILE_PUSH_PERMISSION_BLOCKED: "Los avisos están bloqueados en este teléfono. Puedes permitirlos en los ajustes del sistema.",
  MOBILE_PUSH_PERMISSION_DENIED: "El teléfono no permite los avisos. Puedes cambiar el permiso en los ajustes del sistema.",
  MOBILE_PUSH_DEVICE_NOT_REGISTERED: "Activa los avisos de este teléfono para continuar.",
  DEVICE_NOT_REGISTERED: "Este teléfono necesita volver a activar sus avisos.",
  MOBILE_PUSH_EVENT_NOT_FOUND: "Esta notificación ya no está disponible o no tienes acceso a ella. Actualiza la bandeja.",
  MOBILE_PUSH_SESSION_CHANGED: "La sesión ha cambiado. Vuelve a abrir esta pantalla para continuar.",
  MOBILE_PUSH_SESSION_NOT_READY: "Inicia sesión y selecciona una sucursal para consultar tus avisos.",
  MOBILE_PUSH_REVOCATION_PENDING: "Se está cerrando el registro anterior. Espera antes de volver a activar los avisos.",
  MOBILE_PUSH_RATE_LIMITED: "Has alcanzado el límite de solicitudes. Espera antes de volver a intentarlo.",
  MOBILE_PUSH_TEST_RATE_LIMITED: "Has alcanzado el límite de 5 pruebas por hora. Inténtalo más tarde.",
  MOBILE_PUSH_DELETE_UNSUPPORTED: "Para eliminar notificaciones, el servicio necesita una actualización.",
  MOBILE_PUSH_DELETE_NOT_SUPPORTED: "Para eliminar notificaciones, el servicio necesita una actualización.",
  MOBILE_PUSH_INBOX_UPDATE_REQUIRED: "Actualiza el servicio para filtrar y eliminar avisos. La bandeja completa sigue disponible.",
  MOBILE_PUSH_APP_LOCKED: "Desbloquea la aplicación para continuar.",
};

export function notificationErrorMessage(code: string | null | undefined): string {
  return (code ? errorMessages[code] : null) ?? "No se pudo completar la operación. Comprueba tu conexión e inténtalo de nuevo.";
}

export function notificationSupportCode(code: string | null | undefined): string | null {
  return code && /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : null;
}

const notices: { [notice: string]: string } = {
  "Notificaciones activadas para esta sesión.": "Avisos activados para este teléfono.",
  "Preferencias guardadas en el servidor.": "Tus preferencias se han guardado.",
  "Registro de notificaciones desactivado.": "Avisos desactivados en este teléfono.",
  "Prueba pendiente en el servidor. Respeta el horario silencioso; no confirma entrega al teléfono.": "Prueba solicitada. Queda pendiente de envío y respeta tu horario silencioso.",
  "Hay un cronómetro pendiente de revisión.": "Tienes un cronómetro activo para revisar.",
  "Se recibió una notificación de prueba en esta app.": "La app ha recibido la notificación de prueba.",
  "Hay una nueva asignación técnica. Actualiza tus trabajos.": "Tienes una nueva asignación. Actualiza tus trabajos para verla.",
  "Cerrando el registro de notificaciones de esta sesión.": "Desactivando los avisos de esta sesión…",
  "Notificación eliminada.": "Notificación eliminada de tu bandeja.",
  "Notificación eliminada de tu bandeja.": "Notificación eliminada de tu bandeja.",
  "Lectura guardada. Actualiza la bandeja para consultar el contador actual.": "Lectura guardada. Actualiza la bandeja para consultar el contador actual.",
  "Notificación eliminada. Actualiza la bandeja para consultar el contador actual.": "Notificación eliminada. Actualiza la bandeja para consultar el contador actual.",
  "Prueba registrada. Actualiza la bandeja; no vuelvas a enviarla por un fallo de actualización.": "Prueba registrada. Actualiza la bandeja; no vuelvas a enviarla por un fallo de actualización.",
};

export function notificationNoticeMessage(notice: string): string {
  return notices[notice] ?? "Consulta el estado actualizado de tus avisos en esta pantalla.";
}

export function sameNotificationPreferences(left: NotificationPreferences, right: NotificationPreferences): boolean {
  return left.assignments === right.assignments && left.timers === right.timers
    && left.remindAfterMinutes === right.remindAfterMinutes && left.repeatEveryMinutes === right.repeatEveryMinutes
    && left.quietHoursStart === right.quietHoursStart && left.quietHoursEnd === right.quietHoursEnd;
}