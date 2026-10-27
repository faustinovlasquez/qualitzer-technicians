import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(1_000_000);
const label = (max: number) => z.string().max(max);
const isoDate = z.string().max(40);

/** Lo que la sucursal exige en la inspección de ingreso y de entrega. */
export const inspectionRequirementSchema = z.enum(["none", "photos", "checklist", "full"]);
export type InspectionRequirement = z.infer<typeof inspectionRequirementSchema>;

/** Resumen de una inspección (ingreso o entrega) para saber si cumple lo exigido. */
export const workshopInspectionSchema = z.object({
  id,
  percentage: z.number().int().min(0).max(100),
  photoTypes: z.array(label(120)).max(500),
  photosCount: count,
  checklistTotal: count,
  checklistCompleted: count,
  completedAt: isoDate.nullable()
}).strict();

/** Foto obligatoria u opcional según el tipo de equipo (frente, costado, etc.). */
export const workshopPhotoSlotSchema = z.object({ key: label(120), name: label(200), isRequired: z.boolean() }).strict();

export const workshopWorkSchema = z.object({
  id,
  code: label(40),
  title: label(500),
  priority: z.enum(["low", "medium", "high"]).nullable(),
  statusName: label(120).nullable(),
  statusColor: label(40).nullable(),
  progress: z.number().int().min(0).max(100),
  finished: z.boolean(),
  /** Orden de trabajo o cotización a la que pertenece (id de la lista de órdenes). */
  orderId: id.nullable(),
  maintenanceCode: label(60).nullable(),
  /** Trabajo sin OT (o sin mantenimiento, en equipos propios). */
  loose: z.boolean()
}).strict();

export const workshopOrderStageSchema = z.enum(["draft", "review", "approved", "rejected"]);
export const workshopOrderSchema = z.object({
  id,
  kind: z.enum(["workOrder", "quote", "maintenance"]),
  /** Código de cotización (COT-PRO-4265), de OT (OT-00012) o de mantenimiento (OT-COR-0007). */
  code: label(60),
  workOrderCode: label(60).nullable(),
  title: label(500).nullable(),
  statusLabel: label(120),
  stage: workshopOrderStageSchema,
  /** OT creada en taller que todavía no se envía a comercial. */
  sentToCommercial: z.boolean(),
  /** Tiene montos o ya está aprobada (sin mostrar los montos al técnico). */
  quoted: z.boolean(),
  finished: z.boolean(),
  /** Tipo legible: "Cotización formal", "Venta directa", "OT interna", "Correctivo"… (opcional para gateways anteriores). */
  typeLabel: label(60).nullable().optional(),
  createdAt: isoDate.nullable().optional(),
  sentAt: isoDate.nullable().optional()
}).strict();

const sectionOf = <T extends z.ZodType>(item: T) => z.object({ available: z.boolean(), items: z.array(item).max(500) }).strict();

/** Condiciones de entrega que exige la sucursal (las define la web en «Condiciones de ingreso y entrega»). */
export const deliveryConditionsConfigSchema = z.object({
  /** Cada OT del ingreso enviada a comercial y al menos una cotización creada. */
  requireQuotes: z.boolean(),
  /** Cada cotización del ingreso con montos (o ya aprobada). */
  requireQuotedAmounts: z.boolean().optional(),
  requireApprovedNegotiations: z.boolean(),
  requireNoLooseWorks: z.boolean()
}).strict();
export type DeliveryConditionsConfig = z.infer<typeof deliveryConditionsConfigSchema>;
/** Lo que asume la app si el gateway no lo informa: una cotización en 0 también cuenta como cotización. */
export const DEFAULT_DELIVERY_CONDITIONS: Required<DeliveryConditionsConfig> = { requireQuotes: true, requireQuotedAmounts: false, requireApprovedNegotiations: false, requireNoLooseWorks: true };
/** Encabezado con el que la app avisa que entiende las condiciones de entrega (las apps anteriores no lo envían). */
export const DELIVERY_CONDITIONS_HEADER = "X-Qualitzer-Delivery-Conditions";

