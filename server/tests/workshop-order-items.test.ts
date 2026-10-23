import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode, harness, jsonRequest } from "./mock-upstream";
import { applySectionDelta, editableDocument, sectionTotals } from "../workshop/orderDocument";

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" ? value as Record<string, unknown> : {});
type State = Awaited<ReturnType<typeof harness>>["state"];

/** OT 82 del ingreso 12 con precios de comercial: un producto, un transporte y un trabajo con costo. */
const document = (mainStatus = "PENDING") => ({
  mainStatus, businessTypeName: "service", customer: { name: "Cliente" }, taxes: [{ taxId: 1, rate: 19 }], resultFees: { estimated: {} }, termsCondition: { id: 3 },
  totalsSection: { subTotal: 100000, totalDiscount: 0, totalNet: 100000, totalTax: 19000, totalGross: 119000, discountPercentage: 0, estimatedMargin: 40000, realMargin: 40000 },
  negotiationDataSection: { id: 82, title: "OT de taller", commercialMainStatus: 4, commercialSubStatus: 9, operationalMainStatus: 2, currency: { iso: "CLP" },
    currenciesConversions: "[]", totalCostWorkOrder: 60000, sentToCommercialAt: "22-10-2026", contacts: [{ id: 1, isSelected: true }], creditValidation: { maxPaymentTermId: 3 },
    contractors: [], hasContractor: false, sectionTotals: JSON.stringify({ services: { subtotal: 60000, discount: 0, net: 60000, tax: 11400, gross: 71400 },
      products: { subtotal: 40000, discount: 0, net: 40000, tax: 7600, gross: 47600 } }) },
  workSection: { works: [{ id: 42, title: "Revisar motor", netCostHH: 15000, netSalePerHH: 30000, assignedTime: 120, activities: [{ id: 1 }], responsibles: [{ id: 5 }] }], details: null, taxes: [] },
  productsSection: { products: [{ id: 7, productId: 501, code: "SEL", name: "Sello", quantity: 2, costPrice: 10000, netSalePrice: 20000, isoCostPrice: "CLP", isoNetSalePrice: "CLP", itemType: "PRODUCT" }],
    details: { discountPercentage: 0 }, taxes: [{ id: 3, taxId: 1, rate: 19, isDeleted: false, isDefaultNegotiation: true, isRemovable: false }] },
  transportSection: { transports: [], details: null, taxes: [] },
  othersSection: { others: [], details: null, taxes: [] },
  rentalEquipmentSection: { rentalEquipments: [], details: null, taxes: [] }
});

function setBackend(state: State, mainStatus = "PENDING") {
  state.failures.set("/api/workshops/select", { status: 200, body: [{ value: 7, label: "Taller central" }] });
  state.failures.set("/api/operation_area/dashboard", { status: 200, body: [{ id: 3, title: "Patio", entries: [{ id: 12 }] }] });
  state.failures.set("/api/operation_area_entries/12", { status: 200, body: { id: 12, operationAreaId: 3, operationArea: { id: 3, title: "Patio" }, isInternalEntry: false, customerId: 40,
    customerEquipment: { manufacturer: { name: "CLARKE" } }, deliveredAt: null } });
  state.failures.set("/api/negotiations", { status: 200, body: { data: [{ id: 82, workOrderNumber: 12, createdAsODT: true, sentToCommercialAt: null, title: "OT de taller" }] } });
  state.failures.set("/api/works", { status: 200, body: { data: [] } });
  state.failures.set("/api/negotiations/82", { status: 200, body: document(mainStatus) });
  state.failures.set("/api/commercial_transport/select", { status: 200, body: [{ value: "4", label: "Camioneta", detail: { rates: [{ chargeType: "km", cost: 500, salePrice: 900, iso: "CLP" }] } }] });
  state.failures.set("/api/products", { status: 200, body: { data: [{ id: 503, code: "ROD", name: "Rodamiento", stock: "14", costPrice: "3000", netSalePrice: "5000", currency: { iso: "CLP" } }], totalPages: 1 } });
}
const lastPut = (state: State) => record(state.calls.filter((call) => call.path === "/api/negotiations/82" && call.method === "PUT").at(-1)?.json);

