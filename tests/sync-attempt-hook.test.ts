/// <reference types="node" />
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { OfflineOperation } from "../src/domain/offline";
import { ApiError } from "../src/infrastructure/errors";
import { agendaFixture, frozenNow } from "./helpers/agenda-load-lifecycle";
import { deferred, uiOperation } from "./helpers/durable-ui";

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture(); t.after(() => f.unmount()); return f;
}
const operation: OfflineOperation = { ...uiOperation, kind: "comment", text: "Pending" };

for (const api of ["requestSync", "syncNow"] as const) test(`managed ${api} uses new manual API and releases busy before a quiet partial refresh`, async (t) => {
  const f = fixture(t); await f.loadDay();
  const repo = f.wrappers[0]; let manual = 0; let historical = 0;
  repo.update({ pending: 2, operations: [operation, { ...operation, id: "unsupported", lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" }] });
  repo.syncNow = async () => { historical++; };
  Object.assign(repo, { requestSync: async () => {
    manual++;
    repo.update({ pending: 1, online: false, lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE", operations: [
      { ...operation, status: "applied" }, { ...operation, id: "unsupported", lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" },
    ] });
  } });
  const app = await f.flush();
  await app.offlineController![api]!();
  const after = await f.flush();
  assert.equal(manual, 1); assert.equal(historical, 0);
  assert.equal(after.busy, false); assert.equal(after.loading, false); assert.equal(after.error, null);
  assert.equal(f.reads.length, 2); assert.equal(f.reads[1].settled, false);
  assert.equal(after.offline?.pending, 1);
  f.reads[1].reject(new Error("QUIET_REFRESH_FAILED"));
  assert.equal((await f.flush()).error, null, "a post-send read failure is not a failed manual sync");
});

test("legacy wrapper without requestSync still works and known pending/backoff does not throw a connection banner", async (t) => {
  const f = fixture(t); await f.loadDay(); const repo = f.wrappers[0]; let calls = 0;
  repo.syncNow = async () => { calls++; };
  repo.update({ online: false, pending: 1, operations: [{ ...operation, nextAttemptAt: frozenNow + 30_000 }] });
  const before = await f.flush(); await before.syncOffline();
  const after = await f.flush();
  assert.equal(calls, 1); assert.equal(after.error, null); assert.equal(after.busy, false);
  assert.equal(f.reads.length, 1); assert.equal(after.offline?.pending, 1);
});

test("full manual application resolves without awaiting assignments and keeps version guards on later reads", async (t) => {
  const f = fixture(t); await f.loadDay(); const repo = f.wrappers[0];
  repo.update({ pending: 1, operations: [operation] });
  Object.assign(repo, { requestSync: async () => { repo.update({ online: true, pending: 0, operations: [{ ...operation, status: "applied" }] }); } });
  await (await f.flush()).syncOffline(); const after = await f.flush();
  assert.equal(after.offline?.pending, 0); assert.equal(after.busy, false); assert.equal(after.loading, false);
  assert.equal(f.reads.length, 2); assert.equal(f.reads[1].settled, false);
  f.access.allowed = false; f.render(); await f.flush();
  assert.equal(f.reads[1].signal.aborted, true);
});

test("manual disk failure propagates unchanged without changing global app.error", async (t) => {
  const f = fixture(t); const app = await f.loadDay(); const failure = new Error("OFFLINE_STORAGE_FULL");
  Object.assign(f.wrappers[0], { requestSync: async () => { throw failure; } });
  await assert.rejects(app.syncOffline(), (caught: unknown) => caught === failure);
  const after = await f.flush(); assert.equal(after.error, app.error); assert.equal(after.busy, false); assert.equal(f.reads.length, 1);
});

for (const kind of ["snapshot", "401"] as const) test(`manual ${kind} authentication block retains unauthorized handling and starts no quiet refresh`, async (t) => {
  const f = fixture(t); const app = await f.loadDay(); const repo = f.wrappers[0];
  Object.assign(repo, { requestSync: async () => {
    if (kind === "401") throw new ApiError(401, "UNAUTHORIZED", "Session expired");
    repo.update({ authBlocked: true });
  } });
  await assert.rejects(app.syncOffline()); const after = await f.flush();
  assert.equal(after.session, null); assert.equal(after.offlineController, null);
  assert.match(after.error ?? "", /sesión venció/); assert.equal(f.reads.length, 1);
});

test("manual in-flight lock rejects a second action and revoked access prevents the post-send refresh", async (t) => {
  const f = fixture(t); await f.loadDay(); const repo = f.wrappers[0]; const gate = deferred<void>(); let calls = 0;
  repo.update({ pending: 1, operations: [operation] });
  Object.assign(repo, { requestSync: async () => {
    calls++; await gate.promise; repo.update({ pending: 0, operations: [{ ...operation, status: "applied" }] });
  } });
  const app = await f.flush(); const request = app.syncOffline();
  await assert.rejects(app.syncOffline(), /no está disponible/);
  f.access.allowed = false; f.render(); gate.resolve(); await request;
  const after = await f.flush(); assert.equal(calls, 1); assert.equal(after.busy, false); assert.equal(f.reads.length, 1);
});