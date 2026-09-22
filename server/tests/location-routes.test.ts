import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import express from "express";
import { defaultLocationSchedule, locationBatchSchema } from "../../src/domain/locationTracking";
import { errorHandler } from "../errors";
import { Upstream } from "../upstream";
import { createLocationRouter } from "../locations/routes";
import { user } from "./fixtures";

const point = { id: "00000000-0000-4000-8000-000000000001", companyBranchId: 1, capturedAt: "2026-09-21T09:00:00.000Z", locationAt: "2026-09-21T09:00:00.000Z",
  latitude: -33, longitude: -70, accuracy: 20, mocked: false, kind: "periodic", outcome: "located", schedule: defaultLocationSchedule("UTC"), consentedAt: "2026-09-21T08:00:00.000Z", consentVersion: 1 };
async function harness(context: TestContext) {
  const actor = user(); actor.accessBranchs = actor.accessBranchs.filter(branch => branch.id === 1);
  const state = { writes: 0, corrupt: false, historyQuery: "", historyPoint: point };
  const upstream = new Upstream({ backendUrl: "https://example.invalid/api", tenantOrigin: "https://tenant.example.invalid" });
  upstream.request = async (path, options = {}) => {
    if (path === "/auth/me") return actor;
    if (path === "/worker-locations/batch") { state.writes++; const batch = locationBatchSchema.parse(options.json); return { acceptedIds: state.corrupt ? ["00000000-0000-4000-8000-000000000099"] : batch.points.map(value => value.id) }; }
    if (path === "/worker-locations/me") { state.historyQuery = options.query?.toString() ?? ""; return { items: [{ point: state.historyPoint, receivedAt: point.capturedAt, evidenceSource: "DEVICE_REPORTED" }], page: 0, hasMore: false }; }
    throw new Error("UNEXPECTED_LOCATION_REQUEST");
  };
  const app = express(); app.use("/api/worker-locations", createLocationRouter(upstream)); app.use(errorHandler);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("ADDRESS_REQUIRED");
  const request = async (body: unknown = { companyBranchId: 1, points: [point] }, suffix = "/batch", authenticated = true) => fetch(`http://127.0.0.1:${address.port}/api/worker-locations${suffix}`, {
    method: body === null ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer location-fixture" } : {}) }, body: body === null ? undefined : JSON.stringify({ expectedActor: { userId: actor.id, workerId: actor.workerId }, ...(typeof body === "object" ? body : {}) }),
  });
  return { state, request };
}
test("location gateway forwards only validated self-scoped batches and verifies acknowledgement", async context => {
  const { state, request } = await harness(context);
  assert.equal((await request()).status, 200);
  state.corrupt = true; assert.equal((await request()).status, 502);
  assert.equal(state.writes, 2);
});
test("location gateway rejects identity injection, wrong branch, off-hours, duplicates and missing auth before writes", async context => {
  const { state, request } = await harness(context);
  for (const body of [{ companyBranchId: 1, userId: 99, points: [point] }, { companyBranchId: 999, points: [{ ...point, companyBranchId: 999 }] },
    { companyBranchId: 1, points: [{ ...point, capturedAt: "2026-09-21T19:00:00.000Z" }] }, { companyBranchId: 1, points: [point, point] }]) assert.ok((await request(body)).status >= 400);
  assert.equal((await request(undefined, "/batch", false)).status, 401);
  assert.equal((await request({ companyBranchId: 1, points: [point], expectedActor: { userId: 999, workerId: 999 } })).status, 409);
  assert.equal(state.writes, 0);
});
test("location history is bounded and cannot select another user", async context => {
  const { request } = await harness(context);
  const query = "/me?companyBranchId=1&startDate=2026-09-21&endDate=2026-09-21";
  assert.equal((await request(null, query)).status, 200);
  assert.equal((await request(null, query + "&userId=99")).status, 400);
  assert.equal((await request(null, "/me?companyBranchId=1&startDate=2026-01-01&endDate=2026-09-21")).status, 400);
});
test("location history forwards resource filters and rejects ignored filters", async context => {
  const { request, state } = await harness(context);
  const query = "/me?companyBranchId=1&startDate=2026-09-21&endDate=2026-09-21";
  assert.equal((await request(null, query + "&groupId=maintenance-5&workId=7")).status, 502);
  state.historyPoint = { ...point, kind: "work_started", ...{ groupId: "maintenance-5", workId: 7 } };
  assert.equal((await request(null, query + "&groupId=maintenance-5&workId=7")).status, 200);
  assert.equal(new URLSearchParams(state.historyQuery).get("groupId"), "maintenance-5");
  assert.equal(new URLSearchParams(state.historyQuery).get("workId"), "7");
  assert.equal((await request(null, query + "&workId=7")).status, 400);
  assert.equal((await request(null, query + "&groupId=local-5")).status, 400);
});
test("location gateway accepts action events with explicit consent and queued operation references", async context => {
  const { state, request } = await harness(context);
  const event = { ...point, kind: "action", consentVersion: 2, action: "CHECKLIST_SAVED", actionState: "QUEUED", groupId: "maintenance-5", workId: 7, targetId: "1009", operationId: point.id,
    capturedAt: "2026-09-21T23:00:00.000Z", locationAt: "2026-09-21T23:00:00.000Z" };
  assert.equal((await request({ companyBranchId: 1, points: [event] })).status, 200);
  for (const patch of [{ consentVersion: 1 }, { operationId: undefined }, { action: "UNKNOWN_ACTION" }, { userId: 99 }]) {
    assert.equal((await request({ companyBranchId: 1, points: [{ ...event, ...patch }] })).status, 400);
  }
  assert.equal(state.writes, 1);
});