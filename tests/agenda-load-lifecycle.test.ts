import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { weekRange } from "../src/domain/format";
import { NetworkError } from "../src/infrastructure/errors";
import { checklistDate, equipmentChecklistPayload } from "./helpers/assignment-checklist";
import { agendaFixture, agendaReactFixture, frozenNow } from "./helpers/agenda-load-lifecycle";

function fixture(t: TestContext, options?: Parameters<typeof agendaFixture>[0]) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture(options);
  t.after(() => f.unmount());
  return f;
}

test("fixture memoizes by Object.is dependencies and commits cleanup before replacement effects", () => {
  const hooks = agendaReactFixture();
  const events: string[] = [];
  let dependency = 1;
  const render = () => hooks.render(() => {
    const callback = hooks.react.useCallback(() => dependency, [dependency]);
    const value = hooks.react.useMemo(() => ({ dependency }), [dependency]);
    hooks.react.useEffect(() => { events.push(`setup:${value.dependency}`); return () => { events.push(`cleanup:${value.dependency}`); }; }, [callback]);
    return { callback, value };
  });
  const first = render();
  assert.deepEqual(events, []);
  hooks.commit();
  const same = render(); hooks.commit();
  assert.equal(same.callback, first.callback);
  assert.equal(same.value, first.value);
  dependency = 2;
  const next = render();
  assert.notEqual(next.callback, first.callback);
  assert.notEqual(next.value, first.value);
  hooks.commit(); hooks.unmount();
  assert.deepEqual(events, ["setup:1", "cleanup:1", "setup:2", "cleanup:2"]);
});

test("day to week to day cancels a never-resolving week through options.signal", async (t) => {
  const f = fixture(t);
  const day = await f.loadDay();
  assert.equal(new Date().toISOString(), "2026-09-11T15:00:00.000Z");
  assert.equal(day.range.startDate, checklistDate);
  day.setTab("agenda");
  const week = await f.flush();
  assert.deepEqual(f.reads[1].range, weekRange(checklistDate));
  assert.equal(week.loading, true);
  assert.equal(week.data, null);
  week.setTab("today");
  assert.equal(f.reads[1].signal.aborted, true);
  assert.equal(f.reads[1].aborts, 1);
  assert.equal(f.reads[1].settled, true);
  const pendingDay = await f.flush();
  assert.equal(pendingDay.loading, true, "cancelled week finally must not clear the new day spinner");
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve();
  const loaded = await f.flush();
  assert.equal(loaded.tab, "today");
  assert.equal(loaded.loading, false);
  assert.equal(loaded.error, null);
  assert.ok(loaded.data);
});

test("late week result that ignores abort cannot overwrite a newer day result", async (t) => {
  const f = fixture(t);
  const day = await f.loadDay();
  f.ignoreNextAbort();
  day.setTab("agenda");
  (await f.flush()).setTab("today");
  await f.flush();
  assert.equal(f.reads[1].signal.aborted, true);
  const current = equipmentChecklistPayload(); current.generatedAt = "2026-09-11T15:02:00.000Z";
  f.reads[2].resolve(current);
  await f.flush();
  f.reads[1].resolve(equipmentChecklistPayload());
  const final = await f.flush();
  assert.equal(final.data?.generatedAt, current.generatedAt);
  assert.equal(final.loading, false);
  assert.equal(final.error, null);
});

test("a repository timeout releases loading, reports NetworkError and permits a fresh retry", async (t) => {
  const f = fixture(t);
  (await f.loadDay()).setTab("agenda");
  await f.flush();
  const timeout = new NetworkError("timeout", "fixture assignment deadline");
  setTimeout(() => f.reads[1].reject(timeout), 45_000);
  t.mock.timers.tick(44_999);
  assert.equal((await f.flush()).loading, true);
  t.mock.timers.tick(1);
  const failed = await f.flush();
  assert.equal(failed.loading, false);
  assert.equal(failed.error, timeout.message);
  assert.equal(failed.data, null);
  const retry = failed.refresh();
  await f.flush();
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve(); await retry;
  assert.equal((await f.flush()).error, null);
  assert.equal(f.render().loading, false);
});

