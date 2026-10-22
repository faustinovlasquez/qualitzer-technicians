import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { errorCode, gatewayToken, harness, jsonRequest } from "./mock-upstream";
import { WorkshopRequestLedger } from "../workshop/support";
import { GatewayError } from "../errors";

const dashboard = "/api/operation_area/dashboard";
const area = { id: 3, title: "Patio", maxSlots: 4, occupiedSlots: 1, hasUnlimitedSlots: false, entries: [
  { id: 12, title: "Bomba", status: { key: "IN_PROGRESS", color: "#7c3aed" }, subStatus: null, equipment: { manufacturer: { name: "CLARKE" }, type: { name: "BOMBA" }, model: { name: "DQ6" }, identification: "416545" },
    customerName: "Cliente", isInternalEntry: false, daysElapsed: 4, estimatedDepartureDateTime: "2026-11-29T12:00:00.000Z", isReceptionPending: false, negotiationsCount: 2, image: null, secret: "no se reenvía" }
] };

test("el tablero del taller normaliza naves e ingresos y no reenvía campos desconocidos", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set(dashboard, { status: 200, body: [area] });
  const board = await jsonRequest(baseUrl, "/api/workshop/board?companyBranchId=1&workshopId=7");
  assert.equal(board.response.status, 200);
  assert.deepEqual(board.data, { workshopId: 7, areas: [{ id: 3, title: "Patio", maxSlots: 4, occupiedSlots: 1, hasUnlimitedSlots: false, entries: [{
    id: 12, code: "ING-00012", title: "Bomba", statusKey: "IN_PROGRESS", statusColor: "#7c3aed", subStatusName: null, equipmentLabel: "CLARKE · BOMBA · DQ6",
    equipmentCode: "416545", customerName: "Cliente", isInternalEntry: false, daysInArea: 4, estimatedDeliveryAt: "2026-11-29T12:00:00.000Z",
    isReceptionPending: false, negotiationsCount: 2, imageUrl: null }] }] });
  const call = state.calls.find(item => item.path === dashboard);
  assert.equal(call?.query.get("workshopId"), "7");
  assert.equal(call?.query.get("companyBranchId"), "1");
});

test("el taller exige sesión y una sucursal propia antes de consultar el backend", async context => {
  const { state, baseUrl } = await harness(context);
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/board?companyBranchId=1&workshopId=7", "GET", undefined, null)).response.status, 401);
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/board?companyBranchId=2&workshopId=7")).response.status, 403);
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/board?companyBranchId=1&workshopId=7&extra=1")).response.status, 400);
  assert.equal(state.calls.filter(call => call.path === dashboard).length, 0);
});

test("los errores del backend del taller llegan con su código y un mensaje en español", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set(dashboard, { status: 409, body: { error: "OPERATION_AREA_FULL" } });
  const full = await jsonRequest(baseUrl, "/api/workshop/board?companyBranchId=1&workshopId=7");
  assert.equal(full.response.status, 409);
  assert.deepEqual(full.data, { error: "OPERATION_AREA_FULL", message: "La nave está llena. Elige otra nave o libera un espacio." });
  state.failures.set(dashboard, { status: 400, body: { error: "SELECT * FROM secretos" } });
  const unknown = await jsonRequest(baseUrl, "/api/workshop/board?companyBranchId=1&workshopId=7");
  assert.equal(unknown.response.status, 400);
  assert.equal(errorCode(unknown.data), "UPSTREAM_REJECTED");
});

test("los errores de la app llegan al backend (la ruta de diagnóstico está habilitada)", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/mobile-diagnostics/errors", { status: 200, body: { accepted: 1 } });
  const report = { errors: [{ message: "Falla", stack: null, source: "global", fatal: false, screen: "workshop", appVersion: "1.0.128", platform: "android", occurredAt: "2026-10-22T12:00:00.000Z" }] };
  const sent = await jsonRequest(baseUrl, "/api/diagnostics/errors", "POST", report);
  assert.equal(sent.response.status, 202);
  assert.deepEqual(sent.data, { accepted: 1 });
  assert.equal(state.calls.filter(call => call.path === "/api/mobile-diagnostics/errors").length, 1);
});

const asRecordForTest = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" ? value as Record<string, unknown> : {});
const entryPath = "/api/operation_area_entries/12";
const rawEntry = {
  id: 12, title: "Bomba", notes: "Golpe en carcasa", operationAreaId: 3, operationArea: { id: 3, title: "Patio" }, isInternalEntry: false, customerId: 40, customerName: "Cliente",
  status: { id: "2", key: "IN_PROGRESS", color: "#7c3aed" }, subStatus: { id: 9, name: "Esperando repuesto", color: "#000" },
  entryDateTime: "2026-10-18T12:00:00.000Z", estimatedDepartureDateTime: "2026-11-29T12:00:00.000Z", image: "https://s3.example.test/entry.jpg",
  customerEquipment: { manufacturer: { name: "CLARKE" }, type: { id: 7, name: "BOMBA" }, model: { name: "DQ6" }, identification: "416545" },
  responsibleSignature: { id: "5", workerId: "5", name: "Juan Pérez", signatureImage: "data:image/png;base64,SECRETO", date: "2026-10-18T12:30:00.000Z" },
  negotiations: [{ id: 81 }, { id: 82 }], deliveredAt: null
};
/** Naves de la sucursal 1: taller 7 con Patio (3) y Motores (5). */
const setBranchBays = (state: Awaited<ReturnType<typeof harness>>["state"]) => {
  state.failures.set("/api/workshops/select", { status: 200, body: [{ value: 7, label: "Taller central" }] });
  state.failures.set(dashboard, { status: 200, body: [area, { id: 5, title: "Motores", entries: [] }] });
};
const setEntryBackend = (state: Awaited<ReturnType<typeof harness>>["state"]) => {
  setBranchBays(state);
  state.failures.set(entryPath, { status: 200, body: rawEntry });
  state.failures.set("/api/equipment_dispatches/inspections/by-entry/12/compliance", { status: 200, body: {
    operationAreaEntryId: 12, exitInspection: null,
    entryInspection: { id: 300, type: "DISPATCH", compliancePercentage: 80, completedAt: null, photos: { total: 1, items: [{ id: 1, photoType: "front", label: "Frente" }] }, checklist: { total: 4, completed: 4, percentage: 100 } } } });
  state.failures.set("/api/branches/1/inspectionRequirementsConfig", { status: 200, body: { inspectionRequirementsConfig: { entry: "full", exit: "none" } } });
  state.failures.set("/api/equipment_masters/required_photos", { status: 200, body: [
    { id: "1", key: "front", name: "Frente", relationKind: "GENERAL", equipmentTypeId: null, isRequired: true, order: 1, isEnabled: true },
    { id: "2", key: "side", name: "Costado", relationKind: "EQUIPMENT_TYPE", equipmentTypeId: 7, isRequired: true, order: 2, isEnabled: true },
    { id: "3", key: "roof", name: "Techo", relationKind: "EQUIPMENT_TYPE", equipmentTypeId: 99, isRequired: true, order: 3, isEnabled: true }
  ] });
  state.failures.set("/api/works", { status: 200, body: { data: [
    { id: "41", title: "Cambiar sello", priority: "high", mainStatus: "IN_PROGRESS", mainStatusColor: "#00f", operationalProgress: 40, negotiation: { id: 81 } },
    { id: "42", title: "Revisar motor", priority: "medium", mainStatus: "DONE", operationalProgress: 100 }
  ], totalRows: 2 } });
  state.failures.set("/api/negotiations", { status: 200, body: { data: [
    { id: 81, correlative: 4265, businessModality: "FORMAL_QUOTE", businessTypeName: "project", title: "Reparación", commercialStatus: "APPROVED", createdAsODT: false, totalsSection: { totalNet: 0 } },
    { id: 82, correlative: null, workOrderNumber: 12, createdAsODT: true, sentToCommercialAt: null, title: "OT de taller", totalsSection: { totalNet: 0 } }
  ], totalRows: 2 } });
};

