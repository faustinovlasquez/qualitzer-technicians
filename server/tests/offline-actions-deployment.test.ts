import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import express from "express";
import { z } from "zod";
import { syncAnswerSchema, syncCommandSchema } from "../../src/domain/offlineProtocol";
import { errorHandler } from "../errors";
import { assignmentCalls, errorCode, harness, jsonRequest, writeCalls } from "./mock-upstream";

const operationId = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
const scope = { groupId: "direct-11", workId: "11", companyBranchId: 1, startDate: "2026-09-08", endDate: "2026-09-08" };
const timer = { operationId, kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" } };
const checklist = { operationId, kind: "checklist", scope, payload: { checklistId: 41 } };
const answer = syncAnswerSchema.parse({});
const legacy = [
  { operationId, kind: "comment", scope, payload: { text: "Keep comment" } },
  { operationId, kind: "answer", scope, payload: { stepId: "21", answer, base: answer } },
];
const upstreamPath = "/api/mobile-sync/commands";
const deploymentCode = "MOBILE_SYNC_ACTIONS_UNAVAILABLE";

test("legacy comment/answer-only gateway schema emits the actual INVALID_INPUT middleware code", async (t) => {
  const legacySchema = z.discriminatedUnion("kind", [syncCommandSchema.options[0], syncCommandSchema.options[1]]);
  const app = express();
  app.use(express.json());
  app.post("/commands", (req, res) => { res.json(legacySchema.parse(req.body)); });
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
  }));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  for (const command of [timer, checklist, ...legacy]) {
    const response: Awaited<ReturnType<typeof fetch>> = await fetch(`http://127.0.0.1:${address.port}/commands`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
    });
    if (command.kind === "timer" || command.kind === "checklist") {
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "INVALID_INPUT" });
    } else {
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), syncCommandSchema.parse(command));
    }
  }
});

