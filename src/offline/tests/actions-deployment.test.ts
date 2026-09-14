/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { ZodError } from "zod";
import type { OfflineCommand, OfflineOperation } from "../../domain/offline";
import { syncAnswerSchema, syncCommandSchema } from "../../domain/offlineProtocol";
import type { HttpTechnicianRepository } from "../../infrastructure/HttpTechnicianRepository";
import { ApiError } from "../../infrastructure/errors";
import { isServiceFailure, requiresDeployment } from "../connection";
import { OfflineEngine } from "../engine";
import { checklistCatalogCacheKey } from "../queueIntentions";
import { updateState } from "../state";
import { assignmentsWithStep, fixture, user, uuid } from "./fakes";

const scope = { groupId: "direct-80", workId: "80", companyBranchId: 1, startDate: "2026-09-08", endDate: "2026-09-08" };
const timer: OfflineCommand = { operationId: uuid(1), kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" } };
const checklist: OfflineCommand = { operationId: uuid(2), kind: "checklist", scope, payload: { checklistId: 17 } };
const answer = syncAnswerSchema.parse({});
const legacy: OfflineCommand[] = [
  { operationId: uuid(3), kind: "comment", scope, payload: { text: "Keep comment" } },
  { operationId: uuid(4), kind: "answer", scope, payload: { stepId: "9", answer, base: answer } },
];
const deploymentCode = "MOBILE_SYNC_ACTIONS_UNAVAILABLE";
const legacyCodes = ["INVALID_INPUT", "MOBILE_SYNC_INVALID_KIND"] as const;
interface HttpCall { url: string; method: string; body: string | undefined; }

function repository(reply: (call: HttpCall) => Promise<Response>) {
  const path = resolve(__dirname, "../../infrastructure/HttpTechnicianRepository.ts");
  const requireSource = createRequire(path);
  const exports: { HttpTechnicianRepository?: new (baseUrl: string) => HttpTechnicianRepository } = {};
  const module = { exports };
  const calls: HttpCall[] = [];
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports, FormData, Blob, AbortController, Error, TypeError, setTimeout, clearTimeout, URLSearchParams,
    require: (id: string): unknown => id === "react-native" ? { Platform: { OS: "android" } }
      : id === "./photos" ? { uploadFetch: async (url: string, options: RequestInit) => {
        assert.ok(options.body === undefined || typeof options.body === "string");
        const call = { url, method: options.method ?? "GET", body: options.body };
        calls.push(call);
        return reply(call);
      } } : requireSource(id),
  });
  assert.ok(module.exports.HttpTechnicianRepository);
  const client = new module.exports.HttpTechnicianRepository("https://fixture.invalid");
  client.tenant = user.tenant;
  return { client, calls };
}

const apiFailure = (status: number, code: string) => (error: unknown): boolean => error instanceof ApiError && error.status === status && error.code === code;
const operation = (command: OfflineCommand): OfflineOperation => {
  assert.ok(command.kind === "timer" || command.kind === "checklist");
  const { operationId, ...input } = command;
  return { ...input, id: operationId, createdAt: 100, status: "pending", attempts: 0, nextAttemptAt: 0 };
};
const settle = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };

async function deploymentFixture() {
  const f = fixture();
  const data = assignmentsWithStep();
  data.groups[0]!.works[0]!.canExecute = true;
  await updateState(f.store, "a", (state) => {
    state.cache.push({ key: `assignments:${scope.startDate}`, json: JSON.stringify(data), fetchedAt: 100,
      coverage: { branchId: 1, date: scope.startDate, fetchedAt: 100 } });
    state.cache.push({ key: checklistCatalogCacheKey(scope, {}), fetchedAt: 100, json: JSON.stringify({
      items: [{ id: 17, name: "Available", code: null, description: null, alreadyAssigned: false }], page: 0, pageSize: 20, hasMore: false,
    }) });
  });
  return f;
}