test("la ficha del ingreso reúne datos, inspección, trabajos y órdenes sin enviar firmas ni montos", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  const detail = await jsonRequest(baseUrl, "/api/workshop/entries/12?companyBranchId=1");
  assert.equal(detail.response.status, 200);
  assert.deepEqual(detail.data, {
    id: 12, code: "ING-00012", title: "Bomba", notes: "Golpe en carcasa", areaId: 3, areaTitle: "Patio", statusKey: "IN_PROGRESS", statusColor: "#7c3aed",
    subStatusName: "Esperando repuesto", isInternalEntry: false, customerName: "Cliente", equipmentLabel: "CLARKE · BOMBA · DQ6", equipmentCode: "416545",
    imageUrl: "https://s3.example.test/entry.jpg", entryAt: "2026-10-18T12:00:00.000Z", estimatedDeliveryAt: "2026-11-29T12:00:00.000Z",
    reception: { signed: true, receiverName: "Juan Pérez", signedAt: "2026-10-18T12:30:00.000Z" }, delivery: null,
    inspections: { available: true, entryRequirement: "full", exitRequirement: "none",
      entry: { id: 300, percentage: 80, photoTypes: ["front"], photosCount: 1, checklistTotal: 4, checklistCompleted: 4, completedAt: null }, exit: null,
      photoSlots: [{ key: "front", name: "Frente", isRequired: true }, { key: "side", name: "Costado", isRequired: true }] },
    works: { available: true, items: [
      { id: 41, code: "TR-00041", title: "Cambiar sello", priority: "high", statusName: "En proceso", statusColor: "#00f", progress: 40, finished: false, orderId: 81, maintenanceCode: null, loose: false },
      { id: 42, code: "TR-00042", title: "Revisar motor", priority: "medium", statusName: "Terminado", statusColor: null, progress: 100, finished: true, orderId: null, maintenanceCode: null, loose: true }
    ] },
    orders: { available: true, items: [
      { id: 81, kind: "quote", code: "COT-PRO-4265", workOrderCode: null, title: "Reparación", statusLabel: "Aprobada", stage: "approved", sentToCommercial: true, quoted: true, finished: false },
      { id: 82, kind: "workOrder", code: "OT-00012", workOrderCode: "OT-00012", title: "OT de taller", statusLabel: "Sin enviar a comercial", stage: "draft", sentToCommercial: false, quoted: false, finished: false }
    ] }
  });
  assert.doesNotMatch(JSON.stringify(detail.data), /SECRETO|totalNet/);
  const works = state.calls.find(call => call.path === "/api/works");
  assert.deepEqual(JSON.parse(works?.query.get("filters") ?? "{}"), { companyBranchId: 1, operationAreaEntryWorks: { entryId: 12, negotiationIds: [81, 82] } });
  const negotiations = state.calls.find(call => call.path === "/api/negotiations");
  assert.equal(JSON.parse(negotiations?.query.get("filters") ?? "{}").operationAreaEntryId, 12);
});

test("si una parte de la ficha falla se marca no disponible; si el ingreso no existe responde 404", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  state.failures.set("/api/works", { status: 401, body: { error: "PERMISSION_REQUIRED" } });
  state.failures.set("/api/branches/1/inspectionRequirementsConfig", { status: 500, body: { error: "BOOM" } });
  const partial = await jsonRequest(baseUrl, "/api/workshop/entries/12?companyBranchId=1");
  assert.equal(partial.response.status, 200);
  const data = partial.data as { works: { available: boolean; items: unknown[] }; inspections: { available: boolean }; orders: { available: boolean } };
  assert.deepEqual(data.works, { available: false, items: [] });
  assert.equal(data.inspections.available, false);
  assert.equal(data.orders.available, true);
  state.failures.set(entryPath, { status: 404, body: { error: "NOT_FOUND" } });
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/12?companyBranchId=1")).response.status, 404);
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/12?companyBranchId=2")).response.status, 403);
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/abc?companyBranchId=1")).response.status, 400);
});

test("en un equipo propio la ficha lista los mantenimientos del ingreso", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  state.failures.set(entryPath, { status: 200, body: { ...rawEntry, isInternalEntry: true, customerId: null, customerName: null, customerEquipment: null,
    rentalEquipment: { manufacturer: { name: "MAXUS" }, type: { name: "CAMIONETA" }, model: { name: "T 60" }, internalNumber: "MTTO 3" } } });
  state.failures.set("/api/maintenances", { status: 200, body: { data: [{ id: 7, type: "correctivo", status: "en_progreso", title: null, motive: "Ruido en motor" }], pagination: { total: 1 } } });
  state.failures.set("/api/works", { status: 200, body: { data: [{ id: "50", title: "Diagnóstico", isFromMaintenance: true, maintenanceCode: "OT-COR-0007" }] } });
  const detail = await jsonRequest(baseUrl, "/api/workshop/entries/12?companyBranchId=1");
  assert.equal(detail.response.status, 200);
  const data = detail.data as { equipmentLabel: string; orders: { items: unknown[] }; works: { items: Array<{ loose: boolean }> } };
  assert.equal(data.equipmentLabel, "MAXUS · CAMIONETA · T 60");
  assert.deepEqual(data.orders.items, [{ id: 7, kind: "maintenance", code: "OT-COR-0007", workOrderCode: "OT-COR-0007", title: "Ruido en motor", statusLabel: "En progreso",
    stage: "approved", sentToCommercial: true, quoted: true, finished: false }]);
  assert.equal(data.works.items[0]?.loose, false);
  assert.equal(state.calls.find(call => call.path === "/api/maintenances")?.query.get("operationAreaEntryId"), "12");
  assert.equal(state.calls.filter(call => call.path === "/api/negotiations").length, 0);
});

const intake = {
  companyBranchId: 1, requestId: "8f14191f-e73a-4d92-91b9-bf3fa38a2df1", operationAreaId: 3, title: "Bomba con fuga", notes: null, isInternalEntry: false,
  customerId: 40, customerEquipmentId: 56, rentalEquipmentId: null, branchIds: [7], contactIds: [9, 10], entryAt: "2026-10-22T12:00:00.000Z", estimatedDeliveryAt: null
};

test("crear un ingreso envía los campos del formulario web una sola vez aunque se reintente", async context => {
  const { state, baseUrl } = await harness(context);
  setBranchBays(state);
  state.failures.set("/api/operation_area_entries", { status: 201, body: { id: 77, title: "Bomba con fuga" } });
  // Una nave de otra sucursal no se acepta.
  const foreign = await jsonRequest(baseUrl, "/api/workshop/entries", "POST", { ...intake, requestId: "6f14191f-e73a-4d92-91b9-bf3fa38a2df1", operationAreaId: 99 });
  assert.equal(errorCode(foreign.data), "WORKSHOP_AREA_INVALID");
  const [first, second] = await Promise.all([jsonRequest(baseUrl, "/api/workshop/entries", "POST", intake), jsonRequest(baseUrl, "/api/workshop/entries", "POST", intake)]);
  assert.equal(first.response.status, 201);
  assert.deepEqual(first.data, { id: 77 });
  assert.deepEqual(second.data, { id: 77 });
  const writes = state.calls.filter(call => call.path === "/api/operation_area_entries");
  assert.equal(writes.length, 1);
  assert.deepEqual({ ...asRecordForTest(writes[0]?.json) }, {
    companyBranchId: "1", operationAreaId: "3", title: "Bomba con fuga", notes: "", isInternalEntry: "false", customerId: "40", customerEquipmentId: "56",
    contacts: JSON.stringify([{ id: 9, isNew: false }, { id: 10, isNew: false }]), branchesCustomer: JSON.stringify([{ id: 7, value: "7" }]), entryDateTime: "2026-10-22T12:00:00.000Z"
  });
  const conflict = await jsonRequest(baseUrl, "/api/workshop/entries", "POST", { ...intake, title: "Otro" });
  assert.equal(conflict.response.status, 409);
  assert.equal(errorCode(conflict.data), "WORKSHOP_REQUEST_CONFLICT");
});

