import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { z } from "zod";
import type { Session } from "../src/domain/models";
import type { NotificationData, NotificationDeviceInput, NotificationInboxItem, NotificationStatus } from "../src/domain/notifications";
import type { NativeNotificationResponse, NativePushToken, NotificationAdapter, NotificationApi, NotificationPermission } from "../src/notifications/contracts";
import { MobileNotificationClient, revokeForSession } from "../src/notifications/MobileNotificationClient";
import { createNotificationAdapter as createWebAdapter } from "../src/notifications/notificationAdapter.web";
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationEventDeduper, notificationForSession, permissionAllowsPush } from "../src/notifications/notificationSafety";
import { bindNotificationApi, type NotificationRepository } from "../src/notifications/repositoryNotificationApi";
import { runningTimersFromSnapshot } from "../src/notifications/runningTimers";

const projectId = "0fe95e1e-0dbb-4311-9b79-bd31bc0d41f3";
const installationId = "fa4c5b12-317e-42fd-ac53-cb22c0e0587b";
const eventId = "a1ecc4bb-c526-4607-980e-60911578caf1";
const timestamp = "2026-09-08T12:00:00.000Z";
const session: Session = {
  token: "test-session-only", branchId: 2, mode: "live",
  tenant: { id: "test", name: "Test", portalOrigin: "https://tenant.example", environment: "production" },
  user: { id: 10, workerId: 20, name: "Test", lastnames: "", email: "", role: { name: "Technician" }, accessBranchs: [{ id: 2, name: "Test", main: true }], system: { name: "Test", timezone: "UTC" } },
};
const payload: NotificationData = { tenantOrigin: session.tenant.portalOrigin, companyBranchId: 2, eventId, kind: "WORK_TECHNICIAN_ASSIGNED", groupType: "work", groupId: 82, workId: 82, date: "2026-09-08" };
const response: NativeNotificationResponse = { identifier: "test-notification", data: payload, defaultAction: true };
const item: NotificationInboxItem = { id: eventId, kind: payload.kind, state: "pending", data: payload, lastFailure: null, readAt: null, createdAt: timestamp };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let current = true;
  let consent = false;
  let permission: NotificationPermission = "undetermined";
  let last: NativeNotificationResponse | null = null;
  let items: NotificationInboxItem[] = [item];
  let opened = 0;
  let requests = 0;
  let unregisters = 0;
  let tests = 0;
  let read = 0;
  let status: NotificationStatus = { enabled: true, reasons: [], projectId, reconciliationSeconds: 120, deliveryGuaranteed: false, device: null };
  const registrations: NotificationDeviceInput[] = [];
  const expoTokenArguments: Array<NativePushToken | undefined> = [];
  const dismissed: string[] = [];
  const cleared: string[] = [];
  let listeners: Parameters<NotificationAdapter["subscribe"]>[0] | null = null;
  const api: NotificationApi = {
    async notificationStatus() { return status; },
    async notificationRegister(_session, input) {
      registrations.push(input);
      status = { ...status, device: { installationId: input.installationId, active: true, disabledReason: null, preferences: input.preferences } };
      return { installationId: input.installationId, active: true, preferences: input.preferences, baselineCapturedAt: timestamp };
    },
    async notificationUnregister(captured, id) { assert.equal(captured, session); assert.equal(id, installationId); unregisters += 1; status = { ...status, device: null }; },
    async notificationInbox(_session, page) { return { items: items.slice((page - 1) * 25, page * 25), page, pageSize: 25 }; },
    async notificationRead(_session, id) { read += 1; return { id, read: true }; },
    async notificationTest(...args) { assert.equal(args.length, 1); assert.equal(args[0], session); tests += 1; return { eventId, state: "pending" }; },
  };
  const adapter: NotificationAdapter = {
    platform: "android", unsupportedReason: null, projectId,
    async getPermission() { return permission; },
    async requestPermission() { requests += 1; permission = "granted"; return permission; },
    async prepareChannel() {},
    async getExpoToken(id, token) { assert.equal(id, projectId); expoTokenArguments.push(token); return "ExpoPushToken[testtoken0123456789]"; },
    async getInstallationId() { return installationId; },
    async readConsent() { return consent; },
    async writeConsent(_key, value) { consent = value; },
    subscribe(callbacks) { listeners = callbacks; return () => { listeners = null; }; },
    async lastResponse() { return last; },
    async clearResponse(id) { cleared.push(id); if (last?.identifier === id) last = null; },
    async presented() { return [{ identifier: "own", data: payload }, { identifier: "other", data: { ...payload, tenantOrigin: "https://other.example" } }]; },
    async dismiss(id) { dismissed.push(id); },
    async openSettings() {},
  };
  const client = new MobileNotificationClient({ session, storageKey: "test-namespace", api, adapter, isCurrent: () => current, onOpen: async (_value, context) => { assert.equal(context.isCurrent(), true); opened += 1; return true; } });
  return { client, api, adapter, registrations, expoTokenArguments, dismissed, cleared,
    get listeners() { return listeners; },
    get opened() { return opened; }, get requests() { return requests; }, get unregisters() { return unregisters; }, get tests() { return tests; }, get read() { return read; },
    setCurrent(value: boolean) { current = value; }, setPermission(value: NotificationPermission) { permission = value; }, setConsent(value: boolean) { consent = value; },
    setLast(value: NativeNotificationResponse | null) { last = value; }, setItems(value: NotificationInboxItem[]) { items = value; }, setStatus(value: NotificationStatus) { status = value; },
    rotate(token: NativePushToken) { listeners?.token(token); },
  };
}

