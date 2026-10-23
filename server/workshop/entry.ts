import {
  inspectionRequirementSchema, workshopEntryDetailSchema,
  type InspectionRequirement, type WorkshopEntryDetail, type WorkshopInspection, type WorkshopOrder, type WorkshopOrderStage, type WorkshopPhotoSlot, type WorkshopWork
} from "../../src/domain/workshopEntry";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { asRecord, branchEntry, clip, count, isoDate, list, positive, text, type Raw } from "./support";

const pad = (value: number, size: number) => String(value).padStart(size, "0");
const nameOf = (value: unknown) => text(asRecord(value).name);
const percent = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

/** Equipo del cliente o propio: "MARCA · TIPO · MODELO" y su identificación, como en el tablero. */
export function equipmentSummary(raw: unknown): { label: string; code: string | null; typeId: number | null; typeName: string | null } {
  const equipment = asRecord(raw);
  const parts = [nameOf(equipment.manufacturer), nameOf(equipment.type), nameOf(equipment.model)].filter((part): part is string => part !== null);
  const code = text(equipment.identification) ?? text(equipment.internalNumber) ?? text(equipment.autoGenerateCode);
  return {
    label: (parts.length > 0 ? parts.join(" · ") : code ?? "Sin equipo").slice(0, 500),
    code: clip(code, 120),
    typeId: positive(asRecord(equipment.type).id ?? equipment.typeId),
    typeName: nameOf(equipment.type)
  };
}

function inspection(raw: unknown): WorkshopInspection | null {
  const summary = asRecord(raw);
  const inspectionId = positive(summary.id);
  if (inspectionId === null) return null;
  const photos = asRecord(summary.photos);
  const checklist = asRecord(summary.checklist);
  const photoTypes = list(photos.items).flatMap((item) => { const type = text(asRecord(item).photoType); return type ? [type.slice(0, 120)] : []; });
  return {
    id: inspectionId,
    percentage: percent(summary.compliancePercentage),
    photoTypes: photoTypes.slice(0, 500),
    photosCount: count(photos.total ?? summary.photosCount),
    checklistTotal: count(checklist.total ?? summary.checklistStepsCount),
    checklistCompleted: count(checklist.completed ?? summary.completedChecklistStepsCount),
    completedAt: isoDate(summary.completedAt)
  };
}