test("agregar un producto guarda la OT completa con el precio del catálogo y recalcula solo los totales de productos", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const catalog = await jsonRequest(baseUrl, "/api/workshop/options/order-products?companyBranchId=1&search=rod");
  assert.equal(catalog.response.status, 200);
  assert.doesNotMatch(JSON.stringify(catalog.data), /3000|5000|costPrice|netSalePrice/);
  const added = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId: "6a0a3f0e-2b0e-4c6f-8a43-5d6f1e2a9b11", item: { kind: "product", productId: 503, quantity: 3 } });
  assert.equal(added.response.status, 201);
  const body = lastPut(state);
  const data = record(body.negotiationDataSection);
  // Igual que "Guardar" de la web: sin envío a comercial ni transformación; estados intactos.
  assert.equal(data.commercialSend, false);
  assert.equal(data.transformToNegotiationAndSend, false);
  assert.equal(data.commercialMainStatus, 4);
  assert.equal(data.operationalMainStatus, 2);
  for (const key of ["contacts", "creditValidation", "sentToCommercialAt", "contractors", "hasContractor"]) assert.equal(key in data, false, key);
  assert.equal("resultFees" in body, false);
  assert.equal("termsCondition" in body, false);
  assert.deepEqual(body.taxes, []);
  // El trabajo conserva sus costos y no se tocan actividades ni responsables.
  const work = record(record(body.workSection).works && (record(body.workSection).works as unknown[])[0]);
  assert.equal(work.netCostHH, 15000);
  assert.equal(work.netSalePerHH, 30000);
  assert.equal("activities" in work, false);
  assert.equal(work.hasChangesGeneralData, false);
  assert.ok(record(body.workSection).details, "detalle por defecto de trabajos");
  // Producto nuevo con precios de catálogo; el existente intacto.
  const products = record(body.productsSection).products as Array<Record<string, unknown>>;
  assert.equal(products[0]?.netSalePrice, 20000);
  assert.deepEqual({ ...products[1], order: undefined }, { isNew: true, isDeleted: false, itemType: "PRODUCT", productId: 503, code: "ROD", name: "Rodamiento", description: null,
    costPrice: 3000, netSalePrice: 5000, isoCostPrice: "CLP", isoNetSalePrice: "CLP", quantity: 3, margin: 0, discountPercent: 0, discountAmount: 0, order: undefined });
  // 3 × 5.000 = 15.000 más de venta, 9.000 más de costo, IVA 19 %.
  const totals = record(body.totalsSection);
  assert.equal(totals.subTotal, 115000);
  assert.equal(totals.totalNet, 115000);
  assert.equal(totals.totalTax, 19000 + 2850);
  assert.equal(totals.totalGross, 115000 + 21850);
  assert.equal(totals.estimatedMargin, 40000 + 6000);
  assert.equal(totals.totalCostWorkOrder, 60000 + 9000);
  const snapshot = record(body.sectionTotals);
  assert.deepEqual(snapshot.products, { subtotal: 55000, discount: 0, net: 55000, tax: 10450, gross: 65450 });
  assert.deepEqual(snapshot.services, { subtotal: 60000, discount: 0, net: 60000, tax: 11400, gross: 71400 });
  assert.doesNotMatch(JSON.stringify(added.data), /5000|20000|netSale|costPrice/);
});

