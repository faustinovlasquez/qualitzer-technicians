import type { OfflineOperation } from "../../domain/offline";
import { requiresDeployment } from "../../offline/connection";
import { errorMessage } from "../workDetail/detailRules";

export const SYNC_SUPPORT_MESSAGE = "Sincronización no disponible. Contacta a soporte.";
export const PENDING_CHANGES_MESSAGE = "Hay cambios pendientes de enviar";

const connectionNotifications = new Set([
  "No se pudo verificar la conexión con Qualitzer. Los pendientes siguen guardados en el dispositivo.",
]);

export function workActionError(message: string | null): string | null {
  return message !== null && !connectionNotifications.has(message) ? userErrorText(message) : null;
}

export function syncUserError(code: string | null | undefined): string {
  if (!code) return "";
  if (requiresDeployment(code)) return SYNC_SUPPORT_MESSAGE;
  switch (code) {
    case "INVALID_INPUT":
      return "El servidor rechazó el formato del envío. Los datos siguen guardados; revisa la actualización del servicio antes de repetir la operación.";
    case "TRUSTED_NATIVE_INTERACTION_REVOKED":
      return "La selección se interrumpió o tardó demasiado. Vuelve a tomar o elegir el archivo.";
    case "TRUSTED_NATIVE_INTERACTION_NOT_ALLOWED":
    case "TRUSTED_NATIVE_PICKER_PROVIDER_REQUIRED":
    case "TRUSTED_NATIVE_INTERACTION_CLOCK_INVALID":
    case "TRUSTED_NATIVE_INTERACTION_PRIVACY_UNAVAILABLE":
      return "No se pudo continuar con la selección. Desbloquea la app y vuelve a intentarlo.";
    case "OFFLINE_NETWORK_UNAVAILABLE":
    case "OFFLINE_TIMEOUT_UNCERTAIN":
    case "OFFLINE_CYCLE_INTERRUPTED":
      return "No se pudo confirmar el envío. Se reintentará cuando haya conexión.";
    case "MOBILE_SYNC_IN_PROGRESS":
      return "Envío en proceso.";
    case "MOBILE_SYNC_REQUIRES_REVIEW":
      return "Qualitzer no lo aceptó: puede faltar una foto o respuesta obligatoria, o la hora del teléfono no calza. Corrígelo y vuelve a hacerlo; puedes descartar este intento en «Sin conexión».";
    case "OFFLINE_WORK_COMPLETED_ELSEWHERE":
      return "Otra persona ya dejó este trabajo como finalizado, así que tu entrega no se aplicó. Revísalo y descarta este intento si ya no corresponde.";
    case "OFFLINE_TIMER_CLOCK_CHANGED":
      return "La hora del teléfono retrocedió. Activa «Fecha y hora automáticas» en los ajustes del teléfono y vuelve a intentarlo.";
    case "MOBILE_SYNC_STATUS_CONFLICT":
    case "MOBILE_SYNC_INVALID_STATUS":
      return "El estado del trabajo cambió en Qualitzer. Se está ajustando solo al estado real.";
    case "MOBILE_SYNC_WORK_NOT_FOUND":
      return "El trabajo ya no existe o no está asignado a ti. Descarta este cambio en «Sin conexión».";
    case "MOBILE_SYNC_OPERATION_REUSED":
    case "MOBILE_CREATION_REQUEST_CONFLICT":
      return "Conflicto de envío. Requiere revisión; no vuelvas a enviarlo.";
    case "OFFLINE_STORAGE_FULL":
      return "No se pudo guardar: el almacenamiento local está lleno. No borres los datos de la app.";
    case "OFFLINE_STORAGE_BUSY":
      return "No se pudo guardar en el dispositivo. Reintenta el almacenamiento local.";
    case "OFFLINE_LOCAL_FILE_MISSING":
    case "OFFLINE_FILE_INTEGRITY_MISMATCH":
      return "La copia del archivo falta o está dañada. Requiere revisión.";
    case "OFFLINE_LOCAL_FILE_UNREADABLE":
    case "OFFLINE_SOURCE_FILE_UNREADABLE":
    case "OFFLINE_DOCUMENT_MULTIPART_PREPARATION_FAILED":
      return "No se pudo leer el archivo del dispositivo. Revisa el almacenamiento.";
    case "OFFLINE_DOCUMENT_INVALID_SCOPE":
    case "OFFLINE_DOCUMENT_INVALID_METADATA":
      return "El destino del archivo no es válido. Requiere revisión.";
    case "OFFLINE_DOCUMENT_RECOVERY_PENDING":
      return "Comprobando el envío del archivo.";
    case "OFFLINE_DOCUMENT_FILE_ID_INVALID":
    case "OFFLINE_INVALID_RECEIPT":
    case "OFFLINE_RECEIPT_INVALID_RESPONSE":
    case "OFFLINE_SYNC_UNEXPECTED_RESPONSE":
    case "OFFLINE_DOCUMENT_UNEXPECTED_ERROR":
    case "OFFLINE_DOCUMENT_SUBMISSION_FAILED":
      return "No se pudo confirmar el envío. Requiere revisión; no vuelvas a enviarlo.";
    default:
      return /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(code)
        ? "No se pudo completar la operación. Requiere revisión en el centro offline."
        : userErrorText(code);
  }
}

export function userErrorText(message: string): string {
  return message.replace(/\b(?:MOBILE|OFFLINE|TRUSTED_NATIVE)_[A-Z0-9_]+\b/g, (code) => syncUserError(code));
}

export function userActionError(error: unknown): string {
  return userErrorText(errorMessage(error));
}

export function operationNeedsAttention(operation: OfflineOperation): boolean {
  return operation.status === "blocked" || operation.status === "auth_required" || operation.status === "needs_review" || operation.status === "conflict";
}