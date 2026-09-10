import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { assignments, group, RANGE, work } from "./fixtures";
import { harness, jsonRequest } from "./mock-upstream";

const root = "/api/technician-dashboard/panel/direct-11/works/11/checklists";
const path = (suffix = "", range = RANGE) => `/api/assignments/direct-11/works/11/checklists${suffix}?${range}`;
const page = { items: [{ id: 91, name: "Seguridad", code: "SEG", description: null, alreadyAssigned: false }], page: 0, pageSize: 20, hasMore: false };

async function setup(t: TestContext) {
  const result = await harness(t);
  result.state.failures.set(`${root}/options`, { status: 200, body: page });
  result.state.failures.set(root, { status: 201, body: { checklistId: 91, alreadyAssigned: false } });
  return result;
}

test("catalog uses fresh actor and canonical work, bounded search/page and financial field allowlist", async (t) => {
  const { state, baseUrl } = await setup(t);
  state.failures.set(`${root}/options`, { status: 200, body: { ...page, page: 2, cost: 400, items: [{ ...page.items[0], price: 300 }] } });
  const result = await jsonRequest(baseUrl, path("/options", `${RANGE}&search=Motor&page=2`));
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(result.data, { ...page, page: 2 });
  const call = state.calls.at(-1)!;
  assert.equal(call.path, `${root}/options`);
  assert.equal(call.query.get("groupType"), "direct_assignment");
  assert.equal(call.query.get("search"), "Motor");
  assert.equal(call.query.get("page"), "2");
  assert.ok(state.calls.some((entry) => entry.path === "/api/auth/me"));
  assert.ok(state.calls.some((entry) => entry.path === "/api/technician-dashboard/assignments"));
  assert.equal(state.calls.filter((entry) => entry.method !== "GET").length, 0);
});

test("attach is additive and sends only master ID with canonical source; parent completion is not a child lock", async (t) => {
  const { state, baseUrl } = await setup(t);
  state.assignments = assignments([group({ status: "completed", works: [work({ canEditDefinition: false, canExecute: false })] })]);
  const result = await jsonRequest(baseUrl, path(), "POST", { checklistId: 91 });
  assert.equal(result.response.status, 201);
  const writes = state.calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.path, root);
  assert.deepEqual(writes[0]!.json, { checklistId: 91 });
  assert.equal(writes[0]!.query.get("groupType"), "direct_assignment");
  state.failures.set(root, { status: 200, body: { checklistId: 91, alreadyAssigned: true } });
  const replay = await jsonRequest(baseUrl, path(), "POST", { checklistId: 91 });
  assert.equal(replay.response.status, 200);
  assert.deepEqual(replay.data, { checklistId: 91, alreadyAssigned: true });
});

test("gateway rejects unassigned IDs, wrong worker or branch and terminal children before mutation", async (t) => {
  const { state, baseUrl } = await setup(t);
  for (const current of [assignments([]), assignments([group({ works: [work({ id: "12" })] })]), assignments([group({ works: [work({ status: "completed" })] })])]) {
    state.assignments = current; state.calls.length = 0;
    const result = await jsonRequest(baseUrl, path(), "POST", { checklistId: 91 });
    assert.ok([404, 409].includes(result.response.status));
    assert.equal(state.calls.some((call) => call.method !== "GET"), false);
  }
  state.assignments = assignments(); state.assignments.technician.id = 999;
  assert.equal((await jsonRequest(baseUrl, path(), "POST", { checklistId: 91 })).response.status, 403);
  state.assignments = assignments();
  assert.equal((await jsonRequest(baseUrl, path("", RANGE.replace("companyBranchId=1", "companyBranchId=2")), "POST", { checklistId: 91 })).response.status, 403);
});

test("strict query/body reject forged source, local IDs, responses and unbounded pages without upstream calls", async (t) => {
  const { state, baseUrl } = await setup(t);
  for (const suffix of ["&page=1001", "&page=-1", "&search=x&search=y", "&groupType=internal_maintenance", "&checklistIds=91"]) {
    state.calls.length = 0;
    assert.equal((await jsonRequest(baseUrl, path("/options", RANGE + suffix))).response.status, 400);
    assert.equal(state.calls.length, 0);
  }
  for (const body of [{ checklistId: "91" }, { checklistId: 91, responses: [] }, { checklistId: 91, companyBranchId: 2 }]) {
    state.calls.length = 0;
    assert.equal((await jsonRequest(baseUrl, path(), "POST", body)).response.status, 400);
    assert.equal(state.calls.length, 0);
  }
  assert.equal((await jsonRequest(baseUrl, path().replace("works/11", "works/local-uuid"), "POST", { checklistId: 91 })).response.status, 400);
});

test("catalog requires session and never falls back after upstream invalid/revoked master", async (t) => {
  const { state, baseUrl } = await setup(t);
  assert.equal((await jsonRequest(baseUrl, path("/options"), "GET", undefined, null)).response.status, 401);
  state.failures.set(`${root}/options`, { status: 200, body: { ...page, page: 1 } });
  assert.equal((await jsonRequest(baseUrl, path("/options"))).response.status, 502);
  state.failures.set(root, { status: 404, body: { error: "CHECKLIST_ASSIGNMENT_MASTER_NOT_FOUND" } });
  assert.equal((await jsonRequest(baseUrl, path(), "POST", { checklistId: 91 })).response.status, 404);
  state.failures.set(root, { status: 200, body: { checklistId: 999, alreadyAssigned: false } });
  assert.equal((await jsonRequest(baseUrl, path(), "POST", { checklistId: 91 })).response.status, 502);
});

test("maintenance and external IDs use exact canonical route instead of a guessed standard mirror", async (t) => {
  const { state, baseUrl } = await setup(t);
  for (const current of [group({ id: "maintenance-50", type: "internal_maintenance" }), group({ id: "external-300", type: "external_ot" })]) {
    state.assignments = assignments([current]);
    const target = `/api/technician-dashboard/panel/${current.id}/works/11/checklists`;
    state.failures.set(target, { status: 201, body: { checklistId: 91, alreadyAssigned: false } });
    const result = await jsonRequest(baseUrl, path().replace("direct-11", current.id), "POST", { checklistId: 91 });
    assert.equal(result.response.status, 201);
    assert.equal(state.calls.at(-1)!.path, target);
    assert.equal(state.calls.at(-1)!.query.get("groupType"), current.type);
  }
});