test("payload validation rejects foreign scopes, malformed IDs, origins and dates", () => {
  assert.deepEqual(notificationForSession(payload, session), payload);
  for (const change of [{ tenantOrigin: "https://other.example" }, { companyBranchId: 3 }, { eventId: "invalid" }, { workId: -1 }, { date: "2026-02-30" }, { tenantOrigin: "https://tenant.example/" }, { tenantOrigin: "https://tenant.example\n" }, { kind: "OPEN_URL" }]) {
    assert.equal(notificationForSession({ ...payload, ...change }, session), null);
  }
  assert.equal(notificationForSession(payload, { ...session, mode: "demo" }), null);
  assert.equal(notificationForSession(payload, { ...session, branchId: null }), null);
});

test("dedupe is bounded, rejects concurrent opens and retries rejected navigation", () => {
  const dedupe = new NotificationEventDeduper(2);
  assert.equal(dedupe.begin("a"), true);
  assert.equal(dedupe.begin("a"), false);
  dedupe.finish("a", false);
  assert.equal(dedupe.begin("a"), true);
  dedupe.finish("a", true);
  assert.equal(dedupe.begin("a"), false);
  for (const id of ["b", "c"]) { dedupe.begin(id); dedupe.finish(id, true); }
  assert.equal(dedupe.has("a"), false);
  assert.equal(new NotificationEventDeduper().begin("a"), true);
});

test("iOS provisional and ephemeral authorization are usable without another prompt", () => {
  for (const permission of ["granted", "provisional", "ephemeral"] as const) assert.equal(permissionAllowsPush(permission), true);
  for (const permission of ["denied", "blocked", "undetermined", "unsupported"] as const) assert.equal(permissionAllowsPush(permission), false);
});

test("login and foreground refresh never request OS permission or register without opt-in", async () => {
  const f = fixture(); const stop = f.client.start();
  await f.client.refresh();
  f.setPermission("granted"); await f.client.refresh();
  assert.equal(f.requests, 0); assert.equal(f.registrations.length, 0);
  assert.equal(await f.client.retryEnable(), true);
  assert.equal(f.requests, 0); assert.equal(f.registrations.length, 1);
  assert.deepEqual(f.registrations[0].preferences, DEFAULT_NOTIFICATION_PREFERENCES);
  stop();
});