test("el ingreso exige nave, título y cliente (salvo equipo propio) antes de llamar al backend", async context => {
  const { state, baseUrl } = await harness(context);
  for (const body of [{ ...intake, title: " " }, { ...intake, customerId: null }, { ...intake, isInternalEntry: true, customerId: null }, { ...intake, extra: 1 },
    { ...intake, estimatedDeliveryAt: "2026-10-01T00:00:00.000Z" }]) {
    assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries", "POST", body)).response.status, 400);
  }
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries", "POST", { ...intake, companyBranchId: 2 })).response.status, 403);
  setBranchBays(state);
  state.failures.set("/api/operation_area_entries", { status: 409, body: { error: "OPERATION_AREA_FULL" } });
  const full = await jsonRequest(baseUrl, "/api/workshop/entries", "POST", { ...intake, requestId: "9f14191f-e73a-4d92-91b9-bf3fa38a2df1" });
  assert.equal(full.response.status, 409);
  assert.equal(errorCode(full.data), "OPERATION_AREA_FULL");
  assert.equal(state.calls.filter(call => call.path === "/api/operation_area_entries").length, 1);
});

test("editar el paso 1 a equipo propio borra cliente y equipo del cliente, y no toca fechas ni firmas", async context => {
  const { state, baseUrl } = await harness(context);
  setBranchBays(state);
  state.failures.set("/api/operation_area_entries/77", { status: 200, body: { id: 77, operationAreaId: 3 } });
  const internal = { ...intake, isInternalEntry: true, customerId: null, customerEquipmentId: null, rentalEquipmentId: 5, branchIds: [], contactIds: [] };
  const saved = await jsonRequest(baseUrl, "/api/workshop/entries/77", "PUT", internal);
  assert.equal(saved.response.status, 200);
  const write = state.calls.find(call => call.path === "/api/operation_area_entries/77" && call.method === "PUT");
  assert.deepEqual({ ...asRecordForTest(write?.json) }, { companyBranchId: "1", operationAreaId: "3", title: "Bomba con fuga", notes: "", isInternalEntry: "true", customerId: "", customerEquipmentId: "",
    rentalEquipmentId: "5", contacts: "[]", branchesCustomer: "[]" });
});

test("la foto del equipo conserva contactos y sucursales y solo acepta JPEG", async context => {
  const { state, baseUrl } = await harness(context);
  setBranchBays(state);
  state.failures.set("/api/operation_area_entries/77", { status: 200, body: { id: 77, operationAreaId: 3, contacts: [{ id: 9, fullName: "Ana" }], branchesCustomer: [{ value: "7", label: "Casa matriz" }] } });
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;
  const sent = await jsonRequest(baseUrl, "/api/workshop/entries/77/image", "POST", { companyBranchId: 1, image: jpeg });
  assert.equal(sent.response.status, 200);
  const write = state.calls.find(call => call.method === "PUT");
  assert.deepEqual({ ...asRecordForTest(write?.json) }, { companyBranchId: "1", contacts: JSON.stringify([{ id: 9, isNew: false }]), branchesCustomer: JSON.stringify([{ id: 7, value: "7" }]) });
  assert.deepEqual(write?.files.map(file => [file.field, file.mime]), [["image", "image/jpeg"]]);
  const png = `data:image/jpeg;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`;
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/77/image", "POST", { companyBranchId: 1, image: png })).response.status, 400);
});

test("las opciones del ingreso: clientes con RUT, contactos, equipos del cliente agrupados y naves con espacio", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/customers/select", { status: 200, body: [{ value: 40, label: "Zeta SpA (76.123.456-7)" }, { value: 41, label: "Alfa Ltda (Sin RUT)" }] });
  state.failures.set("/api/customers/40", { status: 200, body: { id: 40, name: "Zeta SpA", contacts: [{ id: 9, fullName: "Ana", email: "ana@zeta.cl", phone: null, position: "Jefa" }] } });
  state.failures.set("/api/customer_branches/select/40", { status: 200, body: [{ value: "7", label: "Casa matriz" }] });
  state.failures.set("/api/customers_equipments/customers/40", { status: 200, body: { BOMBA: [{ id: 56, identification: "416545", manufacturer: { name: "CLARKE" }, type: { name: "BOMBA" }, model: { name: "DQ6" }, year: 2020 }] } });
  state.failures.set("/api/operation_area/select", { status: 200, body: [{ value: 3, label: "Patio" }] });
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/options/customers?companyBranchId=1")).data, { items: [
    { id: 41, name: "Alfa Ltda", document: null }, { id: 40, name: "Zeta SpA", document: "76.123.456-7" }] });
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/options/customers/40?companyBranchId=1")).data, { id: 40, name: "Zeta SpA",
    contacts: [{ id: 9, fullName: "Ana", email: "ana@zeta.cl", phone: null, position: "Jefa" }], branches: [{ id: 7, name: "Casa matriz" }] });
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/options/equipment?companyBranchId=1&source=customer&customerId=40")).data, { hasMore: false, items: [
    { id: 56, source: "customer", label: "CLARKE · BOMBA · DQ6", code: "416545", typeName: "BOMBA", detail: "2020", imageUrl: null }] });
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/options/equipment?companyBranchId=1&source=customer")).response.status, 400);
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/options/areas?companyBranchId=1&workshopId=2")).data, { items: [{ id: 3, title: "Patio" }] });
  assert.equal(state.calls.find(call => call.path === "/api/operation_area/select")?.query.get("workshopId"), "2");
});

const insp = "/api/equipment_dispatches/inspections/300";
const setInspectionBackend = (state: Awaited<ReturnType<typeof harness>>["state"], detail: Record<string, unknown> = {}) => {
  setBranchBays(state);
  state.failures.set(entryPath, { status: 200, body: rawEntry });
  state.failures.set("/api/equipment_dispatches/inspections/by-entry/12/compliance", { status: 200, body: { operationAreaEntryId: 12, entryInspection: null, exitInspection: null } });
  state.failures.set("/api/equipment_dispatches/inspections/ensure", { status: 201, body: { inspectionId: 300, created: true } });
  state.failures.set(`${insp}/meta`, { status: 200, body: { inspectionId: 300 } });
  state.failures.set(insp, { status: 200, body: { id: 300, type: "DISPATCH", operationAreaEntryId: 12, completedAt: null, observation: null,
    photos: [{ id: 1, fileId: 70, photoType: "front", file: { id: 70, url: "https://s3.test/f.jpg", thumbnailUrl: "https://s3.test/f-t.jpg" } }],
    checklistSteps: [{ id: 501, checklistId: 8, checklistStepId: 81, responseValue: "true", comment: null, isCompleted: true, photos: [] }],
    damages: [{ id: 9, description: "Rayón", severity: "LOW", responsibility: "WEAR", location: "front", isAdditional: false, photos: [] }], ...detail } });
  state.failures.set(`${insp}/checklists`, { status: 200, body: [{ id: 1, checklistId: 8, isRequired: true, origin: "DISPATCH_DEFAULT", checklist: { id: 8, name: "Recepción", steps: [
    { id: 81, order: 1, title: "¿Llega con aceite?", type: "validation", value: null, isRequired: true, isFilesRequired: false },
    { id: 82, order: 2, title: "Estado", type: "select", value: JSON.stringify([{ value: "bueno", label: "Bueno" }, { value: "malo", label: "Malo" }]), isRequired: true, isFilesRequired: true }
  ] } }] });
  state.failures.set(`${insp}/patio-context`, { status: 200, body: { equipmentTypeId: 7, equipmentTypeName: "BOMBA", requiredPhotos: [
    { id: "1", key: "front", name: "Frente", relationKind: "GENERAL", isRequired: true, order: 1, isEnabled: true },
    { id: "2", key: "roof", name: "Techo", relationKind: "EQUIPMENT_TYPE", equipmentTypeId: 99, isRequired: true, order: 2, isEnabled: true }] } });
  state.failures.set("/api/branches/1/inspectionRequirementsConfig", { status: 200, body: { inspectionRequirementsConfig: { entry: "full", exit: "none" } } });
};

