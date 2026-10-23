import { z } from "zod";

/**
 * Qué puede hacer el técnico desde la app en la sucursal (configuración web «Permisos de la app móvil»). Todo permitido
 * por defecto y lo no configurado también. Mismas claves que el backend (IMobileAppConfig).
 */
export const MOBILE_APP_PERMISSION_KEYS = [
  "createWorks", "createMaintenances", "createNonProductive",
  "workshop", "workshopEntries", "workshopCustomers", "workshopInspections", "workshopReception", "workshopDelivery", "workshopManage",
  "workshopWorks", "workshopMaintenances",
  "ordersCreate", "ordersSend", "ordersDelete", "ordersGeneral", "ordersWorks", "ordersProducts", "ordersTransports", "ordersOthers"
] as const;
export type MobileAppPermission = typeof MOBILE_APP_PERMISSION_KEYS[number];
export type MobileAppConfig = Record<MobileAppPermission, boolean>;

export const ALL_APP_PERMISSIONS: MobileAppConfig = Object.fromEntries(MOBILE_APP_PERMISSION_KEYS.map((key) => [key, true])) as MobileAppConfig;

export function normalizeMobileAppConfig(raw: unknown): MobileAppConfig {
  const source = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return Object.fromEntries(MOBILE_APP_PERMISSION_KEYS.map((key) => [key, typeof source[key] === "boolean" ? source[key] : true])) as MobileAppConfig;
}

export const mobileAppConfigSchema = z.object(Object.fromEntries(MOBILE_APP_PERMISSION_KEYS.map((key) => [key, z.boolean()])) as Record<MobileAppPermission, z.ZodBoolean>).strict();

/** Nombre de cada acción para explicar al técnico qué desactivó la sucursal. */
export const APP_PERMISSION_LABELS: Record<MobileAppPermission, string> = {
  createWorks: "crear trabajos", createMaintenances: "crear mantenimientos", createNonProductive: "registrar tiempo no productivo",
  workshop: "usar el Taller", workshopEntries: "registrar o editar ingresos", workshopCustomers: "crear clientes, sucursales o contactos",
  workshopInspections: "hacer inspecciones", workshopReception: "firmar la recepción", workshopDelivery: "entregar equipos",
  workshopManage: "mover de nave, cambiar fecha o estado", workshopWorks: "agregar trabajos al ingreso", workshopMaintenances: "agregar mantenimientos al ingreso",
  ordersCreate: "crear OT", ordersSend: "enviar OT a comercial", ordersDelete: "eliminar OT", ordersGeneral: "editar datos generales de la OT",
  ordersWorks: "agregar o quitar trabajos de la OT", ordersProducts: "gestionar productos de la OT", ordersTransports: "gestionar transporte de la OT",
  ordersOthers: "gestionar otros ítems de la OT"
};

/** Las acciones del Taller y de sus OT exigen además que el Taller esté habilitado. */
export const isAppPermissionAllowed = (config: MobileAppConfig, key: MobileAppPermission): boolean =>
  config[key] && (!(key.startsWith("workshop") || key.startsWith("orders")) || config.workshop);