test("only explicit enable prompts, and provisional permission does not prompt again", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.refresh();
  await f.client.retryEnable(); assert.equal(f.requests, 1); stop();
  const p = fixture(); p.setPermission("provisional"); const dispose = p.client.start(); await p.client.retryEnable();
  assert.equal(p.requests, 0); assert.equal(p.client.getSnapshot().permission, "provisional"); dispose();
});

test("missing or mismatched build project prevents permission prompt and token exchange", async () => {
  for (const id of [null, "1fe95e1e-0dbb-4311-9b79-bd31bc0d41f3"]) {
    const f = fixture(); f.adapter.projectId = id; const stop = f.client.start();
    assert.equal(await f.client.retryEnable(), false);
    assert.equal(f.requests, 0); assert.equal(f.expoTokenArguments.length, 0); stop();
  }
});

test("foreground OS denial unregisters the stored own installation", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.retryEnable();
  f.setPermission("blocked"); await f.client.refresh();
  assert.equal(f.unregisters, 1); assert.equal(f.client.getSnapshot().registered, false); stop();
});

test("rotated native token is passed to Expo exchange rather than requesting it recursively", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.retryEnable();
  const token: NativePushToken = { type: "android", data: "new-native-token" };
  f.rotate(token); await f.client.refresh();
  assert.ok(f.expoTokenArguments.some((argument) => argument === token));
  const count = f.expoTokenArguments.length; f.rotate(token);
  await f.client.loadInbox(); assert.equal(f.expoTokenArguments.length, count); stop();
});

test("cold response for another account is not consumed even when tenant and branch match", async () => {
  const f = fixture(); f.setLast(response); f.setItems([]); const stop = f.client.start();
  await f.client.refresh(); assert.equal(f.opened, 0); assert.equal(f.cleared.length, 0); stop();
});

test("tampered resource under an owned event UUID never opens; valid duplicates open once", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.refresh();
  await f.client.handleResponse({ ...response, data: { ...payload, workId: 99 } }); assert.equal(f.opened, 0);
  await Promise.all([f.client.handleResponse(response), f.client.handleResponse(response)]);
  assert.equal(f.opened, 1); assert.equal(f.read, 1); stop();
});

test("session changes during ownership lookup suppress navigation and clearing", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.refresh();
  const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationInbox = async (_session, page) => { entered.resolve(); await release.promise; return { items: [item], page, pageSize: 25 }; };
  const pending = f.client.handleResponse(response); await entered.promise;
  f.setCurrent(false); release.resolve(); await pending;
  assert.equal(f.opened, 0); assert.equal(f.cleared.length, 0); stop();
});

test("revoke waits for in-flight registration and dismisses only server-owned notifications", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.refresh();
  const entered = deferred<void>(); const release = deferred<void>(); const original = f.api.notificationRegister;
  f.api.notificationRegister = async (captured, input) => { entered.resolve(); await release.promise; return original(captured, input); };
  const enable = f.client.retryEnable(); await entered.promise;
  const revoke = revokeForSession(f.client); assert.equal(f.unregisters, 0);
  release.resolve(); await enable; await revoke;
  assert.ok(f.unregisters >= 1); assert.deepEqual(f.dismissed, ["own"]);
  assert.equal(await f.client.retryEnable(), false); stop();
});

test("failed PUT never reports saved preferences and test sends no arbitrary token", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.retryEnable();
  f.api.notificationRegister = async () => { throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE"); };
  assert.equal(await f.client.savePreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, remindAfterMinutes: 60 }), false);
  assert.equal(f.client.getSnapshot().notice, null);
  assert.equal(f.client.getSnapshot().preferences.remindAfterMinutes, 30);
  await f.client.sendTest(); assert.equal(f.tests, 1);
  assert.match(f.client.getSnapshot().notice ?? "", /pendiente/); stop();
});

