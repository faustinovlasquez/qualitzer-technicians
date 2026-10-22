import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateInspection, workshopDeliveryConditions, type WorkshopEntryDetail, type WorkshopOrder, type WorkshopWork } from "../src/domain/workshopEntry";

const slots = [{ key: "front", name: "Frente", isRequired: true }, { key: "side", name: "Costado", isRequired: true }, { key: "top", name: "Techo", isRequired: false }];
const inspection = { id: 1, percentage: 50, photoTypes: ["front"], photosCount: 1, checklistTotal: 4, checklistCompleted: 3, completedAt: null };
const order = (value: Partial<WorkshopOrder>): WorkshopOrder => ({ id: 1, kind: "quote", code: "COT-PRO-0001", workOrderCode: null, title: null, statusLabel: "Pendiente",
  stage: "draft", sentToCommercial: true, quoted: true, finished: false, ...value });
const work = (value: Partial<WorkshopWork>): WorkshopWork => ({ id: 1, code: "TR-00001", title: "Trabajo", priority: null, statusName: null, statusColor: null,
  progress: 0, finished: false, orderId: 1, maintenanceCode: null, loose: false, ...value });
const detail = (value: Partial<WorkshopEntryDetail> = {}): WorkshopEntryDetail => ({
  id: 1, code: "ING-00001", title: null, notes: null, areaId: 1, areaTitle: "Patio", statusKey: "IN_PROGRESS", statusColor: null, subStatusName: null,
  isInternalEntry: false, customerName: "Cliente", equipmentLabel: "Equipo", equipmentCode: null, imageUrl: null, entryAt: null, estimatedDeliveryAt: null,
  reception: { signed: true, receiverName: "Ana", signedAt: null }, delivery: null,
  inspections: { available: true, entryRequirement: "none", exitRequirement: "none", entry: null, exit: null, photoSlots: slots },
  works: { available: true, items: [work({})] }, orders: { available: true, items: [order({})] }, ...value
});
const met = (entry: WorkshopEntryDetail) => workshopDeliveryConditions(entry).map((condition) => [condition.id, condition.met]);

test("la inspección cumple según lo exigido por la sucursal, igual que la web", () => {
  assert.deepEqual(evaluateInspection("none", null, slots), { met: true, missing: [] });
  assert.deepEqual(evaluateInspection("photos", null, slots), { met: false, missing: ["La inspección no se ha realizado"] });
  assert.deepEqual(evaluateInspection("photos", inspection, slots), { met: false, missing: ["Faltan fotos: Costado"] });
  assert.deepEqual(evaluateInspection("checklist", inspection, slots), { met: false, missing: ["Lista de revisión: 3 de 4"] });
  assert.deepEqual(evaluateInspection("full", { ...inspection, photoTypes: ["front", "side"], checklistCompleted: 4 }, slots), { met: true, missing: [] });
  // Sin fotos obligatorias para el tipo de equipo basta con una foto.
  assert.equal(evaluateInspection("photos", { ...inspection, photosCount: 0, photoTypes: [] }, []).met, false);
  assert.equal(evaluateInspection("photos", inspection, []).met, true);
});

test("un ingreso firmado, cotizado y sin trabajos sueltos se puede entregar", () => {
  assert.deepEqual(met(detail()), [["intake", true], ["orders", true], ["works", true]]);
});

test("faltan firma, cotización o trabajos: cada condición explica qué falta", () => {
  const conditions = workshopDeliveryConditions(detail({
    reception: { signed: false, receiverName: null, signedAt: null },
    orders: { available: true, items: [order({ code: "COT-SER-0009", quoted: false }), order({ id: 2, kind: "workOrder", sentToCommercial: false })] },
    works: { available: true, items: [work({ code: "TR-00007", loose: true })] }
  }));
  assert.deepEqual(conditions.map((condition) => [condition.id, condition.met, condition.detail]), [
    ["intake", false, "Falta la firma de recepción del ingreso."],
    ["orders", false, "COT-SER-0009 sin cotizar todavía."],
    ["works", false, "TR-00007 sin OT."]
  ]);
  // Una OT sin enviar a comercial no cuenta como cotización.
  assert.equal(workshopDeliveryConditions(detail({ orders: { available: true, items: [order({ kind: "workOrder", sentToCommercial: false })] } }))[1]?.detail, "El ingreso aún no tiene cotizaciones.");
});

test("con inspecciones exigidas se revisa la de ingreso y aparece la de entrega", () => {
  const conditions = workshopDeliveryConditions(detail({ inspections: { available: true, entryRequirement: "photos", exitRequirement: "checklist", entry: inspection, exit: null, photoSlots: slots } }));
  assert.deepEqual(conditions.map((condition) => [condition.id, condition.met, condition.detail]), [
    ["intake", false, "Inspección de ingreso (fotos): Faltan fotos: Costado"],
    ["orders", true, "1 cotización(es) con montos."],
    ["works", true, "Todos los trabajos están en una OT."],
    ["exit", false, "La inspección no se ha realizado"]
  ]);
});

test("en un equipo propio se piden mantenimientos y lo no verificable no se da por cumplido", () => {
  const internal = detail({ isInternalEntry: true, orders: { available: true, items: [] }, works: { available: false, items: [] } });
  assert.deepEqual(workshopDeliveryConditions(internal).map((condition) => [condition.id, condition.met, condition.title]), [
    ["intake", true, "Ingreso completo"], ["orders", false, "Mantenimientos creados"], ["works", false, "Sin trabajos sueltos"]
  ]);
});
