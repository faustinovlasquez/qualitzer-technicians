import assert from "node:assert/strict";
import { test } from "node:test";
import { materialDispositionInputSchema, materialReceiptSchema, materialReceiptsSchema, verifyMaterialDispositionResult, type MaterialReceipt } from "../src/domain/materialReceipts";
import { dispositionDaysLeft, filterReceipts, productDispositionState, receiptDateTime, receiptMoney, receiptWarehouses } from "../src/receipts/receiptTimeline";
import { createDemoMaterialReceiptPort } from "../src/receipts/demoReceipts";

const confirmed: MaterialReceipt = materialReceiptSchema.parse({ id: 7, version: 3, code: "CE-00000007", sourceLabel: "OT-00456 · Cambio filtro", destination: "Santiago", deliveredAt: "2026-10-01T10:00:00.000Z",
  receiptStatus: "CONFIRMED", warehouseName: "Almacén Principal", sourceType: "WORK_ORDER", sourceCode: "OT-00456", equipmentLabel: "Grúa horquilla · Patente AB-12", customerName: "Cliente SA",
  dispositionDeadline: "2026-10-08T10:00:00.000Z", dispositionClosed: false, products: [
    { id: 1, productId: 11, name: "Tuerca titanio", code: "4123", quantity: 1, unit: "UN", unitCost: 1250, currencyIso: "CLP", imageUrl: "https://bucket.s3/products/1.png", description: "Tuerca M10", disposition: null },
    { id: 2, productId: 12, name: "Filtro aire", code: "FA-002", quantity: 3, unit: "UN", disposition: "USED", dispositionAt: "2026-10-02T10:00:00.000Z" },
  ] });

test("el esquema acepta la ficha nueva y sigue aceptando respuestas de servidores anteriores", () => {
  assert.equal(materialReceiptsSchema.parse({ hasMore: false, items: [confirmed] }).items[0].sourceCode, "OT-00456");
  const legacy = { id: 5, version: 2, code: "CE-5", sourceLabel: "Mantenimiento", destination: "Taller", deliveredAt: null, receiptStatus: "PENDING", products: [{ id: 10, productId: 88, name: "Perno", code: "P", quantity: 1, unit: "UN" }] };
  assert.equal(materialReceiptsSchema.safeParse({ hasMore: false, items: [legacy] }).success, true);
  assert.equal(materialReceiptSchema.safeParse({ ...confirmed, products: [{ ...confirmed.products[0], disposition: "LOST" }] }).success, false);
});

test("las disposiciones exigen líneas únicas y la respuesta debe reflejar lo pedido", () => {
  const input = materialDispositionInputSchema.parse({ companyBranchId: 1, id: 7, version: 3, lines: [{ lineId: 1, disposition: "RETURN_REQUESTED" }] });
  assert.equal(materialDispositionInputSchema.safeParse({ ...input, lines: [...input.lines, ...input.lines] }).success, false);
  assert.equal(materialDispositionInputSchema.safeParse({ ...input, lines: [] }).success, false);
  const accepted = { ...confirmed, version: 4, products: confirmed.products.map(product => product.id === 1 ? { ...product, disposition: "RETURN_REQUESTED" as const } : product) };
  verifyMaterialDispositionResult(input, accepted);
  assert.throws(() => verifyMaterialDispositionResult(input, confirmed));
  assert.throws(() => verifyMaterialDispositionResult(input, { ...accepted, id: 8 }));
  assert.throws(() => verifyMaterialDispositionResult(input, { ...accepted, version: 2 }));
});

test("estado visible por material, plazo restante y formato", () => {
  assert.equal(productDispositionState(confirmed.products[0], false), "OPEN");
  assert.equal(productDispositionState(confirmed.products[0], true), "AUTO_USED");
  assert.equal(productDispositionState(confirmed.products[1], true), "USED");
  assert.equal(productDispositionState({ ...confirmed.products[1], returnedQuantity: 3 }, false), "RETURNED");
  assert.equal(dispositionDaysLeft("2026-10-08T10:00:00.000Z", new Date("2026-10-03T12:00:00.000Z")), 5);
  assert.equal(dispositionDaysLeft("2026-10-08T10:00:00.000Z", new Date("2026-10-09T12:00:00.000Z")), 0);
  assert.equal(dispositionDaysLeft(null), null);
  assert.match(receiptMoney(1250, "CLP")!, /1\.250/);
  assert.equal(receiptMoney(null, "CLP"), null);
  assert.match(receiptDateTime("2026-10-01T10:00:00.000Z"), /2026 · \d{2}:\d{2}$/);
  assert.equal(receiptDateTime(null), "Sin fecha");
});

test("búsqueda sin tildes por OT, equipo o material y filtros de bodega y origen", () => {
  const other: MaterialReceipt = { ...confirmed, id: 8, code: "CE-8", sourceLabel: "Mantenimiento 3", sourceCode: "MANT-0003", sourceType: "MAINTENANCE", equipmentLabel: "Compresor", warehouseName: "Bodega faena", products: [] };
  const items = [confirmed, other];
  assert.deepEqual(filterReceipts(items, { query: "ot-00456" }).map(item => item.id), [7]);
  assert.deepEqual(filterReceipts(items, { query: "grua patente" }).map(item => item.id), [7]);
  assert.deepEqual(filterReceipts(items, { query: "filtro" }).map(item => item.id), [7]);
  assert.deepEqual(filterReceipts(items, { warehouse: "Bodega faena" }).map(item => item.id), [8]);
  assert.deepEqual(filterReceipts(items, { source: "MAINTENANCE" }).map(item => item.id), [8]);
  assert.deepEqual(filterReceipts(items, { source: "WORK_ORDER", query: "compresor" }), []);
  assert.deepEqual(receiptWarehouses(items), ["Almacén Principal", "Bodega faena"]);
});

test("demo: confirmar mueve la entrega al historial con plazo y permite marcar Utilizado/Devolver", async () => {
  const port = createDemoMaterialReceiptPort(9, new Date());
  const pending = await port.materialReceipts(1);
  const target = pending.items[0];
  await port.confirmMaterialReceipts({ companyBranchId: 1, requestId: "f14191fb-e73a-4d92-91b9-bf3fa38a2df1", client: "MOBILE", deliveries: [{ id: target.id, version: target.version }], location: { status: "UNAVAILABLE", reason: "UNSUPPORTED" } });
  const history = await port.materialReceipts(1, "CONFIRMED");
  const moved = history.items.find(item => item.id === target.id)!;
  assert.equal(moved.receiptStatus, "CONFIRMED");
  assert.equal(moved.dispositionClosed, false);
  assert.equal(dispositionDaysLeft(moved.dispositionDeadline), 7);
  const input = { companyBranchId: 1, id: moved.id, version: moved.version, lines: [{ lineId: moved.products[0].id, disposition: "RETURN_REQUESTED" as const }] };
  const updated = await port.materialDispositions(input);
  verifyMaterialDispositionResult(input, updated);
  assert.ok(materialReceiptsSchema.safeParse(history).success);
  const closed = history.items.find(item => item.dispositionClosed)!;
  await assert.rejects(port.materialDispositions({ companyBranchId: 1, id: closed.id, version: closed.version, lines: [{ lineId: closed.products[0].id, disposition: "USED" }] }));
});
