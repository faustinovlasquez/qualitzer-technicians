import { Router } from "express";
import { z } from "zod";
import {
  ORDER_FIELD_LABELS, workshopOrderActionInputSchema, workshopOrderDeletedSchema, workshopOrderGeneralInputSchema, workshopOrderInputSchema, workshopOrderResultSchema,
  workshopOrderRulesSchema, workshopOrderSentSchema, workshopOrderWorksInputSchema, workshopOrderWorksResultSchema, type WorkshopOrderRules, type WorkshopOrderInput, ORDER_FILLABLE_FIELDS, ORDER_SKIPPED_IN_APP
} from "../../src/domain/workshopOrders";
import type { WorkshopEntryDetail } from "../../src/domain/workshopEntry";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { loadWorkshopEntry } from "./entry";
import { loadOrderDetail, NO_ENTRY } from "./orderDetail";
import { registerOrderItemRoutes } from "./orderItems";
import { asRecord, list, positive, text, workshopActor, type WorkshopRequestLedger } from "./support";

const ids = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const orderIds = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), orderId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
/** Ver y editar datos generales también admite ingreso 0 (OT abierta desde Mi jornada). */
const orderRef = z.object({ entryId: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER), orderId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
/** Fila de trabajo: cada ingreso por separado; sin ingreso, cada OT por separado. */
export const queueKey = (entryId: number, orderId: number) => entryId > 0 ? entryId : -orderId;
const branchQuery = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict();

/** Campos que la web oculta en una OT (no se exigen) y los que la pasarela completa desde el ingreso. */
const HIDDEN_IN_WORK_ORDER = new Set(["probableClosingDate", "probablePaymentDate", "probableBillingDate", "sentDate", "salesExecutiveId", "maxPaymentTermId", "currencyId",
  "closingProbability", "negotiationOperationTypeId", "businessModality", "businessTypeId", "daysOfValidity", "termsCondition"]);
const FILLED_BY_GATEWAY = new Set(["title", "customerId", "entryId", "priority", "placeId", "serviceDate", "description"]);

/** Día de hoy en la zona horaria de la empresa (no UTC: de noche en Chile ya sería mañana y la OT no saldría en Mi jornada). */
function localDay(timezone: string | undefined): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
}

/** Igual que la web (isFieldRequired): obligatorio del sistema, o visible y obligatorio. */
async function orderRules(upstream: Upstream, token: string, branchId: number, entry: WorkshopEntryDetail, raw: Record<string, unknown>): Promise<WorkshopOrderRules> {
  const config = list(asRecord(await upstream.request(`/branches/${branchId}/negotiationFieldsConfig`, { token })).negotiationFieldsConfig).map(asRecord);
  const required = config.filter((row) => row.isSystemRequired === true || (row.visible === true && row.required === true)).flatMap((row) => { const name = text(row.fieldName); return name ? [name] : []; });
  const hasEquipment = positive(raw.customerEquipmentId) !== null;
  const hasContacts = list(raw.contacts).length > 0;
  const hasBranches = list(raw.branchesCustomer).length > 0;
  const fillable = new Set<string>(ORDER_FILLABLE_FIELDS);
  const blocking = required.filter((field) => {
    if (HIDDEN_IN_WORK_ORDER.has(field) || FILLED_BY_GATEWAY.has(field) || fillable.has(field) || (ORDER_SKIPPED_IN_APP as readonly string[]).includes(field)) return false;
    if (field === "customersEquipments") return !hasEquipment;
    if (field === "contacts") return !hasContacts;
    if (field === "branchesCustomer") return !hasBranches;
    return true;
  }).map((field) => ORDER_FIELD_LABELS[field] ?? field);
  if (entry.customerName === null && required.includes("customerId")) blocking.push(ORDER_FIELD_LABELS.customerId!);
  // Lo que el técnico sí puede completar en la app (textos).
  const fields = ORDER_FILLABLE_FIELDS.filter((field) => required.includes(field)).map((field) => ({ key: field, label: ORDER_FIELD_LABELS[field] ?? field, options: [] }));
  return workshopOrderRulesSchema.parse({ blockingFields: [...new Set(blocking)].slice(0, 50), descriptionRequired: required.includes("description"), fields });
}

/** Revisa que vengan los campos exigidos que se completan en la app y que las opciones elegidas existan. */
function orderExtra(extra: WorkshopOrderInput["extra"]) {
  const value = extra ?? {};
  return value.costCenterRelation ? { costCenterRelation: value.costCenterRelation } : {};
}

