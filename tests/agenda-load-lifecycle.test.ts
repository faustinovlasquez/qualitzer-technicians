import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { test, type TestContext } from "node:test";
import { weekRange } from "../src/domain/format";
import { assignmentDays, dailyRange } from "../src/domain/assignmentSchedule";
import { user } from "../server/tests/fixtures";
import { NetworkError } from "../src/infrastructure/errors";
import { checklistDate, equipmentChecklistPayload } from "./helpers/assignment-checklist";
import { agendaFixture, agendaReactFixture, frozenNow } from "./helpers/agenda-load-lifecycle";
import type { MaintenanceDeliveryContext } from "../src/domain/orderLifecycle";

test("confirmed creation stays recoverable when its exact resource is missing and retries only the read", async context => {
  const current = fixture(context); const app = await current.loadDay(); app.openCreate("work"); await current.flush();
  const result = { kind: "work" as const, groupId: "direct-72", workId: 72, companyBranchId: 1,
    schedule: { date: checklistDate, startTime: "09:00", endTime: "10:00", plannedMinutes: 60, timezone: "America/Santiago" } };
  const opening = current.render().onCreated(result); const rejected = assert.rejects(opening, /todavía no está disponible/);
  await current.flush(); current.reads.at(-1)!.resolve(); await rejected;
  const failed = await current.flush();
  assert.equal(failed.selectedCreationKind, "work"); assert.equal(failed.selected, null); assert.equal(failed.creationNotice, null);
  const retry = failed.onCreated(result); await current.flush();
  const data = equipmentChecklistPayload(); data.groups = [{ ...data.groups[0], id: result.groupId, works: [{ ...data.groups[0].works[0], id: "72" }] }];
  current.reads.at(-1)!.resolve(data); await retry;
  const opened = await current.flush(); assert.equal(opened.selected?.workId, "72"); assert.equal(opened.creationNotice?.confirmed, true);
  opened.closeWork(); const closed = await current.flush(); assert.equal(closed.creationNotice, null);
  closed.openWork(data.groups[0], data.groups[0].works[0]); assert.equal((await current.flush()).creationNotice, null);
});

test("locked creation handoff never opens a detail or success notice", async context => {
  const current = fixture(context); const app = await current.loadDay(); app.openCreate("maintenance"); await current.flush();
  const result = { kind: "maintenance" as const, groupId: "maintenance-73", workId: 73, companyBranchId: 1,
    schedule: { date: checklistDate, startTime: "09:00", endTime: "10:00", plannedMinutes: 60, timezone: "America/Santiago" } };
  const opening = current.render().onCreated(result); await current.flush(); current.access.allowed = false;
  const data = equipmentChecklistPayload(); data.groups = [{ ...data.groups[0], id: result.groupId, works: [{ ...data.groups[0].works[0], id: "73" }] }];
  current.reads.at(-1)!.resolve(data); await opening; const after = await current.flush();
  assert.equal(after.selectedOrder, null); assert.equal(after.creationNotice, null); assert.equal(after.selectedCreationKind, "maintenance");
});

for (const kind of ["work", "maintenance"] as const) test(`confirmed ${kind} opens the created resource instead of returning to agenda`, async context => {
  const current = fixture(context);
  const app = await current.loadDay();
  app.openCreate(kind); await current.flush();
  const created = { kind, groupId: kind === "maintenance" ? "maintenance-71" : "direct-71", workId: 71, companyBranchId: 1,
    schedule: { date: checklistDate, startTime: "09:00", endTime: "10:00", plannedMinutes: 60, timezone: "America/Santiago" } };
  const opening = current.render().onCreated(created);
  await current.flush();
  const data = equipmentChecklistPayload();
  data.groups = [{ ...data.groups[0], id: created.groupId, type: kind === "maintenance" ? "internal_maintenance" : "direct_assignment",
    works: [{ ...data.groups[0].works[0], id: "71" }] }];
  current.reads.at(-1)!.resolve(data); await opening;
  const opened = await current.flush();
  assert.equal(opened.selectedCreationKind, null);
  assert.equal(opened.tab, "today");
  assert.equal(opened.creationNotice?.confirmed, true);
  assert.equal(opened.creationNotice?.kind, kind);
  if (kind === "maintenance") { assert.equal(opened.selectedOrder?.id, created.groupId); assert.equal(opened.selected, null); }
  else { assert.equal(opened.selected?.workId, "71"); assert.equal(opened.selected?.groupId, created.groupId); assert.equal(opened.selectedOrder, null); }
  opened.dismissCreationNotice(); assert.equal((await current.flush()).creationNotice, null);
});

