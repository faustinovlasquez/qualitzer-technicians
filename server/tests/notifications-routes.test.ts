import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationDataSchema, notificationDeviceResultSchema, notificationInboxSchema, notificationStatusSchema, type NotificationDeviceInput } from "../../src/domain/notifications";
import { MOBILE_USER_AGENT } from "../upstream";
import { TOKEN } from "./fixtures";
import { gatewayToken, harness, jsonRequest, writeCalls } from "./mock-upstream";

const prefix = "/api/mobile-notifications";
const id = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const projectId = "11111111-1111-4111-8111-111111111111";
const preferences = { assignments: true, timers: true, remindAfterMinutes: 30, repeatEveryMinutes: 120, quietHoursStart: "22:00", quietHoursEnd: "07:00" } as const;
const registration: NotificationDeviceInput = { installationId: id, projectId, expoPushToken: "ExpoPushToken[valid_test_token_1234]", platform: "android", companyBranchId: 1, preferences };
const status = { enabled: true, reasons: [], projectId, reconciliationSeconds: 120, deliveryGuaranteed: false };
const path = (action: string) => `${prefix}/${action}?companyBranchId=1`;

test("notification status projects no credentials, remains disabled when backend disabled", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/status`, { status: 200, body: { ...status, enabled: false, reasons: ["MOBILE_PUSH_DISABLED"], tokenCiphertext: "private", expoPushToken: "private" } });
  const response = await jsonRequest(baseUrl, path("status"));
  assert.equal(response.response.status, 200);
  assert.equal(notificationStatusSchema.parse(response.data).enabled, false);
  assert.doesNotMatch(JSON.stringify(response.data), /private|tokenCiphertext|expoPushToken/);
  assert.equal((await jsonRequest(baseUrl, `${prefix}/device`, "PUT", registration)).response.status, 503);
  assert.equal(writeCalls(state).length, 0);
});

test("notification register/unregister use fixed UA, real branch, canonical UUID and safe response", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/status`, { status: 200, body: status });
  state.failures.set(`${prefix}/device`, { status: 200, body: { installationId: id, active: true, preferences: { ...preferences, hourlyCost: 5 }, baselineCapturedAt: "2026-09-08T12:00:00.000Z", tokenHash: "private" } });
  const response = await jsonRequest(baseUrl, `${prefix}/device`, "PUT", registration);
  assert.equal(response.response.status, 200);
  assert.equal(notificationDeviceResultSchema.parse(response.data).installationId, id);
  assert.doesNotMatch(JSON.stringify(response.data), /private|hourlyCost|tokenHash/);
  assert.deepEqual(writeCalls(state).at(-1)?.json, registration);
  assert.ok(state.calls.every((call) => call.headers.authorization === TOKEN && call.headers["user-agent"] === MOBILE_USER_AGENT));
  assert.ok(state.calls.every((call) => call.headers.origin === state.calls[0]!.headers.origin));
  state.failures.set(`${prefix}/device/${id}`, { status: 200, body: "" });
  const removed = await fetch(`${baseUrl}${path(`device/${id}`)}`, { method: "DELETE", headers: { Authorization: gatewayToken(baseUrl) } });
  assert.equal(removed.status, 200);
  assert.equal(await removed.text(), "");
});

test("notification rejects unknown fields, token/project/installation formats, query overrides, pages and oversize body", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const input of [{ ...registration, userId: 9 }, { ...registration, tenantOrigin: "https://other.invalid" }, { ...registration, companyBranchId: "1" }, { ...registration, projectId: "no" }, { ...registration, installationId: "no" }, { ...registration, expoPushToken: "http://bad.invalid" }, { ...registration, preferences: { ...preferences, quietHoursStart: "24:00" } }, { ...registration, preferences: { ...preferences, workerId: 42 } }]) {
    assert.equal((await jsonRequest(baseUrl, `${prefix}/device`, "PUT", input)).response.status, 400);
  }
  for (const suffix of ["status", "status?companyBranchId=1&tenantOrigin=https://other.invalid", "inbox?companyBranchId=1&page=0", "inbox?companyBranchId=1&page=1001", "inbox?companyBranchId=1&page=01", "inbox?companyBranchId=1&page=1&page=2"]) assert.equal((await jsonRequest(baseUrl, `${prefix}/${suffix}`)).response.status, 400);
  assert.equal((await jsonRequest(baseUrl, `${prefix}/device?companyBranchId=1`, "PUT", registration)).response.status, 400);
  assert.equal((await jsonRequest(baseUrl, `${prefix}/device`, "PUT", { ...registration, expoPushToken: "x".repeat(33000) })).response.status, 413);
  assert.equal(state.calls.length, 0);
});

