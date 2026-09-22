import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import express from "express";
import { registerWorkActions } from "../assignments/workActions";
import { errorHandler, GatewayError } from "../errors";
import { Upstream } from "../upstream";
import { assignments, user, RANGE, TOKEN } from "./fixtures";
import { equipmentLocationUpdateSchema, type EquipmentLocation } from "../../src/domain/equipmentLocation";

const address = { address: "Calle 4 Poniente", country: "Chile", region: "Metropolitana", county: "Paine", city: "", postalCode: "", lat: "-33.81", lon: "-70.74" };
async function harness(context: TestContext) {
  const state = { data: assignments(), actor: user(), writes: 0, paths: [] as string[], canEdit: true, badResponse: false };
  const upstream = new Upstream({ backendUrl: "https://api.invalid", tenantOrigin: "https://tenant.invalid" });
  upstream.request = async (path, options = {}) => {
    if (path === "/auth/me") return state.actor;
    if (path === "/technician-dashboard/assignments") return state.data;
    state.paths.push(path);
    assert.equal(options.query?.get("groupType"), "direct_assignment");
    assert.equal(options.query?.get("companyBranchId"), "1");
    assert.ok(path.endsWith("/equipment-location/work") || path.endsWith("/equipment-location/group"));
    if (options.method === "PATCH") {
      if (!state.canEdit) throw new GatewayError(403, "PERMISSION_REQUIRED");
      equipmentLocationUpdateSchema.parse(options.json); state.writes++;
    }
    const result: EquipmentLocation = { equipmentId: 5, equipmentContext: "rental", label: "Equipo", address, canEdit: state.canEdit, currentAddress: address, currentLabel: null, currentSource: "REGISTERED" };
    return state.badResponse ? { ...result, address: { ...address, lat: "999" } } : result;
  };
  const app = express(); app.use(express.json({ limit: "32kb" })); const router = express.Router();
  registerWorkActions(router, upstream, (_req, _res, next) => next(), { active: 0 }); app.use("/assignments", router); app.use(errorHandler);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  const listening = server.address(); if (!listening || typeof listening === "string") throw new Error("NO_ADDRESS");
  const request = (body?: unknown, target = "work", group = "direct-11") => fetch(`http://127.0.0.1:${listening.port}/assignments/${group}/works/11/equipment-location/${target}?${RANGE}`, {
    method: body === undefined ? "GET" : "PATCH", headers: { Authorization: TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { state, request };
}
test("equipment location uses the authorized work and target with no client equipment ID", async context => {
  const { request, state } = await harness(context);
  assert.equal((await request()).status, 200); assert.equal((await request(undefined, "group")).status, 200);
  assert.equal((await request({ expected: address, address: { ...address, lat: "0", lon: "0" } })).status, 200);
  assert.equal(state.writes, 1);
  for (const body of [{ expected: address, address, equipmentId: 9 }, { expected: address, address: { ...address, id: 1 } }, { expected: null, address: { ...address, lat: null } }]) assert.equal((await request(body)).status, 400);
  assert.equal((await request(undefined, "other")).status, 400); assert.equal((await request(undefined, "work", "direct-99")).status, 404);
  state.data.technician.id = 1; assert.equal((await request()).status, 403); assert.equal(state.writes, 1);
});
test("equipment location respects backend permissions and validates coordinates returned", async context => {
  const { request, state } = await harness(context); state.canEdit = false;
  const response = await request(); assert.equal(response.status, 200); assert.equal((await response.json()).canEdit, false);
  assert.equal((await request({ expected: address, address })).status, 403); assert.equal(state.writes, 0);
  state.badResponse = true; assert.equal((await request()).status, 502);
});
test("equipment permission and concurrent-change errors never become an authentication revocation", async context => {
  const original = globalThis.fetch;
  context.after(() => { globalThis.fetch = original; });
  const upstream = new Upstream({ backendUrl: "https://api.invalid", tenantOrigin: "https://tenant.invalid" });
  for (const [status, code, expected] of [[401, "PERMISSION_REQUIRED", 403], [409, "EQUIPMENT_LOCATION_CHANGED", 409]] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: code }), { status });
    await assert.rejects(upstream.request("/technician-dashboard/panel/direct-11/works/11/equipment-location/work", { method: "PATCH" }), (error: unknown) => error instanceof GatewayError && error.status === expected && error.code === code);
  }
});