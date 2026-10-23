import type { WorkshopOrder } from "../../src/domain/workshopEntry";
import { workshopOrderDetailSchema, type WorkshopOrderDetail } from "../../src/domain/workshopOrders";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { loadWorkshopEntry, order } from "./entry";
import { asRecord, clip, list, positive, text, type Raw } from "./support";

/** Igual que la web (NegotiationForm): con estos estados comerciales la OT queda solo para ver. */
const LOCKED_STATUS: Record<string, string> = {
  SENT_TO_CUSTOMER: "La OT ya fue enviada al cliente.", APPROVED: "La OT ya está aprobada.", REJECTED: "La OT fue rechazada.",
  REVISED: "La OT está en revisión.", CANCELLED: "La OT fue cancelada."
};

/** Tipos de negocio del backend (en inglés) con su nombre en la web. */
const BUSINESS_TYPES: Record<string, string> = {
  service: "Servicio", project: "Proyecto", rental: "Arriendo", sale: "Venta", product: "Venta de productos", per_person: "Por persona", result: "Por resultado"
};
const businessTypeLabel = (value: string | null) => value === null ? null : BUSINESS_TYPES[value.toLowerCase()] ?? value;

const priority = (value: unknown) => { const raw = text(value); return raw === "low" || raw === "medium" || raw === "high" ? raw : null; };
const amount = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.min(number, 1_000_000_000) : 0; };
const labels = (value: unknown, ...keys: string[]) => list(value).flatMap((item) => {
  const row = asRecord(item);
  const found = keys.map((key) => text(row[key])).find((label) => label !== null);
  return found ? [found.slice(0, 300)] : [];
}).slice(0, 100);
const dateOnly = (value: unknown) => { const raw = text(value); return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null; };
const rows = (section: unknown, key: string) => list(asRecord(section)[key]).map(asRecord).filter((row) => row.isDeleted !== true);

function equipmentName(row: Raw): string {
  const equipment = asRecord(row.rentalEquipment);
  const parts = [asRecord(equipment.manufacturer).name, asRecord(equipment.type).name, asRecord(equipment.model).name].map(text).filter((part): part is string => part !== null);
  return (text(equipment.name) ?? (parts.length ? parts.join(" · ") : null) ?? text(row.name) ?? text(equipment.internalNumber) ?? "Equipo en arriendo").slice(0, 500);
}

/**
 * OT o cotización del ingreso para el teléfono: datos generales y secciones sin ningún precio, costo, margen ni total.
 * `transportNames` traduce el id del catálogo de transporte a su nombre.
 */
export function orderDetail(raw: unknown, summary: WorkshopOrder, transportNames: Map<number, string>): WorkshopOrderDetail {
  const document = asRecord(raw);
  const data = asRecord(document.negotiationDataSection);
  const status = text(document.mainStatus);
  const locked = status ? LOCKED_STATUS[status] ?? null : null;
  const internal = data.isWorkOrderInternal === true;
  return workshopOrderDetailSchema.parse({
    id: summary.id,
    kind: summary.kind === "workOrder" ? "workOrder" : "quote",
    code: summary.code,
    workOrderCode: summary.workOrderCode,
    statusLabel: summary.statusLabel,
    subStatusLabel: clip(text(document.subStatus), 120),
    sentToCommercial: summary.sentToCommercial,
    // Las OT internas no se bloquean por estado comercial en la web.
    // Solo las OT se editan desde la app: las cotizaciones son de comercial.
    editable: summary.kind === "workOrder" && (internal || locked === null),
    lockedReason: summary.kind !== "workOrder" ? "Las cotizaciones se gestionan en comercial." : internal ? null : locked,
    general: {
      title: clip(text(data.title), 500),
      description: clip(text(data.description), 10000),
      internalNotes: clip(text(data.internalNotes), 10000),
      priority: priority(data.priority),
      serviceDate: dateOnly(data.serviceDate),
      businessType: clip(businessTypeLabel(text(asRecord(data.businessType).name) ?? text(document.businessTypeName)), 120),
      customerName: clip(text(asRecord(document.customer).name) ?? text(asRecord(data.customer).name), 300),
      branches: labels(data.branchesCustomer, "label", "name"),
      contacts: list(data.contacts).map(asRecord).filter((contact) => contact.isSelected === true).flatMap((contact) => {
        const name = text(contact.fullName) ?? text(contact.name);
        return name ? [name.slice(0, 300)] : [];
      }).slice(0, 100),
      equipments: labels(data.customersEquipments, "label", "name"),
      createdAt: summary.createdAt ?? null,
      sentAt: summary.sentAt ?? null
    },
    works: rows(document.workSection, "works").flatMap((row) => {
      const workId = positive(row.id);
      if (workId === null) return [];
      const minutes = Number(row.assignedTime);
      return [{
        id: workId, code: `TR-${String(workId).padStart(5, "0")}`, title: (text(row.title) ?? "Sin título").slice(0, 500), priority: priority(row.priority),
        summary: clip(text(row.summary), 10000), assignedMinutes: Number.isFinite(minutes) && minutes >= 0 ? Math.min(Math.round(minutes), 1_000_000) : null,
        specialty: clip(labels(row.specialties, "label")[0] ?? text(asRecord(row.specialty).name), 200),
        responsibles: labels(row.responsibles, "name", "fullName").slice(0, 50)
      }];
    }),
    products: rows(document.productsSection, "products").flatMap((row) => {
      const rowId = positive(row.id);
      if (rowId === null) return [];
      const stock = Number(row.stock);
      return [{
        id: rowId, productId: positive(row.productId), code: clip(text(row.code), 120), name: (text(row.name) ?? "Producto").slice(0, 500),
        description: clip(text(row.description), 5000), unit: clip(text(row.unitOfMeasure) ?? text(asRecord(row.unitOfMeasure).name), 60),
        quantity: amount(row.quantity), stock: row.stock === null || row.stock === undefined || !Number.isFinite(stock) ? null : stock, isEquipment: row.itemType === "EQUIPMENT"
      }];
    }),
    transports: rows(document.transportSection, "transports").flatMap((row) => {
      const rowId = positive(row.id);
      if (rowId === null) return [];
      const transportId = positive(row.commercialTransportId);
      return [{
        id: rowId, transportId, name: (transportId !== null ? transportNames.get(transportId) : null) ?? "Transporte",
        detail: clip(text(row.detail), 5000), chargeType: clip(text(row.quotedType), 60), quantity: amount(row.quotedValue)
      }];
    }),
    others: rows(document.othersSection, "others").flatMap((row) => {
      const rowId = positive(row.id);
      return rowId === null ? [] : [{ id: rowId, name: (text(row.name) ?? "Otro").slice(0, 500), description: clip(text(row.description), 5000), quantity: amount(row.quantity) }];
    }),
    rentals: rows(document.rentalEquipmentSection, "rentalEquipments").flatMap((row) => {
      const rowId = positive(row.id);
      return rowId === null ? [] : [{ id: rowId, name: equipmentName(row), from: clip(text(row.startDate) ?? text(row.from), 40), to: clip(text(row.endDate) ?? text(row.to), 40) }];
    })
  });
}

