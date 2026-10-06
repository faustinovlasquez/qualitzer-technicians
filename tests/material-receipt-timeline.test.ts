import assert from "node:assert/strict";
import { test } from "node:test";
import { materialReceiptsSchema, type MaterialReceipts } from "../src/domain/materialReceipts";
import { pendingMaterialCount, receiptDayLabel, receiptQuantity, receiptRelative, receiptSourceIcon, receiptTimeline } from "../src/receipts/receiptTimeline";
import { createDemoMaterialReceiptPort } from "../src/receipts/demoReceipts";

const now = new Date(2026, 9, 5, 15, 0, 0);
const delivery = (id: number, at: Date, products = 1, receiptStatus: "PENDING" | "INCIDENT" | "CONFIRMED" = "PENDING"): MaterialReceipts["items"][number] => ({
  id, version: 1, code: `CE-${id}`, sourceLabel: `OT-${id}`, destination: "Planta", deliveredAt: at.toISOString(), receiptStatus,
  products: Array.from({ length: products }, (_, index) => ({ id: id * 10 + index, productId: index + 1, name: `P${index}`, code: `C${index}`, quantity: 1, unit: "UN" })),
});

test("badge counts pending and incident product lines, never confirmed ones", () => {
  assert.equal(pendingMaterialCount(null), 0);
  assert.equal(pendingMaterialCount({ hasMore: false, items: [delivery(1, now, 2), delivery(2, now, 3, "INCIDENT"), delivery(3, now, 4, "CONFIRMED")] }), 5);
});

test("timeline groups by day newest first and keeps session confirmations as received", () => {
  const today = delivery(1, new Date(2026, 9, 5, 9, 5));
  const later = delivery(2, new Date(2026, 9, 5, 14, 30), 2, "INCIDENT");
  const yesterday = delivery(3, new Date(2026, 9, 4, 18, 0));
  const confirmed = delivery(4, new Date(2026, 9, 5, 11, 0));
  const days = receiptTimeline([today, later, yesterday], [{ item: { ...confirmed, receiptStatus: "CONFIRMED" }, confirmedAt: now.toISOString() }], now);
  assert.deepEqual(days.map(day => day.label), ["Hoy", "Ayer"]);
  assert.deepEqual(days[0].entries.map(entry => [entry.item.id, entry.state, entry.time]), [[2, "incident", "14:30"], [4, "confirmed", "11:00"], [1, "pending", "09:05"]]);
  assert.equal(days[0].entries[1].confirmedAt?.toISOString(), now.toISOString());
  // Si la misma entrega vuelve como pendiente (otra versión), prevalece el estado del servidor.
  assert.deepEqual(receiptTimeline([confirmed], [{ item: confirmed, confirmedAt: now.toISOString() }], now)[0].entries.map(entry => entry.state), ["pending"]);
});

test("requestedAt orders the entry before deliveredAt and labels are human readable", () => {
  const item = { ...delivery(1, new Date(2026, 9, 1, 8, 0)), requestedAt: new Date(2026, 9, 5, 14, 20).toISOString() };
  assert.equal(receiptTimeline([item], [], now)[0].label, "Hoy");
  assert.equal(receiptRelative(new Date(2026, 9, 5, 14, 20), now), "Hace 40 min");
  assert.equal(receiptRelative(new Date(2026, 9, 5, 12, 0), now), "Hace 3 h");
  assert.equal(receiptRelative(null, now), "Sin fecha de entrega");
  assert.match(receiptDayLabel(new Date(2026, 9, 1, 8, 0), now), /^Jueves/);
  assert.equal(receiptQuantity(2, "UN"), "2 UN");
  assert.equal(receiptSourceIcon("MAINTENANCE"), "build-outline");
  assert.equal(receiptSourceIcon("NEGOTIATION"), "document-text-outline");
});

test("contract accepts the previous backend payload and the new timeline context", () => {
  const base = { id: 1, version: 2, code: "CE-1", sourceLabel: "OT", destination: "", deliveredAt: null, receiptStatus: "PENDING", products: [] };
  assert.equal(materialReceiptsSchema.safeParse({ hasMore: false, items: [base] }).success, true);
  const enriched = { ...base, requestedByName: "Bodega", requestedAt: "2026-10-05T12:00:00.000Z", sourceType: "MAINTENANCE", warehouseName: "Central", reasonLabel: "Consumo", notes: null };
  assert.equal(materialReceiptsSchema.safeParse({ hasMore: false, items: [enriched] }).success, true);
  assert.equal(materialReceiptsSchema.safeParse({ hasMore: false, items: [{ ...base, unexpected: true }] }).success, false);
});

test("demo port confirms in memory with the protocol shape the app verifies", async () => {
  const port = createDemoMaterialReceiptPort(42, now);
  const first = await port.materialReceipts(1);
  assert.equal(materialReceiptsSchema.safeParse(first).success, true);
  const target = first.items[0];
  const result = await port.confirmMaterialReceipts({ companyBranchId: 1, requestId: "00000000-0000-4000-8000-000000000001", client: "MOBILE",
    deliveries: [{ id: target.id, version: target.version }], location: { status: "UNAVAILABLE", reason: "UNSUPPORTED" } });
  assert.deepEqual(result.receipts.map(receipt => [receipt.id, receipt.version, receipt.acknowledgement.userId]), [[target.id, target.version + 1, 42]]);
  assert.equal((await port.materialReceipts(1)).items.some(item => item.id === target.id), false);
});
