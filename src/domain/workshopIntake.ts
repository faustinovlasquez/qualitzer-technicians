import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const isoDate = z.iso.datetime({ offset: true });

/** Cliente para elegir en el ingreso (el técnico no crea clientes desde la app). */
export const workshopCustomerOptionSchema = z.object({ id, name: z.string().max(300), document: z.string().max(60).nullable() }).strict();
export const workshopCustomerOptionsSchema = z.object({ items: z.array(workshopCustomerOptionSchema).max(20_000) }).strict();

export const workshopContactSchema = z.object({
  id, fullName: z.string().max(300), email: z.string().max(200).nullable(), phone: z.string().max(60).nullable(), position: z.string().max(200).nullable()
}).strict();
export const workshopBranchOptionSchema = z.object({ id, name: z.string().max(300) }).strict();
/** Sucursales y contactos del cliente elegido. */
export const workshopCustomerDetailSchema = z.object({
  id, name: z.string().max(300), contacts: z.array(workshopContactSchema).max(1000), branches: z.array(workshopBranchOptionSchema).max(1000)
}).strict();

export const workshopEquipmentSourceSchema = z.enum(["customer", "own"]);
/** Equipo del cliente o propio (de la empresa). */
export const workshopEquipmentOptionSchema = z.object({
  id, source: workshopEquipmentSourceSchema, label: z.string().max(500), code: z.string().max(120).nullable(),
  typeName: z.string().max(200).nullable(), detail: z.string().max(300).nullable(), imageUrl: z.string().max(4000).nullable()
}).strict();
export const workshopEquipmentOptionsSchema = z.object({ items: z.array(workshopEquipmentOptionSchema).max(500), hasMore: z.boolean() }).strict();
export const workshopEquipmentQuerySchema = z.object({
  companyBranchId: id, source: workshopEquipmentSourceSchema, customerId: id.optional(), search: z.string().trim().max(100).optional(), page: z.number().int().min(0).max(1000).default(0)
}).strict().refine((query) => query.source === "own" || query.customerId !== undefined, { message: "CUSTOMER_REQUIRED", path: ["customerId"] });

/** Naves del taller que todavía tienen espacio. */
export const workshopAreaOptionsSchema = z.object({ items: z.array(z.object({ id, title: z.string().max(300) }).strict()).max(500) }).strict();

/** Paso 1 del ingreso: datos del equipo. Igual que la web: título y nave obligatorios; cliente obligatorio salvo equipo propio. */
export const workshopIntakeInputSchema = z.object({
  companyBranchId: id,
  requestId: z.uuid(),
  operationAreaId: id,
  title: z.string().trim().min(1).max(255),
  notes: z.string().trim().max(2000).nullable(),
  isInternalEntry: z.boolean(),
  customerId: id.nullable(),
  customerEquipmentId: id.nullable(),
  rentalEquipmentId: id.nullable(),
  branchIds: z.array(id).max(50),
  contactIds: z.array(id).max(50),
  entryAt: isoDate,
  estimatedDeliveryAt: isoDate.nullable()
}).strict().superRefine((input, context) => {
  if (!input.isInternalEntry && input.customerId === null) context.addIssue({ code: "custom", message: "CUSTOMER_REQUIRED", path: ["customerId"] });
  if (input.isInternalEntry && input.customerEquipmentId !== null) context.addIssue({ code: "custom", message: "OWN_EQUIPMENT_REQUIRED", path: ["customerEquipmentId"] });
  if (!input.isInternalEntry && input.rentalEquipmentId !== null) context.addIssue({ code: "custom", message: "CUSTOMER_EQUIPMENT_REQUIRED", path: ["rentalEquipmentId"] });
  if (input.estimatedDeliveryAt !== null && Date.parse(input.estimatedDeliveryAt) < Date.parse(input.entryAt)) {
    context.addIssue({ code: "custom", message: "DELIVERY_BEFORE_ENTRY", path: ["estimatedDeliveryAt"] });
  }
});
export const workshopIntakeResultSchema = z.object({ id }).strict();

/** Foto del equipo: JPEG cuadrado preparado en el teléfono (sin EXIF), en data URI. */
export const WORKSHOP_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const workshopImageInputSchema = z.object({
  companyBranchId: id,
  image: z.string().max(Math.ceil(WORKSHOP_IMAGE_MAX_BYTES / 3) * 4 + 30).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
}).strict();

