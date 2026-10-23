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
  /** Trabajos sueltos que se unen a la OT; puede crearse sin trabajos y agregarlos después, como en la web. */
  workIds: z.array(id).max(50),
  /** Guardar y enviar a comercial en el mismo paso, como "Guardar y enviar" de la web. */
  sendToCommercial: z.boolean(),
  /** Campos que la sucursal exige y el técnico completa en la app (centro de costo, notas internas). */
  extra: z.object({
    costCenterRelation: z.string().trim().max(255).optional(), internalNotes: z.string().trim().max(5000).optional()
  }).strict().optional()
}).strict();
export const workshopOrderResultSchema = z.object({ id, sent: z.boolean() }).strict();

export const ORDER_FILLABLE_FIELDS = ["costCenterRelation", "internalNotes"] as const;
/** Exigidos en la web pero que no se piden en la app (no son importantes para el taller): la OT se crea sin ellos. */
export const ORDER_SKIPPED_IN_APP = ["customerOriginId", "tags"] as const;
export type OrderFillableField = typeof ORDER_FILLABLE_FIELDS[number];
/**
 * Lo que la sucursal exige al crear una OT: lo que el técnico completa en la app (`fields`, con sus opciones) y lo que no
 * puede completar (`blockingFields`, se crea desde la web).
 */
export const workshopOrderRulesSchema = z.object({
  blockingFields: z.array(z.string().max(120)).max(50), descriptionRequired: z.boolean(),
  fields: z.array(z.object({ key: z.enum(ORDER_FILLABLE_FIELDS), label: z.string().max(120), options: z.array(z.object({ id, name: z.string().max(300) }).strict()).max(2000) }).strict()).max(10).default([])
}).strict();

export const workshopOrderWorksInputSchema = z.object({ companyBranchId: id, workIds: z.array(id).min(1).max(50) }).strict();
export const workshopOrderWorksResultSchema = z.object({ linked: z.number().int().min(0), skipped: z.number().int().min(0) }).strict();
export const workshopOrderActionInputSchema = z.object({ companyBranchId: id }).strict();
export const workshopOrderDeletedSchema = z.object({ id, deletedWorks: z.number().int().min(0) }).strict();
export const workshopOrderSentSchema = z.object({ id }).strict();

const text = (max: number) => z.string().max(max);
const quantity = z.number().min(0).max(1_000_000_000);

/**
 * Detalle de una OT o cotización del ingreso, sin precios ni totales (igual que el formulario web de OT).
 * `editable` sigue la regla de la web: se bloquea al enviarse al cliente, aprobarse, rechazarse, revisarse o cancelarse.
 */
export const workshopOrderDetailSchema = z.object({
  id,
  kind: z.enum(["workOrder", "quote"]),
  code: text(60),
  workOrderCode: text(60).nullable(),
  statusLabel: text(120),
  subStatusLabel: text(120).nullable(),
  sentToCommercial: z.boolean(),
  editable: z.boolean(),
  lockedReason: text(200).nullable(),
  general: z.object({
    title: text(500).nullable(),
    description: text(10000).nullable(),
    internalNotes: text(10000).nullable(),
    priority: z.enum(["low", "medium", "high"]).nullable(),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    businessType: text(120).nullable(),
    customerName: text(300).nullable(),
    branches: z.array(text(300)).max(100),
    contacts: z.array(text(300)).max(100),
    equipments: z.array(text(300)).max(100),
    createdAt: text(40).nullable(),
    sentAt: text(40).nullable()
  }).strict(),
  works: z.array(z.object({
    id, code: text(40), title: text(500), priority: z.enum(["low", "medium", "high"]).nullable(), summary: text(10000).nullable(),
    assignedMinutes: z.number().int().min(0).max(1_000_000).nullable(), specialty: text(200).nullable(), responsibles: z.array(text(300)).max(50)
  }).strict()).max(500),
  products: z.array(z.object({
    id, productId: id.nullable(), code: text(120).nullable(), name: text(500), description: text(5000).nullable(), unit: text(60).nullable(),
    quantity, stock: z.number().nullable(), isEquipment: z.boolean()
  }).strict()).max(500),
  transports: z.array(z.object({ id, transportId: id.nullable(), name: text(300), detail: text(5000).nullable(), chargeType: text(60).nullable(), quantity }).strict()).max(500),
  others: z.array(z.object({ id, name: text(500), description: text(5000).nullable(), quantity }).strict()).max(500),
  rentals: z.array(z.object({ id, name: text(500), from: text(40).nullable(), to: text(40).nullable() }).strict()).max(500)
}).strict();

export type WorkshopOrderDetail = z.infer<typeof workshopOrderDetailSchema>;

/** Datos generales que el técnico puede cambiar (los mismos campos visibles del formulario web de OT). */
export const workshopOrderGeneralInputSchema = z.object({
  companyBranchId: id,
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).nullable(),
  internalNotes: z.string().trim().max(5000).nullable(),
  priority: z.enum(["low", "medium", "high"]),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
}).strict();
export type WorkshopOrderGeneralInput = z.infer<typeof workshopOrderGeneralInputSchema>;