test("abrir la inspección de ingreso la crea o reutiliza para el ingreso y arma fotos, listas y daños", async context => {
  const { state, baseUrl } = await harness(context);
  setInspectionBackend(state);
  const opened = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections", "POST", { companyBranchId: 1, kind: "entry" });
  assert.equal(opened.response.status, 200);
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path.endsWith("/ensure"))?.json), { type: "DISPATCH", operationAreaEntryId: 12, rentalEquipmentId: null, customerEquipmentId: null });
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path === `${insp}/meta`)?.json), { technicianName: "Técnico Prueba" });
  assert.deepEqual(opened.data, { inspectionId: 300, entryId: 12, kind: "entry", requirement: "full", completedAt: null, observation: null,
    slots: [{ key: "front", name: "Frente", isRequired: true, photo: { fileId: 70, url: "https://s3.test/f-t.jpg", fullUrl: "https://s3.test/f.jpg" }, custom: false, reference: null }],
    checklists: [{ checklistId: 8, name: "Recepción", isRequired: true, locked: true, steps: [
      { checklistStepId: 81, order: 1, title: "¿Llega con aceite?", description: null, type: "validation", options: [], isRequired: true, isFilesRequired: false,
        answer: { stepId: 501, responseValue: "true", comment: null, isCompleted: true, files: [] } },
      { checklistStepId: 82, order: 2, title: "Estado", description: null, type: "select", options: [{ value: "bueno", label: "Bueno" }, { value: "malo", label: "Malo" }],
        isRequired: true, isFilesRequired: true, answer: null }] }],
    damages: [{ id: 9, description: "Rayón", severity: "LOW", responsibility: "WEAR", location: "front", isAdditional: false, photos: [] }] });
});

test("volver a abrir una inspección ya terminada abre esa misma y no crea una nueva en blanco", async context => {
  const { state, baseUrl } = await harness(context);
  setInspectionBackend(state, { completedAt: "2026-10-20T12:00:00.000Z" });
  state.failures.set("/api/equipment_dispatches/inspections/by-entry/12/compliance", { status: 200, body: { operationAreaEntryId: 12, entryInspection: { id: 300, type: "DISPATCH" }, exitInspection: null } });
  const opened = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections", "POST", { companyBranchId: 1, kind: "entry" });
  assert.equal(asRecordForTest(opened.data).inspectionId, 300);
  assert.equal(asRecordForTest(opened.data).completedAt, "2026-10-20T12:00:00.000Z");
  assert.equal(state.calls.filter(call => call.path.endsWith("/ensure")).length, 0);
  // La de entrega aún no existe: esa sí se crea.
  await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections", "POST", { companyBranchId: 1, kind: "exit" });
  assert.equal(asRecordForTest(state.calls.find(call => call.path.endsWith("/ensure"))?.json).type, "RETURN");
});

test("responder una pregunta guarda el formato de la web y no deja tocar inspecciones de otro ingreso", async context => {
  const { state, baseUrl } = await harness(context);
  setInspectionBackend(state);
  state.failures.set(`${insp}/checklist-steps`, { status: 201, body: { stepId: 502 } });
  const answered = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/steps", "PUT", { companyBranchId: 1, checklistId: 8, checklistStepId: 82, responseValue: "malo", comment: " " });
  assert.deepEqual(answered.data, { id: 502 });
  // Exige foto y aún no la tiene: queda pendiente, como en la web.
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path === `${insp}/checklist-steps`)?.json), { checklistId: 8, checklistStepId: 82, order: 2, title: "Estado", description: null,
    type: "select", value: [{ value: "bueno", label: "Bueno" }, { value: "malo", label: "Malo" }], isFilesRequired: true, responseValue: "malo", comment: null, isCompleted: false, executionStatus: null });
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/steps", "PUT", { companyBranchId: 1, checklistId: 8, checklistStepId: 82, responseValue: "otro", comment: null })).response.status, 400);
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/13/inspections/300/steps", "PUT", { companyBranchId: 1, checklistId: 8, checklistStepId: 81, responseValue: "false", comment: null })).response.status, 404);
});

test("la foto de un ángulo se sube con su clave y los permisos faltantes se explican", async context => {
  const { state, baseUrl } = await harness(context);
  setInspectionBackend(state);
  state.failures.set(`${insp}/photos`, { status: 201, body: { fileIds: [71] } });
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64")}`;
  const sent = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/photos/front", "POST", { companyBranchId: 1, image: jpeg, source: "camera" });
  assert.deepEqual(sent.data, { id: 71 });
  const upload = state.calls.find(call => call.path === `${insp}/photos`);
  assert.equal(asRecordForTest(upload?.json).photoTypes, JSON.stringify(["front"]));
  assert.equal(asRecordForTest(upload?.json).captureSources, JSON.stringify(["live_camera"]));
  assert.deepEqual(upload?.files.map(file => file.mime), ["image/jpeg"]);
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/photos/roof", "POST", { companyBranchId: 1, image: jpeg, source: "camera" })).response.status, 404);
  state.failures.set("/api/equipment_dispatches/inspections/ensure", { status: 401, body: { error: "PERMISSION_REQUIRED" } });
  const denied = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections", "POST", { companyBranchId: 1, kind: "entry" });
  assert.equal(denied.response.status, 403);
  assert.equal(errorCode(denied.data), "INSPECTION_PERMISSION_REQUIRED");
});

test("una foto adicional se sube con su nombre, aparece al final y en la entrega cada ángulo trae la foto del ingreso", async context => {
  const { state, baseUrl } = await harness(context);
  setInspectionBackend(state);
  state.failures.set(`${insp}/photos`, { status: 201, body: { fileIds: [72] } });
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64")}`;
  // Sin nombre una clave custom no existe; con nombre se crea, igual que "Agregar foto" en la web.
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/photos/custom-1761148800000", "POST", { companyBranchId: 1, image: jpeg, source: "gallery" })).response.status, 404);
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/photos/custom-1761148800000", "POST",
    { companyBranchId: 1, image: jpeg, source: "gallery", label: "Golpe en tapa" })).data, { id: 72 });
  const upload = asRecordForTest(state.calls.filter(call => call.path === `${insp}/photos`).at(-1)?.json);
  assert.equal(upload.photoTypes, JSON.stringify(["custom-1761148800000"]));
  assert.equal(upload.labels, JSON.stringify(["Golpe en tapa"]));
  // La inspección de entrega (RETURN) muestra la foto adicional y, por ángulo, la del ingreso (inspección 200).
  state.failures.set(insp, { status: 200, body: { id: 300, type: "RETURN", operationAreaEntryId: 12, completedAt: null, observation: null, checklistSteps: [], damages: [],
    photos: [{ id: 3, fileId: 75, photoType: "custom-1761148800000", label: "Golpe en tapa", file: { id: 75, url: "https://s3.test/c.jpg" } }] } });
  state.failures.set("/api/equipment_dispatches/inspections/by-entry/12/compliance", { status: 200, body: { entryInspection: { id: 200 }, exitInspection: { id: 300 } } });
  state.failures.set("/api/equipment_dispatches/inspections/200", { status: 200, body: { id: 200, type: "DISPATCH", operationAreaEntryId: 12,
    photos: [{ id: 9, fileId: 60, photoType: "front", file: { id: 60, url: "https://s3.test/in.jpg", thumbnailUrl: "https://s3.test/in-t.jpg" } }] } });
  const exit = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300?companyBranchId=1");
  const slots = (exit.data as { slots: Array<Record<string, unknown>> }).slots;
  assert.deepEqual(slots.map(slot => [slot.key, slot.custom]), [["front", false], ["custom-1761148800000", true]]);
  assert.deepEqual(slots[0]?.reference, { fileId: 60, url: "https://s3.test/in-t.jpg", fullUrl: "https://s3.test/in.jpg" });
  assert.equal(slots[1]?.name, "Golpe en tapa");
});

test("compartir arma el enlace público en la web de la empresa y extenderlo pide el permiso de inspecciones", async context => {
  const { state, baseUrl } = await harness(context);
  setInspectionBackend(state);
  state.failures.set(`${insp}/patio-context`, { status: 200, body: { publicLinkToken: "tok123", publicLinkExpiresAt: "2026-10-23T12:00:00.000Z", publicLinkRemainingSeconds: 3600 } });
  const share = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/share?companyBranchId=1");
  const data = share.data as { url: string; remainingSeconds: number; active: boolean };
  const url = new URL(data.url);
  assert.equal(url.pathname, "/es/patio-preview");
  assert.equal(url.searchParams.get("inspectionId"), "300");
  assert.equal(url.searchParams.get("token"), "tok123");
  assert.equal(data.active, true);
  state.failures.set(`${insp}/public-link/extend`, { status: 401, body: { error: "PERMISSION_REQUIRED" } });
  const denied = await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/share/extend", "POST", { companyBranchId: 1 });
  assert.equal(errorCode(denied.data), "INSPECTION_PERMISSION_REQUIRED");
  state.failures.set(`${insp}/public-link/extend`, { status: 200, body: {} });
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/entries/12/inspections/300/share/extend", "POST", { companyBranchId: 1 })).response.status, 200);
  assert.equal(state.calls.filter(call => call.path === `${insp}/public-link/extend` && call.method === "PUT").length, 2);
});

