import type { Router } from "express";
import { z } from "zod";
import {
  TRANSPORT_CHARGE_TYPES, workshopOrderItemInputSchema, workshopOrderItemSectionSchema, workshopOrderItemUpdateSchema, workshopProductPageSchema,
  workshopTransportOptionsSchema, type WorkshopOrderDetail
} from "../../src/domain/workshopOrders";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { applySectionDelta, editableDocument, sectionTotals, type ItemSection } from "./orderDocument";
import { loadOrderDetail, loadOrderDocument } from "./orderDetail";
import { queueKey } from "./orders";
import { asRecord, assertAppPermission, list, positive, text, workshopActor, type Raw, type WorkshopRequestLedger } from "./support";

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Ingreso 0: OT abierta desde Mi jornada (sin ingreso del Taller).
const entryRef = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const orderIds = z.object({ entryId: entryRef, orderId: id }).strict();
const itemIds = z.object({ entryId: entryRef, orderId: id, section: z.union([workshopOrderItemSectionSchema, z.literal("works")]), rowId: id }).strict();
const branchQuery = z.object({ companyBranchId: id }).strict();
const productQuery = z.object({ companyBranchId: id, search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(0).max(1000).optional() }).strict();
const PAGE = 25;
const num = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const ROWS: Record<ItemSection, [string, string]> = { products: ["productsSection", "products"], transports: ["transportSection", "transports"], others: ["othersSection", "others"] };

interface CatalogProduct { id: number; code: string | null; name: string; description: string | null; costPrice: number; netSalePrice: number; isoCost: string | null; isoSale: string | null; stock: number | null; unit: string | null }
interface TransportRate { chargeType: string; cost: number; salePrice: number; iso: string }

function catalogProduct(raw: unknown): CatalogProduct | null {
  const row = asRecord(raw);
  const productId = positive(row.id);
  const name = text(row.name);
  if (productId === null || !name) return null;
  const stock = Number(row.stock);
  const currency = text(asRecord(row.currency).iso);
  return {
    id: productId, code: text(row.code)?.slice(0, 120) ?? null, name: name.slice(0, 500), description: text(row.description)?.slice(0, 5000) ?? null,
    costPrice: num(row.costPrice), netSalePrice: num(row.netSalePrice), isoCost: currency, isoSale: text(asRecord(row.currencySalePrice).iso) ?? currency,
    stock: row.stock === null || row.stock === undefined || !Number.isFinite(stock) ? null : stock,
    unit: (text(asRecord(row.unitOfMeasure).name) ?? text(row.unitOfMeasure))?.slice(0, 60) ?? null
  };
}

function transportRates(raw: unknown): Map<number, { name: string; rates: TransportRate[] }> {
  const result = new Map<number, { name: string; rates: TransportRate[] }>();
  for (const item of list(raw).map(asRecord)) {
    const transportId = positive(item.value ?? item.id);
    const name = text(item.label) ?? text(item.name);
    if (transportId === null || !name) continue;
    const rates = list(asRecord(item.detail).rates).map(asRecord).flatMap((rate) => {
      const chargeType = text(rate.chargeType);
      return chargeType ? [{ chargeType, cost: num(rate.cost), salePrice: num(rate.salePrice), iso: text(rate.iso) ?? "" }] : [];
    });
    result.set(transportId, { name: name.slice(0, 300), rates });
  }
  return result;
}

/**
 * Productos, transporte y otros de una OT, y quitar un trabajo de la OT. Cada cambio carga la OT completa, aplica solo
 * ese cambio y la guarda entera conservando precios, estados e impuestos; los totales de la sección se recalculan con las
 * fórmulas de la web. Los precios de lo nuevo salen del catálogo (igual que la web), nunca del teléfono.
 */