test("un producto que no se buscó antes no se agrega y la OT aprobada no se modifica", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const unknown = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId: "7b1b4f1f-3c1f-4d7a-9b54-6e7f2f3a0c22", item: { kind: "product", productId: 999, quantity: 1 } });
  assert.equal(unknown.response.status, 409);
  assert.equal(errorCode(unknown.data), "WORKSHOP_PRODUCT_NOT_LISTED");
  state.failures.set("/api/negotiations/82", { status: 200, body: document("APPROVED") });
  const locked = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId: "8c2c5a2a-4d2a-4e8b-8c65-7f8a3a4b1d33", item: { kind: "other", name: "Limpieza", description: null, quantity: 1 } });
  assert.equal(locked.response.status, 409);
  assert.equal(errorCode(locked.data), "WORKSHOP_ORDER_LOCKED");
  assert.equal(state.calls.filter((call) => call.method === "PUT").length, 0);
});

test("otro ítem sin valor no cambia los totales; el transporte toma la tarifa del vehículo", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId: "9d3d6b3b-5e3b-4f9c-9d76-8a9b4b5c2e44", item: { kind: "other", name: "Limpieza", description: "Lavado", quantity: 2 } });
  const other = lastPut(state);
  assert.equal(record(other.totalsSection).totalNet, 100000);
  assert.deepEqual((record(other.othersSection).others as unknown[]).map(record).map((row) => [row.name, row.unitCost, row.quantity, row.isNew]), [["Limpieza", 0, 2, true]]);
  await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId: "ae4e7c4c-6f4c-4a0d-8e87-9b0c5c6d3f55", item: { kind: "transport", transportId: 4, chargeType: "km", quantity: 10, detail: "Faena" } });
  const transport = lastPut(state);
  const row = record((record(transport.transportSection).transports as unknown[])[0]);
  assert.deepEqual([row.commercialTransportId, row.quotedType, row.quotedValue, row.costUnit, row.salePriceUnit, row.detail], [4, "km", 10, 500, 900, "Faena"]);
  assert.equal(record(transport.totalsSection).subTotal, 109000);
  assert.equal(record(transport.totalsSection).totalCostWorkOrder, 65000);
});

test("cambiar cantidad, quitar un producto y quitar un trabajo de la OT", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const updated = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items/products/7", "PATCH", { companyBranchId: 1, quantity: 1 });
  assert.equal(updated.response.status, 200);
  assert.equal(record((record(lastPut(state).productsSection).products as unknown[])[0]).quantity, 1);
  assert.equal(record(lastPut(state).totalsSection).subTotal, 80000);
  const fraction = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items/products/7", "PATCH", { companyBranchId: 1, quantity: 1.5 });
  assert.equal(fraction.response.status, 400);
  await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items/products/7?companyBranchId=1", "DELETE");
  assert.equal(record((record(lastPut(state).productsSection).products as unknown[])[0]).isDeleted, true);
  assert.equal(record(lastPut(state).totalsSection).subTotal, 60000);
  await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items/works/42?companyBranchId=1", "DELETE");
  const work = record((record(lastPut(state).workSection).works as unknown[])[0]);
  assert.equal(work.isRemoved, true);
  assert.equal(work.isDeleted, false);
  // Igual que la web: el trabajo quitado deja de sumar (2 h × 15.000 de costo, sin margen) en venta y en costo de la OT.
  assert.equal(record(lastPut(state).totalsSection).subTotal, 70000);
  assert.equal(record(lastPut(state).totalsSection).totalCostWorkOrder, 30000);
  assert.deepEqual(record(lastPut(state).sectionTotals).services, { subtotal: 0, discount: 0, net: 0, tax: 0, gross: 0 });
});

