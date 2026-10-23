import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode, harness, jsonRequest } from "./mock-upstream";

type State = Awaited<ReturnType<typeof harness>>["state"];

/** Ingreso 12 con la OT 82 y sus archivos en la web. */
function setBackend(state: State) {
  state.failures.set("/api/workshops/select", { status: 200, body: [{ value: 7, label: "Taller central" }] });
  state.failures.set("/api/operation_area/dashboard", { status: 200, body: [{ id: 3, title: "Patio", entries: [{ id: 12 }] }] });
  state.failures.set("/api/operation_area_entries/12", { status: 200, body: { id: 12, operationAreaId: 3, operationArea: { id: 3, title: "Patio" }, isInternalEntry: false, customerId: 40,
    customerEquipment: { manufacturer: { name: "CLARKE" } }, deliveredAt: null } });
  state.failures.set("/api/negotiations", { status: 200, body: { data: [{ id: 82, workOrderNumber: 12, createdAsODT: true, sentToCommercialAt: null, title: "OT de taller" }] } });
  state.failures.set("/api/works", { status: 200, body: { data: [] } });
  state.failures.set("/api/negotiation_files/82", { status: 200, body: { data: [{ id: 5, name: "foto.jpg", url: "https://files.example.com/foto.jpg" }], totalRows: 1, totalPages: 1 } });
}

test("los archivos de la OT del ingreso se listan desde los archivos de la negociación", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const listed = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/files?companyBranchId=1");
  assert.equal(listed.response.status, 200);
  assert.deepEqual((listed.data as { data: Array<{ id: unknown; name: string }> }).data.map((file) => [String(file.id), file.name]), [["5", "foto.jpg"]]);
});

test("una OT que no es del ingreso no muestra ni borra archivos", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const listed = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/99/files?companyBranchId=1");
  assert.equal(listed.response.status, 404);
  assert.equal(errorCode(listed.data), "NEGOTIATION_NOT_FOUND");
  const removed = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/99/files/5?companyBranchId=1", "DELETE");
  assert.equal(removed.response.status, 404);
  assert.equal(state.calls.some((call) => call.path === "/api/files/5"), false);
});

/** OT 82 vista desde Mi jornada (ingreso 0): el documento de la OT, sin ingreso del Taller. */
function setOrder(state: State, data: Record<string, unknown>) {
  state.failures.set("/api/negotiations/82", { status: 200, body: {
    mainStatus: "PENDING", businessTypeName: "service", customer: { name: "Cliente" }, totalsSection: { totalNet: 0 },
    negotiationDataSection: { id: 82, title: "OT de jornada", createdAsODT: true, workOrderNumber: 15, sentToCommercialAt: null, companyBranchId: 1, ...data },
    workSection: { works: [] }, productsSection: { products: [] }, transportSection: { transports: [] }, othersSection: { others: [] }, rentalEquipmentSection: { rentalEquipments: [] }
  } });
  state.failures.set("/api/commercial_transport/select", { status: 200, body: [] });
}

test("una OT de Mi jornada se abre sin ingreso si es de la sucursal", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  setOrder(state, {});
  const opened = await jsonRequest(baseUrl, "/api/workshop/entries/0/orders/82?companyBranchId=1");
  assert.equal(opened.response.status, 200);
  const detail = opened.data as { code: string; editable: boolean; statusLabel: string };
  assert.equal(detail.code, "OT-00015");
  assert.equal(detail.editable, true);
  assert.equal(detail.statusLabel, "Sin enviar a comercial");
  // Sin ingreso no se consulta ninguna ficha del Taller.
  assert.equal(state.calls.some((call) => call.path === "/api/operation_area_entries/12"), false);
  const files = await jsonRequest(baseUrl, "/api/workshop/entries/0/orders/82/files?companyBranchId=1");
  assert.equal(files.response.status, 200);
});

test("sin ingreso no se abre una OT de otra sucursal ni una cotización", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  setOrder(state, { companyBranchId: 2 });
  const foreign = await jsonRequest(baseUrl, "/api/workshop/entries/0/orders/82?companyBranchId=1");
  assert.equal(foreign.response.status, 404);
  assert.equal(errorCode(foreign.data), "NEGOTIATION_NOT_FOUND");
  setOrder(state, { createdAsODT: false, correlative: 4 });
  const quote = await jsonRequest(baseUrl, "/api/workshop/entries/0/orders/82?companyBranchId=1");
  assert.equal(quote.response.status, 404);
});

test("una OT de Mi jornada sin enviar se envía a comercial; una ya enviada no", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  setOrder(state, {});
  state.failures.set("/api/negotiations/82/send-to-commercial", { status: 200, body: { success: true } });
  const sent = await jsonRequest(baseUrl, "/api/workshop/entries/0/orders/82/send", "POST", { companyBranchId: 1 });
  assert.equal(sent.response.status, 200);
  assert.ok(state.calls.some((call) => call.path === "/api/negotiations/82/send-to-commercial" && call.method === "PATCH"));
  setOrder(state, { sentToCommercialAt: "2026-10-23T12:00:00.000Z" });
  const again = await jsonRequest(baseUrl, "/api/workshop/entries/0/orders/82/send", "POST", { companyBranchId: 1 });
  assert.equal(again.response.status, 409);
  assert.equal(errorCode(again.data), "WORK_ORDER_ALREADY_SENT_TO_COMMERCIAL");
});

test("solo se borra un archivo que pertenece a la OT", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const foreign = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/files/6?companyBranchId=1", "DELETE");
  assert.equal(foreign.response.status, 404);
  assert.equal(errorCode(foreign.data), "FILE_NOT_FOUND");
  assert.equal(state.calls.some((call) => call.path === "/api/files/6"), false);
  state.failures.set("/api/files/5", { status: 200, body: { success: true } });
  const own = await jsonRequest(baseUrl, "/api/workshop/entries/12/orders/82/files/5?companyBranchId=1", "DELETE");
  assert.equal(own.response.status, 200);
  assert.ok(state.calls.some((call) => call.path === "/api/files/5" && call.method === "DELETE"));
});
