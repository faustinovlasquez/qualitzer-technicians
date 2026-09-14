import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { Session } from "../src/domain/models";
import type { NotificationInboxItem, NotificationStatus } from "../src/domain/notifications";
import type { NativeNotification, NativeNotificationResponse, NotificationAdapter, NotificationApi } from "../src/notifications/contracts";
import { MobileNotificationClient } from "../src/notifications/MobileNotificationClient";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../src/notifications/notificationSafety";
import type { NotificationCenterScreen } from "../src/screens/notifications/NotificationCenterScreen";
import * as presentation from "../src/screens/notifications/notificationPresentation";
import * as theme from "../src/ui/theme";

const timestamp = "2026-09-12T12:00:00.000Z";
const projectId = "0fe95e1e-0dbb-4311-9b79-bd31bc0d41f3";
const installationId = "fa4c5b12-317e-42fd-ac53-cb22c0e0587b";
const session: Session = {
  token: "inbox-fixture-only", branchId: 2, mode: "live",
  tenant: { id: "test", name: "Test", portalOrigin: "https://tenant.example", environment: "production" },
  user: { id: 10, workerId: 20, name: "Test", lastnames: "", email: "", role: { name: "Technician" }, accessBranchs: [{ id: 2, name: "Test", main: true }], system: { name: "Test", timezone: "UTC" } },
};

function row(index: number, read = false): NotificationInboxItem {
  const id = `a1ecc4bb-c526-4607-980e-${index.toString(16).padStart(12, "0")}`;
  return { id, kind: "WORK_TECHNICIAN_ASSIGNED", state: index % 2 ? "pending" : "receipt_ok", lastFailure: null,
    readAt: read ? timestamp : null, createdAt: timestamp,
    data: { eventId: id, tenantOrigin: session.tenant.portalOrigin, companyBranchId: 2, kind: "WORK_TECHNICIAN_ASSIGNED", groupType: "work", groupId: index, workId: index, date: "2026-09-12" } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(initial = Array.from({ length: 60 }, (_, index) => row(index + 1, index >= 40))) {
  let rows = structuredClone(initial);
  let current = true;
  let allowed = true;
  let legacy = false;
  let canDelete = true;
  let failInbox = false;
  let permission: "undetermined" | "granted" = "undetermined";
  let consent = false;
  let last: NativeNotificationResponse | null = null;
  let presented: NativeNotification[] = [];
  let listeners: Parameters<NotificationAdapter["subscribe"]>[0] | null = null;
  let status: NotificationStatus = { enabled: true, reasons: [], projectId, reconciliationSeconds: 120, deliveryGuaranteed: false, device: null };
  const calls: string[] = [];
  const inboxCalls: Array<{ page: number; unreadOnly: boolean | undefined }> = [];
  const deletes: string[] = [];
  const reads: string[] = [];
  const badges: number[] = [];
  const dismissed: string[] = [];
  const cleared: string[] = [];
  let refreshes = 0;
  const api: NotificationApi = {
    async notificationStatus(captured) { calls.push("status"); assert.equal(captured, session); return status; },
    async notificationRegister(captured, input) {
      calls.push("register"); assert.equal(captured, session);
      status = { ...status, device: { installationId, active: true, disabledReason: null, preferences: input.preferences } };
      return { installationId, active: true, preferences: input.preferences, baselineCapturedAt: timestamp };
    },
    async notificationUnregister(captured) { calls.push("unregister"); assert.equal(captured, session); status = { ...status, device: null }; },
    async notificationInbox(captured, page, unreadOnly) {
      calls.push("inbox"); assert.equal(captured, session); inboxCalls.push({ page, unreadOnly });
      if (failInbox) throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE");
      const matching = unreadOnly ? rows.filter(entry => entry.readAt === null) : rows;
      return { items: structuredClone(matching.slice((page - 1) * 25, page * 25)), page, pageSize: 25,
        ...(legacy ? {} : { total: matching.length, unreadCount: rows.filter(entry => entry.readAt === null).length, canDelete }) };
    },
    async notificationRead(captured, id) {
      calls.push("read"); assert.equal(captured, session); assert.ok(rows.some(entry => entry.id === id)); reads.push(id);
      rows = rows.map(entry => entry.id === id ? { ...entry, readAt: entry.readAt ?? timestamp } : entry);
      return { id, read: true };
    },
    async notificationDelete(captured, id) {
      calls.push("delete"); assert.equal(captured, session); assert.ok(rows.some(entry => entry.id === id)); deletes.push(id);
      rows = rows.filter(entry => entry.id !== id); return { id, deleted: true };
    },
    async notificationTest(...args) { calls.push("test"); assert.deepEqual(args, [session]); return { eventId: row(500).id, state: "pending" }; },
  };
  const adapter: NotificationAdapter = {
    platform: "android", unsupportedReason: null, projectId,
    async getPermission() { calls.push("permission"); return permission; },
    async requestPermission() { calls.push("requestPermission"); permission = "granted"; return permission; },
    async prepareChannel() { calls.push("channel"); },
    async getExpoToken() { calls.push("token"); return "ExpoPushToken[fixtureonly12345]"; },
    async getInstallationId() { calls.push("installation"); return installationId; },
    async readConsent() { calls.push("consent"); return consent; },
    async writeConsent(_key, value) { calls.push("writeConsent"); consent = value; },
    subscribe(value) { listeners = value; return () => { listeners = null; }; },
    async lastResponse() { calls.push("lastResponse"); return last; },
    async clearResponse(id) { calls.push("clearResponse"); cleared.push(id); if (last?.identifier === id) last = null; },
    async presented() { calls.push("presented"); return presented; },
    async dismiss(id) { calls.push("dismiss"); dismissed.push(id); presented = presented.filter(entry => entry.identifier !== id); },
    async setBadge(count) { calls.push("badge"); badges.push(count); return true; },
    async openSettings() { calls.push("settings"); },
  };
  const client = new MobileNotificationClient({ session, storageKey: "inbox-fixture", api, adapter,
    isCurrent: () => current, isInteractionAllowed: () => allowed,
    onOpen() { calls.push("open"); return true; },
    onForegroundRefresh(context) { assert.equal(context.isCurrent(), true); refreshes += 1; },
  });
  return { client, api, adapter, calls, inboxCalls, deletes, reads, badges, dismissed, cleared,
    get listeners() { assert.ok(listeners); return listeners; }, get rows() { return rows; }, get refreshes() { return refreshes; },
    setCurrent(value: boolean) { current = value; }, setAllowed(value: boolean) { allowed = value; },
    setLegacy(value: boolean) { legacy = value; }, setCanDelete(value: boolean) { canDelete = value; },
    setFailInbox(value: boolean) { failInbox = value; },
    setPresented(value: NativeNotification[]) { presented = value; }, setLast(value: NativeNotificationResponse) { last = value; },
  };
}

test("automatic refresh uses global unread count above 25 for the exact native badge, never page or delivery counts", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const state = f.client.getSnapshot();
  assert.equal(state.inbox.length, 25); assert.equal(state.unreadCount, 40); assert.equal(state.total, 60);
  assert.equal(state.canDelete, true); assert.equal(state.hasMore, true);
  assert.deepEqual(f.badges, [40]);
  assert.ok(state.inbox.some(entry => entry.state === "receipt_ok" && entry.readAt === null));
});

test("failed delete preserves row, global counts and native notifications without resetting the badge", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const before = f.client.getSnapshot(); const badges = [...f.badges]; const lookups = f.inboxCalls.length;
  let attempts = 0;
  f.api.notificationDelete = async () => { attempts += 1; throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE"); };
  assert.equal(await f.client.deleteNotification(row(1).id), false);
  const after = f.client.getSnapshot();
  assert.equal(attempts, 1); assert.deepEqual(after.inbox, before.inbox);
  assert.equal(after.unreadCount, 40); assert.equal(after.total, 60); assert.equal(after.page, before.page);
  assert.equal(after.inboxError, "MOBILE_PUSH_DATABASE_UNAVAILABLE"); assert.equal(after.notice, null);
  assert.deepEqual(f.badges, badges); assert.equal(f.inboxCalls.length, lookups);
  assert.deepEqual(f.dismissed, []); assert.deepEqual(f.cleared, []);
});

test("acknowledged delete removes one row and decrements server count, dismissing only that owned event", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const target = row(1);
  f.setPresented([{ identifier: "own-a", data: target.data }, { identifier: "own-b", data: target.data },
    { identifier: "another-event", data: row(2).data }, { identifier: "another-tenant", data: { ...target.data, tenantOrigin: "https://other.example" } },
    { identifier: "another-branch", data: { ...target.data, companyBranchId: 3 } },
    { identifier: "tampered-resource", data: { ...target.data, workId: 900 } }]);
  f.setLast({ identifier: "own-response", data: target.data, defaultAction: true });
  assert.equal(await f.client.deleteNotification(target.id), true);
  assert.deepEqual(f.deletes, [target.id]); assert.equal(f.rows.length, 59);
  assert.equal(f.rows.filter(entry => entry.readAt === null).length, 39);
  const state = f.client.getSnapshot();
  assert.equal(state.inbox.some(entry => entry.id === target.id), false);
  assert.equal(state.inbox.length, 25); assert.equal(state.unreadCount, 39); assert.equal(state.total, 59);
  assert.deepEqual(f.badges, [40, 39]); assert.ok(!f.badges.includes(0));
  assert.deepEqual(f.dismissed, ["own-a", "own-b"]); assert.deepEqual(f.cleared, ["own-response"]);
  assert.match(state.notice ?? "", /eliminada/);
  assert.equal(await f.client.deleteNotification(target.id), false); assert.deepEqual(f.deletes, [target.id]);
});