export function registerOrderItemRoutes(router: Router, upstream: Upstream, ledger: WorkshopRequestLedger, oneAtATime: <T>(entryId: number, action: () => Promise<T>) => Promise<T>): void {
  // Productos mostrados al técnico: al agregarlos se usan estos datos de catálogo (no los que mande el teléfono).
  const seenProducts = new Map<string, { product: CatalogProduct; at: number }>();
  const remember = (userId: number, product: CatalogProduct) => {
    if (seenProducts.size > 5000) for (const [key, value] of seenProducts) if (Date.now() - value.at > 3_600_000) seenProducts.delete(key);
    seenProducts.set(`${userId}:${product.id}`, { product, at: Date.now() });
  };
  /** Precio vigente: solo productos que el técnico vio hace menos de 15 minutos. */
  const listed = (userId: number, productId: number) => {
    const seen = seenProducts.get(`${userId}:${productId}`);
    return seen && Date.now() - seen.at < 900_000 ? seen.product : null;
  };

  router.get("/options/order-products", async (req, res) => {
    const query = productQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { user, token } = await workshopActor(upstream, req, query.companyBranchId);
    const page = query.page ?? 0;
    const raw = asRecord(await upstream.request("/products", { token, query: new URLSearchParams({
      pagination: JSON.stringify({ limit: PAGE, page }), filters: JSON.stringify({ search: query.search || undefined, isEnabled: true })
    }) }));
    const products = list(Array.isArray(raw) ? raw : raw.data).map(catalogProduct).filter((item): item is CatalogProduct => item !== null).slice(0, PAGE);
    for (const product of products) remember(user.id, product);
    const totalPages = num(raw.totalPages);
    res.json(workshopProductPageSchema.parse({
      items: products.map(({ id: productId, code, name, description, stock, unit }) => ({ id: productId, code, name, description, stock, unit })),
      hasMore: totalPages > page + 1
    }));
  });

  router.get("/options/order-transports", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const catalog = transportRates(await upstream.request("/commercial_transport/select", { token, query: new URLSearchParams({ companyBranchId: String(companyBranchId) }) }));
    res.json(workshopTransportOptionsSchema.parse({ items: [...catalog].slice(0, 500).map(([transportId, { name, rates }]) => {
      const types = TRANSPORT_CHARGE_TYPES.filter((type) => rates.some((rate) => rate.chargeType === type));
      return { id: transportId, name, chargeTypes: types.length > 0 ? types : [...TRANSPORT_CHARGE_TYPES] };
    }) }));
  });

  /** Carga, valida que se pueda editar, aplica el cambio, recalcula la sección y guarda la OT completa. */
  async function save(token: string, branchId: number, entryId: number, orderId: number, section: ItemSection | "works", change: (document: Raw) => void | Promise<void>): Promise<WorkshopOrderDetail> {
    // El bloqueo se revisa sobre el mismo documento que se guarda.
    const { detail: current, raw } = await loadOrderDocument(upstream, token, branchId, entryId, orderId);
    if (!current.editable) throw new GatewayError(409, "WORKSHOP_ORDER_LOCKED", `${current.lockedReason ?? "La OT no se puede editar."} Los cambios se hacen desde la web.`);
    // Una OT interna aprobada reenvía avisos de aprobación en cada guardado: sus ítems se cambian desde la web.
    if (text(asRecord(raw).mainStatus) === "APPROVED") throw new GatewayError(409, "WORKSHOP_ORDER_LOCKED", "La OT ya está aprobada. Los cambios de ítems se hacen desde la web.");
    const document = editableDocument(raw, branchId);
    const money = section === "works" ? "services" : section;
    const sectionProp = { services: "workSection", products: "productsSection", transports: "transportSection", others: "othersSection" }[money];
    if (asRecord(asRecord(document[sectionProp]).details).blockConsumption === true) {
      throw new GatewayError(409, "WORKSHOP_ORDER_SECTION_BLOCKED", "Esta sección de la OT está bloqueada por comercial. Pide el cambio desde la web.");
    }
    const before = sectionTotals(document, money);
    await change(document);
    applySectionDelta(document, money, before, sectionTotals(document, money));
    await upstream.request(`/negotiations/${orderId}`, { token, method: "PUT", json: document });
    return loadOrderDetail(upstream, token, branchId, entryId, orderId);
  }

  router.post("/entries/:entryId/orders/:orderId/items", async (req, res) => {
    const { entryId, orderId } = orderIds.parse(req.params);
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = workshopOrderItemInputSchema.parse(req.body);
    const { token, user } = await workshopActor(upstream, req, input.companyBranchId);
    const { item } = input;
    await assertAppPermission(upstream, token, input.companyBranchId, item.kind === "product" ? "ordersProducts" : item.kind === "transport" ? "ordersTransports" : "ordersOthers");
    const { result } = await ledger.run(`${user.id}`, input.requestId, { entryId, orderId, input }, () => oneAtATime(queueKey(entryId, orderId), async () => {
      if (item.kind === "product") {
        const product = listed(user.id, item.productId);
        if (!product) throw new GatewayError(409, "WORKSHOP_PRODUCT_NOT_LISTED", "Vuelve a buscar el producto para agregarlo.");
        return save(token, input.companyBranchId, entryId, orderId, "products", (document) => {
          const section = asRecord(document.productsSection);
          const rows = list(section.products).map(asRecord);
          const existing = rows.find((row) => row.isDeleted !== true && positive(row.productId) === product.id && (row.itemType ?? "PRODUCT") === "PRODUCT");
          if (existing) { existing.quantity = num(existing.quantity) + item.quantity; return; }
          // Igual que la web: precios convertidos a la moneda de la OT; en una OT interna el precio de venta es el costo.
          const data = asRecord(document.negotiationDataSection);
          const target = text(asRecord(data.currency).iso) ?? product.isoCost ?? "CLP";
          const conversions = list(data.currenciesConversions).map(asRecord);
          const toTarget = (value: number, iso: string | null) => {
            if (!iso || iso === target) return value;
            const factor = Number(conversions.find((entry) => entry.isoFrom === target && entry.isoTo === iso)?.conversionFactor);
            return value * (Number.isFinite(factor) && factor > 0 ? factor : 1);
          };
          const costPrice = toTarget(product.costPrice, product.isoCost);
          const netSalePrice = data.isWorkOrderInternal === true ? costPrice : toTarget(product.netSalePrice, product.isoSale);
          rows.push({
            isNew: true, isDeleted: false, itemType: "PRODUCT", productId: product.id, code: product.code, name: product.name, description: product.description,
            costPrice, netSalePrice, isoCostPrice: target, isoNetSalePrice: target,
            quantity: item.quantity, margin: 0, discountPercent: 0, discountAmount: 0, order: rows.length
          });
          section.products = rows;
        });
      }
      if (item.kind === "transport") {
        const catalog = transportRates(await upstream.request("/commercial_transport/select", { token, query: new URLSearchParams({ companyBranchId: String(input.companyBranchId) }) }));
        const transport = catalog.get(item.transportId);
        if (!transport) throw new GatewayError(409, "WORKSHOP_TRANSPORT_NOT_FOUND", "Ese transporte ya no está disponible. Actualiza la lista.");
        return save(token, input.companyBranchId, entryId, orderId, "transports", (document) => {
          const data = asRecord(document.negotiationDataSection);
          const target = text(asRecord(data.currency).iso) ?? "CLP";
          const conversions = list(data.currenciesConversions).map(asRecord);
          const rate = (iso: string) => {
            if (!iso || iso === target) return 1;
            const factor = Number(conversions.find((entry) => entry.isoFrom === target && entry.isoTo === iso)?.conversionFactor);
            return Number.isFinite(factor) && factor > 0 ? factor : 1;
          };
          // Igual que el asistente de la web: costo y precio sugeridos de la tarifa del vehículo para ese tipo de cobro.
          const suggested = transport.rates.find((entry) => entry.chargeType === item.chargeType);
          const section = asRecord(document.transportSection);
          const rows = list(section.transports).map(asRecord);
          rows.push({
            isNew: true, isDeleted: false, commercialTransportId: item.transportId, quotedType: item.chargeType, quotedValue: item.quantity,
            costUnit: suggested ? suggested.cost * rate(suggested.iso) : 0, salePriceUnit: suggested ? suggested.salePrice * rate(suggested.iso) : 0, isManualChange: false,
            isoTransport: target, detail: item.detail ?? "", order: rows.length, discountPercent: 0, discountAmount: 0, isSelected: false
          });
          section.transports = rows;
        });
      }
      return save(token, input.companyBranchId, entryId, orderId, "others", (document) => {
        const section = asRecord(document.othersSection);
        const rows = list(section.others).map(asRecord);
        // Sin costo: comercial lo valoriza (la web tampoco muestra montos en una OT).
        rows.push({ isNew: true, isDeleted: false, name: item.name, description: item.description ?? "", unitCost: 0, margin: 0, quantity: item.quantity,
          isSelected: false, isGrouped: false, discountPercent: 0, discountAmount: 0, order: rows.length });
        section.others = rows;
      });
    }));
    res.status(201).json(result);
  });

  router.patch("/entries/:entryId/orders/:orderId/items/:section/:rowId", async (req, res) => {
    const { entryId, orderId, section, rowId } = itemIds.parse(req.params);
    emptySchema.parse(req.query);
    if (section === "works") throw new GatewayError(400, "INVALID_INPUT");
    const input = workshopOrderItemUpdateSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    const detail = await oneAtATime(queueKey(entryId, orderId), () => save(token, input.companyBranchId, entryId, orderId, section, (document) => {
      const [sectionKey, rowsKey] = ROWS[section];
      const row = list(asRecord(document[sectionKey])[rowsKey]).map(asRecord)
        .find((item) => positive(item.id) === rowId && item.isDeleted !== true && (section !== "products" || (item.itemType ?? "PRODUCT") === "PRODUCT"));
      if (!row) throw new GatewayError(404, "WORKSHOP_ORDER_ITEM_NOT_FOUND", "Ese ítem ya no está en la OT. Actualiza el detalle.");
      if (num(row.usedQuantity) > input.quantity) throw new GatewayError(409, "WORKSHOP_ORDER_QUANTITY_USED", `Ya se usaron ${num(row.usedQuantity)}; la cantidad no puede ser menor.`);
      if (section === "products") {
        if (!Number.isInteger(input.quantity)) throw new GatewayError(400, "WORKSHOP_PRODUCT_QUANTITY_INTEGER", "La cantidad de un producto debe ser un número entero.");
        row.quantity = input.quantity;
      } else if (section === "transports") {
        row.quotedValue = input.quantity;
        if (input.note !== undefined) row.detail = input.note ?? "";
        row.hasChange = true;
      } else {
        row.quantity = input.quantity;
        if (input.note !== undefined) row.description = input.note ?? "";
        row.isNew = false;
      }
    }));
    res.json(detail);
  });

  router.delete("/entries/:entryId/orders/:orderId/items/:section/:rowId", async (req, res) => {
    const { entryId, orderId, section, rowId } = itemIds.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const detail = await oneAtATime(queueKey(entryId, orderId), () => save(token, companyBranchId, entryId, orderId, section, (document) => {
      if (section === "works") {
        // Quitar de la OT: el trabajo vuelve a quedar suelto en el ingreso (no se elimina).
        const works = list(asRecord(document.workSection).works).map(asRecord);
        const work = works.find((item) => positive(item.id) === rowId);
        if (!work) throw new GatewayError(404, "WORKSHOP_ORDER_ITEM_NOT_FOUND", "Ese trabajo ya no está en la OT. Actualiza el detalle.");
        work.isRemoved = true;
        work.isDeleted = false;
        return;
      }
      const [sectionKey, rowsKey] = ROWS[section];
      const row = list(asRecord(document[sectionKey])[rowsKey]).map(asRecord)
        .find((item) => positive(item.id) === rowId && item.isDeleted !== true && (section !== "products" || (item.itemType ?? "PRODUCT") === "PRODUCT"));
      if (!row) throw new GatewayError(404, "WORKSHOP_ORDER_ITEM_NOT_FOUND", "Ese ítem ya no está en la OT. Actualiza el detalle.");
      if (num(row.usedQuantity) > 0) throw new GatewayError(409, "WORKSHOP_ORDER_ITEM_USED", "Ese ítem ya tiene consumos registrados; no se puede quitar.");
      row.isDeleted = true;
    }));
    res.json(detail);
  });
}