for (const fullWeek of [true, false]) test(`cold offline startup opens today's jornada with ${fullWeek ? "a full downloaded week" : "only older coverage"}`, async () => {
  const filename = new URL("../src/application/useTechnicianApp.ts", import.meta.url);
  const source = ts.createSourceFile(filename.pathname, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  let restore: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => { if (ts.isFunctionDeclaration(node) && node.name?.text === "restoreCachedSession") restore = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(restore);
  const today = "2026-09-21";
  const snapshot = { authBlocked: false, coverage: (fullWeek ? assignmentDays(weekRange(today)) : ["2026-09-18"]).map(date => ({ date, branchId: 1, fetchedAt: 100 })), operations: [] };
  const original = structuredClone(snapshot);
  const changes = new Map<string, unknown>();
  const reads: unknown[] = [];
  const profile = { user: user(), verifiedAt: 100 };
  const wrapped = { stop() { assert.fail("UNEXPECTED_STOP"); }, getSnapshot: () => snapshot,
    localAssignments: async (range: unknown) => { reads.push(range); if (!fullWeek) throw new Error("OFFLINE_CACHE_MISS"); return equipmentChecklistPayload(); } };
  const module = { exports: {} as { restoreCachedSession(stored: object, repo: object, version: number): Promise<boolean> } };
  const state: { current: object } = { current: {} };
  runInNewContext(ts.transpileModule(`export ${restore.getText(source)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, state, repository: { current: null }, sessionSetup: { current: null }, sessionVersion: { current: 1 }, manualRefresh: { current: null },
    restoreOfflineProfile: async () => profile, bindOffline: async () => ({ wrapped, allowNetwork() {} }), scheduleClock: () => ({ day: today }), dateKey: () => today,
    weekRange, assignmentDays, dailyRange, errorText: (error: Error) => error.message,
    ...Object.fromEntries(["Session", "SelectedTenant", "Data", "Range", "Tab", "AgendaFocusDate", "Selected", "SelectedOrder", "SelectedCreationKind", "SelectedOffline", "OfflineController", "OfflineVerifiedAt", "LiveVerified", "ForcePassword", "FinalizingSession", "Error", "Loading"].map(name => [`set${name}`, (value: unknown) => { changes.set(name, value); }])),
  });
  assert.equal(await module.exports.restoreCachedSession({ token: "fixture", tenant: { id: "fixture" }, branchId: 1, gatewayUrl: "https://fixture.invalid" }, {}, 1), true);
  assert.equal(changes.get("Tab"), "today");
  assert.deepEqual(reads, [dailyRange(today)]);
  assert.equal(changes.get("AgendaFocusDate"), null);
  if (!fullWeek) { assert.equal(changes.get("Data"), null); assert.match(String(changes.get("Error")), /OFFLINE_CACHE_MISS/); }
  assert.deepEqual(snapshot, original);
});

test("agenda publishes completed dates before the batch and ignores late progress after range change", async t => {
  const current = fixture(t);
  (await current.loadDay()).setTab("agenda");
  await current.flush();
  const week = current.reads.at(-1)!;
  const partial = equipmentChecklistPayload();
  week.progress(partial, ["2026-09-11"]);
  const loading = await current.flush();
  assert.equal(loading.loading, true);
  assert.ok(loading.data);
  assert.equal(week.priorityDate, "2026-09-11");
  assert.equal(loading.agendaPendingDates?.includes("2026-09-11"), false);
  assert.equal(loading.agendaPendingDates?.length, 6);
  loading.changeRange({ startDate: "2026-09-14", endDate: "2026-09-20" });
  await current.flush();
  week.progress(partial, ["2026-09-11"]);
  assert.equal((await current.flush()).data, null);
  const next = current.reads.at(-1)!;
  next.resolve();
  assert.equal((await current.flush()).agendaPendingDates?.length, 0);
});

test("empty maintenance opens using its scheduled date, not the first day of the month", async t => {
  const current = fixture(t);
  (await current.loadDay()).setTab("agenda"); await current.flush();
  current.reads.at(-1)!.resolve();
  (await current.flush()).changeRange({ startDate: "2026-09-01", endDate: "2026-09-30" }); await current.flush();
  const data = equipmentChecklistPayload();
  data.groups[0] = { ...data.groups[0], id: "maintenance-16", type: "internal_maintenance", scheduledDate: "2026-09-16", works: [] };
  current.reads.at(-1)!.resolve(data);
  (await current.flush()).openGroup(data.groups[0]);
  assert.equal((await current.flush()).selectedOrder?.queryDate, "2026-09-16");
});

test("agenda month keeps the complete requested range and selected date outside the first week", async t => {
  const current = fixture(t);
  (await current.loadDay()).setTab("agenda");
  await current.flush(); current.reads.at(-1)!.resolve();
  const app = await current.flush();
  app.changeRange({ startDate: "2026-09-01", endDate: "2026-09-30" });
  await current.flush();
  assert.deepEqual(current.reads.at(-1)!.range,{ startDate: "2026-09-01", endDate: "2026-09-30" });
  current.reads.at(-1)!.resolve();
  (await current.flush()).focusAgendaDay("2026-09-30");
  assert.equal((await current.flush()).agendaFocusDate,"2026-09-30");
});

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

for (const scenario of ["ready-card", "ready-detail", "pending", "empty", "closed", "failed-read", "failed-write", "locked"] as const) {
  test(`technical delivery guidance uses confirmed full-order state: ${scenario}`, async (t) => {
    const harness = fixture(t);
    await harness.restore();
    const payload = equipmentChecklistPayload();
    const group = payload.groups[0];
    group.type = "internal_maintenance"; group.id = "maintenance-80"; group.status = "in_progress";
    const work = group.works[0]; work.status = "paused";
    harness.reads[0].resolve(payload);
    let app = await harness.flush();
    let confirmWrite: () => void = () => {};
    const writeGate = new Promise<void>(resolve => { confirmWrite = resolve; });
    harness.setStatusGate(async () => { await writeGate; if (scenario === "failed-write") throw new Error("STATUS_REJECTED"); });
    const context: MaintenanceDeliveryContext = { groupId: group.id, status: scenario === "closed" ? "delivered" : "in_progress", maintenanceType: "correctivo", finalizationNote: null,
      damageType: null, durationMinutes: null, startedAt: null, finalizedAt: null, incompleteChecklists: ["Checklist pendiente"], technicianDeliverySupported: true,
      canTechnicianDeliver: scenario !== "closed", totalWorks: scenario === "empty" ? 0 : 2, pendingWorkNames: scenario === "pending" ? ["Trabajo completado, no entregado"] : [] };
    harness.setDeliveryGate(async () => {
      if (scenario === "failed-read") throw new NetworkError("timeout", "GUIDANCE_READ_FAILED");
      if (scenario === "locked") harness.access.allowed = false;
      return context;
    });
    if (scenario === "ready-detail") { app.openWork(group, work); app = await harness.flush(); }
    const mutation = scenario === "ready-detail" ? app.changeStatus({ status: "delivered" }) : app.onWorkStatus(group, work, { status: "delivered" });
    await harness.flush();
    assert.equal(harness.deliveryReads.length, 0);
    assert.equal(harness.render().selectedOrder, null);
    confirmWrite();
    if (scenario === "failed-write") await assert.rejects(mutation, /STATUS_REJECTED/); else await mutation;
    const final = await harness.flush();
    const ready = scenario === "ready-card" || scenario === "ready-detail";
    assert.equal(final.selectedOrder?.deliveryIntent === "ready", ready);
    if (ready) {
      assert.equal(final.selected, null); assert.equal(final.selectedOrder?.queryDate, checklistDate);
      final.consumeOrderDeliveryIntent();
      const consumed = await harness.flush();
      assert.equal(consumed.selectedOrder?.deliveryIntent, undefined);
      consumed.openWork(group, work);
      (await harness.flush()).closeWork();
      assert.equal((await harness.flush()).selectedOrder?.deliveryIntent, undefined);
    }
    assert.equal(harness.deliveryReads.length, scenario === "failed-write" ? 0 : 1);
    assert.ok(harness.deliveryReads.every(read => read.requireFresh === true));
    assert.equal(harness.calls.statuses, 1);
  });
}