async function entryContext(upstream: Upstream, token: string, branchId: number, entryId: number) {
  const [detail, raw] = await Promise.all([
    loadWorkshopEntry(upstream, token, branchId, entryId),
    upstream.request(`/operation_area_entries/${entryId}`, { token }).then(asRecord)
  ]);
  if (detail.delivery) throw new GatewayError(409, "DEPARTURE_ALREADY_EXISTS", "Este equipo ya fue entregado.");
  if (detail.isInternalEntry) throw new GatewayError(409, "WORKSHOP_INTERNAL_ENTRY", "En equipos propios los trabajos van en mantenimientos, no en OT.");
  if (!detail.works.available || !detail.orders.available) throw new GatewayError(503, "WORKSHOP_ENTRY_INCOMPLETE", "No se pudieron revisar los trabajos u órdenes del ingreso. Inténtalo de nuevo.");
  return { detail, raw };
}

/** OT del ingreso no enviada a comercial: la única que el técnico puede tocar desde la app. */
function ownOrder(detail: WorkshopEntryDetail, orderId: number) {
  const order = detail.orders.items.find((item) => item.id === orderId);
  if (!order) throw new GatewayError(404, "NEGOTIATION_NOT_FOUND", "Esa orden no pertenece a este ingreso. Actualiza la ficha.");
  if (order.kind !== "workOrder") throw new GatewayError(409, "WORKSHOP_ORDER_NOT_WORK_ORDER", "Las cotizaciones se gestionan en comercial.");
  if (order.sentToCommercial) throw new GatewayError(409, "WORK_ORDER_ALREADY_SENT_TO_COMMERCIAL", "Esta OT ya fue enviada a comercial.");
  return order;
}

function looseWorks(detail: WorkshopEntryDetail, workIds: number[]): number[] {
  const unique = [...new Set(workIds)];
  const loose = new Set(detail.works.items.filter((work) => work.loose).map((work) => work.id));
  if (unique.some((workId) => !loose.has(workId))) throw new GatewayError(409, "WORKSHOP_WORK_NOT_LOOSE", "Algún trabajo ya está en otra OT o no es de este ingreso. Actualiza la ficha.");
  return unique;
}

async function sendToCommercial(upstream: Upstream, token: string, orderId: number) {
  await upstream.request(`/negotiations/${orderId}/send-to-commercial`, { token, method: "PATCH", json: {} });
}