test("web adapter is importable without native SDK and retains authenticated inbox", async () => {
  const f = fixture(); const adapter = createWebAdapter();
  const client = new MobileNotificationClient({ session, storageKey: "web", api: f.api, adapter, isCurrent: () => true, onOpen: () => false });
  const stop = client.start(); await client.refresh(); await client.loadInbox();
  assert.equal(client.getSnapshot().permission, "unsupported"); assert.equal(client.getSnapshot().inbox.length, 1);
  assert.equal(f.registrations.length, 0); assert.equal(f.requests, 0); stop();
});

test("bound repository rejects another session or branch and test has no body or token argument", async () => {
  const calls: number[][] = [];
  const repository: NotificationRepository = {
    async notificationStatus() { return { enabled: false, reasons: [], projectId: null, reconciliationSeconds: 120, deliveryGuaranteed: false }; },
    async registerNotificationDevice(input) { return { installationId: input.installationId, active: true, preferences: input.preferences, baselineCapturedAt: timestamp }; },
    async unregisterNotificationDevice() {},
    async notificationInbox(_branch, page) { return { page, pageSize: 25, items: [] }; },
    async readNotification(_branch, id) { return { id, read: true }; },
    async testNotification(...args: [number]) { calls.push(args); return { eventId, state: "pending" }; },
  };
  const api = bindNotificationApi(session, repository);
  await api.notificationTest(session); assert.deepEqual(calls, [[2]]);
  assert.throws(() => api.notificationTest({ ...session, token: "different-session" }), /SESSION_CHANGED/);
  assert.throws(() => api.notificationStatus({ ...session, branchId: 3 }), /SESSION_CHANGED/);
  assert.throws(() => api.notificationRegister(session, { installationId, projectId, platform: "android", expoPushToken: "ExpoPushToken[testtoken0123456789]", companyBranchId: 3, preferences: DEFAULT_NOTIFICATION_PREFERENCES }), /SESSION_CHANGED/);
});

test("server prerequisites block opt-in before a permission request", async () => {
  const f = fixture(); f.setStatus({ enabled: false, reasons: ["MOBILE_PUSH_DISABLED"], projectId: null, reconciliationSeconds: 120, deliveryGuaranteed: false });
  const stop = f.client.start(); assert.equal(await f.client.retryEnable(), false);
  assert.equal(f.requests, 0); assert.equal(f.registrations.length, 0); stop();
});

test("rejected canonical navigation preserves a cold response for retry", async () => {
  const f = fixture(); f.setLast(response);
  const client = new MobileNotificationClient({ session, storageKey: "reject", api: f.api, adapter: f.adapter, isCurrent: () => true, onOpen: () => false });
  const stop = client.start(); await client.refresh();
  assert.equal(f.cleared.length, 0); assert.equal(f.read, 0); stop();
});

test("read controls only accept loaded own events and empty snapshots do not invent timers", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.refresh();
  assert.equal(await f.client.markRead(eventId), false);
  await f.client.loadInbox(); assert.equal(await f.client.markRead(eventId), true);
  assert.equal(f.client.getSnapshot().inbox[0].readAt !== null, true);
  assert.deepEqual(runningTimersFromSnapshot(null), []); stop();
});

test("parent OT notifications do not invent a child while timer events require one", () => {
  const order = { ...payload, groupType: "negotiation", groupId: 12, workId: null };
  assert.deepEqual(notificationForSession(order, session), order);
  assert.equal(notificationForSession({ ...order, kind: "RUNNING_TIMER_REMINDER" }, session), null);
  assert.equal(notificationForSession({ ...order, groupType: "maintenance" }, session), null);
  assert.equal(notificationForSession({ ...order, groupType: "work" }, session), null);
});

