import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentsSchema } from "../contracts";
import { assignments, group, RANGE, work } from "./fixtures";
import { assignmentCalls, errorCode, gatewayHarness, harness, jsonRequest, loginGateway, mockBackend, writeCalls } from "./mock-upstream";

function maintenance13() {
  return group({
    id: "maintenance-50", type: "internal_maintenance", code: "PREVENTIVO-0050", maintenanceType: "preventivo",
    works: Array.from({ length: 13 }, (_, index) => work({
      id: String(701 + index), title: `Trabajo de mantenimiento ${index + 1}`,
      scheduledDate: "2026-08-31", isOverdue: true,
      responsibles: index < 2 ? [{ id: 42, name: "Técnico" }] : [],
    })),
  });
}

const listPath = `/api/assignments?${RANGE}`;
const workPath = (groupId = "maintenance-50", workId = "713", suffix = "/files") => `/api/assignments/${groupId}/works/${workId}${suffix}?${RANGE}`;

test("canonical maintenance returns all 13 works: 2 explicit and 11 inherited, including overdue work", async (t) => {
  const { baseUrl, state } = await harness(t);
  const maintenance = maintenance13();
  state.assignments = assignments([maintenance]);
  const response = await jsonRequest(baseUrl, listPath);
  const data = assignmentsSchema.parse(response.data);
  assert.equal(response.response.status, 200);
  assert.equal(maintenance.works.filter((item) => item.responsibles.length > 0).length, 2);
  assert.equal(data.groups[0]?.works.filter((item) => item.responsibles.length === 0).length, 11);
  assert.deepEqual(data.groups[0]?.works.map((item) => item.id), maintenance.works.map((item) => item.id));
  assert.deepEqual(data.summary, { totalGroups: 1, totalWorks: 13, activeWorks: 13, overdueWorks: 13, plannedMinutes: 780 });
  assert.equal(data.groups[0]?.canManage, false);
  assert.ok(data.groups[0]?.works.every((item) => item.canEditDefinition === false));
  const read = assignmentCalls(state)[0]!;
  assert.deepEqual(Object.fromEntries(read.query), Object.fromEntries(new URLSearchParams(RANGE)));
  assert.equal(read.headers.origin, "http://localhost:3000");
});

test("an inherited work can be read and mutated individually, but absent group or work IDs cannot", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([maintenance13()]);
  assert.equal((await jsonRequest(baseUrl, workPath())).response.status, 200);
  assert.equal((await jsonRequest(baseUrl, workPath("maintenance-50", "713", "/status"), "POST", { status: "paused" })).response.status, 200);
  assert.deepEqual(writeCalls(state).map((call) => call.json), [{ workId: 713, maintenanceWorkId: 713, sourceType: "maintenance", status: "paused" }]);
  state.calls.length = 0;
  for (const [groupId, workId] of [["maintenance-51", "713"], ["maintenance-50", "714"], ["direct-713", "713"]]) {
    for (const suffix of ["/files", "/status", "/report"]) {
      const method = suffix === "/files" ? "GET" : "POST";
      const body = suffix === "/status" ? { status: "paused" } : suffix === "/report" ? { note: "No autorizado" } : undefined;
      const result = await jsonRequest(baseUrl, workPath(groupId, workId, suffix), method, body);
      assert.equal(result.response.status, 404);
      assert.equal(errorCode(result.data), "ASSIGNMENT_NOT_FOUND");
    }
  }
  state.assignments.groups[0]!.works = state.assignments.groups[0]!.works.filter((item) => item.id !== "713");
  assert.equal((await jsonRequest(baseUrl, workPath())).response.status, 404);
  assert.equal(writeCalls(state).length, 0);
});

test("activity, planning and nonproductive canonical assignments do not require current worker in responsibles", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const assigned of [
    group({ id: "external-300", type: "external_ot", works: [work({ responsibles: [{ id: 84, name: "Otro responsable" }] })] }),
    group({ id: "direct-11", works: [work({ responsibles: [] })] }),
    group({ id: "direct-np-11", isResponsible: false, works: [work({ workType: "non_productive", responsibles: [] })] }),
  ]) {
    state.assignments = assignments([assigned]);
    const result = assignmentsSchema.parse((await jsonRequest(baseUrl, listPath)).data);
    assert.equal(result.summary.totalWorks, 1);
    assert.equal(result.groups[0]?.isResponsible, assigned.isResponsible);
    assert.equal((await jsonRequest(baseUrl, workPath(assigned.id, "11", "/status"), "POST", { status: "paused" })).response.status, 200);
  }
  assert.equal(writeCalls(state).length, 3);
  assert.ok(writeCalls(state).every((call) => call.path === "/api/technician-dashboard/update-work-status"));
});