test("refresh failure after delete acknowledgement preserves the confirmed deletion and does not clear another response", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  f.setLast({ identifier: "other-response", data: row(2).data, defaultAction: true });
  f.setFailInbox(true);
  assert.equal(await f.client.deleteNotification(row(1).id), true);
  const state = f.client.getSnapshot();
  assert.equal(state.inbox.some(entry => entry.id === row(1).id), false);
  assert.equal(state.inbox.length, 24); assert.equal(state.unreadCount, 39); assert.equal(state.total, 59);
  assert.equal(state.error, null); assert.match(state.notice ?? "", /eliminada.*Actualiza/i);
  assert.equal(f.badges.at(-1), 39); assert.ok(!f.badges.includes(0)); assert.deepEqual(f.cleared, []);
});

test("old API filters loaded pages locally and blocks deletes without inventing global totals", async t => {
  const f = fixture(); f.setLegacy(true); t.after(f.client.start()); await f.client.refresh();
  const state = f.client.getSnapshot();
  assert.equal(state.inbox.length, 25); assert.equal(state.unreadCount, null); assert.equal(state.total, null);
  assert.equal(state.canDelete, false); assert.equal(state.hasMore, true);
  const calls = f.inboxCalls.length;
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.equal(await f.client.deleteNotification(row(1).id), false);
  assert.equal(f.inboxCalls.length, calls); assert.deepEqual(f.deletes, []);
  assert.equal(f.client.getSnapshot().unreadOnly, true);
  assert.equal(f.client.getSnapshot().filterLocal, true);
  assert.equal(await f.client.loadInbox(true), true);
  assert.equal(f.client.getSnapshot().inbox.length, 40);
  assert.equal(f.client.getSnapshot().unreadCount, null); assert.equal(f.client.getSnapshot().total, null);
  assert.ok(f.inboxCalls.every(call => call.unreadOnly === false));
  assert.deepEqual(f.badges, []);
  assert.equal(await f.client.markRead(row(1).id), true);
  assert.deepEqual(f.badges, []);
  await f.client.revokeForSession();
  assert.deepEqual(f.badges, [0]);
});

