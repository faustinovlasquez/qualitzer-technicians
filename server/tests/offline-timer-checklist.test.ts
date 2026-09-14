import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptForOperation, syncCommandSchema, syncErrorSchema, syncReceiptSchema } from "../../src/domain/offlineProtocol";
import { TOKEN } from "./fixtures";
import { assignmentCalls, harness, jsonRequest, writeCalls } from "./mock-upstream";

const operationId = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
const scope = { groupId: "direct-11", workId: "11", companyBranchId: 1, startDate: "2026-09-01", endDate: "2026-09-07" };
const timer = { operationId, kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" } };
const checklist = { operationId, kind: "checklist", scope, payload: { checklistId: 41 } };
const commandsPath = "/api/mobile-sync/commands";

test("timer/checklist schema is additive, strict and normalizes only historical UUID/scope fields", () => {
  for (const command of [timer, checklist]) {
    assert.deepEqual(syncCommandSchema.parse({ ...command, operationId: operationId.toUpperCase() }), {
      ...command, scope: { ...scope, workId: 11 },
    });
    for (const groupId of ["external-8", "maintenance-7", "direct-11", "direct-np-11"]) {
      assert.equal(syncCommandSchema.safeParse({ ...command, scope: { ...scope, groupId } }).success, true);
      const { workId: _workId, ...rootScope } = scope;
      assert.equal(syncCommandSchema.safeParse({ ...command, scope: { ...rootScope, groupId } }).success, false);
    }
    for (const key of ["userId", "workerId", "tenant", "steps", "definition"]) {
      assert.equal(syncCommandSchema.safeParse({ ...command, [key]: 99 }).success, false);
      assert.equal(syncCommandSchema.safeParse({ ...command, scope: { ...scope, [key]: 99 } }).success, false);
      assert.equal(syncCommandSchema.safeParse({ ...command, payload: { ...command.payload, [key]: 99 } }).success, false);
    }
  }
  for (const status of ["pending", "completed", "delivered", "IN_PROGRESS", null, undefined, 1]) {
    assert.equal(syncCommandSchema.safeParse({ ...timer, payload: { ...timer.payload, status } }).success, false);
  }
  for (const baseStatus of ["completed", "delivered", "PENDING", null, undefined, 1]) {
    assert.equal(syncCommandSchema.safeParse({ ...timer, payload: { ...timer.payload, baseStatus } }).success, false);
  }
  for (const checklistId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "41", "041", null, undefined, true]) {
    assert.equal(syncCommandSchema.safeParse({ ...checklist, payload: { checklistId } }).success, false);
  }
  for (const key of ["elapsedSeconds", "clientSeconds", "changedAt", "executionStartTime", "executionEndTime", "executionDates", "isManual", "sourceType", "maintenanceWorkId"]) {
    assert.equal(syncCommandSchema.safeParse({ ...timer, payload: { ...timer.payload, [key]: 1 } }).success, false);
  }
});

test("new commands preserve byte normalization for historical comment and answer payloads", () => {
  const envelope = { operationId, scope: { ...scope, workId: 11 } };
  const comment = syncCommandSchema.parse({ ...envelope, kind: "comment", payload: { text: "  texto  " } });
  assert.equal(JSON.stringify(comment), JSON.stringify({ operationId, kind: "comment", scope: envelope.scope, payload: { text: "texto" } }));
  const empty = { isCompleted: null, responseValue: "", selectValue: "", optionsSelectValue: [], comment: "" };
  const answer = syncCommandSchema.parse({ ...envelope, kind: "answer", payload: { stepId: "21", answer: { isCompleted: false }, base: {} } });
  assert.equal(JSON.stringify(answer), JSON.stringify({ operationId, kind: "answer", scope: envelope.scope, payload: { stepId: 21, answer: { ...empty, isCompleted: false }, base: empty } }));
});

test("offline forwards timer/checklist only through backend receipts without gateway assignment ownership or fallback", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.assignments.groups = [];
  state.failures.set(commandsPath, { status: 200, body: { operationId, state: "applied" } });
  for (const command of [timer, checklist]) {
    const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.data, { operationId, state: "applied" });
    assert.deepEqual(writeCalls(state).at(-1)?.json, syncCommandSchema.parse(command));
  }
  assert.equal(assignmentCalls(state).length, 0);
  assert.equal(writeCalls(state).length, 2);
  assert.ok(writeCalls(state).every((call) => call.path === commandsPath && call.headers.authorization === TOKEN));
});

test("offline checks actor/branch and rejects untrusted timer/checklist fields before forwarding", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const command of [timer, checklist]) {
    assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...command, scope: { ...scope, companyBranchId: 2 } })).response.status, 403);
    for (const patch of [{ workId: "01" }, { groupId: "local-11" }, { companyBranchId: "1" }, { startDate: "2026-02-30" }, { endDate: "2027-01-01" }]) {
      assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...command, scope: { ...scope, ...patch } })).response.status, 400);
    }
  }
  state.user.workerId = null;
  assert.equal((await jsonRequest(baseUrl, "/api/offline/commands", "POST", timer)).response.status, 403);
  assert.equal(writeCalls(state).length, 0);
});

test("new error allowlist preserves backend terminal receipts and strips unknown fields", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const [status, receiptState, error] of [
    [409, "conflict", "MOBILE_SYNC_STATUS_CONFLICT"],
    [400, "rejected", "MOBILE_SYNC_INVALID_STATUS"],
    [400, "rejected", "MOBILE_SYNC_INVALID_CHECKLIST"],
    [409, "needs_review", "MOBILE_SYNC_REQUIRES_REVIEW"],
  ] as const) {
    assert.equal(syncErrorSchema.safeParse(error).success, true);
    state.failures.set(commandsPath, { status, body: { operationId, state: receiptState, error, sql: "SECRET", token: "SECRET" } });
    const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", timer);
    assert.equal(result.response.status, status);
    assert.deepEqual(result.data, { operationId, state: receiptState, error });
    assert.equal(result.response.headers.get("cache-control"), "no-store");
  }
  assert.equal(syncErrorSchema.safeParse("MOBILE_SYNC_ARBITRARY_SECRET").success, false);
  assert.deepEqual(syncReceiptSchema.parse({ operationId, state: "applied" }), { operationId, state: "applied" });
  assert.equal(writeCalls(state).length, 4);
});

test("offline does not retry ambiguous new command responses or manufacture local receipts", async (t) => {
  const { state, baseUrl } = await harness(t);
  for (const command of [timer, checklist]) {
    for (const failure of [
      { status: 503, body: { error: "MOBILE_SYNC_UNAVAILABLE" } },
      { status: 409, body: { error: "UNKNOWN" } },
      { status: 200, body: { operationId: "52b5201d-4ea9-4dad-9f9d-191d11ea8462", state: "applied" } },
    ]) {
      state.failures.set(commandsPath, failure);
      const before = writeCalls(state).length;
      const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
      assert.ok(result.response.status >= 400);
      assert.equal(syncReceiptSchema.safeParse(result.data).success, false);
      assert.equal(writeCalls(state).length, before + 1);
    }
  }
  assert.deepEqual(receiptForOperation({ operationId, state: "conflict", error: "MOBILE_SYNC_OPERATION_REUSED" }, operationId, 409), {
    operationId, state: "needs_review", error: "MOBILE_SYNC_OPERATION_REUSED",
  });
  assert.equal(assignmentCalls(state).length, 0);
});