test("el comprimido de fotos se baja del backend como archivo .zip", async context => {
  const { state, baseUrl } = await harness(context);
  setInspectionBackend(state);
  state.failures.set("/api/equipment_dispatches/inspections/photos/download/300", { status: 200, body: { zip: "contenido" } });
  const response = await fetch(`${baseUrl}/api/workshop/entries/12/inspections/300/photos.zip?companyBranchId=1`, { headers: { Authorization: gatewayToken(baseUrl) } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /inspeccion-12-ingreso\.zip/);
  assert.ok((await response.arrayBuffer()).byteLength > 0);
});

const pngSignature = (() => {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (data: Buffer) => { let x = 0xffffffff; for (const v of data) x = crcTable[(x ^ v) & 255]! ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(4, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(26))), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
})();
const reception = { companyBranchId: 1, requestId: "7f14191f-e73a-4d92-91b9-bf3fa38a2df1", workerId: 5, name: "Juan Pérez", email: null, phone: "+56 9 1234",
  signature: { source: "MANUAL", image: pngSignature }, observation: "Llega con barro" };
const setReceptionBackend = (state: Awaited<ReturnType<typeof harness>>["state"], status = "PENDING") => {
  setEntryBackend(state);
  state.failures.set(entryPath, { status: 200, body: { ...rawEntry, status: { key: status }, contacts: [{ id: 9 }], branchesCustomer: [{ value: "7", label: "Casa" }] } });
  state.failures.set("/api/branches/1/inspectionRequirementsConfig", { status: 200, body: { inspectionRequirementsConfig: { entry: "none", exit: "none" } } });
  state.failures.set("/api/select/employees", { status: 200, body: [{ value: 5, label: "Juan Pérez", userId: 33, profile: { phone: "+56 9 1234", user: { email: "juan@x.cl" } } }] });
  state.failures.set("/api/equipment_dispatches/inspections/ensure", { status: 201, body: { inspectionId: 300, created: false } });
  state.failures.set("/api/equipment_dispatches/inspections/300/meta", { status: 200, body: { inspectionId: 300 } });
  state.failures.set("/api/master_commercial/get-all-status", { status: 200, body: [{ id: 50, name: "IN_PROGRESS", isPrimary: false }, { id: 2, name: "IN_PROGRESS", isPrimary: true, isEnabled: true, defaultSubStatusId: null }] });
  state.failures.set("/api/operation_area_entries/12/change-status", { status: 200, body: "" });
};

test("firmar la recepción guarda la firma con contactos y sucursales, la observación y deja el ingreso En proceso", async context => {
  const { state, baseUrl } = await harness(context);
  setReceptionBackend(state);
  const signed = await jsonRequest(baseUrl, "/api/workshop/entries/12/reception", "POST", reception);
  assert.equal(signed.response.status, 200);
  assert.deepEqual(signed.data, { id: 12, observationSaved: true, statusUpdated: true });
  const put = asRecordForTest(state.calls.find(call => call.path === entryPath && call.method === "PUT")?.json);
  assert.equal(put.contacts, JSON.stringify([{ id: 9, isNew: false }]));
  assert.equal(put.branchesCustomer, JSON.stringify([{ id: 7, value: "7" }]));
  const signature = JSON.parse(String(put.responsibleSignature)) as Record<string, unknown>;
  assert.deepEqual({ ...signature, signedAt: "x" }, { id: "5", workerId: "5", name: "Juan Pérez", email: null, phone: "+56 9 1234", userSignatureId: null,
    signatureSource: "MANUAL", signatureImage: pngSignature, signedAt: "x" });
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path.endsWith("/meta"))?.json), { observation: "Llega con barro" });
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path.endsWith("/change-status"))?.json), { statusId: 2, subStatusId: null });
  assert.equal(state.calls.find(call => call.path === "/api/select/employees")?.query.get("filterByBranch"), "1");
});

test("no se firma con la inspección exigida incompleta, ni con firmas inválidas, y no se retrocede el estado", async context => {
  const { state, baseUrl } = await harness(context);
  setReceptionBackend(state, "UNDER_REVIEW");
  state.failures.set("/api/branches/1/inspectionRequirementsConfig", { status: 200, body: { inspectionRequirementsConfig: { entry: "full", exit: "none" } } });
  const blocked = await jsonRequest(baseUrl, "/api/workshop/entries/12/reception", "POST", reception);
  assert.equal(blocked.response.status, 409);
  assert.equal(errorCode(blocked.data), "WORKSHOP_INSPECTION_INCOMPLETE");
  const forged = await jsonRequest(baseUrl, "/api/workshop/entries/12/reception", "POST", { ...reception, requestId: "6f14191f-e73a-4d92-91b9-bf3fa38a2df1", signature: { source: "MANUAL", image: "data:image/png;base64,AAAA" } });
  assert.equal(errorCode(forged.data), "WORKSHOP_SIGNATURE_INVALID");
  assert.equal(state.calls.filter(call => call.method === "PUT").length, 0);
  state.failures.set("/api/branches/1/inspectionRequirementsConfig", { status: 200, body: { inspectionRequirementsConfig: { entry: "none", exit: "none" } } });
  const ok = await jsonRequest(baseUrl, "/api/workshop/entries/12/reception", "POST", { ...reception, requestId: "5f14191f-e73a-4d92-91b9-bf3fa38a2df1", observation: null });
  assert.deepEqual(ok.data, { id: 12, observationSaved: true, statusUpdated: true });
  assert.equal(state.calls.filter(call => call.path.endsWith("/change-status")).length, 0);
});

test("una firma guardada debe ser del trabajador que recibe", async context => {
  const { state, baseUrl } = await harness(context);
  setReceptionBackend(state);
  state.failures.set("/api/user_signatures/options", { status: 200, body: { defaultSignatureId: 4, options: [{ id: 4, signatureName: "Juan", signatureImage: "https://s3.test/firma.png" }] } });
  const signed = await jsonRequest(baseUrl, "/api/workshop/entries/12/reception", "POST", { ...reception, signature: { source: "USER_SIGNATURE", userSignatureId: 4 } });
  assert.equal(signed.response.status, 200);
  const put = asRecordForTest(state.calls.find(call => call.method === "PUT")?.json);
  const signature = JSON.parse(String(put.responsibleSignature)) as Record<string, unknown>;
  assert.equal(signature.signatureImage, "https://s3.test/firma.png");
  assert.equal(signature.userSignatureId, 4);
  assert.equal(state.calls.find(call => call.path === "/api/user_signatures/options")?.query.get("userId"), "33");
  const other = await jsonRequest(baseUrl, "/api/workshop/entries/12/reception", "POST", { ...reception, requestId: "4f14191f-e73a-4d92-91b9-bf3fa38a2df1", signature: { source: "USER_SIGNATURE", userSignatureId: 99 } });
  assert.equal(errorCode(other.data), "WORKSHOP_SIGNATURE_INVALID");
});