test("a legacy inbox refresh never replaces a previously known native unread badge with zero", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const badges = [...f.badges]; assert.equal(badges.at(-1), 40);
  f.setLegacy(true); assert.equal(await f.client.loadInbox(), true);
  assert.equal(f.client.getSnapshot().unreadCount, null); assert.equal(f.client.getSnapshot().total, null);
  assert.equal(await f.client.markRead(row(1).id), true);
  assert.deepEqual(f.badges, badges);
  await f.client.revokeForSession(); assert.deepEqual(f.badges, [...badges, 0]);
});

test("server unreadOnly filter paginates unread rows and retains global unread count across pages", async t => {
  const rows = Array.from({ length: 80 }, (_, index) => row(index + 1, index % 2 === 0));
  const f = fixture(rows); t.after(f.client.start()); await f.client.refresh();
  assert.equal(f.client.getSnapshot().total, 80);
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.deepEqual(f.inboxCalls.at(-1), { page: 1, unreadOnly: true });
  assert.deepEqual(f.client.getSnapshot().inbox.map(entry => entry.id), rows.filter(entry => !entry.readAt).slice(0, 25).map(entry => entry.id));
  assert.equal(f.client.getSnapshot().unreadCount, 40); assert.equal(f.client.getSnapshot().total, 40);
  assert.equal(await f.client.loadInbox(true), true);
  assert.deepEqual(f.inboxCalls.at(-1), { page: 2, unreadOnly: true });
  const state = f.client.getSnapshot();
  assert.equal(state.inbox.length, 40); assert.equal(state.page, 2); assert.equal(state.hasMore, false);
  assert.equal(state.unreadCount, 40); assert.equal(new Set(state.inbox.map(entry => entry.id)).size, 40);
  assert.ok(state.inbox.every(entry => entry.readAt === null)); assert.ok(f.badges.every(count => count === 40));
  const calls = f.inboxCalls.length; await f.client.loadInbox(true); assert.equal(f.inboxCalls.length, calls);
  await f.client.loadInbox(false, false); assert.equal(f.client.getSnapshot().total, 80);
  assert.deepEqual(f.inboxCalls.at(-1), { page: 1, unreadOnly: false });
});

test("mark read updates the global count once, persists across fresh reads and cannot make badges negative", async t => {
  const f = fixture([row(1), row(2, true)]); t.after(f.client.start()); await f.client.refresh();
  assert.equal(await f.client.markRead(row(1).id), true);
  const readAt = f.client.getSnapshot().inbox[0].readAt; assert.ok(readAt);
  assert.equal(f.client.getSnapshot().unreadCount, 0); assert.equal(f.client.getSnapshot().total, 2);
  assert.equal(await f.client.markRead(row(1).id), true);
  assert.equal(await f.client.markRead(row(2).id), true);
  assert.equal(f.client.getSnapshot().unreadCount, 0); assert.equal(f.client.getSnapshot().inbox[0].readAt, readAt);
  assert.deepEqual(f.badges, [1, 0]);
  assert.equal(await f.client.deleteNotification(row(2).id), true);
  assert.equal(f.client.getSnapshot().unreadCount, 0); assert.equal(f.client.getSnapshot().total, 1);
});

test("mark read in filtered view removes the row and refreshes global count beyond the loaded page", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh(); await f.client.loadInbox(false, true);
  assert.equal(await f.client.markRead(row(1).id), true);
  const state = f.client.getSnapshot();
  assert.equal(state.unreadCount, 39); assert.equal(state.total, 39); assert.equal(state.inbox.length, 25);
  assert.equal(state.inbox.some(entry => entry.id === row(1).id), false);
  assert.deepEqual(f.inboxCalls.at(-1), { page: 1, unreadOnly: true });
  const reads = f.reads.length; assert.equal(await f.client.markRead(row(1).id), false);
  assert.equal(f.reads.length, reads); assert.equal(f.client.getSnapshot().unreadCount, 39);
});

for (const count of [1, 60]) {
  test(`filtered read acknowledgement survives refresh failure with ${count} unread rows and never decrements twice`, async t => {
    const f = fixture(Array.from({ length: count }, (_, index) => row(index + 1)));
    t.after(f.client.start()); await f.client.refresh(); await f.client.loadInbox(false, true);
    const before = f.client.getSnapshot(); f.setFailInbox(true);
    assert.equal(await f.client.markRead(row(1).id), true);
    const after = f.client.getSnapshot();
    assert.equal(after.unreadOnly, true); assert.equal(after.unreadCount, count - 1); assert.equal(after.total, count - 1);
    assert.equal(after.inbox.length, before.inbox.length - 1);
    assert.equal(after.inbox.some(entry => entry.id === row(1).id), false);
    assert.deepEqual(after.inbox, before.inbox.filter(entry => entry.id !== row(1).id));
    assert.equal(after.error, null); assert.match(after.notice ?? "", /Lectura guardada.*Actualiza/);
    assert.equal(f.badges.at(-1), count - 1); assert.ok(f.badges.every(value => value >= 0));
    const badges = [...f.badges]; const lookups = f.inboxCalls.length;
    assert.equal(await f.client.markRead(row(1).id), false);
    assert.deepEqual(f.reads, [row(1).id]); assert.equal(f.inboxCalls.length, lookups); assert.deepEqual(f.badges, badges);
    assert.equal(f.client.getSnapshot().unreadCount, count - 1); assert.equal(f.client.getSnapshot().total, count - 1);
  });
}