/** Ingreso 0: la OT se abre desde Mi jornada, sin pasar por un ingreso del Taller. */
export const NO_ENTRY = 0;

/** Carga la OT solo si es una OT o cotización de este ingreso (o, con ingreso 0, de la sucursal) y de la sucursal de la sesión. */
export async function loadOrderDetail(upstream: Upstream, token: string, branchId: number, entryId: number, orderId: number): Promise<WorkshopOrderDetail> {
  return (await loadOrderDocument(upstream, token, branchId, entryId, orderId)).detail;
}

/** Igual que loadOrderDetail, pero entrega también el documento del backend con el que se calculó (para guardarlo sin releer). */
export async function loadOrderDocument(upstream: Upstream, token: string, branchId: number, entryId: number, orderId: number): Promise<{ detail: WorkshopOrderDetail; raw: unknown }> {
  let summary: WorkshopOrder | undefined;
  if (entryId !== NO_ENTRY) {
    const entry = await loadWorkshopEntry(upstream, token, branchId, entryId);
    if (!entry.orders.available) throw new GatewayError(503, "WORKSHOP_ENTRY_INCOMPLETE", "No se pudieron revisar las órdenes del ingreso. Inténtalo de nuevo.");
    summary = entry.orders.items.find((item) => item.id === orderId && item.kind !== "maintenance");
    if (!summary) throw new GatewayError(404, "NEGOTIATION_NOT_FOUND", "Esa orden no pertenece a este ingreso. Actualiza la ficha.");
  }
  const branch = new URLSearchParams({ companyBranchId: String(branchId) });
  const [raw, catalog] = await Promise.all([
    upstream.request(`/negotiations/${orderId}`, { token, query: branch }),
    // Solo para mostrar el nombre del transporte; si falla se muestra "Transporte".
    upstream.request("/commercial_transport/select", { token, query: branch }).catch((error: unknown) => {
      if (error instanceof GatewayError && error.status === 401) throw error;
      return [];
    })
  ]);
  const data = asRecord(asRecord(raw).negotiationDataSection);
  if (positive(data.id) !== orderId) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
  if (!summary) {
    // Sin ingreso: el resumen sale de la misma OT, que debe ser de la sucursal de la sesión.
    const owner = positive(data.companyBranchId ?? asRecord(data.branch).id ?? asRecord(asRecord(raw).branch).id);
    if (owner !== null && owner !== branchId) throw new GatewayError(404, "NEGOTIATION_NOT_FOUND", "Esa orden no es de esta sucursal.");
    const document = asRecord(raw);
    summary = order({ ...data, id: orderId, commercialStatus: text(document.mainStatus), businessTypeName: text(document.businessTypeName) ?? data.businessTypeName,
      totalsSection: document.totalsSection }) ?? undefined;
    if (!summary || summary.kind !== "workOrder") throw new GatewayError(404, "NEGOTIATION_NOT_FOUND", "Solo se pueden abrir órdenes de trabajo.");
  }
  const names = new Map<number, string>();
  for (const item of list(catalog).map(asRecord)) {
    const transportId = positive(item.value ?? item.id);
    const label = text(item.label) ?? text(item.name);
    if (transportId !== null && label) names.set(transportId, label.slice(0, 300));
  }
  return { detail: orderDetail(raw, summary, names), raw };
}