for (const command of [timer, checklist]) {
  for (const code of legacyCodes) test(`${command.kind}: validated old gateway/backend ${code} becomes deployment-only 503`, async () => {
    const f = repository(async () => Response.json({ error: code, message: "SECRET" }, { status: 400 }));
    const before = structuredClone(command);
    await assert.rejects(f.client.offlineCommand(command), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503); assert.equal(error.code, deploymentCode);
      assert.equal(requiresDeployment(error.code), true); assert.equal(isServiceFailure(error), true);
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
    assert.deepEqual(command, before);
    assert.deepEqual(f.calls, [{ url: "https://fixture.invalid/api/offline/commands", method: "POST", body: JSON.stringify(syncCommandSchema.parse(command)) }]);
  });

  test(`${command.kind}: upgraded gateway deployment code is retained`, async () => {
    const f = repository(async () => Response.json({ error: deploymentCode }, { status: 503 }));
    await assert.rejects(f.client.offlineCommand(command), apiFailure(503, deploymentCode));
    assert.equal(f.calls.length, 1);
  });

  test(`${command.kind}: local schema failure cannot become a deployment retry or reach HTTP`, async () => {
    const f = repository(async () => Response.json({ error: "INVALID_INPUT" }, { status: 400 }));
    const invalid = { ...command, scope: { ...scope, workId: "local-80" } };
    await assert.rejects(f.client.offlineCommand(invalid), (error: unknown) => error instanceof ZodError);
    assert.equal(f.calls.length, 0);
  });

  test(`${command.kind}: only the verified 400 codes are remapped, never auth or conflict`, async () => {
    let status = 400; let code = ""; let unauthorized = 0;
    const f = repository(async () => Response.json({ error: code }, { status }));
    f.client.onUnauthorized = () => { unauthorized++; };
    for (code of ["VALIDATION_ERROR", "MOBILE_SYNC_INVALID_INPUT", "MOBILE_SYNC_INVALID_STATUS", "MOBILE_SYNC_INVALID_CHECKLIST", "MOBILE_SYNC_OPERATION_REUSED", "OTHER_400"]) {
      await assert.rejects(f.client.offlineCommand(command), apiFailure(400, code));
    }
    for (status of [401, 403, 409, 422]) {
      for (code of legacyCodes) await assert.rejects(f.client.offlineCommand(command), apiFailure(status, code));
    }
    assert.equal(unauthorized, legacyCodes.length);
    assert.equal(f.calls.length, 14);
  });

  test(`${command.kind}: valid terminal receipts outrank unsupported-kind errors`, async () => {
    for (const [status, state, code, expectedState] of [
      [400, "rejected", "MOBILE_SYNC_INVALID_KIND", "rejected"],
      [400, "rejected", "MOBILE_SYNC_INVALID_STATUS", "rejected"],
      [409, "conflict", "MOBILE_SYNC_STATUS_CONFLICT", "conflict"],
      [409, "needs_review", "MOBILE_SYNC_REQUIRES_REVIEW", "needs_review"],
      [400, "rejected", "MOBILE_SYNC_OPERATION_REUSED", "needs_review"],
      [409, "conflict", "MOBILE_SYNC_OPERATION_REUSED", "needs_review"],
    ] as const) {
      const f = repository(async () => Response.json({ operationId: command.operationId, state, error: code }, { status }));
      assert.deepEqual(structuredClone(await f.client.offlineCommand(command)), { operationId: command.operationId, state: expectedState, error: code });
      assert.equal(f.calls.length, 1);
    }
    const f = repository(async () => Response.json({ operationId: command.operationId, state: "in_progress", error: "MOBILE_SYNC_IN_PROGRESS" }, { status: 409 }));
    await assert.rejects(f.client.offlineCommand(command), apiFailure(409, "MOBILE_SYNC_IN_PROGRESS"));
  });

  for (const [status, code] of [[400, "INVALID_INPUT"], [400, "MOBILE_SYNC_INVALID_KIND"], [503, deploymentCode]] as const) {
    test(`${command.kind}: ${code} survives restart, waits 60 seconds and replays identical UUID/body automatically`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const state = await deploymentFixture(); let upgraded = false;
      const f = repository(async () => upgraded ? Response.json({ operationId: command.operationId, state: "applied" }) : Response.json({ error: code }, { status }));
      state.upstream.offlineCommand = (input) => f.client.offlineCommand(input);
      const first = new OfflineEngine(state.dependencies);
      await first.enqueue([operation(command)]); await first.syncNow();
      const pending = (await state.store.read("a")).operations[0]!;
      assert.equal(pending.id, command.operationId); assert.equal(pending.status, "pending");
      assert.equal(pending.lastError, deploymentCode); assert.equal(pending.receipt, undefined);
      assert.equal(pending.nextAttemptAt, 61_000); assert.equal(pending.attempts, 1);
      assert.equal(first.getSnapshot().connection?.status, "service_error");
      assert.equal(await first.hasPendingChanges(), true);
      await first.retry(command.operationId); assert.equal(f.calls.length, 1);
      first.stop();
      const restarted = new OfflineEngine(state.dependencies); t.after(() => restarted.stop());
      restarted.start(); t.mock.timers.tick(0); await settle();
      assert.equal(f.calls.length, 1);
      state.advance(59_999); t.mock.timers.tick(59_999); await settle();
      assert.equal(f.calls.length, 1);
      upgraded = true; state.advance(1); t.mock.timers.tick(1); await settle();
      assert.equal(f.calls.length, 2);
      assert.deepEqual(f.calls[0], f.calls[1]);
      const stored = (await state.store.read("a")).operations;
      assert.equal(stored.length, 1); assert.equal(stored[0]?.id, command.operationId);
      assert.equal(stored[0]?.status, "applied"); assert.equal(restarted.getSnapshot().pending, 0);
    });
  }
}