test("foreground presentation is synchronous, opted-in, registered and captured-session scoped", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.refresh();
  const callbacks = f.listeners; assert.ok(callbacks?.shouldPresent);
  assert.equal(callbacks.shouldPresent(response), false);
  await f.client.retryEnable();
  let lookups = 0;
  f.api.notificationInbox = async () => { lookups += 1; throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE"); };
  assert.equal(callbacks.shouldPresent(response), true);
  assert.equal(callbacks.shouldPresent({ ...response, data: { ...payload, groupType: "negotiation", workId: null } }), true);
  for (const change of [{ tenantOrigin: "https://other.example" }, { companyBranchId: 3 }, { eventId: "bad" }, { kind: "OPEN_URL" }]) {
    assert.equal(callbacks.shouldPresent({ ...response, data: { ...payload, ...change } }), false);
  }
  assert.equal(lookups, 0); assert.equal(f.opened, 0); assert.equal(f.read, 0);
  f.setCurrent(false); assert.equal(callbacks.shouldPresent(response), false);
  f.setCurrent(true); stop(); assert.equal(callbacks.shouldPresent(response), false);
});

test("foreground presentation stops on OS denial and failed consent withdrawal", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.retryEnable();
  const callbacks = f.listeners; assert.ok(callbacks?.shouldPresent);
  f.setPermission("blocked"); await f.client.refresh();
  assert.equal(callbacks.shouldPresent(response), false);
  f.setPermission("granted"); await f.client.retryEnable();
  f.api.notificationUnregister = async () => { throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE"); };
  assert.equal(await f.client.disable(), false);
  assert.equal(callbacks.shouldPresent(response), false); stop();
});

test("disabled service with no consent or registration skips all revocation network calls", async () => {
  const f = fixture();
  f.setStatus({ enabled: false, reasons: ["MOBILE_PUSH_DISABLED"], projectId: null, reconciliationSeconds: 120, deliveryGuaranteed: false });
  const stop = f.client.start(); await f.client.refresh();
  let network = 0;
  f.api.notificationUnregister = async () => { network += 1; throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE"); };
  f.api.notificationInbox = async () => { network += 1; throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE"); };
  f.setLast(response);
  await f.client.revokeForSession();
  assert.equal(network, 0); assert.equal(f.registrations.length, 0);
  assert.deepEqual(f.dismissed, []); assert.deepEqual(f.cleared, []);
  assert.equal(f.client.getSnapshot().error, null); stop();
});

test("unsupported client without binding skips revocation and ownership network requests", async () => {
  const f = fixture(); f.adapter.platform = "unsupported";
  const stop = f.client.start(); await f.client.refresh();
  f.api.notificationUnregister = async () => { assert.fail("unexpected DELETE"); };
  f.api.notificationInbox = async () => { assert.fail("unexpected inbox lookup"); };
  await f.client.revokeForSession(); assert.equal(f.client.getSnapshot().error, null); stop();
});

test("disabled service still revokes a previously active binding and failure permits scoped DELETE retry only", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.retryEnable();
  const callbacks = f.listeners; assert.ok(callbacks?.shouldPresent);
  await f.client.loadInbox();
  f.setStatus({ enabled: false, reasons: ["MOBILE_PUSH_DISABLED"], projectId: null, reconciliationSeconds: 120, deliveryGuaranteed: false });
  await f.client.refresh(); assert.equal(f.client.getSnapshot().registered, false);
  f.setConsent(false);
  const original = f.api.notificationUnregister;
  let attempts = 0;
  f.api.notificationUnregister = async (captured, id) => {
    attempts += 1; assert.equal(captured, session); assert.equal(id, installationId);
    if (attempts === 1) throw new Error("MOBILE_PUSH_DATABASE_UNAVAILABLE");
    await original(captured, id);
  };
  const revoke = f.client.revokeForSession();
  assert.equal(callbacks.shouldPresent(response), false);
  await assert.rejects(revoke, /MOBILE_PUSH_DATABASE_UNAVAILABLE/);
  assert.equal(f.client.getSnapshot().error, "MOBILE_PUSH_DATABASE_UNAVAILABLE");
  assert.equal(f.client.getSnapshot().busy, false);
  assert.equal(f.client.isCurrent(), true);
  const registrations = f.registrations.length;
  callbacks.token({ type: "android", data: "late-token" }); callbacks.foreground();
  assert.equal(await f.client.retryEnable(), false);
  assert.equal(f.registrations.length, registrations);
  assert.equal(callbacks.shouldPresent(response), false);
  f.api.notificationInbox = async () => { assert.fail("disabled cleanup must use known ownership only"); };
  f.setLast(response);
  await f.client.revokeForSession();
  assert.equal(attempts, 2); assert.deepEqual(f.dismissed, ["own"]); assert.deepEqual(f.cleared, [response.identifier]);
  assert.equal(f.client.isCurrent(), false); stop();
});

test("disabled service with persisted opt-in still attempts captured-session revocation", async () => {
  const f = fixture(); f.setConsent(true); f.setPermission("granted");
  f.setStatus({ enabled: false, reasons: ["MOBILE_PUSH_DISABLED"], projectId: null, reconciliationSeconds: 120, deliveryGuaranteed: false });
  const stop = f.client.start(); await f.client.refresh();
  await f.client.revokeForSession(); assert.equal(f.unregisters, 1); stop();
});

test("cleanup failure after successful DELETE stays off and retries cleanup without another DELETE", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.retryEnable();
  const original = f.adapter.presented;
  f.adapter.presented = async () => { throw new Error("native cleanup failed"); };
  await assert.rejects(f.client.revokeForSession(), /MOBILE_PUSH_NOTIFICATION_CLEANUP_FAILED/);
  assert.equal(f.unregisters, 1);
  assert.equal(f.client.getSnapshot().error, "MOBILE_PUSH_NOTIFICATION_CLEANUP_FAILED");
  assert.equal(f.client.getSnapshot().status?.device?.active, false);
  assert.equal(f.client.isCurrent(), false);
  assert.equal(await f.client.retryEnable(), false);
  f.adapter.presented = original;
  await f.client.revokeForSession();
  assert.equal(f.unregisters, 1); assert.deepEqual(f.dismissed, ["own"]); stop();
});

