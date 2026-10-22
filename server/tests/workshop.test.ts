import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode, harness, jsonRequest } from "./mock-upstream";
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