for (const command of legacy) test(`${command.kind}: existing schema and unsupported-kind errors are never deployment classified`, async () => {
  for (const code of [...legacyCodes, "VALIDATION_ERROR", "MOBILE_SYNC_INVALID_INPUT"]) {
    const f = repository(async () => Response.json({ error: code }, { status: 400 }));
    await assert.rejects(f.client.offlineCommand(command), apiFailure(400, code));
    assert.equal(f.calls.length, 1); assert.equal(requiresDeployment(code), false);
  }
});

test("receipt GET has no new-command compatibility mapping", async () => {
  for (const code of legacyCodes) {
    const f = repository(async () => Response.json({ error: code }, { status: 400 }));
    await assert.rejects(f.client.offlineReceipt(timer.operationId, 1), apiFailure(400, code));
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0]?.method, "GET");
  }
});

test("prolonged deployment outage keeps one intent and bounded backoff, never substitutes a status route", async () => {
  const state = await deploymentFixture();
  const f = repository(async () => Response.json({ error: "INVALID_INPUT" }, { status: 400 }));
  state.upstream.offlineCommand = (input) => f.client.offlineCommand(input);
  const engine = new OfflineEngine(state.dependencies);
  await engine.enqueue([operation(timer)]);
  for (let attempt = 1; attempt <= 12; attempt++) {
    await engine.syncNow();
    const stored = (await state.store.read("a")).operations;
    assert.equal(stored.length, 1); assert.equal(stored[0]?.status, "pending");
    assert.equal(stored[0]?.attempts, attempt); assert.equal(stored[0]?.id, timer.operationId);
    const delay = stored[0]!.nextAttemptAt - state.dependencies.now();
    assert.ok(delay >= 60_000 && delay <= 300_000);
    state.advance(delay - 1); await engine.retry(timer.operationId);
    assert.equal(f.calls.length, attempt);
    state.advance(1);
  }
  assert.equal(new Set(f.calls.map((call) => JSON.stringify(call))).size, 1);
  assert.equal(f.calls[0]?.url, "https://fixture.invalid/api/offline/commands");
});

test("a valid rejected or reused receipt remains held after restart with no retry", async () => {
  for (const [code, expected] of [["MOBILE_SYNC_INVALID_KIND", "blocked"], ["MOBILE_SYNC_OPERATION_REUSED", "needs_review"]] as const) {
    const state = await deploymentFixture();
    const f = repository(async () => Response.json({ operationId: timer.operationId, state: "rejected", error: code }, { status: 400 }));
    state.upstream.offlineCommand = (input) => f.client.offlineCommand(input);
    const engine = new OfflineEngine(state.dependencies);
    await engine.enqueue([operation(timer)]); await engine.syncNow();
    const held = (await state.store.read("a")).operations[0];
    assert.equal(held?.status, expected); assert.equal(held?.receipt?.error, code);
    state.advance(); const restarted = new OfflineEngine(state.dependencies);
    await restarted.syncNow(); await assert.rejects(restarted.retry(timer.operationId), /REVIEW_REQUIRED/);
    assert.deepEqual((await state.store.read("a")).operations[0], held); assert.equal(f.calls.length, 1);
  }
});