test("late delete acknowledgement after session changes cannot publish or touch the next private session", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const entered = deferred<void>(); const release = deferred<void>(); const original = f.api.notificationDelete;
  f.api.notificationDelete = async (captured, id) => { entered.resolve(); await release.promise; return original(captured, id); };
  let publications = 0; t.after(f.client.subscribe(() => { publications += 1; }));
  const pending = f.client.deleteNotification(row(1).id); await entered.promise;
  f.setCurrent(false);
  const snapshot = f.client.getSnapshot(); const count = publications;
  const badges = [...f.badges]; const inboxCalls = f.inboxCalls.length;
  release.resolve(); assert.equal(await pending, false);
  assert.equal(f.rows.some(entry => entry.id === row(1).id), false);
  assert.equal(f.client.getSnapshot(), snapshot); assert.equal(publications, count);
  assert.deepEqual(f.badges, badges); assert.equal(f.inboxCalls.length, inboxCalls);
  assert.deepEqual(f.dismissed, []); assert.deepEqual(f.cleared, []);
});

test("repeated received callbacks for the same owned event refresh foreground work only once", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const received = { identifier: "received-first", data: row(1).data };
  f.listeners.received(received); f.listeners.received({ ...received, identifier: "received-again" });
  await f.client.loadInbox(); assert.equal(f.refreshes, 1);
  const lookups = f.inboxCalls.length;
  f.listeners.received(received); await f.client.markRead(row(1).id);
  assert.equal(f.refreshes, 1); assert.equal(f.inboxCalls.length, lookups + 1);
  f.listeners.received({ identifier: "different-event", data: row(2).data });
  await f.client.loadInbox(); assert.equal(f.refreshes, 2);
});

test("simultaneous sendTest calls share one server request and allow a later deliberate test", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.retryEnable();
  const entered = deferred<void>(); const release = deferred<void>(); const original = f.api.notificationTest;
  f.api.notificationTest = async captured => { entered.resolve(); await release.promise; return original(captured); };
  const first = f.client.sendTest(); const second = f.client.sendTest();
  assert.equal(first, second); await entered.promise; release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.calls.filter(call => call === "test").length, 1);
  assert.match(f.client.getSnapshot().notice ?? "", /pendiente/);
  await f.client.sendTest(); assert.equal(f.calls.filter(call => call === "test").length, 2);
});

test("accepted test with a failed inbox refresh returns success and warns against resending without another server request", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.retryEnable();
  const before = f.client.getSnapshot(); const badges = [...f.badges];
  const entered = deferred<void>(); const release = deferred<void>(); const original = f.api.notificationTest;
  f.api.notificationTest = async captured => { const result = await original(captured); entered.resolve(); await release.promise; return result; };
  t.after(() => release.resolve());
  const first = f.client.sendTest(); await entered.promise;
  const second = f.client.sendTest(); assert.equal(first, second);
  f.setFailInbox(true); const lookups = f.inboxCalls.length; release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.calls.filter(call => call === "test").length, 1); assert.equal(f.inboxCalls.length, lookups + 1);
  const after = f.client.getSnapshot();
  const notice = "Prueba registrada. Actualiza la bandeja; no vuelvas a enviarla por un fallo de actualización.";
  assert.equal(after.notice, notice); assert.equal(after.error, null); assert.equal(after.busy, false);
  assert.deepEqual(after.inbox, before.inbox); assert.equal(after.unreadCount, before.unreadCount);
  assert.equal(after.total, before.total); assert.deepEqual(f.badges, badges);
  assert.match(renderCenter(f.client), /Prueba registrada\..*no vuelvas a enviarla/);
  assert.equal(presentation.notificationNoticeMessage(notice), notice);
  f.setFailInbox(false); assert.equal(await f.client.loadInbox(), true);
  assert.equal(f.calls.filter(call => call === "test").length, 1);
});

for (const operation of ["retryEnable", "savePreferences"] as const) {
  test(`${operation} cannot register an Expo token obtained after the app locks`, async t => {
    const f = fixture(); t.after(f.client.start()); await f.client.refresh();
    if (operation === "savePreferences") assert.equal(await f.client.retryEnable(), true);
    const before = f.client.getSnapshot(); const registrations = f.calls.filter(call => call === "register").length;
    const entered = deferred<void>(); const release = deferred<string>();
    f.adapter.getExpoToken = async () => { f.calls.push("token"); entered.resolve(); return release.promise; };
    t.after(() => release.resolve("ExpoPushToken[fixtureonly12345]"));
    const pending = operation === "retryEnable" ? f.client.retryEnable()
      : f.client.savePreferences({ ...before.preferences, remindAfterMinutes: 60 });
    await entered.promise; f.setAllowed(false); release.resolve("ExpoPushToken[fixtureonly12345]");
    assert.equal(await pending, false);
    assert.equal(f.calls.filter(call => call === "register").length, registrations);
    const after = f.client.getSnapshot();
    assert.deepEqual(after.preferences, before.preferences); assert.deepEqual(after.status?.device, before.status?.device);
    assert.equal(after.registered, before.registered); assert.equal(after.error, "MOBILE_PUSH_APP_LOCKED");
    assert.equal(after.notice, null); assert.equal(after.busy, false);
  });
}

test("locking during the permission prompt prevents consent writes, token exchange and registration", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const before = f.client.getSnapshot(); const entered = deferred<void>(); const release = deferred<"granted">();
  f.adapter.requestPermission = async () => { f.calls.push("requestPermission"); entered.resolve(); return release.promise; };
  t.after(() => release.resolve("granted"));
  const pending = f.client.retryEnable(); await entered.promise;
  f.setAllowed(false); release.resolve("granted"); assert.equal(await pending, false);
  for (const call of ["writeConsent", "token", "register"]) assert.equal(f.calls.includes(call), false, call);
  const after = f.client.getSnapshot();
  assert.equal(after.permission, "granted"); assert.equal(after.optedIn, false); assert.equal(after.registered, false);
  assert.deepEqual(after.preferences, before.preferences); assert.equal(after.error, "MOBILE_PUSH_APP_LOCKED");
  assert.equal(after.notice, null);
});

