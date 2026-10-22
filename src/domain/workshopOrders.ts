import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * OT del ingreso creada por el técnico: sin precios (comercial los pone después). Se crea "sin enviar a comercial" con los
 * trabajos sueltos elegidos; cliente, equipo, ingreso, sucursales y contactos salen del ingreso.
 */
export const workshopOrderInputSchema = z.object({
  companyBranchId: id,
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).nullable(),
  priority: z.enum(["low", "medium", "high"]),
  workIds: z.array(id).min(1).max(50),
  /** Guardar y enviar a comercial en el mismo paso, como "Guardar y enviar" de la web. */
  sendToCommercial: z.boolean()
}).strict();
export const workshopOrderResultSchema = z.object({ id, sent: z.boolean() }).strict();

/** Lo que la sucursal exige al crear una OT y que el técnico no puede completar desde la app. */
export const workshopOrderRulesSchema = z.object({ blockingFields: z.array(z.string().max(120)).max(50), descriptionRequired: z.boolean() }).strict();

export const workshopOrderWorksInputSchema = z.object({ companyBranchId: id, workIds: z.array(id).min(1).max(50) }).strict();
export const workshopOrderWorksResultSchema = z.object({ linked: z.number().int().min(0), skipped: z.number().int().min(0) }).strict();
export const workshopOrderActionInputSchema = z.object({ companyBranchId: id }).strict();
export const workshopOrderDeletedSchema = z.object({ id, deletedWorks: z.number().int().min(0) }).strict();
export const workshopOrderSentSchema = z.object({ id }).strict();

export type WorkshopOrderInput = z.infer<typeof workshopOrderInputSchema>;
export type WorkshopOrderRules = z.infer<typeof workshopOrderRulesSchema>;

export interface WorkshopOrdersPort {
  workshopOrderRules(entryId: number, branchId: number): Promise<WorkshopOrderRules>;
  createWorkshopOrder(entryId: number, input: WorkshopOrderInput): Promise<z.infer<typeof workshopOrderResultSchema>>;
  addWorksToOrder(entryId: number, orderId: number, input: z.infer<typeof workshopOrderWorksInputSchema>): Promise<z.infer<typeof workshopOrderWorksResultSchema>>;
  sendOrderToCommercial(entryId: number, orderId: number, branchId: number): Promise<{ id: number }>;
  deleteWorkshopOrder(entryId: number, orderId: number, branchId: number): Promise<z.infer<typeof workshopOrderDeletedSchema>>;
}

/** Nombres en español de los campos que la sucursal puede exigir en una OT. */
export const ORDER_FIELD_LABELS: Record<string, string> = {
  serviceTypeId: "Tipo de servicio", customerOriginId: "Origen del cliente", costCenterRelation: "Centro de costo", tags: "Etiquetas",
  contractors: "Contratistas", departments: "Departamentos", construction: "Obra", internalNotes: "Notas internas", placeId: "Lugar",
  contacts: "Contactos del cliente", branchesCustomer: "Sucursales del cliente", customersEquipments: "Equipo del cliente", customerId: "Cliente",
  description: "Descripción", entryId: "Ingreso"
};