test("user pull before the range effect and repeated same-key refreshes share one read", async (t) => {
  const f = fixture(t);
  (await f.loadDay()).setTab("agenda");
  const beforeEffects = f.render();
  const pull = beforeEffects.refresh();
  const secondPull = beforeEffects.refresh();
  await f.flush();
  assert.equal(f.reads.length, 2, "automatic range effect must join the manual read");
  assert.equal(f.reads[1].signal.aborted, false);
  const thirdPull = f.render().refresh();
  await f.flush();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve();
  await Promise.all([pull, secondPull, thirdPull]);
  assert.equal((await f.flush()).loading, false);
  const fresh = f.render().refresh(); await f.flush();
  assert.equal(f.reads.length, 3, "settled reads are not permanently memoized");
  f.reads[2].resolve(); await fresh;
});

test("post-answer invalidation never joins a same-range pre-answer read", async (t) => {
  const f = fixture(t);
  const loaded = await f.loadDay();
  const group = loaded.data!.groups[0];
  loaded.openWork(group, group.works[0], { tab: "checklist" });
  await f.flush();
  assert.equal(f.render().canonicalDetailWork?.checklistDone, 7);
  f.ignoreNextAbort();
  const beforeAnswer = f.render().refresh();
  await f.flush();
  assert.equal(f.reads.length, 2, "capture the deferred pre-answer read before installing the mutation");
  let confirm = (): void => {};
  f.setAnswerGate(() => new Promise<void>((resolve) => { confirm = resolve; }));
  const save = f.render().saveAnswer("1009", { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: null });
  await f.flush();
  assert.equal(f.calls.answers, 1);
  assert.equal(f.render().busy, true);
  confirm(); await f.flush();
  assert.equal(f.reads.length, 3);
  assert.deepEqual(f.reads[2].range, f.reads[1].range);
  assert.equal(f.reads[1].signal.aborted, true);
  assert.equal(f.render().busy, false, "the confirmed write releases busy while the background read remains unresolved");
  assert.equal(f.render().loading, false);
  f.reads[2].resolve(); await save;
  const updated = await f.flush();
  assert.equal(updated.canonicalDetailWork?.checklistDone, 8);
  assert.equal(updated.data?.groups[0].works[0].checklistDone, 8);
  f.reads[1].resolve(); await beforeAnswer;
  const final = await f.flush();
  assert.equal(final.canonicalDetailWork?.checklistDone, 8);
  assert.equal(final.loading, false);
  assert.equal(final.busy, false);
  assert.equal(f.calls.answers, 1);
});

test("request-version invalidation discards a pre-answer result before any replacement controller exists", async (t) => {
  const f = fixture(t);
  const loaded = await f.loadDay();
  const group = loaded.data!.groups[0];
  loaded.openWork(group, group.works[0], { tab: "checklist" });
  await f.flush();
  f.ignoreNextAbort();
  const previous = f.render().refresh(); await f.flush();
  let confirm = (): void => {};
  f.setAnswerGate(() => new Promise<void>((resolve) => { confirm = resolve; }));
  const save = f.render().saveAnswer("1009", { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: null });
  await f.flush();
  assert.equal(f.reads[1].signal.aborted, true, "mutation aborts the old read even when its transport ignores cancellation");
  const stale = equipmentChecklistPayload(); stale.generatedAt = "2026-09-11T15:01:00.000Z";
  f.reads[1].resolve(stale); await previous;
  const pending = await f.flush();
  assert.equal(pending.data?.generatedAt, loaded.data?.generatedAt);
  assert.equal(pending.busy, true);
  confirm(); await f.flush();
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve(); await save;
  assert.equal((await f.flush()).canonicalDetailWork?.checklistDone, 8);
});

test("baseline waits for foreground data and remains alive through stable rendered cycles", async (t) => {
  const f = fixture(t, { online: true });
  await f.restore();
  for (let cycle = 0; cycle < 12; cycle++) { f.render(); await f.flush(); }
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve();
  const loaded = await f.flush();
  assert.equal(loaded.loading, false);
  assert.ok(loaded.data);
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.reads[1].range, weekRange(checklistDate));
  for (let cycle = 0; cycle < 12; cycle++) { f.render(); await f.flush(); }
  assert.equal(f.reads[1].signal.aborted, false, "publishing data must not cancel its baseline preparation");
  f.reads[1].resolve(); await f.flush();
  assert.equal(f.calls.options, 1);
  assert.equal(f.calls.loadSession, 1);
  assert.equal(f.calls.repositories, 1);
  assert.equal(f.calls.me, 2);
  assert.equal(f.wrappers[0].starts, 1);
  assert.equal(f.wrappers[0].stops, 0);
  assert.equal(f.reads.length, 2);
});

