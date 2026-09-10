import assert from "node:assert/strict";
import { test } from "node:test";
import { creationOptionsSchema, creationResultSchema, type CreationInput } from "../../src/domain/creation";
import { demoCreationOptions } from "../../src/infrastructure/creationDemo";
import { MOBILE_USER_AGENT } from "../upstream";
import { TOKEN } from "./fixtures";
import { harness, jsonRequest, writeCalls } from "./mock-upstream";

const upstreamPath = "/api/technician-dashboard/mobile-creations";
const input: CreationInput = { kind: "work", companyBranchId: 1, clientRequestId: "52b5201d-4ea9-4dad-9f9d-191d11ea8461", schedule: { date: "2026-09-10", startTime: "09:00", endTime: "10:30" }, work: { title: "Inspección", summary: "Revisar", priority: "medium", specialtyId: 2 } };
const result = { kind: "work", companyBranchId: 1, groupId: "direct-71", workId: 71, schedule: { ...input.schedule, plannedMinutes: 90, timezone: "America/Santiago" } };
const options = () => ({ ...demoCreationOptions({ companyBranchId: 1 }), userId: 9, workerId: 42 });

test("creation routes forward exact allowlisted request, UUID unchanged, replay status and safe result", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(upstreamPath, { status: 201, body: { ...result, cost: 123, token: "private", schedule: { ...result.schedule, price: 50 } } });
  const first = await jsonRequest(baseUrl, "/api/creation", "POST", input);
  assert.equal(first.response.status, 201);
  assert.equal(first.response.headers.get("idempotency-replayed"), "false");
  assert.equal(first.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(creationResultSchema.parse(first.data), result);
  assert.doesNotMatch(JSON.stringify(first.data), /private|cost|price|token/);
  state.failures.set(upstreamPath, { status: 200, body: result });
  const replay = await jsonRequest(baseUrl, "/api/creation", "POST", input);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.response.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(first.data, replay.data);
  assert.deepEqual(writeCalls(state).map((call) => call.json), [input, input]);
  assert.equal(state.calls.filter((call) => call.path === "/api/auth/me").length, 2);
  assert.ok(state.calls.every((call) => call.headers.authorization === TOKEN && call.headers["user-agent"] === MOBILE_USER_AGENT));
});

test("creation options resource paging verifies actor, worker and branch and strips financial fields", async (t) => {
  const { state, baseUrl } = await harness(t);
  const body = options();
  state.failures.set(`${upstreamPath}/options`, { status: 200, body: { ...body, token: "secret", equipment: { ...body.equipment, items: [{ id: 15, label: "Equipo", netCost: 50 }] } } });
  const response = await jsonRequest(baseUrl, "/api/creation/options?companyBranchId=1&kind=equipment&search=%20EQ%20&page=0");
  assert.equal(response.response.status, 200);
  assert.equal(creationOptionsSchema.parse(response.data).userId, 9);
  assert.doesNotMatch(JSON.stringify(response.data), /secret|netCost|token/);
  assert.deepEqual(Object.fromEntries(state.calls.at(-1)!.query), { companyBranchId: "1", kind: "equipment", search: "EQ", page: "0" });
  for (const changed of [{ userId: 42 }, { workerId: 9 }, { companyBranchId: 2 }]) {
    state.failures.set(`${upstreamPath}/options`, { status: 200, body: { ...body, ...changed } });
    assert.equal((await jsonRequest(baseUrl, "/api/creation/options?companyBranchId=1")).response.status, 403);
  }
});

test("creation rejects invalid calendar, unknown nested fields, IDs, time ranges and no-productivity reason before posting", async (t) => {
  const { state, baseUrl } = await harness(t);
  const invalid = [
    { ...input, userId: 9 }, { ...input, companyBranchId: "1" }, { ...input, clientRequestId: "new" }, { ...input, maintenance: null },
    { ...input, schedule: { ...input.schedule, date: "2026-02-30" } }, { ...input, schedule: { ...input.schedule, timezone: "UTC" } },
    { ...input, schedule: { ...input.schedule, endTime: "09:00" } }, { ...input, schedule: { ...input.schedule, startTime: "9:00" } },
    { ...input, schedule: { ...input.schedule, endDateOffset: 1 } }, { ...input, work: { ...input.work, workerId: 42 } },
    { ...input, work: { ...input.work, rentalEquipmentId: null } }, { ...input, work: { ...input.work, title: "\u000bTitle" } },
    { kind: "non_productive", companyBranchId: 1, clientRequestId: input.clientRequestId, schedule: input.schedule, nonProductive: { reason: "other" } },
  ];
  for (const body of invalid) assert.equal((await jsonRequest(baseUrl, "/api/creation", "POST", body)).response.status, 400);
  assert.equal((await jsonRequest(baseUrl, "/api/creation?companyBranchId=1", "POST", input)).response.status, 400);
  assert.equal(writeCalls(state).length, 0);
});