test("locking during channel preparation prevents the interactive permission prompt", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const entered = deferred<void>(); const release = deferred<void>();
  f.adapter.prepareChannel = async () => { f.calls.push("channel"); entered.resolve(); await release.promise; };
  t.after(() => release.resolve());
  const pending = f.client.retryEnable(); await entered.promise;
  f.setAllowed(false); release.resolve(); assert.equal(await pending, false);
  for (const call of ["requestPermission", "writeConsent", "token", "register"]) assert.equal(f.calls.includes(call), false, call);
  assert.equal(f.client.getSnapshot().error, "MOBILE_PUSH_APP_LOCKED");
  assert.deepEqual(f.client.getSnapshot().preferences, DEFAULT_NOTIFICATION_PREFERENCES);
});

for (const operation of ["read", "delete"] as const) {
  test(`an already sent ${operation} still publishes its confirmed result when the same session locks`, async t => {
    const f = fixture([row(1), row(2)]); t.after(f.client.start()); await f.client.refresh();
    const target = row(1); f.setPresented([{ identifier: "confirmed-own", data: target.data }]);
    const entered = deferred<void>(); const release = deferred<void>();
    if (operation === "read") {
      const original = f.api.notificationRead;
      f.api.notificationRead = async (captured, id) => { const result = await original(captured, id); entered.resolve(); await release.promise; return result; };
    } else {
      const original = f.api.notificationDelete;
      f.api.notificationDelete = async (captured, id) => { const result = await original(captured, id); entered.resolve(); await release.promise; return result; };
    }
    t.after(() => release.resolve());
    const pending = operation === "read" ? f.client.markRead(target.id) : f.client.deleteNotification(target.id);
    await entered.promise; f.setAllowed(false); release.resolve(); assert.equal(await pending, true);
    const after = f.client.getSnapshot();
    assert.equal(after.error, null); assert.equal(after.unreadCount, 1); assert.equal(after.total, operation === "read" ? 2 : 1);
    if (operation === "read") assert.ok(after.inbox.find(entry => entry.id === target.id)?.readAt);
    else assert.equal(after.inbox.some(entry => entry.id === target.id), false);
    assert.deepEqual(operation === "read" ? f.reads : f.deletes, [target.id]);
    assert.deepEqual(f.dismissed, ["confirmed-own"]); assert.equal(f.badges.at(-1), 1);
    const calls = [...f.calls];
    assert.equal(await (operation === "read" ? f.client.markRead(target.id) : f.client.deleteNotification(target.id)), false);
    assert.deepEqual(f.calls, calls);
  });
}

test("blocked interaction prevents inbox, delete, read, navigation, settings, opt-in and test side effects", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.retryEnable(); await f.client.loadInbox();
  f.setAllowed(false); const calls = [...f.calls]; const before = f.client.getSnapshot();
  await f.client.loadInbox(); await f.client.loadInbox(false, true); await f.client.markRead(row(1).id);
  await f.client.deleteNotification(row(1).id); await f.client.openInboxItem(row(1).id);
  await f.client.handleResponse({ identifier: "locked", data: row(1).data, defaultAction: true });
  await f.client.sendTest(); await f.client.retryEnable(); await f.client.savePreferences(DEFAULT_NOTIFICATION_PREFERENCES);
  await f.client.disable(); await f.client.openSettings();
  assert.deepEqual(f.calls, calls); assert.deepEqual(f.client.getSnapshot().inbox, before.inbox);
  assert.equal(f.client.getSnapshot().unreadCount, before.unreadCount);
});

function renderCenter(client: MobileNotificationClient): string {
  interface HostProps { children?: React.ReactNode; title?: string; message?: string; label?: string; accessibilityLabel?: string; disabled?: boolean; }
  function Host(props: HostProps) { return React.createElement("div", { "aria-label": props.label ?? props.accessibilityLabel, "aria-disabled": props.disabled }, props.title, props.message, props.children); }
  const exported: { NotificationCenterScreen?: typeof NotificationCenterScreen } = {};
  const source = readFileSync(resolve(__dirname, "../src/screens/notifications/NotificationCenterScreen.tsx"), "utf8");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, { exports: exported, require(name: string): unknown {
    switch (name) {
      case "react": return React;
      case "react/jsx-runtime": return jsxRuntime;
      case "react-native": return { Pressable: Host, RefreshControl: Host, ScrollView: Host, Text: Host, View: Host, StyleSheet: { create: (value: unknown) => value } };
      case "@expo/vector-icons": return { Ionicons: () => null };
      case "react-native-safe-area-context": return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
      case "../../security/DeviceSecurityContext": return { DeviceSecurityContext: React.createContext(null), PrivateModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) => visible ? children : null };
      case "../../ui/components": return { BodyText: Host, Button: Host, Card: Host, EmptyState: Host, IconButton: Host, SectionTitle: Host };
      case "../../ui/theme": return theme;
      case "./notificationPresentation": return presentation;
      default: throw new Error(`UNEXPECTED_UI_IMPORT: ${name}`);
    }
  } });
  const Screen = exported.NotificationCenterScreen; assert.ok(Screen);
  return renderToStaticMarkup(React.createElement(Screen, { notifications: { client, state: client.getSnapshot(), storageKey: "inbox-fixture", revokeForSession: client.revokeForSession } }));
}