test("a foreground refresh cancels baseline without its cancellation leaking an error", async (t) => {
  const f = fixture(t, { online: true });
  const loaded = await f.loadDay();
  assert.equal(f.reads.length, 2);
  const refresh = loaded.refresh();
  assert.equal(f.reads[1].signal.aborted, true);
  await f.flush();
  assert.equal(f.calls.options, 0);
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve(); await refresh;
  const final = await f.flush();
  assert.equal(final.error, null);
  assert.equal(final.offlineSetupError, null);
  assert.equal(final.loading, false);
});

test("switching to agenda aborts the background baseline and starts a distinct visible week read", async (t) => {
  const f = fixture(t, { online: true });
  const loaded = await f.loadDay();
  assert.equal(f.reads.length, 2);
  loaded.setTab("agenda");
  assert.equal(f.reads[1].signal.aborted, true);
  const pending = await f.flush();
  assert.equal(pending.loading, true);
  assert.equal(f.reads.length, 3);
  assert.deepEqual(f.reads[2].range, f.reads[1].range);
  assert.notEqual(f.reads[2].signal, f.reads[1].signal);
  assert.equal(f.reads[2].signal.aborted, false);
  f.reads[2].resolve();
  const final = await f.flush();
  assert.equal(final.loading, false);
  assert.ok(final.data);
  assert.equal(final.error, null);
  assert.equal(f.calls.options, 0);
});

test("foreground and access changes pause the controller without start/stop lifecycle churn", async (t) => {
  const f = fixture(t);
  await f.restore();
  const controller = f.wrappers[0];
  for (let cycle = 0; cycle < 6; cycle++) {
    f.foreground(false); f.foreground(true);
    f.access.allowed = false; f.render(); await f.flush();
    assert.equal(controller.foreground.at(-1), false);
    const count = f.reads.length;
    await f.render().refresh(); await f.flush();
    assert.equal(f.reads.length, count);
    f.access.allowed = true; f.render(); await f.flush();
    assert.equal(controller.foreground.at(-1), true);
  }
  assert.equal(controller.starts, 1);
  assert.equal(controller.stops, 0);
  assert.equal(f.calls.loadSession, 1);
  assert.equal(f.calls.repositories, 1);
  assert.equal(f.calls.binds - f.calls.detaches, 1);
  assert.ok(f.reads.slice(0, -1).every((read) => read.signal.aborted));
  f.unmount();
  assert.equal(f.reads.at(-1)?.signal.aborted, true);
  assert.equal(f.calls.binds, f.calls.detaches);
});

for (const boundary of ["lock", "unauthorized", "logout", "branch", "unmount"] as const) {
  test(`${boundary} aborts foreground assignments and cannot publish a late old-session result`, async (t) => {
    const f = fixture(t, { online: boundary === "branch" });
    f.ignoreNextAbort();
    const loaded = await f.restore();
    let completion: Promise<void> | undefined;
    if (boundary === "lock") { f.access.allowed = false; f.render(); }
    if (boundary === "unauthorized") f.wrappers[0].remote.onUnauthorized?.();
    if (boundary === "logout") completion = loaded.logout();
    if (boundary === "branch") completion = loaded.branch(2);
    if (boundary === "unmount") f.unmount();
    if (boundary !== "unmount") await f.flush();
    await completion;
    assert.equal(f.reads[0].signal.aborted, true);
    assert.equal(f.reads[0].aborts, 1);
    f.reads[0].resolve();
    if (boundary === "unmount") return;
    const final = await f.flush();
    assert.equal(final.data, null);
    if (boundary === "branch") {
      assert.equal(final.session?.branchId, 2);
      assert.equal(f.reads.length, 2);
      assert.equal(f.reads[1].branchId, 2);
      assert.equal(final.loading, true, "old finally cannot release a new branch read");
    } else if (boundary !== "lock") {
      assert.equal(final.session, null);
      assert.equal(final.loading, false);
    }
  });

  test(`${boundary} also aborts an in-flight baseline and skips creation options`, async (t) => {
    const f = fixture(t, { online: true });
    const loaded = await f.loadDay();
    assert.equal(f.reads.length, 2);
    if (boundary === "lock") { f.access.allowed = false; f.render(); }
    if (boundary === "unauthorized") f.wrappers[0].remote.onUnauthorized?.();
    if (boundary === "logout") await loaded.logout();
    if (boundary === "branch") await loaded.branch(2);
    if (boundary === "unmount") f.unmount();
    if (boundary !== "unmount") await f.flush();
    assert.equal(f.reads[1].signal.aborted, true);
    assert.equal(f.reads[1].aborts, 1);
    assert.equal(f.calls.options, 0);
  });
}