test("las cotizaciones, las OT internas aprobadas y las secciones bloqueadas no se editan desde la app", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const other = (requestId: string) => jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId, item: { kind: "other", name: "Limpieza", description: null, quantity: 1 } });
  state.failures.set("/api/negotiations", { status: 200, body: { data: [{ id: 82, correlative: 7, businessModality: "FORMAL_QUOTE", createdAsODT: false, title: "Cotización" }] } });
  const quote = await other("b05f8d5d-7a5d-4b1e-9f98-0c1d6d7e4a66");
  assert.equal(quote.response.status, 409);
  assert.equal(errorCode(quote.data), "WORKSHOP_ORDER_LOCKED");
  setBackend(state);
  state.failures.set("/api/negotiations/82", { status: 200, body: { ...document("APPROVED"), negotiationDataSection: { ...document().negotiationDataSection, isWorkOrderInternal: true } } });
  const approved = await other("c16a9e6e-8b6e-4c2f-8a09-1d2e7e8f5b77");
  assert.equal(approved.response.status, 409);
  const blocked = document();
  blocked.othersSection.details = { blockConsumption: true } as never;
  state.failures.set("/api/negotiations/82", { status: 200, body: blocked });
  const section = await other("d27b0f7f-9c7f-4d3a-9b1a-2e3f8f9a6c88");
  assert.equal(section.response.status, 409);
  assert.equal(errorCode(section.data), "WORKSHOP_ORDER_SECTION_BLOCKED");
  assert.equal(state.calls.filter((call) => call.method === "PUT").length, 0);
});

test("al guardar no se reenvía la reserva de mantenimiento (evita moverla de hora)", () => {
  const body = editableDocument({ negotiationDataSection: { id: 1, isWorkOrderInternal: true, internalEquipmentId: 5, maintenanceOccupation: { from: "22-10-2026 03:00:00" } } }, 1);
  assert.equal("maintenanceOccupation" in record(body.negotiationDataSection), false);
  assert.equal(record(body.negotiationDataSection).isWorkOrderInternal, true);
});

test("los totales de una sección siguen las fórmulas de la web (descuentos y moneda)", () => {
  const raw = editableDocument({ negotiationDataSection: { id: 1, currency: { iso: "CLP" }, currenciesConversions: [{ isoFrom: "CLP", isoTo: "USD", conversionFactor: 950 }] },
    totalsSection: { subTotal: 0, totalDiscount: 0, totalTax: 0 },
    productsSection: { products: [{ id: 1, quantity: 2, costPrice: 10, netSalePrice: 20, isoCostPrice: "USD", isoNetSalePrice: "USD", discountPercent: 10 }], details: { discountPercentage: 5 }, taxes: [{ taxId: 1, rate: 19, isDeleted: false }] },
    workSection: {}, transportSection: {}, othersSection: {}, rentalEquipmentSection: {} }, 1);
  const totals = sectionTotals(raw, "products");
  assert.equal(totals.subtotal, 38000);
  assert.equal(totals.itemDiscount, 3800);
  assert.equal(totals.discount, (34200 * 5) / 100);
  assert.equal(totals.net, 34200 - 1710);
  applySectionDelta(raw, "products", { subtotal: 0, itemDiscount: 0, discount: 0, net: 0, tax: 0, gross: 0, estimatedMargin: 0, realMargin: 0, cost: 0 }, totals);
  assert.equal(record(raw.totalsSection).totalNet, 38000 - 3800 - 1710);
});

test("la pasarela respeta los permisos de la app configurados por la sucursal", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/branches/1/mobileAppConfig", { status: 200, body: { mobileAppConfig: { ordersTransports: false } } });
  const config = await jsonRequest(baseUrl, "/api/workshop/app-config?companyBranchId=1");
  assert.equal(config.response.status, 200);
  assert.equal(record(config.data).ordersTransports, false);
  assert.equal(record(config.data).ordersOthers, true);
  const transport = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId: "e38c1a8a-ad8a-4e4b-8c2b-3f4a9a0b7d99", item: { kind: "transport", transportId: 4, chargeType: "km", quantity: 1, detail: null } });
  assert.equal(transport.response.status, 403);
  assert.equal(errorCode(transport.data), "BRANCH_APP_ACTION_DISABLED");
  const other = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/items", "POST", {
    companyBranchId: 1, requestId: "f49d2b9b-be9b-4f5c-9d3c-4a5b0b1c8e00", item: { kind: "other", name: "Limpieza", description: null, quantity: 1 } });
  assert.equal(other.response.status, 201);
});