test("explicit canDelete false preserves server counts but offers no delete UI or delete request", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  assert.match(renderCenter(f.client), /aria-label="Eliminar:/);
  f.setCanDelete(false); await f.client.loadInbox();
  assert.equal(f.client.getSnapshot().unreadCount, 40); assert.equal(f.client.getSnapshot().total, 60);
  assert.equal(f.client.getSnapshot().canDelete, false);
  const html = renderCenter(f.client);
  assert.doesNotMatch(html, /aria-label="Eliminar:|Eliminar notificación/);
  assert.match(html, /Marcar como leída:/);
  assert.equal(await f.client.deleteNotification(row(1).id), false); assert.deepEqual(f.deletes, []);
});

test("startup and screen loading coalesce the same read while a pending Expo token never blocks filters or inbox mutations", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const entered = deferred<void>(); const token = deferred<string>();
  f.adapter.readConsent = async () => true;
  f.adapter.getPermission = async () => "granted";
  f.adapter.getExpoToken = async () => { entered.resolve(); return token.promise; };
  t.after(f.client.start());
  const refresh = f.client.refresh();
  assert.equal(await f.client.loadInbox(), true);
  await entered.promise;
  assert.equal(f.inboxCalls.length, 1);
  assert.equal(f.calls.filter(call => call === "status").length, 1);
  assert.equal(f.client.getSnapshot().busy, true);
  assert.equal(f.client.getSnapshot().inboxBusy, false);
  const html = renderCenter(f.client);
  assert.match(html, /aria-label="Actualizar notificaciones" aria-disabled="false"/);
  assert.doesNotMatch(html, /Cargando notificaciones|No pudimos actualizar/);
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.equal(f.client.getSnapshot().unreadOnly, true);
  assert.equal(await f.client.markRead(row(1).id), true);
  assert.equal(await f.client.deleteNotification(row(2).id), true);
  assert.equal(await f.client.openInboxItem(row(3).id), true);
  assert.deepEqual(f.reads, [row(1).id, row(3).id]);
  assert.deepEqual(f.deletes, [row(2).id]);
  assert.equal(f.client.getSnapshot().unreadCount, 37);
  assert.deepEqual(f.badges, [40, 39, 38, 37]);
  assert.equal(await f.client.loadInbox(false, false), true);
  assert.equal(f.client.getSnapshot().unreadOnly, false);
  assert.equal(f.calls.includes("register"), false);
  t.mock.timers.tick(20_000);
  assert.equal(await refresh, false);
  assert.equal(f.client.getSnapshot().error, "MOBILE_PUSH_NATIVE_TIMEOUT");
  assert.equal(f.client.getSnapshot().inboxError, null);
  assert.equal(f.client.getSnapshot().busy, false);
  token.resolve("ExpoPushToken[latetoken12345]");
  await Promise.resolve();
  assert.equal(f.calls.includes("register"), false);
  assert.equal(f.client.getSnapshot().registered, false);
  assert.doesNotMatch(renderCenter(f.client), /No pudimos actualizar la bandeja/);
});

test("legacy first 25 read rows remain pageable in unread view and next 15 unread rows retain raw progress and unknown totals", async t => {
  const rows = Array.from({ length: 40 }, (_, index) => row(index + 1, index < 25));
  const f = fixture(rows); f.setLegacy(true); t.after(f.client.start()); await f.client.refresh();
  const calls = f.inboxCalls.length;
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.equal(f.inboxCalls.length, calls);
  let state = f.client.getSnapshot();
  assert.equal(state.inbox.length, 0); assert.equal(state.page, 1); assert.equal(state.hasMore, true);
  assert.equal(state.filterLocal, true); assert.equal(state.unreadCount, null); assert.equal(state.total, null);
  const html = renderCenter(f.client);
  assert.match(html, /Filtro sobre avisos cargados/);
  assert.match(html, /No hay avisos sin leer entre los cargados/);
  assert.match(html, /Cargar más notificaciones/);
  assert.doesNotMatch(html, /No tienes avisos sin leer|Tu bandeja está al día|Para filtrar/);
  assert.equal(await f.client.loadInbox(true, true), true);
  state = f.client.getSnapshot();
  assert.deepEqual(state.inbox.map(item => item.id), rows.slice(25).map(item => item.id));
  assert.equal(state.page, 2); assert.equal(state.hasMore, false);
  assert.equal(state.unreadCount, null); assert.equal(state.total, null);
  assert.equal(await f.client.deleteNotification(row(26).id), false); assert.deepEqual(f.deletes, []);
  assert.equal(await f.client.loadInbox(false, false), true);
  assert.equal(f.client.getSnapshot().inbox.length, 40); assert.equal(f.client.getSnapshot().page, 2);
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.equal(f.client.getSnapshot().inbox.length, 15); assert.equal(f.client.getSnapshot().page, 2);
  assert.deepEqual(f.inboxCalls.slice(calls), [{ page: 2, unreadOnly: false }]);
  assert.deepEqual(f.badges, []);
});

test("unknown legacy capability starts unread with one bounded unfiltered page and never prefetches the whole inbox", async t => {
  const f = fixture(Array.from({ length: 200 }, (_, index) => row(index + 1, index < 150)));
  f.setLegacy(true); t.after(f.client.start());
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.deepEqual(f.inboxCalls, [{ page: 1, unreadOnly: false }]);
  assert.equal(f.client.getSnapshot().inbox.length, 0);
  assert.equal(f.client.getSnapshot().unreadOnly, true);
  assert.equal(f.client.getSnapshot().hasMore, true);
  assert.equal(f.client.getSnapshot().unreadCount, null);
});

test("server claiming filter support but returning read rows falls back to raw pages without pretending a global unread result", async t => {
  const f = fixture(Array.from({ length: 40 }, (_, index) => row(index + 1, index < 25)));
  t.after(f.client.start()); await f.client.refresh();
  const original = f.api.notificationInbox;
  f.api.notificationInbox = (captured, page) => original(captured, page, false);
  const calls = f.inboxCalls.length;
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.equal(f.inboxCalls.length, calls + 2);
  let state = f.client.getSnapshot();
  assert.equal(state.filterLocal, true); assert.equal(state.unreadOnly, true);
  assert.equal(state.inbox.length, 0); assert.equal(state.hasMore, true);
  assert.equal(state.total, null); assert.equal(state.unreadCount, 15);
  assert.equal(await f.client.loadInbox(true, true), true);
  state = f.client.getSnapshot();
  assert.equal(state.inbox.length, 15); assert.equal(state.page, 2); assert.equal(state.hasMore, false);
  assert.ok(state.inbox.every(item => item.readAt === null));
  assert.equal(f.inboxCalls.length, calls + 3);
});

