import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationDeleteResultSchema, notificationInboxSchema } from "../../src/domain/notifications";
import { MOBILE_USER_AGENT } from "../upstream";
import { TOKEN } from "./fixtures";
import { errorCode, gatewayToken, harness, jsonRequest, writeCalls } from "./mock-upstream";

const prefix = "/api/mobile-notifications";
const eventId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const deletePath = `${prefix}/inbox/${eventId}`;
const scopedDeletePath = `${deletePath}?companyBranchId=1`;
const legacyInbox = { items: [], page: 1, pageSize: 25 };
const deleteResult = { id: eventId, deleted: true };

function inboxItem(tenantOrigin: string, companyBranchId = 1) {
  return {
    id: eventId, kind: "WORK_TECHNICIAN_ASSIGNED", state: "pending", lastFailure: null,
    readAt: null, createdAt: "2026-09-12T12:00:00.000Z",
    data: { tenantOrigin, companyBranchId, eventId, kind: "WORK_TECHNICIAN_ASSIGNED", groupType: "maintenance", groupId: 50, workId: 71, date: "2026-09-12" },
  };
}

test("legacy inbox 200 preserves missing counts and delete capability without deriving them from a page", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/inbox`, { status: 200, body: legacyInbox });
  const response = await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1`);
  assert.equal(response.response.status, 200);
  assert.deepEqual(response.data, legacyInbox);
  const parsed = notificationInboxSchema.parse(response.data);
  assert.equal(parsed.unreadCount, undefined);
  assert.equal(parsed.total, undefined);
  assert.equal(parsed.canDelete, undefined);
});

test("inbox forwards only explicit unreadOnly=true and preserves legacy all-items default", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/inbox`, { status: 200, body: { ...legacyInbox, page: 2, unreadCount: 53, total: 104, canDelete: true } });
  for (const filter of ["", "&unreadOnly=false", "&unreadOnly=true"]) {
    const response = await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1&page=2${filter}`);
    assert.equal(response.response.status, 200);
    assert.deepEqual(response.data, { ...legacyInbox, page: 2, unreadCount: 53, total: 104, canDelete: true });
    const call = state.calls.at(-1)!;
    assert.equal(call.path, `${prefix}/inbox`);
    assert.equal(call.method, "GET");
    assert.deepEqual([...call.query], [["companyBranchId", "1"], ["page", "2"], ...(filter === "&unreadOnly=true" ? [["unreadOnly", "true"]] : [])]);
    assert.equal(call.json, undefined);
  }
  assert.equal(writeCalls(state).length, 0);
});

test("inbox rejects malformed, duplicate and structured booleans before calling upstream", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const value of ["", "TRUE", "False", "1", "0", "null", "%20true", "true%20", "true%00", "true&unreadOnly=false", "true&unreadOnly=true"]) {
    assert.equal((await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1&unreadOnly=${value}`)).response.status, 400);
  }
  for (const query of ["unreadOnly[]=true", "unreadOnly[value]=true", "userId=1", "workerId=42", "hiddenAt=null", "tenantOrigin=https://other.invalid"]) {
    assert.equal((await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1&${query}`)).response.status, 400);
  }
  assert.equal(state.calls.length, 0);
});

