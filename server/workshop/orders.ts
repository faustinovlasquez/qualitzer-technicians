import { Router } from "express";
import { z } from "zod";
import {
  ORDER_FIELD_LABELS, workshopOrderActionInputSchema, workshopOrderDeletedSchema, workshopOrderInputSchema, workshopOrderResultSchema,
  workshopOrderRulesSchema, workshopOrderSentSchema, workshopOrderWorksInputSchema, workshopOrderWorksResultSchema, type WorkshopOrderRules
} from "../../src/domain/workshopOrders";
import type { WorkshopEntryDetail } from "../../src/domain/workshopEntry";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { loadWorkshopEntry } from "./entry";
import { asRecord, list, positive, text, workshopActor, type WorkshopRequestLedger } from "./support";

const ids = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const orderIds = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), orderId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const branchQuery = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict();

/** Campos que la web oculta en una OT (no se exigen) y los que la pasarela completa desde el ingreso. */
const HIDDEN_IN_WORK_ORDER = new Set(["probableClosingDate", "probablePaymentDate", "probableBillingDate", "sentDate", "salesExecutiveId", "maxPaymentTermId", "currencyId",
  "closingProbability", "negotiationOperationTypeId", "businessModality", "businessTypeId", "daysOfValidity", "termsCondition"]);
const FILLED_BY_GATEWAY = new Set(["title", "customerId", "entryId", "priority", "placeId", "serviceDate", "description"]);

/** Igual que la web (isFieldRequired): obligatorio del sistema, o visible y obligatorio. */
async function orderRules(upstream: Upstream, token: string, branchId: number, entry: WorkshopEntryDetail, raw: Record<string, unknown>): Promise<WorkshopOrderRules> {
  const config = list(asRecord(await upstream.request(`/branches/${branchId}/negotiationFieldsConfig`, { token })).negotiationFieldsConfig).map(asRecord);
  const required = config.filter((row) => row.isSystemRequired === true || (row.visible === true && row.required === true)).flatMap((row) => { const name = text(row.fieldName); return name ? [name] : []; });
  const hasEquipment = positive(raw.customerEquipmentId) !== null;
  const hasContacts = list(raw.contacts).length > 0;
  const hasBranches = list(raw.branchesCustomer).length > 0;
  const blocking = required.filter((field) => {
    if (HIDDEN_IN_WORK_ORDER.has(field) || FILLED_BY_GATEWAY.has(field)) return false;
    if (field === "customersEquipments") return !hasEquipment;
    if (field === "contacts") return !hasContacts;
    if (field === "branchesCustomer") return !hasBranches;
    return true;
  }).map((field) => ORDER_FIELD_LABELS[field] ?? field);
  if (entry.customerName === null && required.includes("customerId")) blocking.push(ORDER_FIELD_LABELS.customerId!);
  return workshopOrderRulesSchema.parse({ blockingFields: [...new Set(blocking)].slice(0, 50), descriptionRequired: required.includes("description") });
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
  router.get("/entries/:entryId/order-rules", async (req, res) => {
    const { entryId } = ids.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const { detail, raw } = await entryContext(upstream, token, companyBranchId, entryId);
    res.json(await orderRules(upstream, token, companyBranchId, detail, raw));
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
      const rules = await orderRules(upstream, token, input.companyBranchId, detail, raw);
      if (rules.blockingFields.length > 0) {
        throw new GatewayError(409, "WORKSHOP_ORDER_FIELDS_REQUIRED", `La sucursal exige completar en la OT: ${rules.blockingFields.join(", ")}. Créala desde la web.`);
      }
      if (rules.descriptionRequired && !input.description) throw new GatewayError(400, "WORKSHOP_ORDER_DESCRIPTION_REQUIRED", "La sucursal exige una descripción para la OT.");
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
          segmentId: positive(segment?.value), segmentMarginHH: Number(segment?.marginHH) || 0, serviceDate: new Date().toISOString().slice(0, 10),
          salesExecutiveId: actor.user.workerId, description: input.description ?? "", internalNotes: "", hasContractor: false, contractors: []
        },
        // Trabajos existentes sin precios: solo se unen (no se copian ni se modifican).
        workSection: { works: workIds.map((workId) => ({ existingWorkId: workId, isNew: true })), details: { ...details, showWorkHoursInPdf: true }, taxes: defaultTaxes },
        transportSection: { transports: [], details, taxes: [] }
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
      ownOrder(detail, orderId);
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
    const { entryId, orderId } = orderIds.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopOrderActionInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    const { detail } = await entryContext(upstream, token, input.companyBranchId, entryId);
    ownOrder(detail, orderId);
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