test("legacy capability disappearing on a filtered page restarts raw page one, not a filtered page offset", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh(); await f.client.loadInbox(false, true);
  f.setLegacy(true);
  assert.equal(await f.client.loadInbox(true, true), true);
  const state = f.client.getSnapshot();
  assert.equal(state.filterLocal, true); assert.equal(state.canDelete, false); assert.equal(state.page, 1);
  assert.equal(state.unreadCount, null); assert.equal(state.total, null);
  assert.deepEqual(f.inboxCalls.slice(-2), [{ page: 2, unreadOnly: true }, { page: 1, unreadOnly: false }]);
  assert.equal(await f.client.deleteNotification(row(1).id), false); assert.deepEqual(f.deletes, []);
});

test("filter changes during an older read preserve the latest view without discarding authoritative unread updates", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const original = f.api.notificationInbox; const entered = deferred<void>(); const release = deferred<void>();
  let held = false;
  f.api.notificationInbox = async (captured, page, unreadOnly) => {
    if (unreadOnly && !held) { held = true; entered.resolve(); await release.promise; }
    return original(captured, page, unreadOnly);
  };
  const unread = f.client.loadInbox(false, true); await entered.promise;
  const all = f.client.loadInbox(false, false);
  assert.equal(f.client.getSnapshot().unreadOnly, false);
  assert.equal(f.client.getSnapshot().inbox.length, 25);
  const published: boolean[] = [];
  t.after(f.client.subscribe(() => published.push(f.client.getSnapshot().unreadOnly)));
  release.resolve(); assert.deepEqual(await Promise.all([unread, all]), [true, true]);
  assert.ok(published.every(value => value === false));
  assert.equal(f.client.getSnapshot().unreadCount, 40);
  assert.equal(f.client.getSnapshot().total, 60);
  assert.deepEqual(f.badges, [40]);
  assert.equal(f.client.getSnapshot().inboxBusy, false);
});

test("received-notice ownership lookup cannot reset a filter selected while that lookup is pending", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const original = f.api.notificationInbox; const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationInbox = async (captured, page, unreadOnly) => {
    if (unreadOnly === undefined) { entered.resolve(); await release.promise; }
    return original(captured, page, unreadOnly);
  };
  f.listeners.received({ identifier: "notice", data: row(1).data }); await entered.promise;
  const filter = f.client.loadInbox(false, true);
  assert.equal(f.client.getSnapshot().unreadOnly, true);
  release.resolve(); assert.equal(await filter, true);
  assert.equal(f.client.getSnapshot().unreadOnly, true);
  assert.equal(f.client.getSnapshot().total, 40);
  assert.equal(f.refreshes, 1);
  assert.ok(f.client.getSnapshot().inbox.every(item => item.readAt === null));
  assert.deepEqual(f.inboxCalls.slice(-2), [{ page: 1, unreadOnly: true }, { page: 1, unreadOnly: true }]);
});

test("load, read and delete share one ordered inbox lane even while push registration uses its own lane", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const original = f.api.notificationRead; const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationRead = async (captured, id) => { entered.resolve(); await release.promise; return original(captured, id); };
  const read = f.client.markRead(row(1).id); await entered.promise;
  const calls = f.inboxCalls.length;
  const remove = f.client.deleteNotification(row(2).id);
  const load = f.client.loadInbox();
  await Promise.resolve();
  assert.equal(f.client.getSnapshot().inboxBusy, true);
  assert.deepEqual(f.deletes, []); assert.equal(f.inboxCalls.length, calls);
  release.resolve(); assert.deepEqual(await Promise.all([read, remove, load]), [true, true, true]);
  assert.deepEqual(f.calls.filter(call => call === "read" || call === "delete"), ["read", "delete"]);
  assert.equal(f.client.getSnapshot().unreadCount, 38);
  assert.equal(f.client.getSnapshot().total, 59);
  assert.equal(f.client.getSnapshot().inboxBusy, false);
});

for (const action of ["openInboxItem", "handleResponse"] as const) {
  test(`${action} rechecks the lock after ownership lookup before navigation or read mutation`, async t => {
    const f = fixture(); t.after(f.client.start()); await f.client.refresh();
    const original = f.api.notificationInbox; const entered = deferred<void>(); const release = deferred<void>();
    f.api.notificationInbox = async (captured, page, unreadOnly) => { entered.resolve(); await release.promise; return original(captured, page, unreadOnly); };
    const pending = action === "openInboxItem" ? f.client.openInboxItem(row(1).id)
      : f.client.handleResponse({ identifier: "locked-mid-lookup", data: row(1).data, defaultAction: true });
    await entered.promise; f.setAllowed(false); release.resolve();
    assert.equal(await pending, false);
    assert.equal(f.calls.includes("open"), false); assert.deepEqual(f.reads, []); assert.deepEqual(f.cleared, []);
    assert.equal(f.client.getSnapshot().inboxError, "MOBILE_PUSH_APP_LOCKED");
  });
}

test("queued delete rechecks interaction without undoing the preceding read acknowledgement", async t => {
  const f = fixture([row(1), row(2)]); t.after(f.client.start()); await f.client.refresh();
  const original = f.api.notificationRead; const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationRead = async (captured, id) => { const result = await original(captured, id); entered.resolve(); await release.promise; return result; };
  const read = f.client.markRead(row(1).id); await entered.promise;
  const remove = f.client.deleteNotification(row(2).id);
  f.setAllowed(false); release.resolve();
  assert.deepEqual(await Promise.all([read, remove]), [true, false]);
  assert.deepEqual(f.reads, [row(1).id]); assert.deepEqual(f.deletes, []);
  assert.equal(f.client.getSnapshot().unreadCount, 1);
});