/** Igual que la web (resolveEquipmentPhotoSlots): fotos generales y las del tipo de equipo, sin repetir. */
export function photoSlots(raw: unknown, typeId: number | null, typeName: string | null): WorkshopPhotoSlot[] {
  const normalizedType = typeName?.trim().toLowerCase() ?? null;
  const rows = list(raw).map(asRecord).filter((row) => row.isEnabled !== false && row.isDeleted !== true);
  rows.sort((a, b) => Number(b.isRequired === true) - Number(a.isRequired === true) || (Number(a.order) || 0) - (Number(b.order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));
  const seen = new Set<string>();
  const slots: WorkshopPhotoSlot[] = [];
  for (const row of rows) {
    const key = text(row.key);
    if (!key || seen.has(key)) continue;
    const general = row.relationKind === "GENERAL";
    const sameType = row.relationKind === "EQUIPMENT_TYPE" && ((typeId !== null && positive(row.equipmentTypeId) === typeId) ||
      (normalizedType !== null && text(row.equipmentTypeName)?.toLowerCase() === normalizedType));
    if (!general && !sameType) continue;
    seen.add(key);
    slots.push({ key: key.slice(0, 120), name: (text(row.name) ?? key).slice(0, 200), isRequired: row.isRequired === true });
  }
  return slots.slice(0, 200);
}

const FINISHED_WORK = new Set(["DONE", "FINISHED", "FINALIZED", "FINALIZADO", "COMPLETED", "COMPLETADO"]);
const WORK_STATUS: Record<string, string> = { TODO: "Por hacer", PENDING: "Pendiente", IN_PROGRESS: "En proceso", PAUSED: "Pausado", ON_HOLD: "En espera", DONE: "Terminado", FINISHED: "Terminado", COMPLETED: "Terminado" };
const normalize = (value: string | null) => (value ?? "").trim().toUpperCase().replace(/\s+/g, "_");

export function work(raw: unknown, internal: boolean): WorkshopWork | null {
  const row = asRecord(raw);
  const workId = positive(row.id);
  if (workId === null) return null;
  const status = text(row.mainStatus);
  const progress = percent(row.operationalProgress);
  const priority = text(row.priority);
  const orderId = positive(asRecord(row.negotiation).id);
  const maintenanceCode = clip(text(row.maintenanceCode), 60);
  return {
    id: workId,
    code: `TR-${pad(workId, 5)}`,
    title: (text(row.title) ?? "Sin título").slice(0, 500),
    priority: priority === "low" || priority === "medium" || priority === "high" ? priority : null,
    statusName: clip(status ? WORK_STATUS[normalize(status)] ?? status : null, 120),
    statusColor: clip(text(row.mainStatusColor), 40),
    progress,
    finished: progress >= 100 || FINISHED_WORK.has(normalize(status)) || FINISHED_WORK.has(normalize(text(row.status))),
    orderId,
    maintenanceCode,
    loose: internal ? row.isFromMaintenance !== true && maintenanceCode === null : orderId === null
  };
}

const BUSINESS_TYPE: Record<string, string> = { service: "SER", periodic_services: "SER", rental: "ARR", project: "PRO", rental_service: "SER", products: "PRO", result: "RES" };
const COMMERCIAL_STATUS: Record<string, string> = { PENDING: "Pendiente", APPROVED: "Aprobada", REJECTED: "Rechazada", CANCELLED: "Cancelada" };

/** Etapa comercial, igual que getWorkOrderStage de la web. */
export function orderStage(statusName: string | null): WorkshopOrderStage {
  if (statusName === "APPROVED") return "approved";
  if (statusName === "REJECTED" || statusName === "CANCELLED") return "rejected";
  if (statusName === null || statusName === "PENDING") return "draft";
  return "review";
}

/** Código como la web: COT-PRO-4265 (cotización formal de proyecto) o VEN-SER-0012 (venta directa de servicio). */
export function quoteCode(correlative: number | null, modality: string | null, businessType: string | null): string {
  if (correlative === null) return "Sin cotización";
  const prefix = modality === "DIRECT_AGREEMENT" ? "VEN" : "COT";
  const type = businessType ? BUSINESS_TYPE[businessType] ?? businessType.slice(0, 3).toUpperCase() : "";
  return `${prefix}-${type}-${pad(correlative, 4)}`;
}

export function order(raw: unknown): WorkshopOrder | null {
  const row = asRecord(raw);
  const orderId = positive(row.id);
  if (orderId === null) return null;
  const createdAsOT = row.createdAsODT === true;
  const sentToCommercial = !createdAsOT || text(row.sentToCommercialAtIso ?? row.sentToCommercialAt) !== null;
  const statusName = text(row.commercialStatus);
  const stage = orderStage(statusName);
  const internalNumber = positive(row.workOrderInternalNumber);
  const number = positive(row.workOrderNumber);
  const workOrderCode = row.isWorkOrderInternal === true && internalNumber !== null ? `OT-INT-${pad(internalNumber, 4)}` : number !== null ? `OT-${pad(number, 5)}` : null;
  const correlative = positive(row.correlative);
  const netTotal = Number(asRecord(row.totalsSection).totalNet) || 0;
  return {
    id: orderId,
    kind: createdAsOT ? "workOrder" : "quote",
    code: (correlative !== null ? quoteCode(correlative, text(row.businessModality), text(row.businessTypeName)) : workOrderCode ?? "OT sin código").slice(0, 60),
    workOrderCode,
    title: clip(text(row.title), 500),
    statusLabel: (!sentToCommercial ? "Sin enviar a comercial" : statusName ? COMMERCIAL_STATUS[statusName] ?? "En revisión" : "Pendiente").slice(0, 120),
    stage,
    sentToCommercial,
    quoted: netTotal > 0 || stage === "approved",
    finished: row.isCompleted === true,
    typeLabel: createdAsOT ? (row.isWorkOrderInternal === true ? "OT interna" : "Orden de trabajo") : text(row.businessModality) === "DIRECT_AGREEMENT" ? "Venta directa" : "Cotización formal",
    createdAt: isoDate(row.createdAt),
    sentAt: createdAsOT ? isoDate(row.sentToCommercialAtIso ?? row.sentToCommercialAt) : null
  };
}

const MAINTENANCE_PREFIX: Record<string, string> = { detencion: "DET", correctivo: "COR", preventivo: "PRE", rutinario: "RUT", checklist: "CHK" };
const MAINTENANCE_TYPE: Record<string, string> = { detencion: "Detención", correctivo: "Correctivo", preventivo: "Preventivo", rutinario: "Rutinario", checklist: "Checklist" };
const MAINTENANCE_STATUS: Record<string, string> ={ por_planificar: "Por planificar", planificada: "Planificada", en_progreso: "En progreso", entrega_tecnico: "Entrega técnica", finalizada: "Finalizada" };

export function maintenance(raw: unknown): WorkshopOrder | null {
  const row = asRecord(raw);
  const maintenanceId = positive(row.id);
  if (maintenanceId === null) return null;
  const status = text(row.status);
  const code = `OT-${MAINTENANCE_PREFIX[text(row.type) ?? ""] ?? "MAN"}-${pad(maintenanceId, 4)}`;
  return {
    id: maintenanceId, kind: "maintenance", code, workOrderCode: code,
    title: clip(text(row.title) ?? text(row.motive), 500),
    statusLabel: (status ? MAINTENANCE_STATUS[status] ?? status : "Sin estado").slice(0, 120),
    stage: "approved", sentToCommercial: true, quoted: true, finished: status === "finalizada",
    typeLabel: MAINTENANCE_TYPE[text(row.type) ?? ""] ?? "Mantenimiento", createdAt: isoDate(row.createdAt), sentAt: null
  };
}

/** Partes opcionales de la ficha: si fallan se marca "no disponible", salvo que la sesión haya vencido. */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try { return await load(); }
  catch (error) {
    if (error instanceof GatewayError && error.status === 401) throw error;
    return null;
  }
}