/** Valores actuales del paso 1 para continuar un ingreso ya registrado. */
export const workshopIntakeFormSchema = z.object({
  entryId: id,
  operationAreaId: id.nullable(),
  areaTitle: z.string().max(300).nullable(),
  title: z.string().max(500),
  notes: z.string().max(4000).nullable(),
  isInternalEntry: z.boolean(),
  customer: z.object({ id, name: z.string().max(300) }).strict().nullable(),
  equipment: workshopEquipmentOptionSchema.nullable(),
  branches: z.array(workshopBranchOptionSchema).max(1000),
  contacts: z.array(workshopContactSchema).max(1000),
  entryAt: z.string().max(40).nullable(),
  estimatedDeliveryAt: z.string().max(40).nullable(),
  imageUrl: z.string().max(4000).nullable(),
  signed: z.boolean()
}).strict();

export type WorkshopCustomerOption = z.infer<typeof workshopCustomerOptionSchema>;
export type WorkshopCustomerDetail = z.infer<typeof workshopCustomerDetailSchema>;
export type WorkshopContact = z.infer<typeof workshopContactSchema>;
export type WorkshopBranchOption = z.infer<typeof workshopBranchOptionSchema>;
export type WorkshopEquipmentSource = z.infer<typeof workshopEquipmentSourceSchema>;
export type WorkshopEquipmentOption = z.infer<typeof workshopEquipmentOptionSchema>;
export type WorkshopEquipmentOptions = z.infer<typeof workshopEquipmentOptionsSchema>;
export type WorkshopEquipmentQuery = z.input<typeof workshopEquipmentQuerySchema>;
export type WorkshopAreaOptions = z.infer<typeof workshopAreaOptionsSchema>;
export type WorkshopIntakeInput = z.infer<typeof workshopIntakeInputSchema>;
export type WorkshopIntakeResult = z.infer<typeof workshopIntakeResultSchema>;
export type WorkshopImageInput = z.infer<typeof workshopImageInputSchema>;
export type WorkshopIntakeForm = z.infer<typeof workshopIntakeFormSchema>;

export interface WorkshopIntakePort {
  workshopCustomers(branchId: number): Promise<{ items: WorkshopCustomerOption[] }>;
  workshopCustomer(branchId: number, customerId: number): Promise<WorkshopCustomerDetail>;
  workshopEquipment(query: WorkshopEquipmentQuery): Promise<WorkshopEquipmentOptions>;
  workshopAreas(branchId: number, workshopId: number): Promise<WorkshopAreaOptions>;
  workshopIntakeForm(branchId: number, entryId: number): Promise<WorkshopIntakeForm>;
  createWorkshopEntry(input: WorkshopIntakeInput): Promise<WorkshopIntakeResult>;
  updateWorkshopEntry(entryId: number, input: WorkshopIntakeInput): Promise<WorkshopIntakeResult>;
  uploadWorkshopEntryImage(entryId: number, input: WorkshopImageInput): Promise<WorkshopIntakeResult>;
}

const INTAKE_ERRORS: Record<string, string> = {
  CUSTOMER_REQUIRED: "Elige el cliente.",
  OWN_EQUIPMENT_REQUIRED: "En un equipo propio elige un equipo de la empresa.",
  CUSTOMER_EQUIPMENT_REQUIRED: "Elige un equipo del cliente.",
  DELIVERY_BEFORE_ENTRY: "La entrega estimada no puede ser antes del ingreso."
};
/** Mensajes en español de las reglas del paso 1. */
export function workshopIntakeIssues(input: unknown): Record<string, string> {
  const parsed = workshopIntakeInputSchema.safeParse(input);
  if (parsed.success) return {};
  const issues: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (issues[field]) continue;
    issues[field] = INTAKE_ERRORS[issue.message] ?? (field === "title" ? "Escribe un título (máximo 255 caracteres)." : field === "operationAreaId" ? "Elige la nave."
      : field === "notes" ? "Las observaciones admiten hasta 2000 caracteres." : "Revisa este dato.");
  }
  return issues;
}