export const workshopEntryDetailSchema = z.object({
  id,
  code: label(40),
  title: label(500).nullable(),
  notes: label(4000).nullable(),
  areaId: id.nullable(),
  areaTitle: label(300).nullable(),
  statusKey: label(80).nullable(),
  statusColor: label(40).nullable(),
  subStatusName: label(200).nullable(),
  isInternalEntry: z.boolean(),
  customerName: label(300).nullable(),
  equipmentLabel: label(500),
  equipmentCode: label(120).nullable(),
  imageUrl: label(4000).nullable(),
  entryAt: isoDate.nullable(),
  estimatedDeliveryAt: isoDate.nullable(),
  reception: z.object({ signed: z.boolean(), receiverName: label(300).nullable(), signedAt: isoDate.nullable() }).strict(),
  delivery: z.object({ at: isoDate, to: label(300).nullable(), note: label(4000).nullable() }).strict().nullable(),
  inspections: z.object({
    available: z.boolean(),
    entryRequirement: inspectionRequirementSchema,
    exitRequirement: inspectionRequirementSchema,
    entry: workshopInspectionSchema.nullable(),
    exit: workshopInspectionSchema.nullable(),
    photoSlots: z.array(workshopPhotoSlotSchema).max(200),
    deliveryConditions: deliveryConditionsConfigSchema.optional()
  }).strict(),
  works: sectionOf(workshopWorkSchema),
  orders: sectionOf(workshopOrderSchema)
}).strict();

export type WorkshopInspection = z.infer<typeof workshopInspectionSchema>;
export type WorkshopPhotoSlot = z.infer<typeof workshopPhotoSlotSchema>;
export type WorkshopWork = z.infer<typeof workshopWorkSchema>;
export type WorkshopOrder = z.infer<typeof workshopOrderSchema>;
export type WorkshopOrderStage = z.infer<typeof workshopOrderStageSchema>;
export type WorkshopEntryDetail = z.infer<typeof workshopEntryDetailSchema>;

export interface WorkshopEntryPort {
  workshopEntry(branchId: number, entryId: number): Promise<WorkshopEntryDetail>;
}

const REQUIREMENT_LABELS: Record<InspectionRequirement, string> = { none: "No exigida", photos: "Fotos", checklist: "Lista de revisión", full: "Fotos y lista de revisión" };
export const inspectionRequirementLabel = (requirement: InspectionRequirement): string => REQUIREMENT_LABELS[requirement];

/** Igual que la web: una inspección cumple si tiene las fotos obligatorias y/o la lista de revisión completa. */
export function evaluateInspection(requirement: InspectionRequirement, inspection: WorkshopInspection | null, slots: WorkshopPhotoSlot[]): { met: boolean; missing: string[] } {
  if (requirement === "none") return { met: true, missing: [] };
  if (!inspection) return { met: false, missing: ["La inspección no se ha realizado"] };
  const missing: string[] = [];
  if (requirement === "photos" || requirement === "full") {
    const required = slots.filter((slot) => slot.isRequired);
    if (required.length === 0) {
      if (inspection.photosCount === 0) missing.push("Al menos una foto");
    } else {
      const taken = new Set(inspection.photoTypes);
      const pending = required.filter((slot) => !taken.has(slot.key));
      if (pending.length > 0) missing.push(`Faltan fotos: ${pending.map((slot) => slot.name).join(", ")}`);
    }
  }
  if ((requirement === "checklist" || requirement === "full") && inspection.checklistTotal > 0 && inspection.checklistCompleted < inspection.checklistTotal) {
    missing.push(`Lista de revisión: ${inspection.checklistCompleted} de ${inspection.checklistTotal}`);
  }
  return { met: missing.length === 0, missing };
}

export interface DeliveryCondition { id: "intake" | "orders" | "sent" | "amounts" | "approved" | "works" | "exit"; met: boolean; title: string; detail: string }