test("canonical membership still requires matching authenticated technician on every list, read and mutation", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const id of [84, null]) {
    state.assignments = assignments([maintenance13()]);
    state.assignments.technician.id = id;
    for (const [path, method, body] of [[listPath, "GET", undefined], [workPath(), "GET", undefined], [workPath("maintenance-50", "713", "/status"), "POST", { status: "paused" }]] as const) {
      const result = await jsonRequest(baseUrl, path, method, body);
      assert.equal(result.response.status, 403);
      assert.equal(errorCode(result.data), "WORKER_MISMATCH");
    }
  }
  assert.equal(writeCalls(state).length, 0);
  assert.ok(state.calls.every((call) => ["/api/auth/me", "/api/technician-dashboard/assignments"].includes(call.path)));
});

test("ambiguous duplicate groups or work IDs never authorize a backend route", async (t) => {
  const { baseUrl, state } = await harness(t);
  const maintenance = maintenance13();
  for (const groups of [[maintenance, maintenance], [group({ ...maintenance, works: [maintenance.works[12]!, maintenance.works[12]!] })]]) {
    state.assignments = assignments(groups);
    assert.equal((await jsonRequest(baseUrl, workPath())).response.status, 404);
    assert.equal((await jsonRequest(baseUrl, workPath("maintenance-50", "713", "/status"), "POST", { status: "paused" })).response.status, 404);
  }
  assert.equal(writeCalls(state).length, 0);
});

test("inherited canonical membership is tenant-bound even when worker and work identifiers coincide", async (t) => {
  const a = await mockBackend(t, { assignments: assignments([maintenance13()]) });
  const b = await mockBackend(t, { assignments: assignments([]) });
  const { baseUrl } = await gatewayHarness(t, { tenants: [
    { id: "tenant-a", name: "A", backendUrl: a.backendUrl, tenantOrigin: "http://a.localhost:3000", environment: "development", enabled: true },
    { id: "tenant-b", name: "B", backendUrl: b.backendUrl, tenantOrigin: "http://b.localhost:3000", environment: "development", enabled: true },
  ] });
  const loginA = await loginGateway(baseUrl, "tenant-a");
  const loginB = await loginGateway(baseUrl, "tenant-b");
  a.state.calls.length = b.state.calls.length = 0;
  const accepted = await jsonRequest(baseUrl, workPath("maintenance-50", "713", "/status"), "POST", { status: "paused" }, loginA.token);
  assert.equal(accepted.response.status, 200);
  assert.equal(b.state.calls.length, 0);
  const aCalls = a.state.calls.length;
  const denied = await jsonRequest(baseUrl, workPath("maintenance-50", "713", "/status"), "POST", { status: "paused" }, loginB.token);
  assert.equal(denied.response.status, 404);
  assert.equal(a.state.calls.length, aCalls);
  assert.equal(writeCalls(b.state).length, 0);
  assert.ok(a.state.calls.every((call) => call.headers.origin === "http://a.localhost:3000"));
  assert.ok(b.state.calls.every((call) => call.headers.origin === "http://b.localhost:3000"));
});

test("assignment contracts retain public code metadata and total times while stripping nested costs", async (t) => {
  const { baseUrl, state } = await harness(t);
  const metadata = {
    negotiationCode: "COT-SER-0017", businessModality: "FORMAL_QUOTE", businessTypeName: "service", negotiationCorrelative: 17,
    workOrderNumber: 81, workOrderInternalNumber: 3, isWorkOrderInternal: false,
  };
  state.invalidAssignments = { ...assignments(), groups: [{ ...group(), ...metadata, works: [{ ...work(), totalPlannedMinutes: 120, totalExecutedMinutes: 360, netCostHH: 500 }] }] };
  const result = await jsonRequest(baseUrl, listPath);
  const parsed = assignmentsSchema.parse(result.data);
  assert.equal(result.response.status, 200);
  for (const [key, value] of Object.entries(metadata)) assert.equal(Reflect.get(parsed.groups[0]!, key), value);
  assert.equal(parsed.groups[0]?.works[0]?.totalPlannedMinutes, 120);
  assert.equal(parsed.groups[0]?.works[0]?.totalExecutedMinutes, 360);
  assert.doesNotMatch(JSON.stringify(result.data), /netCostHH/);
  const emptyMetadata = { negotiationCode: null, businessModality: null, businessTypeName: null, negotiationCorrelative: null, workOrderNumber: null, workOrderInternalNumber: null, isWorkOrderInternal: null };
  const nullable = assignmentsSchema.parse(assignments([{ ...group(), ...emptyMetadata }]));
  for (const key of Object.keys(emptyMetadata)) assert.equal(Reflect.get(nullable.groups[0]!, key), null);
  const legacy = assignmentsSchema.parse(assignments());
  assert.equal(legacy.groups[0]?.negotiationCode, undefined);
  assert.equal(legacy.groups[0]?.works[0]?.totalPlannedMinutes, undefined);
});