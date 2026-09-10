export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export class NetworkError extends Error {
  readonly name = "NetworkError";
  constructor(readonly kind: "network" | "timeout", message = "No se pudo conectar con la pasarela móvil.") { super(message); }
}
export function isNetworkError(error: unknown): error is NetworkError { return error instanceof NetworkError; }
export function classifyTransportError(error: unknown, timedOut: boolean, native: boolean): unknown {
  if (timedOut) return new NetworkError("timeout", "La solicitud tardó demasiado; el resultado del envío puede ser incierto.");
  if (error instanceof TypeError || (native && error instanceof Error && error.message.startsWith("fetch failed:"))) return new NetworkError("network");
  return error;
}

const messages: { [code: string]: string } = {
  LOGIN_DISCOVERY_UNAVAILABLE: "No se pudo comprobar el acceso en todas las empresas. Verifica la conexión y vuelve a intentar; no se ha elegido una empresa incompleta.",
  LOGIN_CHALLENGE_EXPIRED: "La selección de empresa venció. Vuelve a ingresar con tu usuario y contraseña.",
  INVALID_LOGIN_CHALLENGE: "La selección de empresa no es válida o ya fue utilizada. Vuelve al acceso.",
  SESSION_PERSISTENCE_UNAVAILABLE: "No se pudo guardar la sesión de forma segura en la pasarela. Revisa el almacenamiento del servidor.",
  TENANT_REQUIRED: "Selecciona la empresa a la que deseas ingresar.",
  TENANT_NOT_FOUND: "Esta empresa no está habilitada en la pasarela. Actualiza la lista de empresas.",
  TENANT_SESSION_MISMATCH: "La sesión pertenece a otra empresa. Cierra sesión y vuelve a elegir la empresa.",
  PASSWORD_CHANGE_REQUIRED: "Debes cambiar la contraseña temporal antes de consultar trabajos.",
  UNAUTHORIZED: "La sesión no es válida. Ingresa nuevamente con tu usuario de Qualitzer.",
  AUTH_INVALID_CREDENTIALS: "Revisa tu usuario y contraseña.",
  WORKER_REQUIRED: "Tu usuario no tiene un colaborador asociado. Solicita que lo vinculen en Qualitzer.",
  BRANCH_FORBIDDEN: "No tienes acceso a esta sucursal.",
  ASSIGNMENT_NOT_FOUND: "Este trabajo ya no está asignado a tu usuario en el período consultado. Actualiza la jornada.",
  WORK_READ_ONLY: "Este trabajo ya está cerrado y no admite cambios.",
  UPSTREAM_UNAVAILABLE: "El backend de Qualitzer no responde. Verifica que esté iniciado.",
  UPSTREAM_TIMEOUT: "Qualitzer tardó demasiado. Actualiza antes de repetir un envío: podría haberse guardado.",
  UPSTREAM_INVALID_RESPONSE: "La API devolvió un formato inesperado. Revisa la compatibilidad de la pasarela.",
  RATE_LIMITED: "Se alcanzó el límite de solicitudes. Espera un momento antes de volver a intentar.",
  AUTH_RATE_LIMITED: "Demasiados intentos de acceso. Vuelve a intentarlo más tarde.",
  WORK_FILES_REQUIRED: "Debes adjuntar las evidencias obligatorias antes de completar.",
  ORIGIN_FORBIDDEN: "Esta dirección web no está habilitada en la pasarela móvil.",
  INVALID_TRANSITION: "El estado cambió. Actualiza la ficha antes de continuar.",
};
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}
export function apiMessage(code: string, fallback?: string): string {
  return messages[code] ?? fallback ?? `No se pudo completar la operación (${code}).`;
}