test("expired session and late callbacks cannot restore presentation or issue new registrations", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.retryEnable();
  const callbacks = f.listeners; assert.ok(callbacks?.shouldPresent);
  const entered = deferred<void>(); const release = deferred<void>();
  f.api.notificationUnregister = async () => { entered.resolve(); await release.promise; throw new Error("MOBILE_PUSH_SESSION_CHANGED"); };
  const pending = f.client.revokeForSession(); await entered.promise;
  f.setCurrent(false); release.resolve(); await assert.rejects(pending, /SESSION_CHANGED/);
  const registrations = f.registrations.length;
  callbacks.received(response); callbacks.response(response); callbacks.foreground(); callbacks.token({ type: "android", data: "expired" });
  assert.equal(callbacks.shouldPresent(response), false);
  assert.equal(await f.client.retryEnable(), false);
  assert.equal(f.registrations.length, registrations); assert.equal(f.opened, 0); stop();
});

test("session expiry while obtaining an Expo token never registers the late result", async () => {
  const f = fixture(); const stop = f.client.start(); await f.client.refresh();
  const entered = deferred<void>(); const release = deferred<string>();
  f.adapter.getExpoToken = async () => { entered.resolve(); return release.promise; };
  const pending = f.client.retryEnable(); await entered.promise;
  f.setCurrent(false); release.resolve("ExpoPushToken[testtoken0123456789]");
  assert.equal(await pending, false); assert.equal(f.registrations.length, 0); stop();
});