test("unir trabajos libres al ingreso explica el permiso que falta y no repite trabajos", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/works", { status: 200, body: { data: [{ id: "702", title: "Cambio de filtros", mainStatus: "pending" }] } });
  const free = await jsonRequest(baseUrl, "/api/workshop/entries/12/free-works?companyBranchId=1&search=filtro");
  assert.deepEqual(free.data, { items: [{ id: 702, code: "TR-00702", title: "Cambio de filtros", statusName: "pending" }] });
  assert.deepEqual(JSON.parse(state.calls.find(call => call.path === "/api/works")?.query.get("filters") ?? "{}"), { companyBranchId: 1, withoutWorkOrder: true, withoutEntry: true, search: "filtro" });
  setEntryBackend(state);
  // Un trabajo de otra sucursal (o ya unido a otro ingreso) no se une.
  state.failures.set("/api/works/5", { status: 200, body: { id: 5, companyBranchId: 2, operationAreaEntryId: null, isDeleted: false } });
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/workshop/entries/12/works/link", "POST", { companyBranchId: 1, workIds: [5] })).data), "WORKSHOP_WORK_NOT_FREE");
  state.failures.set("/api/works/5", { status: 200, body: { id: 5, companyBranchId: 1, operationAreaEntryId: 30, isDeleted: false } });
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/workshop/entries/12/works/link", "POST", { companyBranchId: 1, workIds: [5] })).data), "WORKSHOP_WORK_NOT_FREE");
  assert.equal(state.calls.filter(call => call.path === "/api/works/link-entry").length, 0);
  state.failures.set("/api/works/5", { status: 200, body: { id: 5, companyBranchId: 1, operationAreaEntryId: null, isDeleted: false } });
  state.failures.set("/api/works/link-entry", { status: 401, body: { error: "PERMISSION_REQUIRED" } });
  const denied = await jsonRequest(baseUrl, "/api/workshop/entries/12/works/link", "POST", { companyBranchId: 1, workIds: [5] });
  assert.equal(denied.response.status, 403);
  assert.equal(errorCode(denied.data), "WORKS_PERMISSION_REQUIRED");
  state.failures.set("/api/works/link-entry", { status: 200, body: { linked: 1, skipped: 0 } });
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/entries/12/works/link", "POST", { companyBranchId: 1, workIds: [5, 5] })).data, { linked: 1, skipped: 0 });
  assert.deepEqual(asRecordForTest(state.calls.filter(call => call.path === "/api/works/link-entry").at(-1)?.json), { operationAreaEntryId: 12, workIds: [5] });
});

test("la creación móvil acepta el ingreso de un trabajo y rechaza que el teléfono elija el equipo", async context => {
  const { state, baseUrl } = await harness(context);
  const input = { kind: "work", companyBranchId: 1, clientRequestId: "8a14191f-e73a-4d92-91b9-bf3fa38a2df1", schedule: { date: "2026-10-22", startTime: "", endTime: "" },
    work: { title: "Cambio de sello", summary: "", priority: "high", operationAreaEntryId: 12 } };
  assert.equal((await jsonRequest(baseUrl, "/api/creation", "POST", { ...input, work: { ...input.work, rentalEquipmentId: 5 } })).response.status, 400);
  assert.equal(state.calls.filter(call => call.path === "/api/technician-dashboard/mobile-creations").length, 0);
  await jsonRequest(baseUrl, "/api/creation", "POST", input);
  const forwarded = asRecordForTest(state.calls.find(call => call.path === "/api/technician-dashboard/mobile-creations")?.json);
  assert.deepEqual(forwarded.work, { title: "Cambio de sello", summary: "", priority: "high", operationAreaEntryId: 12 });
});
const setOrderBackend = (state: Awaited<ReturnType<typeof harness>>["state"], fields: unknown[] = []) => {
  setEntryBackend(state);
  state.failures.set(entryPath, { status: 200, body: { ...rawEntry, customerEquipmentId: 56, contacts: [{ id: 9 }], branchesCustomer: [{ value: "7", label: "Casa matriz" }] } });
  state.failures.set("/api/branches/1/negotiationFieldsConfig", { status: 200, body: { negotiationFieldsConfig: fields } });
  state.failures.set("/api/master_commercial/business-type-select-by-branch", { status: 200, body: [{ value: 3, label: "rental" }, { value: 4, label: "service" }] });
  state.failures.set("/api/master_commercial/segments/selects", { status: 200, body: [{ value: "2", label: "General", marginHH: 10, isDefault: true }] });
  state.failures.set("/api/master_commercial/taxes", { status: 200, body: [{ id: 1, rate: 19, isDefaultNegotiation: true, isEnabled: true }, { id: 2, rate: 5, isDefaultNegotiation: false }] });
  state.failures.set("/api/negotiations/95/send-to-commercial", { status: 200, body: { sentToCommercialAt: "2026-10-22" } });
  const list = state.failures.get("/api/negotiations");
  // La misma ruta lista (GET) y crea (POST).
  state.beforeResponse = async (call) => {
    if (call.path === "/api/negotiations") state.failures.set("/api/negotiations", call.method === "POST" ? { status: 201, body: { id: 95 } } : list!);
  };
};
const newOrder = { companyBranchId: 1, requestId: "0f14191f-e73a-4d92-91b9-bf3fa38a2df1", title: "OT bomba", description: null, priority: "high", workIds: [42], sendToCommercial: true };

test("crear una OT sin precios une los trabajos sueltos, usa los valores de la sucursal y la envía a comercial", async context => {
  const { state, baseUrl } = await harness(context);
  setOrderBackend(state);
  const created = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders", "POST", newOrder);
  assert.equal(created.response.status, 201);
  assert.deepEqual(created.data, { id: 95, sent: true });
  const body = asRecordForTest(state.calls.find(call => call.path === "/api/negotiations" && call.method === "POST")?.json);
  const data = asRecordForTest(body.negotiationDataSection);
  assert.equal(data.createdAsODT, true);
  assert.equal(data.businessTypeId, 4);
  assert.equal(data.segmentId, 2);
  assert.equal(data.salesExecutiveId, 42);
  assert.deepEqual(data.customersEquipments, [{ value: 56 }]);
  assert.equal(data.entryId, 12);
  assert.deepEqual(data.contacts, [{ id: 9, isSelected: true, isNew: false }]);
  assert.deepEqual(data.branchesCustomer, [{ value: "7", label: "Casa matriz", isNew: true }]);
  const works = asRecordForTest(body.workSection);
  assert.deepEqual(works.works, [{ existingWorkId: 42, isNew: true }]);
  assert.deepEqual(works.taxes, [{ taxId: 1, rate: 19, isDeleted: false, isNew: true }]);
  assert.equal(asRecordForTest(body.totalsSection).totalNet, 0);
  assert.equal(state.calls.filter(call => call.path === "/api/negotiations/95/send-to-commercial").length, 1);
  // Un trabajo que ya está en una OT no se puede volver a usar.
  const taken = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders", "POST", { ...newOrder, requestId: "1f14191f-e73a-4d92-91b9-bf3fa38a2df2", workIds: [41] });
  assert.equal(errorCode(taken.data), "WORKSHOP_WORK_NOT_LOOSE");
});

test("si la sucursal exige campos que el técnico no puede completar, la OT no se crea y se explica", async context => {
  const { state, baseUrl } = await harness(context);
  setOrderBackend(state, [{ fieldName: "costCenterRelation", visible: true, required: true }, { fieldName: "salesExecutiveId", visible: true, required: true }, { fieldName: "contacts", visible: true, required: true }]);
  const rules = await jsonRequest(baseUrl, "/api/workshop/entries/12/order-rules?companyBranchId=1");
  assert.deepEqual(rules.data, { blockingFields: ["Centro de costo"], descriptionRequired: false });
  const blocked = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders", "POST", newOrder);
  assert.equal(errorCode(blocked.data), "WORKSHOP_ORDER_FIELDS_REQUIRED");
  assert.equal(state.calls.filter(call => call.path === "/api/negotiations" && call.method === "POST").length, 0);
});

test("enviar o eliminar solo aplica a OT del ingreso que aún no se envían", async context => {
  const { state, baseUrl } = await harness(context);
  setOrderBackend(state);
  state.failures.set("/api/negotiations/82/send-to-commercial", { status: 200, body: {} });
  state.failures.set("/api/negotiations/82/work-order", { status: 200, body: { deletedWorks: 2 } });
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/81/send", "POST", { companyBranchId: 1 })).data), "WORKSHOP_ORDER_NOT_WORK_ORDER");
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/99/send", "POST", { companyBranchId: 1 })).data), "NEGOTIATION_NOT_FOUND");
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/send", "POST", { companyBranchId: 1 })).data, { id: 82 });
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82?companyBranchId=1", "DELETE")).data, { id: 82, deletedWorks: 2 });
  assert.equal(state.calls.filter(call => call.path === "/api/negotiations/82/work-order" && call.method === "DELETE").length, 1);
});

