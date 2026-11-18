import { z } from "zod";
import type { WorkScope } from "./models";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const label = z.string().max(500);
export const MAX_PAUTA_ITEMS_PER_ADD = 100;

/** Ítem de la pauta del equipo en un mantenimiento preventivo. */
export const pautaItemSchema = z.object({
  id, pautaValue: z.number().min(0), title: z.string().min(1).max(1000),
  system: label.nullable(), component: label.nullable(), action: label.nullable(),
  product: z.object({ code: label.nullable(), name: label }).nullable(),
  quantity: z.number().positive(),
  /** Ya existe un trabajo hecho desde este ítem. */
  linked: z.boolean(),
});
export const pautaSchema = z.object({
  maintenanceId: id, planName: label.nullable(), measurementType: z.string().max(40).nullable(),
  canEdit: z.boolean(), items: z.array(pautaItemSchema).max(2000),
}).refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length, "PAUTA_DUPLICATED_ITEM");
export const pautaAddInputSchema = z.object({ itemIds: z.array(id).min(1).max(MAX_PAUTA_ITEMS_PER_ADD) }).strict()
  .refine((value) => new Set(value.itemIds).size === value.itemIds.length, "PAUTA_DUPLICATED_ITEM");
export const pautaAddResultSchema = z.object({ added: z.number().int().min(0), alreadyLinked: z.number().int().min(0) });

export type PautaItem = z.infer<typeof pautaItemSchema>;
export type Pauta = z.infer<typeof pautaSchema>;
export type PautaAddResult = z.infer<typeof pautaAddResultSchema>;

export interface MaintenancePautaPort {
  maintenancePauta(scope: WorkScope): Promise<Pauta>;
  addPautaItems(scope: WorkScope, itemIds: number[]): Promise<PautaAddResult>;
}

/** Ítems agrupados por valor de pauta (por ejemplo 250, 500 horas), en orden, como en la web. */
export function pautaGroups(items: PautaItem[]): Array<{ value: number; items: PautaItem[] }> {
  const groups = new Map<number, PautaItem[]>();
  for (const item of items) groups.set(item.pautaValue, [...(groups.get(item.pautaValue) ?? []), item]);
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([value, groupItems]) => ({ value, items: groupItems }));
}

const MEASUREMENT_UNITS: Record<string, string> = { hourmeter: "horas", odometer: "km", rented_days: "días" };
export const pautaGroupLabel = (value: number, measurementType: string | null): string =>
  value > 0 ? `Pauta ${value.toLocaleString("es-CL")} ${MEASUREMENT_UNITS[measurementType ?? ""] ?? ""}`.trim() : "Sin valor de pauta";

export function pautaErrorMessage(code: string): string {
  if (code === "PANEL_PAUTA_NOT_PREVENTIVE") return "La pauta solo está disponible en mantenimientos preventivos.";
  if (code === "PANEL_PAUTA_READ_ONLY") return "Este mantenimiento o trabajo ya está cerrado: no se pueden agregar ítems de la pauta.";
  if (code === "PANEL_PAUTA_ITEM_NOT_FOUND") return "Un ítem ya no está en la pauta del equipo. Actualiza la pauta e intenta de nuevo.";
  if (code === "PANEL_PAUTA_WORK_NOT_FOUND") return "No encontramos este trabajo en tu agenda. Actualiza e intenta de nuevo.";
  if (code === "PANEL_PAUTA_NOT_AVAILABLE") return "Actualiza el servidor para ver la pauta del equipo desde la app.";
  if (code === "MAINTENANCE_WORKER_NOT_PLANNABLE") return "No estás habilitado para planificación; pide a un supervisor que agregue los ítems.";
  return "No se pudo completar la acción con la pauta. Revisa tu conexión e intenta de nuevo.";
}
