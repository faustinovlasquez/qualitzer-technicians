import { z } from "zod";
import { evaluateInspection, workshopDeliveryConditions, type DeliveryCondition, type WorkshopEntryDetail } from "./workshopEntry";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const SIGNATURE_MAX_CHARS = Math.ceil((1024 * 1024) / 3) * 4 + 30;

/** Entrega del equipo: quién lo retira, su firma, cuándo y una nota. Igual que el formulario de entrega de la web. */
export const workshopDeliveryInputSchema = z.object({
  companyBranchId: id,
  requestId: z.uuid(),
  receiverName: z.string().trim().min(1).max(255),
  receiverEmail: z.string().trim().max(100).nullable(),
  receiverPhone: z.string().trim().max(50).nullable(),
  receiverSignature: z.string().max(SIGNATURE_MAX_CHARS).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  deliveredAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().max(2000).nullable()
}).strict();
export const workshopDeliveryResultSchema = z.object({ id, deliveredAt: z.string().max(40) }).strict();

export type WorkshopDeliveryInput = z.infer<typeof workshopDeliveryInputSchema>;
export type WorkshopDeliveryResult = z.infer<typeof workshopDeliveryResultSchema>;

export interface WorkshopDeliveryPort {
  deliverWorkshopEntry(entryId: number, input: WorkshopDeliveryInput): Promise<WorkshopDeliveryResult>;
}

/**
 * Igual que la web: para entregar deben cumplirse las condiciones de la ficha. La inspección de entrega solo bloquea si la
 * sucursal la exige; si no, una incompleta solo se advierte.
 */
export function deliveryBlockers(detail: WorkshopEntryDetail): { pending: DeliveryCondition[]; exitWarning: string | null } {
  const pending = workshopDeliveryConditions(detail).filter((condition) => !condition.met);
  const exit = detail.inspections.exit;
  const exitWarning = detail.inspections.exitRequirement === "none" && exit && evaluateInspection("full", exit, detail.inspections.photoSlots).missing.length > 0 && exit.completedAt === null
    ? "La inspección de entrega quedó incompleta. Puedes entregar igual, pero conviene terminarla." : null;
  return { pending, exitWarning };
}