/** Condiciones para entregar el equipo, las mismas de la ficha web y según lo que exige la sucursal. */
export function workshopDeliveryConditions(detail: WorkshopEntryDetail): DeliveryCondition[] {
  const { inspections } = detail;
  const required: Required<DeliveryConditionsConfig> = { ...DEFAULT_DELIVERY_CONDITIONS, ...inspections.deliveryConditions };
  const entryCheck = evaluateInspection(inspections.entryRequirement, inspections.entry, inspections.photoSlots);
  const requirementName = inspectionRequirementLabel(inspections.entryRequirement).toLowerCase();
  const conditions: DeliveryCondition[] = [{
    id: "intake",
    met: detail.reception.signed && inspections.available && entryCheck.met,
    title: "Ingreso completo",
    detail: !detail.reception.signed ? "Falta la firma de recepción del ingreso."
      : !inspections.available ? "No se pudo revisar la inspección de ingreso."
      : !entryCheck.met ? `Inspección de ingreso (${requirementName}): ${entryCheck.missing.join(" · ")}`
      : inspections.entryRequirement === "none" ? "Firma de recepción completa."
      : `Firma de recepción e inspección de ingreso (${requirementName}) completas.`
  }];
  if (detail.isInternalEntry) {
    const maintenances = detail.orders.items.filter((order) => order.kind === "maintenance");
    conditions.push({
      id: "orders", met: detail.orders.available && maintenances.length > 0, title: "Mantenimientos creados",
      detail: !detail.orders.available ? "No se pudieron revisar los mantenimientos." : maintenances.length === 0 ? "El ingreso aún no tiene mantenimientos." : `${maintenances.length} mantenimiento(s) creado(s).`
    });
  } else {
    const commercial = detail.orders.items.filter((order) => order.kind !== "maintenance" && order.sentToCommercial);
    const unquoted = commercial.filter((order) => !order.quoted);
    // Una OT sin enviar no llega a comercial: no se cotiza y el equipo no se puede entregar.
    const unsent = detail.orders.items.filter((order) => order.kind === "workOrder" && !order.sentToCommercial);
    if (required.requireQuotes) {
      conditions.push({
        id: "orders", met: detail.orders.available && commercial.length > 0, title: "Cotizaciones creadas",
        detail: !detail.orders.available ? "No se pudieron revisar las cotizaciones."
          : commercial.length === 0 && unsent.length > 0 ? "Comercial todavía no puede cotizar: la OT no se ha enviado."
          : commercial.length === 0 ? "El ingreso aún no tiene cotizaciones."
          : `${commercial.map((order) => order.code).join(", ")} creada(s).`
      });
      if (detail.orders.available && unsent.length > 0) conditions.push({
        id: "sent", met: false, title: "OTs enviadas a comercial",
        detail: `${unsent.map((order) => order.code).join(", ")} sin enviar a comercial. Ábrela desde la pestaña OTs y envíala.`
      });
    }
    if (required.requireQuotedAmounts) conditions.push({
      id: "amounts", met: detail.orders.available && commercial.length > 0 && unquoted.length === 0, title: "Cotizaciones con valores",
      detail: !detail.orders.available ? "No se pudieron revisar las cotizaciones."
        : commercial.length === 0 ? "Aún no hay cotizaciones a las que poner valores."
        : unquoted.length > 0 ? `${unquoted.map((order) => order.code).join(", ")} sin valores todavía.`
        : "Todas las cotizaciones tienen valores."
    });
    if (required.requireApprovedNegotiations) {
      const negotiations = detail.orders.items.filter((order) => order.kind !== "maintenance");
      const unapproved = negotiations.filter((order) => order.stage !== "approved");
      conditions.push({
        id: "approved", met: detail.orders.available && negotiations.length > 0 && unapproved.length === 0, title: "Negociaciones aprobadas",
        detail: !detail.orders.available ? "No se pudieron revisar las negociaciones."
          : negotiations.length === 0 ? "El ingreso aún no tiene negociaciones."
          : unapproved.length > 0 ? `${unapproved.map((order) => order.code).join(", ")} sin aprobar por comercial.`
          : "Todas las negociaciones están aprobadas."
      });
    }
  }
  const loose = detail.works.items.filter((work) => work.loose);
  if (required.requireNoLooseWorks) conditions.push({
    id: "works", met: detail.works.available && loose.length === 0, title: "Sin trabajos sueltos",
    detail: !detail.works.available ? "No se pudieron revisar los trabajos."
      : detail.works.items.length === 0 ? "No hay trabajos sueltos."
      : loose.length === 0 ? `Todos los trabajos están en ${detail.isInternalEntry ? "un mantenimiento" : "una OT"}.`
      : `${loose.map((work) => work.code).join(", ")} sin ${detail.isInternalEntry ? "mantenimiento" : "OT"}.`
  });
  if (inspections.exitRequirement !== "none") {
    const exitCheck = evaluateInspection(inspections.exitRequirement, inspections.exit, inspections.photoSlots);
    conditions.push({
      id: "exit", met: inspections.available && exitCheck.met, title: "Inspección de entrega",
      detail: !inspections.available ? "No se pudo revisar la inspección de entrega." : exitCheck.met ? "Inspección de entrega completa." : exitCheck.missing.join(" · ")
    });
  }
  return conditions;
}
