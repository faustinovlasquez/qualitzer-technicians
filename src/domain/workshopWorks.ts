import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * Trabajos del ingreso. Se crean con el formulario normal de creación de la app (mobile-creations con el ingreso) y se
 * gestionan en su ficha normal (iniciar, cronómetro, archivos, checklist). Aquí solo se unen trabajos libres existentes.
 */
export const workshopFreeWorksSchema = z.object({
  items: z.array(z.object({ id, code: z.string().max(40), title: z.string().max(500), statusName: z.string().max(120).nullable() }).strict()).max(100)
}).strict();
export const workshopLinkWorksInputSchema = z.object({ companyBranchId: id, workIds: z.array(id).min(1).max(50) }).strict();
export const workshopLinkWorksResultSchema = z.object({ linked: z.number().int().min(0), skipped: z.number().int().min(0) }).strict();

export type WorkshopFreeWork = z.infer<typeof workshopFreeWorksSchema>["items"][number];

export interface WorkshopWorksPort {
  workshopFreeWorks(entryId: number, branchId: number, search: string): Promise<z.infer<typeof workshopFreeWorksSchema>>;
  linkWorkshopWorks(entryId: number, input: z.infer<typeof workshopLinkWorksInputSchema>): Promise<z.infer<typeof workshopLinkWorksResultSchema>>;
  /** Solo demostración: refleja en la ficha un trabajo creado con el formulario normal. */
  noteCreatedWork?(entryId: number, workId: number): void;
}
