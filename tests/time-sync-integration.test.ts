/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactNode } from "react";
import type { OfflineCommand, OfflineOperation } from "../src/domain/offline";
import { ApiError } from "../src/infrastructure/errors";
import { OfflineEngine } from "../src/offline/engine";
import { updateState } from "../src/offline/state";
import { fixture, uuid } from "../src/offline/tests/fakes";
import { agendaFixture, frozenNow } from "./helpers/agenda-load-lifecycle";
import { action, deferred, durableReactFixture, uiModule } from "./helpers/durable-ui";

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (!isValidElement<{ children?: ReactNode; message?: string; title?: string }>(node)) return "";
  return [node.props.message, node.props.title, text(node.props.children)].filter(Boolean).join(" ");
}

for (const api of ["requestSync", "legacy-syncNow"] as const) test(`full hook + engine + result UI ${api}: unsupported timer does not starve legacy writes, later automatic wake drains identical chain`, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const app = agendaFixture(); t.after(app.unmount);
  const loaded = await app.loadDay();
  const session = loaded.session; assert.ok(session);
  const data = loaded.data; assert.ok(data);
  const group = data.groups[0]; const work = group.works[0];
  const scope = { companyBranchId: 1, groupId: group.id, workId: work.id, ...loaded.range };
  const base = (id: number) => ({ id: uuid(id), status: "pending" as const, createdAt: frozenNow - 1000, attempts: 0, nextAttemptAt: 0 });
  const original: OfflineOperation[] = [
    { ...base(801), kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" } },
    { ...base(802), kind: "timer", scope, dependencyId: uuid(801), payload: { status: "paused", baseStatus: "in_progress" } },
    { ...base(803), kind: "comment", scope, text: "Independent legacy comment" },
  ];
  const storage = fixture();
  storage.dependencies.now = () => Date.now();
  storage.dependencies.user = session.user;
  storage.upstream.identity = structuredClone(session.user);
  await updateState(storage.store, "a", state => { state.operations = structuredClone(original); });
  const gate = deferred<void>(); let upgraded = false; let entered = false;
  const sent: OfflineCommand[] = [];
  const send = storage.upstream.offlineCommand.bind(storage.upstream);
  storage.upstream.offlineCommand = async command => {
    sent.push(structuredClone(command));
    if (!upgraded && command.kind === "timer") { entered = true; await gate.promise; throw new ApiError(503, "MOBILE_SYNC_ACTIONS_UNAVAILABLE", "Upgrade required"); }
    return send(command);
  };
  const engine = new OfflineEngine(storage.dependencies); t.after(() => engine.stop());
  await engine.refresh();
  const wrapper = app.wrappers[0];
  wrapper.update(engine.getSnapshot());
  const unsubscribe = engine.subscribe(() => wrapper.update(engine.getSnapshot())); t.after(unsubscribe);
  let manualCalls = 0; let legacyCalls = 0;
  wrapper.syncNow = () => { legacyCalls++; return engine.syncNow(); };
  if (api === "requestSync") Object.assign(wrapper, { requestSync: () => { manualCalls++; return engine.requestSync(); } });
  else assert.equal("requestSync" in wrapper, false);
  const uiHooks = durableReactFixture(); t.after(uiHooks.unmount);
  const ui = uiModule<typeof import("../src/screens/offline/OfflineCenterScreen")>("screens/offline/OfflineCenterScreen.tsx", uiHooks, {
    "../workDetail/files/fileRules": { fileSizeLabel: () => "0 B" },
  });
  const renderUi = () => {
    const current = app.render(); assert.ok(current.offlineController);
    const tree = uiHooks.render(() => ui.OfflineCenterScreen({ controller: current.offlineController!, snapshot: current.offline, range: current.range, branchId: 1, onBack: () => {} }));
    uiHooks.flush(); return tree;
  };
  await app.flush();
  const button = action(renderUi(), "Sincronizar ahora");
  assert.equal(button.disabled, false);
  button.onPress(); button.onPress();
  const sending = await app.flush();
  assert.equal(entered, true); assert.equal(sending.busy, true);
  await assert.rejects(sending.syncOffline(), /no está disponible/);
  assert.equal(manualCalls, api === "requestSync" ? 1 : 0);
  assert.equal(legacyCalls, api === "legacy-syncNow" ? 1 : 0);
  gate.resolve();
  const partial = await app.flush();
  assert.equal(partial.busy, false); assert.equal(partial.loading, false); assert.equal(partial.error, null);
  assert.equal(partial.offline?.pending, 2);
  assert.deepEqual(sent.map(command => command.operationId), [uuid(801), uuid(803)]);
  assert.deepEqual(engine.getSnapshot().operations.map(operation => operation.status), ["pending", "pending", "applied"]);
  assert.equal(engine.getSnapshot().operations[1].attempts, 0);
  assert.equal(engine.getSnapshot().operations[0].nextAttemptAt, frozenNow + 60_000);
  assert.equal(app.reads.length, 2); assert.equal(app.reads[1].settled, false);
  assert.deepEqual(partial.data, data, "no fabricated canonical snapshot before GET finishes");
  const result = text(renderUi());
  assert.match(result, /Se envió 1 cambio; quedan 2 pendientes/);
  assert.match(result, /2 cambios requieren actualizar el servicio/);
  assert.doesNotMatch(result, /MOBILE_SYNC_ACTIONS_UNAVAILABLE/);
  app.reads[1].reject(new Error("QUIET_READ_FAILED"));
  assert.equal((await app.flush()).error, null);
  engine.start(); t.mock.timers.tick(0); await app.flush();
  const probes = storage.upstream.verifyCount;
  t.mock.timers.tick(59_999); await app.flush();
  assert.equal(sent.length, 2); assert.equal(storage.upstream.verifyCount, probes);
  upgraded = true; t.mock.timers.tick(1); await app.flush();
  assert.equal(engine.getSnapshot().pending, 0);
  assert.deepEqual(sent.map(command => command.operationId), [uuid(801), uuid(803), uuid(801), uuid(802)]);
  assert.deepEqual(sent[2], sent[0], "retry keeps the original UUID and complete payload");
  const final = await app.flush();
  assert.equal(final.busy, false); assert.equal(final.loading, false); assert.equal(final.error, null);
  assert.equal(final.offline?.pending, 0);
  assert.doesNotMatch(text(renderUi()), /Se envió 1 cambio|requieren actualizar el servicio/);
  assert.equal(manualCalls + legacyCalls, 1, "automatic wake must not be replaced by a test-triggered manual sync");
  assert.deepEqual((await storage.store.read("a")).operations.map(operation => [operation.id, operation.createdAt, operation.dependencyId]), original.map(operation => [operation.id, operation.createdAt, operation.dependencyId]));
});