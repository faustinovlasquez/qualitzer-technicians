import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Estados del ingreso configurados en la sucursal (principales con sus subestados), como en la web. */
export const workshopStatusesSchema = z.object({
  items: z.array(z.object({
    id, name: z.string().max(120), color: z.string().max(40).nullable(),
    subStatuses: z.array(z.object({ id, name: z.string().max(200), color: z.string().max(40).nullable() }).strict()).max(100)
  }).strict()).max(100)
}).strict();

const branch = { companyBranchId: id };
/** Mover el equipo a otra nave del mismo taller (la web lo hace arrastrando la tarjeta). */
export const workshopMoveInputSchema = z.object({ ...branch, toAreaId: id, note: z.string().trim().max(500).nullable() }).strict();
/** Nueva fecha estimada de entrega: la web exige el motivo y guarda el historial. */
export const workshopEstimatedDateInputSchema = z.object({ ...branch, estimatedDeliveryAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(3).max(500) }).strict();
export const workshopStatusInputSchema = z.object({ ...branch, statusId: id, subStatusId: id.nullable() }).strict();
export const workshopManageResultSchema = z.object({ id }).strict();

export type WorkshopStatuses = z.infer<typeof workshopStatusesSchema>;

export interface WorkshopManagePort {
  workshopStatuses(branchId: number): Promise<WorkshopStatuses>;
  moveWorkshopEntry(entryId: number, input: z.infer<typeof workshopMoveInputSchema>): Promise<{ id: number }>;
  changeEstimatedDelivery(entryId: number, input: z.infer<typeof workshopEstimatedDateInputSchema>): Promise<{ id: number }>;
  changeEntryStatus(entryId: number, input: z.infer<typeof workshopStatusInputSchema>): Promise<{ id: number }>;
}
