import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { assignments, group, RANGE, work } from "./fixtures";
import { errorCode, harness, jsonRequest } from "./mock-upstream";

const root = "/api/technician-dashboard/panel/direct-11/works/11/team";
const path = (suffix = "", range = RANGE) => `/api/assignments/direct-11/works/11/team${suffix}?${range}`;
const member = (id: number, name: string, isCurrentUser = false) => ({ id, name, avatarColor: null, avatarThumbnail: null, isCurrentUser });
const team = { members: [member(42, "Técnico Prueba", true)], candidates: [member(42, "Técnico Prueba", true), member(43, "Ana Pérez")] };

async function setup(t: TestContext) {
  const result = await harness(t);
  result.state.failures.set(root, { status: 200, body: team });
  result.state.failures.set(`${root}/43`, { status: 200, body: team });
  return result;
}

test("lee el equipo con el alcance del trabajo asignado y sin escrituras", async (t) => {
  const { state, baseUrl } = await setup(t);
  const result = await jsonRequest(baseUrl, path());
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, team);
  const call = state.calls.at(-1)!;
  assert.equal(call.path, root);
  assert.equal(call.query.get("groupType"), "direct_assignment");
  assert.equal(call.query.get("companyBranchId"), "1");
  assert.ok(state.calls.some((entry) => entry.path === "/api/technician-dashboard/assignments"));
  assert.equal(state.calls.filter((entry) => entry.method !== "GET").length, 0);
});

test("agregar y quitar envían solo el técnico y devuelven el equipo validado", async (t) => {
  const { state, baseUrl } = await setup(t);
  const added = await jsonRequest(baseUrl, path(), "POST", { workerId: 43 });
  assert.equal(added.response.status, 200);
  const writes = state.calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.path, root);
  assert.deepEqual(writes[0]!.json, { workerId: 43 });
  const removed = await jsonRequest(baseUrl, path("/43"), "DELETE");
  assert.equal(removed.response.status, 200);
  assert.equal(state.calls.at(-1)!.method, "DELETE");
  assert.equal(state.calls.at(-1)!.path, `${root}/43`);
});

test("rechaza cuerpos e IDs inválidos sin llamar al backend", async (t) => {
  const { state, baseUrl } = await setup(t);
  for (const body of [{ workerId: "43" }, { workerId: 0 }, { workerId: 43, extra: true }, {}]) {
    state.calls.length = 0;
    assert.equal((await jsonRequest(baseUrl, path(), "POST", body)).response.status, 400);
    assert.equal(state.calls.length, 0);
  }
  state.calls.length = 0;
  assert.equal((await jsonRequest(baseUrl, path("/abc"), "DELETE")).response.status, 400);
  assert.equal(state.calls.length, 0);
});

test("la sucursal puede desactivar «Asignar técnicos» y un trabajo terminado no cambia su equipo", async (t) => {
  const { state, baseUrl } = await setup(t);
  state.failures.set("/api/branches/1/mobileAppConfig", { status: 200, body: { mobileAppConfig: { workTeam: false } } });
  const denied = await jsonRequest(baseUrl, path(), "POST", { workerId: 43 });
  assert.equal(denied.response.status, 403);
  assert.equal(errorCode(denied.data), "BRANCH_APP_ACTION_DISABLED");
  assert.equal(state.calls.some((call) => call.method !== "GET"), false);
  state.failures.delete("/api/branches/1/mobileAppConfig");
});

test("un trabajo ajeno o terminado no llega al backend", async (t) => {
  const { state, baseUrl } = await setup(t);
  for (const current of [assignments([]), assignments([group({ works: [work({ id: "12" })] })]), assignments([group({ works: [work({ status: "completed" })] })])]) {
    state.assignments = current; state.calls.length = 0;
    const result = await jsonRequest(baseUrl, path(), "POST", { workerId: 43 });
    assert.ok([404, 409].includes(result.response.status));
    assert.equal(state.calls.some((call) => call.method !== "GET"), false);
  }
});

test("traduce los rechazos del backend y no acepta respuestas con otra forma", async (t) => {
  const { state, baseUrl } = await setup(t);
  state.failures.set(`${root}/43`, { status: 409, body: { error: "WORK_TEAM_LAST_MEMBER" } });
  const last = await jsonRequest(baseUrl, path("/43"), "DELETE");
  assert.equal(last.response.status, 409);
  assert.equal(errorCode(last.data), "WORK_TEAM_LAST_MEMBER");
  state.failures.set(root, { status: 200, body: { members: [{ id: "x" }], candidates: [] } });
  assert.equal((await jsonRequest(baseUrl, path())).response.status, 502);
  state.failures.set(root, { status: 404, body: "<html>Not found</html>" });
  const missing = await jsonRequest(baseUrl, path());
  assert.equal(missing.response.status, 503);
  assert.equal(errorCode(missing.data), "WORK_TEAM_NOT_AVAILABLE");
});