test("creation rejects query overrides, missing branch and noncanonical pages", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const query of ["", "companyBranchId=1&workerId=42", "companyBranchId=1&timezone=UTC", "companyBranchId=1&kind=work", "companyBranchId=1&page=01", "companyBranchId=1&page=1001", "companyBranchId=1&page=-1", "companyBranchId=1&page=0&page=1", "companyBranchId=1&companyBranchId=2"]) {
    assert.equal((await jsonRequest(baseUrl, `/api/creation/options?${query}`)).response.status, 400);
  }
  assert.equal(state.calls.length, 0);
});

test("creation authorization is fresh, requires a positive worker and blocks foreign branches", async (t) => {
  const { state, baseUrl } = await harness(t);
  assert.equal((await jsonRequest(baseUrl, "/api/creation", "POST", input, null)).response.status, 401);
  for (const workerId of [null, 0, -1]) {
    state.user.workerId = workerId;
    assert.ok([403, 502].includes((await jsonRequest(baseUrl, "/api/creation", "POST", input)).response.status));
  }
  state.user.workerId = 42;
  assert.equal((await jsonRequest(baseUrl, "/api/creation", "POST", { ...input, companyBranchId: 2 })).response.status, 403);
  assert.equal(writeCalls(state).length, 0);
});

test("creation preserves safe backend conflict, DST and deployment codes but never upstream secrets", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const [status, code] of [[409, "MOBILE_CREATION_REQUEST_CONFLICT"], [409, "MOBILE_CREATION_SCHEMA_NOT_READY"], [400, "MOBILE_CREATION_INVALID_LOCAL_TIME"]] as const) {
    state.failures.set(upstreamPath, { status, body: { error: code, sql: "private", token: "private" } });
    const response = await jsonRequest(baseUrl, "/api/creation", "POST", input);
    assert.equal(response.response.status, status);
    assert.equal((response.data as { error: string }).error, code);
    assert.doesNotMatch(JSON.stringify(response.data), /private|sql|token/);
  }
});

test("creation rejects mismatched successful response and enforces 32kb body limit", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(upstreamPath, { status: 201, body: { ...result, companyBranchId: 2 } });
  assert.equal((await jsonRequest(baseUrl, "/api/creation", "POST", input)).response.status, 502);
  state.calls.length = 0;
  assert.equal((await jsonRequest(baseUrl, "/api/creation", "POST", { ...input, work: { ...input.work, summary: "x".repeat(33000) } })).response.status, 413);
  assert.equal(state.calls.length, 0);
});

test("equipment exact lookup forwards a normalized string on the same options route", async (t) => {
  const { state, baseUrl } = await harness(t);
  const item = { id: 71, label: "N.º interno EQ-001 · PLACA-9 · Excavadora", internalNumber: "EQ-001", identifier: "PLACA-9", equipmentType: "Excavadora" };
  state.failures.set(`${upstreamPath}/options`, { status: 200, body: { ...options(), equipment: { items: [{ ...item, cost: 999 }], page: 0, pageSize: 25, hasMore: false } } });
  const response = await jsonRequest(baseUrl, "/api/creation/options?companyBranchId=1&kind=equipment&internalNumber=%20EQ-001%20&page=0");
  assert.equal(response.response.status, 200);
  assert.deepEqual(Object.fromEntries(state.calls.at(-1)!.query), { companyBranchId: "1", kind: "equipment", internalNumber: "eq-001", page: "0" });
  assert.deepEqual(creationOptionsSchema.parse(response.data).equipment?.items, [item]);
  assert.equal(writeCalls(state).length, 0);
  state.calls.length = 0;
  for (const query of ["kind=equipment&internalNumber=", "kind=equipment&internalNumber=1&internalNumber=2", "kind=specialties&internalNumber=1", "internalNumber=1", "kind=equipment&internalNumber=1&search=EQ", `kind=equipment&internalNumber=${"x".repeat(101)}`, "kind=equipment&internalNumber=1%0A2", "kind=equipment&internalNumber=1&filters=%7B%7D"]) {
    assert.equal((await jsonRequest(baseUrl, `/api/creation/options?companyBranchId=1&${query}`)).response.status, 400);
  }
  assert.equal(state.calls.length, 0);
});