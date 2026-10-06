/** Estado de un permiso del sistema tal como lo muestra la pantalla Permisos (al estilo de Ajustes de Android). */
export type PermissionKind = "notifications" | "camera" | "location";
export type PermissionState = "granted" | "denied" | "blocked" | "undetermined" | "unknown";
export interface PermissionSnapshot { granted: boolean; canAskAgain: boolean; status?: string }

export function permissionState(snapshot: PermissionSnapshot | null): PermissionState {
  if (!snapshot) return "unknown";
  if (snapshot.granted) return "granted";
  if (snapshot.status === "undetermined" && snapshot.canAskAgain) return "undetermined";
  return snapshot.canAskAgain ? "denied" : "blocked";
}

export type PermissionAction = "request" | "settings" | "revoke" | null;
/**
 * Acción disponible: pedir el permiso si el sistema aún deja preguntar; si está bloqueado, abrir Ajustes.
 * Android no permite que una app se quite permisos: "Quitar" abre la ficha de la app en Ajustes.
 */
export function permissionAction(state: PermissionState): PermissionAction {
  return state === "granted" ? "revoke" : state === "blocked" ? "settings" : state === "unknown" ? null : "request";
}

export const permissionLabels: { [K in PermissionState]: string } = {
  granted: "Permitido", denied: "No permitido", blocked: "Bloqueado", undetermined: "Sin solicitar", unknown: "Comprobando…",
};