test("inbox projects additive global metadata and strips unknown private fields at every level", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/inbox`, { status: 200, body: legacyInbox });
  await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1`);
  const item = inboxItem(String(state.calls.at(-1)!.headers.origin));
  state.failures.set(`${prefix}/inbox`, { status: 200, body: {
    items: [{ ...item, hiddenAt: "private", userId: 999, workerId: 888, tokenCiphertext: "private", data: { ...item.data, token: "private", sessionId: "private" } }],
    page: 1, pageSize: 25, unreadCount: 90, total: 120, canDelete: true, token: "private", hiddenAt: "private",
  } });
  const response = await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1&unreadOnly=true`);
  assert.equal(response.response.status, 200);
  assert.deepEqual(response.data, { items: [item], page: 1, pageSize: 25, unreadCount: 90, total: 120, canDelete: true });
  assert.doesNotMatch(JSON.stringify(response.data), /private|hiddenAt|userId|workerId|token|sessionId/);
});

test("inbox rejects invalid additive metadata instead of inventing counts or capabilities", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const fields of [{ unreadCount: -1 }, { unreadCount: 1.5 }, { unreadCount: "2" }, { unreadCount: null }, { total: -1 }, { total: 1.5 }, { total: "2" }, { total: null }, { canDelete: "true" }, { canDelete: null }]) {
    state.failures.set(`${prefix}/inbox`, { status: 200, body: { ...legacyInbox, ...fields, token: "private" } });
    const response = await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1`);
    assert.equal(response.response.status, 502);
    assert.equal(errorCode(response.data), "UPSTREAM_INVALID_RESPONSE");
    assert.doesNotMatch(JSON.stringify(response.data), /private|token/);
  }
});