test("session change during inbox read cannot publish old rows or update the next scope badge", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const original = f.api.notificationInbox; const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationInbox = async (captured, page, unreadOnly) => { entered.resolve(); await release.promise; return original(captured, page, unreadOnly); };
  const pending = f.client.loadInbox(false, true); await entered.promise;
  f.setCurrent(false); const snapshot = f.client.getSnapshot(); const badges = [...f.badges];
  release.resolve(); assert.equal(await pending, false);
  assert.equal(f.client.getSnapshot(), snapshot); assert.deepEqual(f.badges, badges);
});

test("failed authenticated status prevents both inbox requests and push registration", async t => {
  const f = fixture();
  f.api.notificationStatus = async () => { throw new Error("MOBILE_PUSH_SESSION_CHANGED"); };
  t.after(f.client.start()); assert.equal(await f.client.refresh(), false);
  assert.deepEqual(f.inboxCalls, []); assert.equal(f.calls.includes("register"), false);
  assert.equal(f.client.getSnapshot().inbox.length, 0);
  assert.equal(f.client.getSnapshot().unreadCount, null); assert.deepEqual(f.badges, []);
});

test("a hung native badge write is best effort and does not duplicate the same count or hold the inbox forever", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture([row(1)]); t.after(f.client.start()); await f.client.refresh();
  const entered = deferred<void>(); const badge = deferred<boolean>(); const original = f.adapter.setBadge;
  f.adapter.setBadge = async count => { assert.equal(count, 0); entered.resolve(); return badge.promise; };
  const pending = f.client.markRead(row(1).id); await entered.promise;
  assert.equal(f.client.getSnapshot().unreadCount, 0);
  t.mock.timers.tick(2_000); assert.equal(await pending, true);
  assert.equal(f.client.getSnapshot().inboxBusy, false);
  assert.equal(await f.client.loadInbox(), true);
  f.adapter.setBadge = original; badge.resolve(true);
});

test("a hung native dismiss lookup cannot keep an acknowledged delete busy indefinitely", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture([row(1)]); t.after(f.client.start()); await f.client.refresh();
  const entered = deferred<void>(); const presented = deferred<NativeNotification[]>();
  f.adapter.presented = async () => { entered.resolve(); return presented.promise; };
  const pending = f.client.deleteNotification(row(1).id); await entered.promise;
  assert.equal(f.client.getSnapshot().inbox.length, 0);
  t.mock.timers.tick(2_000); assert.equal(await pending, true);
  assert.equal(f.client.getSnapshot().inboxBusy, false);
  presented.resolve([{ identifier: "too-late", data: row(1).data }]); await Promise.resolve();
  assert.deepEqual(f.dismissed, []); assert.deepEqual(f.deletes, [row(1).id]);
});

test("the native read timeout never races or repeats an already dispatched registration PUT", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); t.after(f.client.start()); await f.client.refresh();
  const entered = deferred<void>(); const release = deferred<void>(); const original = f.api.notificationRegister;
  let attempts = 0;
  f.api.notificationRegister = async (captured, input) => { attempts += 1; entered.resolve(); await release.promise; return original(captured, input); };
  const pending = f.client.retryEnable(); await entered.promise;
  t.mock.timers.tick(20_000);
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.equal(f.client.getSnapshot().busy, true); assert.equal(f.client.getSnapshot().inboxBusy, false);
  assert.equal(f.client.getSnapshot().registered, false); assert.equal(attempts, 1);
  release.resolve(); assert.equal(await pending, true);
  assert.equal(f.client.getSnapshot().registered, true); assert.equal(attempts, 1);
});

test("failed raw fallback after a legacy downgrade still disables deletion before another user action", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh(); await f.client.loadInbox(false, true);
  const original = f.api.notificationInbox;
  f.setLegacy(true);
  f.api.notificationInbox = async (captured, page, unreadOnly) => {
    if (unreadOnly === false) throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE");
    return original(captured, page, unreadOnly);
  };
  assert.equal(await f.client.loadInbox(true, true), false);
  assert.equal(f.client.getSnapshot().filterLocal, true);
  assert.equal(f.client.getSnapshot().canDelete, false);
  assert.equal(f.client.getSnapshot().unreadCount, null);
  assert.equal(await f.client.deleteNotification(row(1).id), false);
  assert.deepEqual(f.deletes, []);
});

test("failed revocation after an in-flight inbox read releases its busy flag for the still-current session", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.retryEnable(); await f.client.loadInbox();
  const original = f.api.notificationInbox; const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationInbox = async (captured, page, unreadOnly) => { entered.resolve(); await release.promise; return original(captured, page, unreadOnly); };
  f.api.notificationUnregister = async () => { throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE"); };
  const load = f.client.loadInbox(); await entered.promise;
  const revoke = assert.rejects(f.client.revokeForSession(), /MOBILE_PUSH_DATABASE_UNAVAILABLE/);
  release.resolve(); assert.equal(await load, false); await revoke;
  assert.equal(f.client.isCurrent(), true); assert.equal(f.client.getSnapshot().inboxBusy, false);
  assert.equal(await f.client.loadInbox(false, true), true);
  assert.equal(f.client.getSnapshot().inboxBusy, false);
});

test("changing filters during a read acknowledgement preserves the confirmation and latest view without a second badge decrement", async t => {
  const f = fixture(); t.after(f.client.start()); await f.client.refresh(); await f.client.loadInbox(false, true);
  const original = f.api.notificationRead; const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationRead = async (captured, id) => { const result = await original(captured, id); entered.resolve(); await release.promise; return result; };
  const read = f.client.markRead(row(1).id); await entered.promise;
  const all = f.client.loadInbox(false, false);
  release.resolve(); assert.deepEqual(await Promise.all([read, all]), [true, true]);
  assert.equal(f.client.getSnapshot().unreadOnly, false);
  assert.ok(f.client.getSnapshot().inbox.find(item => item.id === row(1).id)?.readAt);
  assert.equal(f.client.getSnapshot().unreadCount, 39); assert.deepEqual(f.badges, [40, 39]);
});