/** Órdenes de trabajo del ingreso: crear sin precios, agregar trabajos, enviar a comercial y eliminar una no enviada. */
export function registerOrderRoutes(router: Router, upstream: Upstream, ledger: WorkshopRequestLedger): void {
  // El backend no impide que un mismo trabajo quede en dos OT: lo que mueve trabajos de un ingreso va de a uno por ingreso.
  const busy = new Map<number, Promise<unknown>>();
  const oneAtATime = <T>(entryId: number, action: () => Promise<T>): Promise<T> => {
    const run = (busy.get(entryId) ?? Promise.resolve()).catch(() => undefined).then(action);
    const tail = run.catch(() => undefined);
    busy.set(entryId, tail);
    void tail.then(() => { if (busy.get(entryId) === tail) busy.delete(entryId); });
    return run;
  };
  registerOrderItemRoutes(router, upstream, ledger, oneAtATime);
  router.get("/entries/:entryId/order-rules", async (req, res) => {
    const { entryId } = ids.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const { detail, raw } = await entryContext(upstream, token, companyBranchId, entryId);
    res.json(await orderRules(upstream, token, companyBranchId, detail, raw));
  });

  router.get("/entries/:entryId/orders/:orderId", async (req, res) => {
    const { entryId, orderId } = orderRef.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    res.json(await loadOrderDetail(upstream, token, companyBranchId, entryId, orderId));
  });

  // Datos generales: solo columnas de la OT (sin tocar secciones, precios ni estados), con la regla de edición de la web.
  router.put("/entries/:entryId/orders/:orderId/general", async (req, res) => {
    const { entryId, orderId } = orderRef.parse(req.params);
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = workshopOrderGeneralInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    // En la misma fila que los ítems: un guardado completo no debe pisar este cambio con datos viejos.
    res.json(await oneAtATime(queueKey(entryId, orderId), async () => {
    const current = await loadOrderDetail(upstream, token, input.companyBranchId, entryId, orderId);
    if (!current.editable) throw new GatewayError(409, "WORKSHOP_ORDER_LOCKED", `${current.lockedReason ?? "La OT no se puede editar."} Los cambios se hacen desde la web.`);
    const config = list(asRecord(await upstream.request(`/branches/${input.companyBranchId}/negotiationFieldsConfig`, { token })).negotiationFieldsConfig).map(asRecord);
    const required = (field: string) => config.some((row) => text(row.fieldName) === field && (row.isSystemRequired === true || (row.visible === true && row.required === true)));
    if (required("description") && !input.description) throw new GatewayError(400, "WORKSHOP_ORDER_DESCRIPTION_REQUIRED", "La sucursal exige una descripción para la OT.");
    if (required("internalNotes") && !input.internalNotes) throw new GatewayError(400, "WORKSHOP_ORDER_NOTES_REQUIRED", "La sucursal exige notas internas en la OT.");
    await upstream.request(`/negotiations/${orderId}/update_fields`, { token, method: "PATCH", json: {
      title: input.title, description: input.description ?? "", internalNotes: input.internalNotes ?? "", priority: input.priority, serviceDate: input.serviceDate
    } });
    return loadOrderDetail(upstream, token, input.companyBranchId, entryId, orderId);
    }));
  });

  router.post("/entries/:entryId/orders", async (req, res) => {
    const { entryId } = ids.parse(req.params);
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = workshopOrderInputSchema.parse(req.body);
    const actor = await workshopActor(upstream, req, input.companyBranchId);
    const { token } = actor;
    const { result, replayed } = await ledger.run(`${actor.user.id}`, input.requestId, { entryId, input }, () => oneAtATime(entryId, async () => {
      const { detail, raw } = await entryContext(upstream, token, input.companyBranchId, entryId);
      const workIds = looseWorks(detail, input.workIds);
      // Desde el taller solo el título es obligatorio: los campos que exige la web los completa comercial después.
      const extra = orderExtra(input.extra);
      // Valores por defecto de la web: tipo de negocio "servicio", segmento predeterminado e impuestos predeterminados de la sucursal.
      const branch = new URLSearchParams({ companyBranchId: String(input.companyBranchId) });
      const [businessTypes, segments, taxes] = await Promise.all([
        upstream.request("/master_commercial/business-type-select-by-branch", { token, query: branch }),
        upstream.request("/master_commercial/segments/selects", { token, query: branch }),
        upstream.request("/master_commercial/taxes", { token, query: branch })
      ]);
      const service = list(businessTypes).map(asRecord).find((row) => text(row.label)?.toLowerCase() === "service");
      const businessTypeId = positive(service?.value);
      if (businessTypeId === null) throw new GatewayError(409, "WORKSHOP_ORDER_SERVICE_TYPE_MISSING", "La sucursal no tiene el tipo de negocio «Servicio». Configúralo en la web.");
      const segment = list(segments).map(asRecord).find((row) => row.isDefault === true);
      const defaultTaxes = list(taxes).map(asRecord).filter((row) => row.isDefaultNegotiation === true && row.isEnabled !== false).flatMap((row) => {
        const taxId = positive(row.id);
        return taxId === null ? [] : [{ taxId, rate: Number(row.rate) || 0, isDeleted: false, isNew: true }];
      });
      const details = { discountPercentage: 0, showGenericDescription: false, genericDescription: "", showItemDescriptionInPdf: true, assignedBudget: 0, freeConsumption: true, blockConsumption: false };
      const customerEquipmentId = positive(raw.customerEquipmentId);
      const created = asRecord(await upstream.request("/negotiations", { token, method: "POST", json: {
        businessTypeName: "service",
        taxes: [],
        totalsSection: { estimatedMargin: 0, realMargin: 0, subTotal: 0, totalNet: 0, totalDiscount: 0, totalTax: 0, totalGross: 0, discountPercentage: 0, totalCostWorkOrder: 0 },
        negotiationDataSection: {
          companyBranchId: input.companyBranchId, createdAsODT: true, isWorkOrderInternal: false, isTemplate: false, commercialSend: false, transformToNegotiationAndSend: false,
          businessModality: "FORMAL_QUOTE", businessTypeId, title: input.title, customerId: positive(raw.customerId),
          customersEquipments: customerEquipmentId === null ? [] : [{ value: customerEquipmentId }], entryId,
          branchesCustomer: list(raw.branchesCustomer).flatMap((item) => { const value = positive(asRecord(item).value ?? asRecord(item).id); return value === null ? [] : [{ value: String(value), label: text(asRecord(item).label) ?? "", isNew: true }]; }),
          contacts: list(raw.contacts).flatMap((item) => { const value = positive(asRecord(item).id); return value === null ? [] : [{ id: value, isSelected: true, isNew: false }]; }),
          currencyId: 1, placeId: 1, priority: input.priority, daysOfValidity: 15, closingProbability: 0, discountPercentage: 0,
          segmentId: positive(segment?.value), segmentMarginHH: Number(segment?.marginHH) || 0, serviceDate: localDay(actor.user.system?.timezone),
          salesExecutiveId: actor.user.workerId, description: input.description ?? "", internalNotes: input.extra?.internalNotes ?? "", hasContractor: false, contractors: [],
          ...extra
        },
        // Trabajos existentes sin precios: solo se unen (no se copian ni se modifican).
        workSection: { works: workIds.map((workId) => ({ existingWorkId: workId, isNew: true })), details: { ...details, showWorkHoursInPdf: true }, taxes: defaultTaxes },
        transportSection: { transports: [], details, taxes: [] },
        // El backend lee la sección de arriendos al crear (aunque venga vacía), igual que la envía la web.
        rentalEquipmentSection: { rentalEquipments: [], taxes: [], details: { fuelPriceRental: 0, fuelPriceRentalIso: "CLP", startDateRental: new Date().toISOString(),
          endDateRental: new Date().toISOString(), genericDescription: "", showGenericDescription: false,
          discountPercentage: 0, assignedBudget: 0, freeConsumption: true, blockConsumption: false, showFuelInPdf: false, showOperatorInPdf: false, showGpsInPdf: false,
          showOnlyEquipmentTypeInPdf: false, showItemDescriptionInPdf: true } }
      } }));
      const orderId = positive(created.id);
      if (orderId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
      let sent = false;
      if (input.sendToCommercial) {
        // La OT ya quedó creada: si el envío falla (también por sesión vencida) se informa y se envía después desde la ficha.
        try { await sendToCommercial(upstream, token, orderId); sent = true; }
        catch { sent = false; }
      }
      return { id: orderId, sent };
    }));
    res.status(replayed ? 200 : 201).json(workshopOrderResultSchema.parse(result));
  });

  router.post("/entries/:entryId/orders/:orderId/works", async (req, res) => {
    const { entryId, orderId } = orderIds.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopOrderWorksInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    const raw = await oneAtATime(entryId, async () => {
      const { detail } = await entryContext(upstream, token, input.companyBranchId, entryId);
      // Igual que la web: se agregan trabajos mientras la OT se pueda editar (aunque ya esté enviada a comercial).
      const order = await loadOrderDetail(upstream, token, input.companyBranchId, entryId, orderId);
      if (!order.editable) throw new GatewayError(409, "WORKSHOP_ORDER_LOCKED", `${order.lockedReason ?? "La OT no se puede editar."} Los cambios se hacen desde la web.`);
      const workIds = looseWorks(detail, input.workIds);
      try { return await upstream.request("/works/link-negotiation", { token, method: "PATCH", json: { negotiationId: orderId, workIds } }); }
      catch (error) {
        if (error instanceof GatewayError && error.status === 403) throw new GatewayError(403, "WORKS_PERMISSION_REQUIRED", "Tu perfil no tiene permiso para mover trabajos a una OT. Pide que te den \"editar\" en Trabajos.");
        throw error;
      }
    });
    const row = asRecord(raw);
    res.json(workshopOrderWorksResultSchema.parse({ linked: Math.max(0, Math.floor(Number(row.linked) || 0)), skipped: Math.max(0, Math.floor(Number(row.skipped) || 0)) }));
  });

  router.post("/entries/:entryId/orders/:orderId/send", async (req, res) => {
    const { entryId, orderId } = orderRef.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopOrderActionInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    if (entryId === NO_ENTRY) {
      // OT abierta desde Mi jornada: se revisa contra la propia OT de la sucursal.
      const current = await loadOrderDetail(upstream, token, input.companyBranchId, NO_ENTRY, orderId);
      if (current.kind !== "workOrder") throw new GatewayError(409, "WORKSHOP_ORDER_NOT_WORK_ORDER", "Las cotizaciones se gestionan en comercial.");
      if (current.sentToCommercial) throw new GatewayError(409, "WORK_ORDER_ALREADY_SENT_TO_COMMERCIAL", "Esta OT ya fue enviada a comercial.");
    } else {
      const { detail } = await entryContext(upstream, token, input.companyBranchId, entryId);
      ownOrder(detail, orderId);
    }
    await sendToCommercial(upstream, token, orderId);
    res.json(workshopOrderSentSchema.parse({ id: orderId }));
  });

  router.delete("/entries/:entryId/orders/:orderId", async (req, res) => {
    const { entryId, orderId } = orderIds.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const { detail } = await entryContext(upstream, token, companyBranchId, entryId);
    ownOrder(detail, orderId);
    const raw = asRecord(await upstream.request(`/negotiations/${orderId}/work-order`, { token, method: "DELETE" }));
    res.json(workshopOrderDeletedSchema.parse({ id: orderId, deletedWorks: Math.max(0, Math.floor(Number(raw.deletedWorks) || 0)) }));
  });
}