function nativeAdapterHarness() {
  type Presentation = { shouldShowBanner: boolean; shouldShowList: boolean; shouldPlaySound: boolean; shouldSetBadge: boolean };
  type Handler = { handleNotification(value: { request: { identifier: string; content: { data: unknown } } }): Promise<Presentation> };
  let handler: Handler | null = null;
  let removals = 0;
  let imports = 0;
  const sdk = {
    setNotificationHandler(value: Handler | null) { handler = value; },
    addNotificationResponseReceivedListener() { return { remove() { removals += 1; } }; },
    addNotificationReceivedListener() { return { remove() { removals += 1; } }; },
    addPushTokenListener() { return { remove() { removals += 1; } }; },
  };
  const exported: { createNotificationAdapter?: () => NotificationAdapter } = {};
  const source = readFileSync(resolve(__dirname, "../src/notifications/notificationAdapter.ts"), "utf8");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports: exported, require(name: string): unknown {
    switch (name) {
      case "@react-native-async-storage/async-storage": return { default: {} };
      case "expo-constants": return { default: { executionEnvironment: "standalone", easConfig: { projectId } }, ExecutionEnvironment: { StoreClient: "storeClient" } };
      case "react-native": return { Platform: { OS: "android" }, Linking: {}, AppState: { addEventListener() { return { remove() { removals += 1; } }; } } };
      case "zod": return { z };
      case "expo-notifications": imports += 1; return sdk;
      default: throw new Error(`Unexpected SDK access: ${name}`);
    }
  } });
  const create = exported.createNotificationAdapter; assert.ok(create);
  return { create, get handler() { return handler; }, get removals() { return removals; }, get imports() { return imports; } };
}

test("native handler uses synchronous scoped approval and older teardown cannot clear its replacement", async () => {
  const h = nativeAdapterHarness();
  const callbacks: Parameters<NotificationAdapter["subscribe"]>[0] = {
    shouldPresent: () => true, response() {}, received() {}, token() {}, foreground() {},
  };
  const notification = { request: { identifier: response.identifier, content: { data: payload } } };
  const first = h.create().subscribe(callbacks);
  await new Promise<void>((done) => setImmediate(done));
  const old = h.handler; assert.ok(old);
  let approvals = 0;
  callbacks.shouldPresent = () => { approvals += 1; return true; };
  const presentation = old.handleNotification(notification);
  assert.equal(approvals, 1);
  const allowed = await presentation;
  assert.equal(allowed.shouldShowBanner, true); assert.equal(allowed.shouldShowList, true);
  assert.equal(allowed.shouldPlaySound, true); assert.equal(allowed.shouldSetBadge, false);
  const second = h.create().subscribe({ ...callbacks, shouldPresent: () => false });
  assert.equal((await old.handleNotification(notification)).shouldShowBanner, false);
  await new Promise<void>((done) => setImmediate(done));
  const replacement = h.handler; assert.ok(replacement); assert.notEqual(replacement, old);
  first(); assert.equal(h.handler, replacement);
  const denied = await replacement.handleNotification(notification);
  assert.equal(denied.shouldShowBanner, false); assert.equal(denied.shouldShowList, false); assert.equal(denied.shouldPlaySound, false);
  second(); assert.equal(h.handler, null); assert.equal(h.removals, 8);
  assert.equal((await replacement.handleNotification(notification)).shouldShowBanner, false);
});

test("native handler fails closed without approval or when it throws and ignores late SDK initialization", async () => {
  const h = nativeAdapterHarness();
  const callbacks: Parameters<NotificationAdapter["subscribe"]>[0] = { response() {}, received() {}, token() {}, foreground() {} };
  const notification = { request: { identifier: response.identifier, content: { data: payload } } };
  const obsolete = h.create().subscribe({ ...callbacks, shouldPresent: () => true });
  const dispose = h.create().subscribe(callbacks);
  await new Promise<void>((done) => setImmediate(done));
  const handler = h.handler; assert.ok(handler);
  obsolete(); assert.equal(h.handler, handler);
  assert.equal((await handler.handleNotification(notification)).shouldShowBanner, false);
  callbacks.shouldPresent = () => { throw new Error("stale callback"); };
  assert.equal((await handler.handleNotification(notification)).shouldPlaySound, false);
  dispose();
  const stopped = h.create().subscribe(callbacks); stopped();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(h.handler, null); assert.ok(h.imports > 0);
});