import assert from "node:assert/strict";
import { test } from "node:test";
import { agendaFixture, frozenNow } from "./helpers/agenda-load-lifecycle";
import { deferred } from "./helpers/durable-ui";

for (const failure of ["offline", "auth", "transport"] as const) test(`syncOffline ${failure} keeps transport diagnostics local but retains mandatory authentication invalidation`, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture(); t.after(f.unmount);
  const loaded = await f.loadDay();
  const saved = structuredClone(loaded.data);
  const wrapper = f.wrappers[0];
  const gate = deferred<void>();
  wrapper.syncNow = () => gate.promise;
  const action = loaded.syncOffline();
  const checked = failure === "offline" ? assert.doesNotReject(action)
    : assert.rejects(action, failure === "auth" ? /misma cuenta/ : /fixture-transport/);
  assert.equal((await f.flush()).busy, true);
  wrapper.update({ online: false, authBlocked: failure === "auth", lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" });
  if (failure === "transport") gate.reject(new Error("fixture-transport"));
  else gate.resolve();
  await checked;
  const after = await f.flush();
  assert.equal(after.busy, false);
  assert.equal(after.loading, false);
  if (failure === "auth") {
    assert.match(after.error ?? "", /Tu sesión venció/);
    assert.equal(after.session, null); assert.equal(after.data, null);
    assert.equal(after.offlineController, null);
    assert.equal(f.calls.removeSession, 1);
  } else {
    assert.equal(after.error, null);
    assert.deepEqual(after.data, saved);
    assert.equal(after.offline?.lastError, "MOBILE_SYNC_ACTIONS_UNAVAILABLE");
    assert.equal(after.offline?.authBlocked, false);
  }
  assert.equal(wrapper.getSnapshot().authBlocked, failure === "auth");
  assert.equal(f.reads.length, 1);
});

test("offline snapshots do not replace a genuine assignment-read error with connection diagnostics", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture(); t.after(f.unmount);
  const loaded = await f.loadDay();
  const refresh = loaded.refresh();
  const rejected = assert.rejects(refresh, /FIXTURE_ASSIGNMENT_READ_FAILED/);
  await f.flush();
  f.reads[1].reject(new Error("FIXTURE_ASSIGNMENT_READ_FAILED"));
  await rejected;
  const failed = await f.flush();
  assert.match(failed.error ?? "", /FIXTURE_ASSIGNMENT_READ_FAILED/);
  for (const lastError of ["MOBILE_SYNC_ACTIONS_UNAVAILABLE", "OFFLINE_NETWORK_UNAVAILABLE", null]) {
    f.wrappers[0].update({ online: false, lastError });
    const after = await f.flush();
    assert.equal(after.error, failed.error);
    assert.deepEqual(after.data, loaded.data);
  }
});

test("actual action rejection remains observable and leaves checklist/draft identity unchanged despite sync snapshots", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture(); t.after(f.unmount);
  const loaded = await f.loadDay(); const group = loaded.data!.groups[0];
  loaded.openWork(group, group.works[0], { tab: "checklist" });
  const opened = await f.flush(); const gate = deferred<void>();
  const failure = new Error("OFFLINE_STORAGE_FULL");
  f.setAnswerGate(() => gate.promise);
  const action = opened.saveAnswer("1009", { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: "Keep unsaved text" });
  const rejected = assert.rejects(action, (caught: unknown) => caught === failure);
  f.wrappers[0].update({ lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" });
  gate.reject(failure); await rejected;
  const after = await f.flush();
  assert.equal(after.busy, false); assert.equal(after.error, null);
  assert.equal(f.calls.answers, 1); assert.equal(f.reads.length, 1);
  assert.deepEqual(after.canonicalDetailWork, opened.canonicalDetailWork);
  assert.deepEqual(after.selected, opened.selected);
  assert.deepEqual(after.detailDraftIdentity, opened.detailDraftIdentity);
});