const delivery = { companyBranchId: 1, requestId: "2a14191f-e73a-4d92-91b9-bf3fa38a2df1", receiverName: "Pedro Soto", receiverEmail: null, receiverPhone: "+56 9 1",
  receiverSignature: pngSignature, deliveredAt: "2026-10-22T15:00:00.000Z", note: "Sin observaciones" };

test("entregar el equipo exige las condiciones de la ficha, igual que la web", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  const blocked = await jsonRequest(baseUrl, "/api/workshop/entries/12/delivery", "POST", delivery);
  assert.equal(blocked.response.status, 409);
  assert.equal(errorCode(blocked.data), "WORKSHOP_DELIVERY_BLOCKED");
  assert.match(String((blocked.data as { message?: string }).message), /Ingreso completo.*Sin trabajos sueltos/);
  assert.equal(state.calls.filter(call => call.path.endsWith("/deliver")).length, 0);
});

test("con todo cumplido la entrega se registra una sola vez con quien retira y su firma", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  state.failures.set("/api/branches/1/inspectionRequirementsConfig", { status: 200, body: { inspectionRequirementsConfig: { entry: "none", exit: "none" } } });
  state.failures.set("/api/works", { status: 200, body: { data: [{ id: "41", title: "Cambiar sello", mainStatus: "DONE", operationalProgress: 100, negotiation: { id: 81 } }] } });
  state.failures.set("/api/negotiations", { status: 200, body: { data: [{ id: 81, correlative: 4265, businessModality: "FORMAL_QUOTE", businessTypeName: "project", commercialStatus: "APPROVED", createdAsODT: false }] } });
  state.failures.set("/api/operation_area_entries/12/deliver", { status: 201, body: { id: 12 } });
  const [first, second] = await Promise.all([jsonRequest(baseUrl, "/api/workshop/entries/12/delivery", "POST", delivery), jsonRequest(baseUrl, "/api/workshop/entries/12/delivery", "POST", delivery)]);
  assert.deepEqual(first.data, { id: 12, deliveredAt: "2026-10-22T15:00:00.000Z" });
  assert.deepEqual(second.data, first.data);
  const calls = state.calls.filter(call => call.path === "/api/operation_area_entries/12/deliver");
  assert.equal(calls.length, 1);
  assert.deepEqual(asRecordForTest(calls[0]?.json), { companyBranchId: 1, deliveredAt: "2026-10-22T15:00:00.000Z", deliveryNote: "Sin observaciones",
    receiverName: "Pedro Soto", receiverPhone: "+56 9 1", receiverEmail: null, receiverSignature: pngSignature });
  const forged = await jsonRequest(baseUrl, "/api/workshop/entries/12/delivery", "POST", { ...delivery, requestId: "3a14191f-e73a-4d92-91b9-bf3fa38a2df1", receiverSignature: "data:image/png;base64,AAAA" });
  assert.equal(errorCode(forged.data), "WORKSHOP_SIGNATURE_INVALID");
});

const statusRows = [
  { id: 2, name: "En proceso", color: "#7c3aed", isPrimary: true, mainStatusId: 2, order: 2, isEnabled: true },
  { id: 1, name: "Pendiente", color: "#3498db", isPrimary: true, mainStatusId: 1, order: 1, isEnabled: true },
  { id: 3, name: "Antiguo", color: "#999", isPrimary: true, mainStatusId: 3, order: 3, isEnabled: false },
  { id: 9, name: "Esperando repuesto", color: "#000", isPrimary: false, mainStatusId: 2, order: 1, isEnabled: true },
  { id: 2, name: "Sub de pendiente", color: null, isPrimary: false, mainStatusId: 1, order: 1, isEnabled: true }
];

test("los estados del ingreso llegan agrupados con sus subestados y sin los deshabilitados", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/master_commercial/get-all-status", { status: 200, body: statusRows });
  const list = await jsonRequest(baseUrl, "/api/workshop/options/statuses?companyBranchId=1");
  assert.deepEqual(list.data, { items: [
    { id: 1, name: "Pendiente", color: "#3498db", subStatuses: [{ id: 2, name: "Sub de pendiente", color: null }] },
    { id: 2, name: "En proceso", color: "#7c3aed", subStatuses: [{ id: 9, name: "Esperando repuesto", color: "#000" }] }
  ] });
  assert.equal(state.calls.find(call => call.path === "/api/master_commercial/get-all-status")?.query.get("module"), "OPERATION_AREAS_ENTRIES");
});

test("cambiar el estado solo acepta estados y subestados vigentes de la sucursal", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  state.failures.set("/api/master_commercial/get-all-status", { status: 200, body: statusRows });
  state.failures.set("/api/operation_area_entries/12/change-status", { status: 200, body: {} });
  const status = (body: object) => jsonRequest(baseUrl, "/api/workshop/entries/12/status", "POST", { companyBranchId: 1, ...body });
  assert.equal(errorCode((await status({ statusId: 3, subStatusId: null })).data), "WORKSHOP_STATUS_INVALID");
  assert.equal(errorCode((await status({ statusId: 1, subStatusId: 9 })).data), "WORKSHOP_STATUS_INVALID");
  assert.equal(state.calls.filter(call => call.path.endsWith("/change-status")).length, 0);
  assert.deepEqual((await status({ statusId: 2, subStatusId: 9 })).data, { id: 12 });
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path.endsWith("/change-status"))?.json), { statusId: 2, subStatusId: 9 });
});

test("mover de nave usa la nave actual del ingreso y explica si la nueva está llena", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  const move = (toAreaId: number) => jsonRequest(baseUrl, "/api/workshop/entries/12/move", "POST", { companyBranchId: 1, toAreaId, note: "Pasa a motores" });
  assert.equal(errorCode((await move(3)).data), "WORKSHOP_SAME_AREA");
  // Una nave que no es del taller del ingreso (ni de la sucursal) se rechaza antes de llamar al backend.
  assert.equal(errorCode((await move(99)).data), "WORKSHOP_AREA_INVALID");
  assert.equal(state.calls.filter(call => call.path === "/api/operation_area_entries/move").length, 0);
  state.failures.set("/api/operation_area_entries/move", { status: 409, body: { error: "OPERATION_AREA_FULL" } });
  const full = await move(5);
  assert.equal(full.response.status, 409);
  assert.equal(errorCode(full.data), "OPERATION_AREA_FULL");
  state.failures.set("/api/operation_area_entries/move", { status: 200, body: {} });
  assert.deepEqual((await move(5)).data, { id: 12 });
  const sent = state.calls.filter(call => call.path === "/api/operation_area_entries/move");
  assert.equal(sent.at(-1)?.method, "PATCH");
  assert.deepEqual(asRecordForTest(sent.at(-1)?.json), { entryId: 12, fromOperationsAreaId: 3, toOperationsAreaId: 5, note: "Pasa a motores" });
});

test("un ingreso de otra sucursal no se puede ver ni modificar aunque se mande la sucursal propia", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  state.failures.set(entryPath, { status: 200, body: { ...rawEntry, operationAreaId: 44, operationArea: { id: 44, title: "Nave ajena" } } });
  for (const [path, method, body] of [
    ["/api/workshop/entries/12?companyBranchId=1", "GET", undefined],
    ["/api/workshop/entries/12/form?companyBranchId=1", "GET", undefined],
    ["/api/workshop/entries/12/status", "POST", { companyBranchId: 1, statusId: 2, subStatusId: null }],
    ["/api/workshop/entries/12/inspections", "POST", { companyBranchId: 1, kind: "entry" }]
  ] as const) {
    const result = await jsonRequest(baseUrl, path, method, body);
    assert.equal(result.response.status, 404, path);
    assert.equal(errorCode(result.data), "ENTRY_NOT_FOUND");
  }
  assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
});