test("notification registration requires configured project, fresh positive worker and branch membership", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/status`, { status: 200, body: status });
  assert.equal((await jsonRequest(baseUrl, `${prefix}/device`, "PUT", { ...registration, projectId: eventId })).response.status, 400);
  state.user.workerId = 0;
  assert.ok([403, 502].includes((await jsonRequest(baseUrl, path("status"))).response.status));
  state.user.workerId = 42;
  state.user.accessBranchs = [];
  assert.equal((await jsonRequest(baseUrl, path("status"))).response.status, 403);
  assert.equal(writeCalls(state).length, 0);
});

test("notification inbox validates source IDs, nullable test payload, dates and tenant/branch boundaries", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/status`, { status: 200, body: status });
  await jsonRequest(baseUrl, path("status"));
  const tenantOrigin = String(state.calls.at(-1)!.headers.origin);
  const data = { tenantOrigin, companyBranchId: 1, eventId, kind: "WORK_TECHNICIAN_ASSIGNED", groupType: "maintenance", groupId: 50, workId: 71, date: "2026-12-24" };
  const item = { id: eventId, kind: data.kind, state: "dead", data, lastFailure: "EXPO_HTTP_429", readAt: null, createdAt: "2026-09-08T12:00:00.000Z" };
  state.failures.set(`${prefix}/inbox`, { status: 200, body: { items: [{ ...item, token: "private", data: { ...data, netCost: 100 } }], page: 1, pageSize: 25 } });
  const response = await jsonRequest(baseUrl, path("inbox"));
  assert.equal(response.response.status, 200);
  assert.equal(notificationInboxSchema.parse(response.data).items[0]!.data.workId, 71);
  assert.doesNotMatch(JSON.stringify(response.data), /private|netCost|token/);
  for (const changed of [{ tenantOrigin: "https://other.invalid" }, { companyBranchId: 2 }, { date: "2026-02-30" }, { workId: 0 }, { groupType: "internal_maintenance" }]) {
    state.failures.set(`${prefix}/inbox`, { status: 200, body: { items: [{ ...item, data: { ...data, ...changed } }], page: 1, pageSize: 25 } });
    assert.equal((await jsonRequest(baseUrl, path("inbox"))).response.status, 502);
  }
  assert.ok(notificationDataSchema.safeParse({ ...data, kind: "MOBILE_PUSH_TEST", groupType: null, groupId: null, workId: null, date: null }).success);
});

test("notification read/test have no target body, preserve rate limits and route exact IDs", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/inbox/${eventId}/read`, { status: 200, body: { id: eventId, read: true, token: "private" } });
  assert.equal((await jsonRequest(baseUrl, path(`inbox/${eventId}/read`), "PATCH", {})).response.status, 400);
  assert.deepEqual((await jsonRequest(baseUrl, path(`inbox/${eventId}/read`), "PATCH")).data, { id: eventId, read: true });
  assert.equal((await jsonRequest(baseUrl, path("test"), "POST", { expoPushToken: registration.expoPushToken })).response.status, 400);
  state.failures.set(`${prefix}/test`, { status: 201, body: { eventId, state: "pending" } });
  assert.equal((await jsonRequest(baseUrl, path("test"), "POST", {})).response.status, 201);
  state.failures.set(`${prefix}/test`, { status: 429, body: { error: "MOBILE_PUSH_TEST_RATE_LIMIT", detail: "secret" } });
  const limited = await jsonRequest(baseUrl, path("test"), "POST");
  assert.equal(limited.response.status, 429);
  assert.doesNotMatch(JSON.stringify(limited.data), /secret/);
});

test("notification routes support native and cookie sessions, reject cookie CSRF, and advertise PUT in CORS", async (t) => {
  const { state, baseUrl } = await harness(t, { login: false });
  state.failures.set(`${prefix}/status`, { status: 200, body: status });
  const origin = "http://localhost:8081";
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { Origin: origin, "X-Qualitzer-Session": "cookie", "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: "local", username: "test", password: "fixture", remember: true }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const headers = { Origin: origin, "X-Qualitzer-Session": "cookie", Cookie: cookie };
  assert.equal((await fetch(`${baseUrl}${path("status")}`, { headers })).status, 200);
  assert.equal((await fetch(`${baseUrl}${path("status")}`, { headers: { "X-Qualitzer-Session": "cookie", Cookie: cookie } })).status, 403);
  const cors = await fetch(`${baseUrl}${prefix}/device`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-qualitzer-session" } });
  assert.match(cors.headers.get("access-control-allow-methods") ?? "", /PUT/);
  assert.equal((await fetch(`${baseUrl}${path("status")}`)).status, 401);
});