/** Catálogos para agregar ítems (sin precios: la pasarela los toma del catálogo al guardar, como la web). */
export const workshopProductOptionSchema = z.object({ id, code: text(120).nullable(), name: text(500), description: text(5000).nullable(), stock: z.number().nullable(), unit: text(60).nullable() }).strict();
export const workshopProductPageSchema = z.object({ items: z.array(workshopProductOptionSchema).max(25), hasMore: z.boolean() }).strict();
export const TRANSPORT_CHARGE_TYPES = ["km", "hr", "day", "month", "year"] as const;
export const workshopTransportOptionSchema = z.object({ id, name: text(300), chargeTypes: z.array(z.enum(TRANSPORT_CHARGE_TYPES)).max(5) }).strict();
export const workshopTransportOptionsSchema = z.object({ items: z.array(workshopTransportOptionSchema).max(500) }).strict();

const itemQuantity = z.number().positive().max(1_000_000);
export const workshopOrderItemInputSchema = z.object({
  companyBranchId: id,
  requestId: z.uuid(),
  item: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("product"), productId: id, quantity: z.number().int().positive().max(1_000_000) }).strict(),
    z.object({ kind: z.literal("transport"), transportId: id, chargeType: z.enum(TRANSPORT_CHARGE_TYPES), quantity: itemQuantity, detail: z.string().trim().max(1000).nullable() }).strict(),
    z.object({ kind: z.literal("other"), name: z.string().trim().min(1).max(255), description: z.string().trim().max(1000).nullable(), quantity: itemQuantity }).strict()
  ])
}).strict();
/** Cambiar cantidad (y detalle o descripción) de un ítem existente. */
export const workshopOrderItemUpdateSchema = z.object({ companyBranchId: id, quantity: itemQuantity, note: z.string().trim().max(1000).nullable().optional() }).strict();
export const workshopOrderItemSectionSchema = z.enum(["products", "transports", "others"]);

export type WorkshopProductOption = z.infer<typeof workshopProductOptionSchema>;
export type WorkshopTransportOption = z.infer<typeof workshopTransportOptionSchema>;
export type WorkshopOrderItemInput = z.infer<typeof workshopOrderItemInputSchema>;
export type WorkshopOrderItemSection = z.infer<typeof workshopOrderItemSectionSchema>;
export type WorkshopOrderInput = z.infer<typeof workshopOrderInputSchema>;
export type WorkshopOrderRules = z.infer<typeof workshopOrderRulesSchema>;

export interface WorkshopOrdersPort {
  workshopOrderRules(entryId: number, branchId: number): Promise<WorkshopOrderRules>;
  workshopOrderDetail(entryId: number, orderId: number, branchId: number): Promise<WorkshopOrderDetail>;
  updateOrderGeneral(entryId: number, orderId: number, input: WorkshopOrderGeneralInput): Promise<WorkshopOrderDetail>;
  workshopProducts(branchId: number, search: string, page: number): Promise<z.infer<typeof workshopProductPageSchema>>;
  workshopTransports(branchId: number): Promise<z.infer<typeof workshopTransportOptionsSchema>>;
  addOrderItem(entryId: number, orderId: number, input: WorkshopOrderItemInput): Promise<WorkshopOrderDetail>;
  updateOrderItem(entryId: number, orderId: number, section: WorkshopOrderItemSection, rowId: number, input: z.infer<typeof workshopOrderItemUpdateSchema>): Promise<WorkshopOrderDetail>;
  removeOrderItem(entryId: number, orderId: number, section: WorkshopOrderItemSection | "works", rowId: number, branchId: number): Promise<WorkshopOrderDetail>;
  createWorkshopOrder(entryId: number, input: WorkshopOrderInput): Promise<z.infer<typeof workshopOrderResultSchema>>;
  addWorksToOrder(entryId: number, orderId: number, input: z.infer<typeof workshopOrderWorksInputSchema>): Promise<z.infer<typeof workshopOrderWorksResultSchema>>;
  sendOrderToCommercial(entryId: number, orderId: number, branchId: number): Promise<{ id: number }>;
  deleteWorkshopOrder(entryId: number, orderId: number, branchId: number): Promise<z.infer<typeof workshopOrderDeletedSchema>>;
  /** Archivos de la OT (los mismos que en la web y en Mi jornada). */
  workshopOrderFiles(entryId: number, orderId: number, branchId: number): Promise<import("./models").Attachment[]>;
  uploadWorkshopOrderFiles(entryId: number, orderId: number, branchId: number, files: import("./models").LocalPhoto[]): Promise<void>;
  deleteWorkshopOrderFile(entryId: number, orderId: number, branchId: number, fileId: string): Promise<void>;
}

/** Nombres en español de los campos que la sucursal puede exigir en una OT. */
export const ORDER_FIELD_LABELS: Record<string, string> = {
  serviceTypeId: "Tipo de servicio", customerOriginId: "Origen del cliente", costCenterRelation: "Centro de costo", tags: "Etiquetas",
  contractors: "Contratistas", departments: "Departamentos", construction: "Obra", internalNotes: "Notas internas", placeId: "Lugar",
  contacts: "Contactos del cliente", branchesCustomer: "Sucursales del cliente", customersEquipments: "Equipo del cliente", customerId: "Cliente",
  description: "Descripción", entryId: "Ingreso"
};