test("la fecha estimada exige motivo y no se cambia en un equipo ya entregado", async context => {
  const { state, baseUrl } = await harness(context);
  setEntryBackend(state);
  state.failures.set("/api/operation_area_entries/12/estimated-delivery-date", { status: 200, body: {} });
  const change = (body: object) => jsonRequest(baseUrl, "/api/workshop/entries/12/estimated-delivery", "POST", { companyBranchId: 1, estimatedDeliveryAt: "2026-12-01T18:00:00.000Z", ...body });
  assert.equal((await change({ reason: "" })).response.status, 400);
  assert.deepEqual((await change({ reason: "Se espera un repuesto" })).data, { id: 12 });
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path.endsWith("/estimated-delivery-date"))?.json),
    { estimatedDeliveryDate: "2026-12-01T18:00:00.000Z", reason: "Se espera un repuesto", companyBranchId: 1 });
  state.failures.set(entryPath, { status: 200, body: { ...rawEntry, deliveredAt: "2026-10-22T15:00:00.000Z" } });
  assert.equal(errorCode((await change({ reason: "Otro motivo" })).data), "DEPARTURE_ALREADY_EXISTS");
  assert.equal(state.calls.filter(call => call.path.endsWith("/estimated-delivery-date")).length, 1);
});

const newCustomer = { companyBranchId: 1, requestId: "5b14191f-e73a-4d92-91b9-bf3fa38a2df1", customerType: "consignment", identificationTypeId: 1,
  number: "76086428-5", name: "Constructora Andes SpA", fantasyName: " ", businessActivity: "Construcción" };

test("crear un cliente valida el RUT, evita duplicados y manda los campos del formulario web una sola vez", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/DocumentsSalesCountries/select", { status: 200, body: [{ value: "1", label: "RUT" }, { value: "2", label: "Pasaporte" }] });
  assert.equal(errorCode((await jsonRequest(baseUrl, "/api/workshop/customers", "POST", { ...newCustomer, number: "76086428-1" })).data), "RUT_INVALID");
  // La búsqueda trae un cliente con el mismo RUT: no se crea otro.
  state.failures.set("/api/customers", { status: 200, body: { data: [{ id: 3, name: "Andes", documentIdentification: "76.086.428-5" }] } });
  const duplicated = await jsonRequest(baseUrl, "/api/workshop/customers", "POST", { ...newCustomer, requestId: "6b14191f-e73a-4d92-91b9-bf3fa38a2df1" });
  assert.equal(duplicated.response.status, 409);
  assert.equal(errorCode(duplicated.data), "CLIENT_IDENTIFICATION_EXISTS");
  assert.equal(state.calls.filter(call => call.path === "/api/customers" && call.method === "POST").length, 0);
  const search = state.calls.find(call => call.path === "/api/customers" && call.method === "GET");
  assert.equal(JSON.parse(search?.query.get("filters") ?? "{}").search, "76.086.428-5");
  // Sin duplicado: GET devuelve la lista vacía y POST crea.
  state.beforeResponse = async (call) => {
    if (call.path === "/api/customers") state.failures.set("/api/customers", call.method === "POST" ? { status: 201, body: { id: 77 } } : { status: 200, body: { data: [] } });
  };
  const body = { ...newCustomer, requestId: "7b14191f-e73a-4d92-91b9-bf3fa38a2df1" };
  const [first, second] = await Promise.all([jsonRequest(baseUrl, "/api/workshop/customers", "POST", body), jsonRequest(baseUrl, "/api/workshop/customers", "POST", body)]);
  assert.deepEqual(first.data, { id: 77, name: "Constructora Andes SpA", document: "76.086.428-5" });
  assert.deepEqual(second.data, first.data);
  const posts = state.calls.filter(call => call.path === "/api/customers" && call.method === "POST");
  assert.equal(posts.length, 1);
  const sent = asRecordForTest(posts[0]?.json);
  assert.deepEqual(sent.customerType, { name: "company" });
  assert.equal(sent.isConsignment, true);
  assert.deepEqual(sent.identification, { type: "1", number: "76.086.428-5" });
  assert.equal(sent.fantasyName, "");
  assert.equal(sent.businessActivity, "Construcción");
});

test("crear sucursal y contacto del cliente manda los campos de la web y explica el permiso que falta", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/customers/40", { status: 200, body: { id: 40, name: "Cliente" } });
  state.failures.set("/api/customer_branches", { status: 201, body: { id: 12, name: "Planta Lampa", customerId: 40 } });
  const branch = await jsonRequest(baseUrl, "/api/workshop/customers/40/branches", "POST", { companyBranchId: 1, requestId: "8b14191f-e73a-4d92-91b9-bf3fa38a2df1",
    name: "Planta Lampa", contactName: "Ana", address: "Camino Lo Echevers 550", apartment: "B", noStreetNumber: false, region: "RM", county: "Lampa", city: null });
  assert.deepEqual(branch.data, { id: 12, name: "Planta Lampa" });
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path === "/api/customer_branches")?.json), {
    customerId: "40", name: "Planta Lampa", description: "Ana", country: "", region: "RM", county: "Lampa", city: "", address: "Camino Lo Echevers 550, Depto B",
    postalCode: "", lat: "", lon: "", isEnabled: true });
  state.failures.set("/api/customers/40/contacts", { status: 201, body: { id: 9, fullName: "Pedro Soto", email: "psoto@cer.cl", phone: "+56911112222", position: "Jefe" } });
  const contact = { companyBranchId: 1, requestId: "9b14191f-e73a-4d92-91b9-bf3fa38a2df1", firstName: "Pedro", lastName: "Soto", position: "Jefe",
    email: " PSoto@CER.cl ", phone: "+56 9 1111 2222", notes: null };
  assert.deepEqual((await jsonRequest(baseUrl, "/api/workshop/customers/40/contacts", "POST", contact)).data,
    { id: 9, fullName: "Pedro Soto", email: "psoto@cer.cl", phone: "+56911112222", position: "Jefe" });
  assert.deepEqual(asRecordForTest(state.calls.find(call => call.path === "/api/customers/40/contacts")?.json),
    { fullName: "Pedro Soto", email: "psoto@cer.cl", phone: "+56911112222", position: "Jefe", notes: "" });
  assert.equal((await jsonRequest(baseUrl, "/api/workshop/customers/40/contacts", "POST", { ...contact, requestId: "ab14191f-e73a-4d92-91b9-bf3fa38a2df1", email: "sin-arroba" })).response.status, 400);
  state.failures.set("/api/customers/40/contacts", { status: 401, body: { error: "PERMISSION_REQUIRED" } });
  const denied = await jsonRequest(baseUrl, "/api/workshop/customers/40/contacts", "POST", { ...contact, requestId: "bb14191f-e73a-4d92-91b9-bf3fa38a2df1" });
  assert.equal(denied.response.status, 403);
  assert.equal(errorCode(denied.data), "CUSTOMERS_PERMISSION_REQUIRED");
});

test("un mismo intento de escritura del taller se hace una sola vez", async () => {
  let clock = 0;
  const ledger = new WorkshopRequestLedger(1000, 2, () => clock);
  let calls = 0;
  const action = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { id: calls }; };
  const [first, second] = await Promise.all([ledger.run("9", "a", { x: 1 }, action), ledger.run("9", "a", { x: 1 }, action)]);
  assert.deepEqual(first, { result: { id: 1 }, replayed: false });
  assert.deepEqual(second, { result: { id: 1 }, replayed: true });
  assert.equal(calls, 1);
  await assert.rejects(ledger.run("9", "a", { x: 2 }, action), (error: unknown) => error instanceof GatewayError && error.status === 409 && error.code === "WORKSHOP_REQUEST_CONFLICT");
  // Otro usuario con el mismo identificador es otro intento.
  assert.deepEqual(await ledger.run("10", "a", { x: 1 }, action), { result: { id: 2 }, replayed: false });
  // Al vencer, el intento se olvida.
  clock = 1000;
  assert.deepEqual(await ledger.run("9", "a", { x: 1 }, action), { result: { id: 3 }, replayed: false });
});

test("un intento fallido del taller se puede reintentar", async () => {
  const ledger = new WorkshopRequestLedger();
  let calls = 0;
  await assert.rejects(ledger.run("9", "b", {}, async () => { calls++; throw new GatewayError(504, "UPSTREAM_TIMEOUT"); }));
  assert.deepEqual(await ledger.run("9", "b", {}, async () => { calls++; return "ok"; }), { result: "ok", replayed: false });
  assert.equal(calls, 2);
});