test("filtered inbox still rejects foreign tenant, foreign branch, wrong page and mismatched event IDs", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(`${prefix}/inbox`, { status: 200, body: legacyInbox });
  await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1`);
  const item = inboxItem(String(state.calls.at(-1)!.headers.origin));
  for (const body of [
    { ...legacyInbox, items: [{ ...item, data: { ...item.data, tenantOrigin: "https://other.invalid" } }] },
    { ...legacyInbox, items: [{ ...item, data: { ...item.data, companyBranchId: 2 } }] },
    { ...legacyInbox, page: 2 },
    { ...legacyInbox, items: [{ ...item, data: { ...item.data, eventId: otherId } }] },
  ]) {
    state.failures.set(`${prefix}/inbox`, { status: 200, body });
    assert.equal((await jsonRequest(baseUrl, `${prefix}/inbox?companyBranchId=1&unreadOnly=true`)).response.status, 502);
  }
});

test("delete forwards only a canonical event ID and selected branch with fresh mobile actor credentials", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(deletePath, { status: 200, body: { ...deleteResult, hiddenAt: "private", token: "private", userId: 9, workerId: 42, tenantOrigin: "private" } });
  const response = await jsonRequest(baseUrl, scopedDeletePath, "DELETE");
  assert.equal(response.response.status, 200);
  assert.deepEqual(response.data, deleteResult);
  assert.deepEqual(notificationDeleteResultSchema.parse(response.data), deleteResult);
  const writes = writeCalls(state);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.path, deletePath);
  assert.equal(writes[0]!.method, "DELETE");
  assert.deepEqual([...writes[0]!.query], [["companyBranchId", "1"]]);
  assert.equal(writes[0]!.json, undefined);
  assert.deepEqual(writes[0]!.files, []);
  assert.equal(writes[0]!.headers["content-type"], undefined);
  assert.ok(state.calls.some((call) => call.path === "/api/auth/me"));
  assert.ok(state.calls.every((call) => call.headers.authorization === TOKEN && call.headers["user-agent"] === MOBILE_USER_AGENT));
  assert.ok(state.calls.every((call) => call.headers.origin === state.calls[0]!.headers.origin));
});

test("delete rejects bodies, invalid UUIDs, noncanonical branch and all query overrides before upstream", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const body of [{}, { id: otherId }, { userId: 9, workerId: 42, companyBranchId: 2, hiddenAt: null }]) {
    assert.equal((await jsonRequest(baseUrl, scopedDeletePath, "DELETE", body)).response.status, 400);
  }
  for (const query of ["", "companyBranchId=01", "companyBranchId=0", "companyBranchId=1&companyBranchId=2", "companyBranchId=1&id=" + otherId, "companyBranchId=1&userId=9", "companyBranchId=1&workerId=42", "companyBranchId=1&tenantOrigin=https://other.invalid", "companyBranchId=1&hiddenAt=null", "companyBranchId=1&unreadOnly=true", "companyBranchId=1&page=1"]) {
    assert.equal((await jsonRequest(baseUrl, `${deletePath}?${query}`, "DELETE")).response.status, 400);
  }
  for (const id of ["invalid", "1", `${eventId}%2Fread`, `${eventId}%3FuserId=9`]) {
    assert.equal((await jsonRequest(baseUrl, `${prefix}/inbox/${id}?companyBranchId=1`, "DELETE")).response.status, 400);
  }
  const textBody = await fetch(`${baseUrl}${scopedDeletePath}`, { method: "DELETE", headers: { Authorization: gatewayToken(baseUrl), "Content-Type": "text/plain" }, body: "override" });
  assert.equal(textBody.status, 400);
  assert.equal(state.calls.length, 0);
});

test("delete requires a session, current worker and current branch membership", async (t) => {
  const { state, baseUrl } = await harness(t);
  assert.equal((await jsonRequest(baseUrl, scopedDeletePath, "DELETE", undefined, null)).response.status, 401);
  state.user.workerId = null;
  assert.equal((await jsonRequest(baseUrl, scopedDeletePath, "DELETE")).response.status, 403);
  state.user.workerId = 42;
  state.user.accessBranchs = [];
  assert.equal((await jsonRequest(baseUrl, scopedDeletePath, "DELETE")).response.status, 403);
  assert.equal(writeCalls(state).length, 0);
});

test("delete rejects mismatched IDs and malformed success responses without exposing private payloads", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const body of [{ id: otherId, deleted: true }, { id: eventId, deleted: false }, { id: eventId, deleted: "true" }, { deleted: true }, { id: eventId, read: true }, null, ""]) {
    state.failures.set(deletePath, { status: 200, body: body !== null && typeof body === "object" ? { ...body, token: "private" } : body });
    const response = await jsonRequest(baseUrl, scopedDeletePath, "DELETE");
    assert.equal(response.response.status, 502);
    assert.equal(errorCode(response.data), "UPSTREAM_INVALID_RESPONSE");
    assert.doesNotMatch(JSON.stringify(response.data), /private|token/);
  }
});

test("delete preserves upstream idempotent responses without local fabrication or extra mutations", async (t) => {
  const { state, baseUrl } = await harness(t);
  const hiddenEvents = new Set<string>();
  state.beforeResponse = async (call) => {
    if (call.method === "DELETE" && call.path === deletePath) hiddenEvents.add(eventId);
  };
  state.failures.set(deletePath, { status: 200, body: deleteResult });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await jsonRequest(baseUrl, scopedDeletePath, "DELETE");
    assert.equal(response.response.status, 200);
    assert.deepEqual(response.data, deleteResult);
  }
  assert.equal(hiddenEvents.size, 1);
  assert.deepEqual(writeCalls(state).map((call) => [call.method, call.path]), [["DELETE", deletePath], ["DELETE", deletePath]]);
  state.failures.set(deletePath, { status: 404, body: { error: "MOBILE_PUSH_EVENT_NOT_FOUND", detail: "private", hiddenAt: "private" } });
  const foreign = await jsonRequest(baseUrl, scopedDeletePath, "DELETE");
  assert.equal(foreign.response.status, 404);
  assert.equal(errorCode(foreign.data), "MOBILE_PUSH_EVENT_NOT_FOUND");
  assert.doesNotMatch(JSON.stringify(foreign.data), /private|hiddenAt/);
});

test("delete preserves sanitized forbidden and deployment failures rather than claiming success", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const status of [403, 404, 503]) {
    state.failures.set(deletePath, { status, body: { error: "MOBILE_PUSH_UNAVAILABLE", token: "private", sql: "private" } });
    const response = await jsonRequest(baseUrl, scopedDeletePath, "DELETE");
    assert.equal(response.response.status, status);
    assert.equal(errorCode(response.data), "MOBILE_PUSH_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(response.data), /private|token|sql|deleted/);
  }
});