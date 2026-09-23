import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import express from "express";
import { registerWorkActions } from "../assignments/workActions";
import { errorHandler, GatewayError } from "../errors";
import { Upstream } from "../upstream";
import { assignments, user, RANGE, TOKEN } from "./fixtures";
import { workEditInputSchema, type WorkEditDocument } from "../../src/domain/creation";

const document: WorkEditDocument = { groupId: "direct-11", workId: 11, companyBranchId: 1, revision: "a".repeat(64),
  fields: { title: "Original", summary: "", priority: "medium", rentalEquipmentId: null, specialtyId: null, schedule: { date: "2026-09-10", startTime: "09:00", endTime: "10:00" } },
  equipment: null, specialty: null, equipmentInherited: false, scheduleEditable: true };
async function harness(context: TestContext) {
  const state = { data: assignments(), actor: user(), writes: 0, conflict: false, invalid: false, invalidJson: false, document: structuredClone(document) };
  const upstream = new Upstream({ backendUrl: "https://api.invalid", tenantOrigin: "https://tenant.invalid" });
  upstream.request = async (path, options = {}) => {
    if (path === "/auth/me") return state.actor;
    if (path === "/technician-dashboard/assignments") return state.data;
    assert.equal(path, "/technician-dashboard/panel/direct-11/works/11/edit");
    assert.equal(options.query?.get("companyBranchId"), "1");
    if (state.invalidJson) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    if (options.method === "PATCH") {
      const input = workEditInputSchema.parse(options.json);
      if (state.conflict) throw new GatewayError(409, "WORK_EDIT_CONFLICT");
      state.writes++;
      return { ...document, fields: input.fields };
    }
    return state.invalid ? { ...state.document, revision: "invalid" } : state.document;
  };
  const app = express(); app.use(express.json()); const router = express.Router();
  registerWorkActions(router, upstream, (_req, _res, next) => next(), { active: 0 }); app.use("/assignments", router); app.use(errorHandler);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
  const request = (body?: unknown, group = "direct-11") => fetch(`http://127.0.0.1:${address.port}/assignments/${group}/works/11/edit?${RANGE}`, {
    method: body === undefined ? "GET" : "PATCH", headers: { Authorization: TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { state, request };
}
test("editing reads canonical data and writes to the same authorized work without a create request", async context => {
  const { state, request } = await harness(context);
  assert.equal((await request()).status, 200);
  const input = { expectedRevision: document.revision, fields: { ...document.fields, title: "Edited", rentalEquipmentId: 5 } };
  const response = await request(input); assert.equal(response.status, 200);
  assert.equal((await response.json()).fields.title, "Edited"); assert.equal(state.writes, 1);
  assert.equal((await request({ ...input, companyBranchId: 2 })).status, 400);
  assert.equal((await request(input, "direct-99")).status, 404);
  state.data.technician.id = 1; assert.equal((await request(input)).status, 403); assert.equal(state.writes, 1);
});
test("editing preserves conflicts and rejects malformed upstream data", async context => {
  const { state, request } = await harness(context);
  state.conflict = true;
  assert.equal((await request({ expectedRevision: document.revision, fields: document.fields })).status, 409);
  state.invalid = true;
  const response = await request();
  assert.equal(response.status, 502);
  const failure = await response.json();
  assert.equal(failure.error, "WORK_EDIT_INVALID_RESPONSE");
  assert.match(failure.message, /revision/);
  assert.doesNotMatch(JSON.stringify(failure), /Original|"invalid"|expectedRevision/);
  assert.equal(state.writes, 0);
});

test("editing opens an untimed direct work without equipment or specialty", async context => {
  const { state, request } = await harness(context);
  state.document.fields.schedule = { date: "2026-09-22", startTime: "", endTime: "", endDateOffset: 0 };
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), state.document);
  assert.equal(state.writes, 0);
});

test("editing diagnoses invalid schedule fields without exposing their values", async context => {
  const { state, request } = await harness(context);
  state.document.fields.schedule.date = "private-invalid-date";
  const response = await request();
  assert.equal(response.status, 502);
  const failure = await response.json();
  assert.equal(failure.error, "WORK_EDIT_INVALID_RESPONSE");
  assert.match(failure.message, /fields\.schedule\.date/);
  assert.doesNotMatch(JSON.stringify(failure), /private-invalid-date|Original/);
  assert.equal(state.writes, 0);
});

test("editing distinguishes malformed assignment data from the edit document", async context => {
  const { state, request } = await harness(context);
  Reflect.deleteProperty(state.data, "technician");
  const response = await request();
  assert.equal(response.status, 502);
  const failure = await response.json();
  assert.equal(failure.error, "WORK_EDIT_ASSIGNMENT_INVALID_RESPONSE");
  assert.equal(state.writes, 0);
});

test("editing distinguishes non-JSON data and wrong resource identity", async context => {
  const { state, request } = await harness(context);
  state.invalidJson = true;
  const malformed = await request();
  assert.equal(malformed.status, 502);
  const failure = await malformed.json();
  assert.equal(failure.error, "WORK_EDIT_INVALID_RESPONSE");
  assert.match(failure.message, /JSON/);
  state.invalidJson = false;
  state.document.workId = 12;
  const mismatched = await request();
  assert.equal(mismatched.status, 502);
  assert.match((await mismatched.json()).message, /no corresponde/);
  assert.equal(state.writes, 0);
});

test("editing never includes unknown upstream keys or private fields in diagnostics", async context => {
  const { state, request } = await harness(context);
  Object.assign(state.document, { privateExtra: "secret-data", accessToken: "never-return" });
  const response = await request();
  assert.equal(response.status, 502);
  const failure = await response.json();
  assert.match(failure.message, /document/);
  assert.doesNotMatch(JSON.stringify(failure), /privateExtra|secret-data|accessToken|never-return/);
  assert.equal(state.writes, 0);
});