for (const command of [timer, checklist]) {
  test(`${command.kind}: upgraded gateway exposes old backend unsupported-kind as deployment 503 without fallback`, async (t) => {
    const { state, baseUrl } = await harness(t);
    state.failures.set(upstreamPath, { status: 400, body: { error: "MOBILE_SYNC_INVALID_KIND" } });
    const first = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
    assert.equal(first.response.status, 503); assert.deepEqual(first.data, { error: deploymentCode });
    assert.equal(first.response.headers.get("retry-after"), "60");
    assert.equal(first.response.headers.get("cache-control"), "no-store");
    assert.equal(writeCalls(state).length, 1); assert.equal(assignmentCalls(state).length, 0);
    const sent = writeCalls(state)[0]!;
    assert.equal(sent.path, upstreamPath); assert.equal(sent.method, "POST");
    assert.deepEqual(sent.json, syncCommandSchema.parse(command));
    state.failures.set(upstreamPath, { status: 200, body: { operationId, state: "applied" } });
    const second = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
    assert.equal(second.response.status, 200); assert.deepEqual(second.data, { operationId, state: "applied" });
    assert.deepEqual(writeCalls(state)[1]?.json, sent.json);
    assert.equal(writeCalls(state).length, 2); assert.equal(assignmentCalls(state).length, 0);
  });

  test(`${command.kind}: upgraded gateway never turns generic backend validation/auth/conflict into unsupported action`, async (t) => {
    const { state, baseUrl } = await harness(t);
    for (const [status, code, expected] of [
      [400, "INVALID_INPUT", "UPSTREAM_REJECTED"],
      [400, "VALIDATION_ERROR", "UPSTREAM_REJECTED"],
      [400, "OTHER_400", "UPSTREAM_REJECTED"],
      [400, "MOBILE_SYNC_INVALID_INPUT", "MOBILE_SYNC_INVALID_INPUT"],
      [400, "MOBILE_SYNC_INVALID_STATUS", "MOBILE_SYNC_INVALID_STATUS"],
      [400, "MOBILE_SYNC_INVALID_CHECKLIST", "MOBILE_SYNC_INVALID_CHECKLIST"],
      [400, "MOBILE_SYNC_OPERATION_REUSED", "MOBILE_SYNC_OPERATION_REUSED"],
      [403, "MOBILE_SYNC_INVALID_KIND", "MOBILE_SYNC_INVALID_KIND"],
      [409, "MOBILE_SYNC_INVALID_KIND", "MOBILE_SYNC_INVALID_KIND"],
      [409, "MOBILE_SYNC_OPERATION_REUSED", "MOBILE_SYNC_OPERATION_REUSED"],
      [401, "MOBILE_SYNC_INVALID_KIND", "UNAUTHORIZED"],
    ] as const) {
      state.failures.set(upstreamPath, { status, body: { error: code } });
      const before = writeCalls(state).length;
      const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
      assert.equal(result.response.status, status); assert.equal(errorCode(result.data), expected);
      assert.equal(result.response.headers.get("retry-after"), null);
      assert.equal(writeCalls(state).length, before + 1);
    }
  });

  test(`${command.kind}: receipt authority wins even when rejection says unsupported kind`, async (t) => {
    const { state, baseUrl } = await harness(t);
    for (const [status, receiptState, error, expectedState] of [
      [400, "rejected", "MOBILE_SYNC_INVALID_KIND", "rejected"],
      [200, "rejected", "MOBILE_SYNC_INVALID_KIND", "rejected"],
      [400, "rejected", "MOBILE_SYNC_OPERATION_REUSED", "needs_review"],
      [409, "conflict", "MOBILE_SYNC_STATUS_CONFLICT", "conflict"],
      [409, "conflict", "MOBILE_SYNC_OPERATION_REUSED", "needs_review"],
      [409, "needs_review", "MOBILE_SYNC_REQUIRES_REVIEW", "needs_review"],
      [409, "in_progress", "MOBILE_SYNC_IN_PROGRESS", "in_progress"],
    ] as const) {
      state.failures.set(upstreamPath, { status, body: { operationId, state: receiptState, error } });
      const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
      assert.equal(result.response.status, status);
      assert.deepEqual(result.data, { operationId, state: expectedState, error });
      assert.equal(result.response.headers.get("retry-after"), receiptState === "in_progress" ? "5" : null);
    }
    assert.equal(writeCalls(state).length, 7);
  });

  test(`${command.kind}: malformed receipt with unsupported-kind code is not recast as deployment`, async (t) => {
    const { state, baseUrl } = await harness(t);
    for (const body of [
      { operationId: "52b5201d-4ea9-4dad-9f9d-191d11ea8462", state: "rejected", error: "MOBILE_SYNC_INVALID_KIND" },
      { operationId, state: "unknown", error: "MOBILE_SYNC_INVALID_KIND" },
    ]) {
      state.failures.set(upstreamPath, { status: 400, body });
      const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
      assert.equal(result.response.status, 502); assert.equal(errorCode(result.data), "UPSTREAM_INVALID_RESPONSE");
      assert.equal(result.response.headers.get("retry-after"), null);
    }
  });

  test(`${command.kind}: schema and actor validation remain outside deployment remapping`, async (t) => {
    const { state, baseUrl } = await harness(t);
    state.failures.set(upstreamPath, { status: 400, body: { error: "MOBILE_SYNC_INVALID_KIND" } });
    const invalid = await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...command, payload: { ...command.payload, userId: 99 } });
    assert.equal(invalid.response.status, 400); assert.equal(errorCode(invalid.data), "INVALID_INPUT");
    assert.equal(invalid.response.headers.get("retry-after"), null);
    const branch = await jsonRequest(baseUrl, "/api/offline/commands", "POST", { ...command, scope: { ...scope, companyBranchId: 2 } });
    assert.equal(branch.response.status, 403); assert.notEqual(errorCode(branch.data), deploymentCode);
    state.failures.set("/api/auth/me", { status: 400, body: { error: "MOBILE_SYNC_INVALID_KIND" } });
    const actor = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
    assert.equal(actor.response.status, 400); assert.equal(errorCode(actor.data), "UPSTREAM_REJECTED");
    assert.equal(actor.response.headers.get("retry-after"), null); assert.equal(writeCalls(state).length, 0);
  });
}

test("historical comment/answer and receipt GET unsupported-kind responses remain unchanged", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set(upstreamPath, { status: 400, body: { error: "MOBILE_SYNC_INVALID_KIND" } });
  for (const command of legacy) {
    const result = await jsonRequest(baseUrl, "/api/offline/commands", "POST", command);
    assert.equal(result.response.status, 400); assert.equal(errorCode(result.data), "MOBILE_SYNC_INVALID_KIND");
    assert.equal(result.response.headers.get("retry-after"), null);
  }
  state.failures.set(`/api/mobile-sync/receipts/${operationId}`, { status: 400, body: { error: "MOBILE_SYNC_INVALID_KIND" } });
  const receipt = await jsonRequest(baseUrl, `/api/offline/receipts/${operationId}?companyBranchId=1`);
  assert.equal(receipt.response.status, 400); assert.equal(errorCode(receipt.data), "MOBILE_SYNC_INVALID_KIND");
  assert.equal(writeCalls(state).length, 2); assert.equal(assignmentCalls(state).length, 0);
});