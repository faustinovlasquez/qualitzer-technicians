import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, jsonRequest } from "./mock-upstream";

const input = { companyBranchId: 1, requestId: "f14191fb-e73a-4d92-91b9-bf3fa38a2df1", client: "MOBILE", deliveries: [{ id: 5, version: 2 }], location: { status: "UNAVAILABLE", reason: "PERMISSION_DENIED" } };
const acknowledgement = { requestId: input.requestId, userId: 9, confirmedAt: "2026-09-29T12:00:00.000Z", client: "MOBILE", method: "AUTHENTICATED_RECIPIENT", location: input.location };
const result = { companyBranchId: 1, requestId: input.requestId, receipts: [{ id: 5, version: 3, acknowledgement }] };
const endpoint = "/api/material-receipts";
const backend = "/api/inventory_consumptions_v2/my-receipts";

test("real gateway forwards own material confirmation once with original UUID and no signature", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set(backend, { status: 200, body: { items: [], hasMore: false } });
  state.failures.set(`${backend}/confirm`, { status: 200, body: result });
  assert.equal((await jsonRequest(baseUrl, `${endpoint}?companyBranchId=1`)).response.status, 200);
  const confirmed = await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", input);
  assert.equal(confirmed.response.status, 200);
  assert.match(confirmed.response.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(confirmed.data, result);
  const writes = state.calls.filter(call => call.path === `${backend}/confirm`);
  assert.equal(writes.length, 1);
  assert.ok(writes[0]);
  assert.deepEqual(writes[0].json, input);
});

test("gateway rejects unauthenticated, foreign-branch, non-worker and forged actor requests before forwarding", async context => {
  const { state, baseUrl } = await harness(context);
  state.calls.length = 0;
  assert.equal((await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", input, null)).response.status, 401);
  assert.equal((await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", { ...input, userId: 99 })).response.status, 400);
  assert.equal((await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", { ...input, companyBranchId: 2 })).response.status, 403);
  assert.equal((await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", { ...input, client: "WEB" })).response.status, 400);
  state.user.workerId = null;
  assert.equal((await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", input)).response.status, 403);
  assert.equal(state.calls.filter(call => call.path === `${backend}/confirm`).length, 0);
});

test("gateway preserves explicit conflicts and rejects acknowledgements for another recipient", async context => {
  const { state, baseUrl } = await harness(context);
  for (const error of ["CONSUMPTION_VERSION_CONFLICT", "CONSUMPTION_RECEIPT_LOCATION_EXPIRED", "CONSUMPTION_REQUEST_ID_REUSED"]) {
    state.failures.set(`${backend}/confirm`, { status: 409, body: { error } });
    const rejected = await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", input);
    assert.equal(rejected.response.status, 409);
    assert.deepEqual(rejected.data, { error });
  }
  state.failures.set(`${backend}/confirm`, { status: 200, body: { ...result, receipts: [{ ...result.receipts[0], acknowledgement: { ...acknowledgement, userId: 99 } }] } });
  assert.equal((await jsonRequest(baseUrl, `${endpoint}/confirm`, "POST", input)).response.status, 502);
  state.failures.set(backend, { status: 200, body: { items: [], hasMore: false, netCost: 100 } });
  assert.equal((await jsonRequest(baseUrl, `${endpoint}?companyBranchId=1`)).response.status, 502);
});