const requirement = (value: unknown): InspectionRequirement => {
  const parsed = inspectionRequirementSchema.safeParse(value);
  return parsed.success ? parsed.data : "none";
};

/** Ficha del ingreso: datos, recepción, inspecciones, trabajos y órdenes, en una sola respuesta para la app. */
export async function loadWorkshopEntry(upstream: Upstream, token: string, branchId: number, entryId: number): Promise<WorkshopEntryDetail> {
  const { raw } = await branchEntry(upstream, token, branchId, entryId);
  const internal = raw.isInternalEntry === true;
  const equipment = equipmentSummary(raw.customerEquipment ?? raw.rentalEquipment);
  const negotiationIds = list(raw.negotiations).flatMap((item) => { const value = positive(asRecord(item).id); return value === null ? [] : [value]; });
  const branchFilter = { companyBranchId: branchId };
  const page = JSON.stringify({ page: 0, limit: 200 });

  const [compliance, config, requiredPhotos, works, orders] = await Promise.all([
    optional(() => upstream.request(`/equipment_dispatches/inspections/by-entry/${entryId}/compliance`, { token })),
    optional(() => upstream.request(`/branches/${branchId}/inspectionRequirementsConfig`, { token })),
    optional(() => upstream.request("/equipment_masters/required_photos", { token })),
    optional(() => upstream.request("/works", { token, query: new URLSearchParams({
      filters: JSON.stringify({ ...branchFilter, operationAreaEntryWorks: { entryId, negotiationIds } }), pagination: page
    }) })),
    optional(() => internal
      ? upstream.request("/maintenances", { token, query: new URLSearchParams({ page: "1", limit: "100", includeArchived: "true", operationAreaEntryId: String(entryId), companyBranchId: String(branchId) }) })
      : upstream.request("/negotiations", { token, query: new URLSearchParams({
        pagination: page,
        filters: JSON.stringify({ ...branchFilter, ...(positive(raw.customerId) !== null ? { customerId: positive(raw.customerId) } : {}), operationAreaEntryId: entryId,
          byWorkOrderInternal: false, includeWorkOrders: true, byBusinessTypeName: "-1", byBusinessModality: "-1", byPriority: "-1", byStatus: "-1", byContract: "-1",
          byCommercialStatus: [], byCommercialSubStatus: [], byOperationalStatus: [], byOperationalSubStatus: [], departments: [], specialties: [],
          sortBy: [{ column: "correlative", sortDirection: "desc" }] })
      }) }))
  ]);

  const requirements = asRecord(asRecord(config).inspectionRequirementsConfig);
  const signature = asRecord(raw.responsibleSignature);
  const status = asRecord(raw.status);
  const subStatus = asRecord(raw.subStatus);
  const deliveredAt = isoDate(raw.deliveredAt);
  const result = workshopEntryDetailSchema.safeParse({
    id: entryId,
    code: `ING-${pad(entryId, 5)}`,
    title: clip(text(raw.title), 500),
    notes: clip(text(raw.notes), 4000),
    areaId: positive(raw.operationAreaId),
    areaTitle: clip(text(asRecord(raw.operationArea).title), 300),
    statusKey: clip(text(status.key), 80),
    statusColor: clip(text(status.color), 40),
    subStatusName: clip(text(subStatus.name), 200),
    isInternalEntry: internal,
    customerName: clip(text(raw.customerName), 300),
    equipmentLabel: equipment.label,
    equipmentCode: equipment.code,
    imageUrl: clip(text(raw.image) ?? text(raw.avatarThumbnail), 4000),
    entryAt: isoDate(raw.entryDateTime),
    estimatedDeliveryAt: isoDate(raw.estimatedDepartureDateTime),
    reception: { signed: text(signature.id) !== null && text(signature.signatureImage) !== null, receiverName: clip(text(signature.name), 300), signedAt: isoDate(signature.date) },
    delivery: deliveredAt ? { at: deliveredAt, to: clip(text(raw.deliveredTo), 300), note: clip(text(raw.deliveryNote), 4000) } : null,
    inspections: {
      available: compliance !== null && config !== null && requiredPhotos !== null,
      entryRequirement: requirement(requirements.entry),
      exitRequirement: requirement(requirements.exit),
      entry: inspection(asRecord(compliance).entryInspection),
      exit: inspection(asRecord(compliance).exitInspection),
      photoSlots: photoSlots(requiredPhotos, equipment.typeId, equipment.typeName)
    },
    works: { available: works !== null, items: list(works).map((item) => work(item, internal)).filter((item): item is WorkshopWork => item !== null).slice(0, 500) },
    orders: { available: orders !== null, items: list(orders).map(internal ? maintenance : order).filter((item): item is WorkshopOrder => item !== null).slice(0, 500) }
  });
  if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
  return result.data;
}
