import { z } from "zod";
import type { WorkScope } from "./models";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const label = z.string().max(500);
export const MAX_RESOURCE_QUANTITY = 100000;
const quantity = z.number().int().min(1).max(MAX_RESOURCE_QUANTITY);

/** Recurso (producto) usado en un mantenimiento. Sin precios: la app no los muestra. */
export const maintenanceResourceSchema = z.object({
  id, productId: id.nullable(), code: label.nullable(), name: z.string().min(1).max(500), quantity: z.number().min(0),
  workTitle: label.nullable(),
});
export const maintenanceResourcesSchema = z.object({
  maintenanceId: id, canEdit: z.boolean(), items: z.array(maintenanceResourceSchema).max(2000),
}).refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length, "RESOURCE_DUPLICATED");
export const resourceCatalogItemSchema = z.object({ id, code: label.nullable(), name: z.string().min(1).max(500), description: z.string().max(5000).nullable() });
export const resourceCatalogPageSchema = z.object({ items: z.array(resourceCatalogItemSchema).max(20), page: z.number().int().min(0).max(1000), hasMore: z.boolean() });
export const resourceCatalogQuerySchema = z.object({
  search: z.string().max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).transform((value) => value.trim()).default(""),
  page: z.number().int().min(0).max(1000).default(0),
}).strict();
export const resourceAddInputSchema = z.object({ productId: id, quantity }).strict();
export const resourceQuantityInputSchema = z.object({ quantity }).strict();

export type MaintenanceResource = z.infer<typeof maintenanceResourceSchema>;
export type MaintenanceResources = z.infer<typeof maintenanceResourcesSchema>;
export type ResourceCatalogItem = z.infer<typeof resourceCatalogItemSchema>;
export type ResourceCatalogPage = z.infer<typeof resourceCatalogPageSchema>;
export type ResourceCatalogQuery = z.input<typeof resourceCatalogQuerySchema>;

export interface MaintenanceResourcesPort {
  maintenanceResources(scope: WorkScope): Promise<MaintenanceResources>;
  maintenanceResourceCatalog(scope: WorkScope, query: ResourceCatalogQuery): Promise<ResourceCatalogPage>;
  addMaintenanceResource(scope: WorkScope, productId: number, quantity: number): Promise<MaintenanceResources>;
  setMaintenanceResourceQuantity(scope: WorkScope, resourceId: number, quantity: number): Promise<MaintenanceResources>;
  removeMaintenanceResource(scope: WorkScope, resourceId: number): Promise<MaintenanceResources>;
}

export function resourceErrorMessage(code: string): string {
  if (code === "PANEL_RESOURCE_NOT_MAINTENANCE") return "Los recursos solo se agregan a mantenimientos.";
  if (code === "PANEL_RESOURCE_READ_ONLY") return "El mantenimiento o el trabajo ya está cerrado: los recursos se cambian desde la web.";
  if (code === "PANEL_RESOURCE_PRODUCT_NOT_FOUND") return "El producto ya no está disponible en el catálogo. Busca otro.";
  if (code === "PANEL_RESOURCE_NOT_FOUND") return "Ese recurso ya no está en el mantenimiento. Actualiza la lista.";
  if (code === "PANEL_RESOURCE_INVALID_QUANTITY") return "La cantidad debe ser un número entero mayor que cero.";
  if (code === "PANEL_RESOURCE_WORK_NOT_FOUND") return "No encontramos este mantenimiento en tu agenda. Actualiza e intenta de nuevo.";
  if (code === "PANEL_RESOURCE_NOT_AVAILABLE") return "Actualiza el servidor para gestionar los recursos desde la app.";
  return "No se pudo completar la acción con los recursos. Revisa tu conexión e intenta de nuevo.";
}
