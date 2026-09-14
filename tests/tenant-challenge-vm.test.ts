import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tenant } from "../src/domain/models";
import type { TenantSelectionScreenProps } from "../src/screens/TenantSelectionScreen";
import * as connection from "../src/infrastructure/gatewayConnection";
import * as errors from "../src/infrastructure/errors";
import * as schemas from "../src/infrastructure/tenantSchemas";
import * as tenantSession from "../src/domain/tenantSession";
import { user } from "../src/offline/tests/fakes";
import { challenge, httpFixture, loadSource, reactFixture, tenant } from "./helpers/tenant-challenge";

type App = ReturnType<typeof import("../src/application/useTechnicianApp").useTechnicianApp>;
async function appFixture(options: Parameters<typeof httpFixture>[0] = {}) {
  const http = httpFixture(options);
  const hooks = reactFixture();
  const storage: unknown[] = [];
  const queue = Object.freeze([{ id: "pending-fixture", status: "pending", payload: "preserve" }]);
  const forbidden: string[] = [];
  const block = (name: string) => () => { forbidden.push(name); throw new Error(`FORBIDDEN_${name}`); };
  http.HttpRepository.prototype.me = async function () { this.tenant = tenant; return { ...user, tenant, workerId: null }; };
  const module = loadSource<{ useTechnicianApp: () => App }>("application/useTechnicianApp.ts", (id) => {
    if (id === "react") return hooks.react;
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "../infrastructure/tenantChallengeClock") return http.clock;
    if (id === "../infrastructure/HttpTechnicianRepository") return { HttpTechnicianRepository: http.HttpRepository };
    if (id === "../infrastructure/gatewayConfig") return { gatewayConfiguration: { locked: true, url: http.repo.baseUrl, error: null } };
    if (id === "../infrastructure/gatewayConnection") return connection;
    if (id === "../infrastructure/errors") return errors;
    if (id === "../domain/tenantSession") return tenantSession;
    if (id === "../infrastructure/tenantSchemas") return schemas;
    if (id === "../domain/format") return { dateKey: () => "2026-09-10" };
    if (id === "../domain/weeklySchedule") return { scheduleClock: () => ({ day: "2026-09-10" }) };
    if (id === "../domain/assignmentSchedule") return { dailyRange: (day: string) => ({ startDate: day, endDate: day }) };
    if (id === "../notifications") return { useMobileNotifications: () => ({ client: null }), bindNotificationApi: () => null };
    if (id === "../offline") return {
      OfflineTechnicianRepository: class {}, saveOfflineProfile: async () => {},
      hasPendingChanges: block("queue"), disableOfflineProfile: block("disable-profile"), createOfflineRepository: block("create-offline"),
    };
    if (id === "../offline/DurableStore") return { createDurableStore: block("durable-store") };
    if (id === "../infrastructure/sessionStorage") return {
      loadSession: async () => null, saveSession: async (value: unknown) => { storage.push(value); },
      saveGateway: async () => {}, removeSession: block("remove-session"),
    };
    return {};
  }, { Date: http.PhoneDate });
  const render = () => hooks.render(module.useTechnicianApp);
  render(); hooks.restore();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { ...http, render, storage, queue, forbidden };
}

for (const offset of [24 * 3600_000, -24 * 3600_000]) {
  test(`actual hook + HTTP complete valid server challenge with phone skew ${offset}`, async () => {
    const f = await appFixture();
    f.time.wall = Date.parse("2026-09-10T12:00:00Z") + offset;
    await f.render().login("fixture", "fixture-only");
    let app = f.render();
    assert.ok(app.challenge);
    const original = app.challenge;
    f.time.wall += 365 * 86400_000;
    f.time.mono += 10_000;
    app = f.render();
    assert.equal(app.challenge, original);
    await app.selectTenant(tenant);
    app = f.render();
    assert.ok(app.session);
    assert.equal(app.challenge, null);
    assert.equal(app.error, null);
    assert.equal(app.busy, false);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(JSON.parse(String(f.calls[1].init.body)), { challenge: original.challenge, tenantId: tenant.id });
    assert.ok(f.storage.length > 0);
    assert.equal(JSON.stringify(f.storage).includes("fixture-only"), false);
    f.time.mono += 240_000;
    assert.equal(f.render().session, app.session, "challenge expiry never logs out an established session");
    assert.deepEqual(f.forbidden, []);
  });
}

test("hook accepts unverified clock fallback but server 401 clears only pending login, preserving storage/queue", async () => {
  for (const date of [undefined, null, "malformed Date"]) {
    const f = await appFixture({ date, completeStatus: 401 });
    const queueBefore = JSON.stringify(f.queue);
    await f.render().login("fixture", "fixture-only");
    const stale = f.render();
    assert.ok(stale.challenge);
    await stale.selectTenant(tenant);
    const app = f.render();
    assert.equal(app.challenge, null);
    assert.equal(app.session, null);
    assert.equal(app.busy, false);
    assert.match(app.error ?? "", /esta selección no se reutilizará/);
    await stale.selectTenant(tenant);
    assert.equal(f.calls.length, 2, "no retry, refresh or password replay");
    assert.deepEqual(f.storage, []);
    assert.deepEqual(f.forbidden, []);
    assert.equal(JSON.stringify(f.queue), queueBefore);
  }
});

test("hook permits fallback completion with gateway 1.0.0 and no exposed Date", async () => {
  const f = await appFixture({ date: null, body: { ...challenge(), expiresAt: "2000-01-01T00:00:00Z" } });
  await f.render().login("fixture", "fixture-only");
  await f.render().selectTenant(tenant);
  assert.ok(f.render().session);
  assert.equal(f.calls.length, 2);
});

test("hook checks true expiry, invalid timing and tenant membership without completing or touching storage", async () => {
  for (const kind of ["elapsed", "server-expired", "fallback-elapsed", "invalid-expiry", "invalid-monotonic", "tenant-mismatch"] as const) {
    const f = await appFixture({ date: kind === "fallback-elapsed" ? null : undefined,
      body: kind === "server-expired" ? { ...challenge(), expiresAt: "2026-09-10T12:00:00Z" } : undefined });
    await f.render().login("fixture", "fixture-only");
    const app = f.render();
    assert.ok(app.challenge);
    if (kind === "elapsed" || kind === "fallback-elapsed") f.time.mono += 120_000;
    if (kind === "invalid-expiry") app.challenge.expiresAt = "invalid";
    if (kind === "invalid-monotonic") f.time.mono = -1;
    await app.selectTenant(kind === "tenant-mismatch" ? { ...tenant, portalOrigin: "https://other.example.test" } : tenant);
    assert.equal(f.render().challenge, null);
    assert.equal(f.render().busy, false);
    assert.ok(f.render().error);
    if (kind.startsWith("invalid")) assert.match(f.render().error!, /No se pudo validar el tiempo/);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.storage, []);
    assert.deepEqual(f.forbidden, []);
  }
});

test("new login after expired cancellation never reuses the old anchor or callbacks", async () => {
  const f = await appFixture();
  await f.render().login("fixture", "fixture-only");
  const previous = f.render();
  assert.ok(previous.challenge);
  f.time.mono += 121_000;
  previous.cancelLoginChallenge();
  await f.render().login("fixture", "fixture-only");
  const fresh = f.render();
  assert.ok(fresh.challenge);
  assert.notEqual(fresh.challenge, previous.challenge);
  assert.equal(f.clock.getTenantChallengeRemaining(fresh.challenge).remainingMs, 118_500);
  await previous.selectTenant(tenant);
  previous.cancelLoginChallenge();
  assert.equal(f.render().challenge, fresh.challenge);
  assert.equal(f.calls.length, 2);
  await fresh.selectTenant(tenant);
  assert.ok(f.render().session);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.forbidden, []);
});

test("pending lock prevents double completion/cancellation; cancellation invalidates old callbacks", async () => {
  const f = await appFixture();
  const complete = f.HttpRepository.prototype.completeLogin;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  f.HttpRepository.prototype.completeLogin = async function (value, selected) { await gate; return complete.call(this, value, selected); };
  await f.render().login("fixture", "fixture-only");
  const app = f.render();
  const pending = app.selectTenant(tenant);
  assert.equal(f.render().busy, true);
  f.render().cancelLoginChallenge();
  await f.render().selectTenant(tenant);
  assert.equal(f.render().challenge, app.challenge);
  release(); await pending;
  assert.equal(f.calls.length, 2);
  assert.ok(f.render().session);

  const cancelled = await appFixture();
  await cancelled.render().login("fixture", "fixture-only");
  const stale = cancelled.render();
  stale.cancelLoginChallenge();
  await stale.selectTenant(tenant);
  assert.equal(cancelled.calls.length, 1);
  assert.equal(cancelled.render().challenge, null);
  assert.deepEqual(cancelled.storage, []);
});

interface ElementProps {
  children?: unknown;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  onPress?: () => void;
  onSelect?: (tenant: Tenant) => void;
}
interface Element { type: string; props: ElementProps; }
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== "object" || value === null || !("type" in value) || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && "props" in value) return text((value as Element).props.children);
  return "";
}
async function screenFixture(options: Parameters<typeof httpFixture>[0] = {}) {
  const http = httpFixture(options);
  const result = await http.repo.startLogin("fixture", "fixture-only");
  assert.ok(result.nextStep === "SELECT_TENANT");
  const hooks = reactFixture();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let listener: ((state: string) => void) | null = null;
  let selected = 0;
  let cancelled = 0;
  const props: TenantSelectionScreenProps = { challenge: result, busy: false, error: null, onSelect: () => { selected++; }, onCancel: () => { cancelled++; } };
  const jsx = (type: string, props: ElementProps): Element => ({ type, props });
  const module = loadSource<{ TenantSelectionScreen: (props: TenantSelectionScreenProps) => Element }>("screens/TenantSelectionScreen.tsx", (id) => {
    if (id === "react") return hooks.react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "../infrastructure/tenantChallengeClock") return http.clock;
    if (id === "react-native") return { ActivityIndicator: "ActivityIndicator", ScrollView: "ScrollView", Text: "Text", View: "View",
      StyleSheet: { create: (styles: object) => styles }, AppState: { addEventListener: (_event: string, callback: (state: string) => void) => {
        listener = callback; return { remove: () => { listener = null; } };
      } } };
    if (id === "@expo/vector-icons") return { Ionicons: "Ionicons" };
    if (id === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (id === "../ui/components") return { BodyText: "BodyText", Brand: "Brand", Button: "Button", Card: "Card", SectionTitle: "SectionTitle" };
    if (id === "../ui/theme") return { palette: {}, radius: {}, typography: {} };
    if (id === "./TenantPicker") return { TenantPicker: "TenantPicker" };
    throw new Error(`UNEXPECTED_IMPORT_${id}`);
  }, { Date: http.PhoneDate, setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id: number) => timers.delete(id) });
  function render() { const tree = hooks.render(() => module.TenantSelectionScreen(props)); hooks.flush(); return { tree, nodes: elements(tree), text: text(tree) }; }
  return { ...http, props, render, timers, resume: () => listener?.("active"), unmount: hooks.unmount, selected: () => selected, cancelled: () => cancelled };
}

test("actual screen recalculates on render/resume without resetting deadline or trusting phone wall time", async () => {
  const f = await screenFixture();
  let view = f.render();
  assert.match(view.text, /119 segundos/);
  f.time.wall -= 365 * 86400_000;
  f.time.mono += 60_000;
  f.resume(); view = f.render();
  assert.match(view.text, /59 segundos/);
  assert.equal(view.nodes.filter((node) => node.type === "TenantPicker").length, 1);
  f.unmount();
  assert.equal(f.timers.size, 0);
  f.time.mono += 60_000;
  view = f.render();
  assert.match(view.text, /selección de empresa venció/);
  assert.equal(view.nodes.some((node) => node.type === "TenantPicker"), false);
  const buttons = view.nodes.filter((node) => node.type === "Button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.title, "Volver al acceso");
  assert.equal(buttons[0].props.disabled, false);
  buttons[0].props.onPress?.();
  assert.equal(f.cancelled(), 1);
});

test("screen fallback is validation-labelled, and cancel precedes ten cards without duplication", async () => {
  const f = await screenFixture({ date: null, body: { ...challenge(), expiresAt: "2000-01-01T00:00:00Z" } });
  const view = f.render();
  assert.match(view.text, /El servidor validará la vigencia/);
  assert.doesNotMatch(view.text, /venció|120 segundos/);
  const buttonIndex = view.nodes.findIndex((node) => node.type === "Button");
  const pickerIndex = view.nodes.findIndex((node) => node.type === "TenantPicker");
  assert.ok(buttonIndex >= 0 && buttonIndex < pickerIndex);
  assert.equal(f.props.challenge.tenants.length, 10);
  view.nodes[pickerIndex].props.onSelect?.(tenant);
  assert.equal(f.selected(), 1);
  f.time.mono += 120_000;
  f.resume();
  assert.match(f.render().text, /Se agotó el tiempo local/);
  f.unmount();
});

test("screen click rechecks elapsed time even before timer/resume, and auth-pending cancellation stays disabled", async () => {
  const f = await screenFixture();
  const picker = f.render().nodes.find((node) => node.type === "TenantPicker");
  assert.ok(picker);
  f.props.busy = true;
  let view = f.render();
  assert.equal(view.nodes.find((node) => node.type === "Button")?.props.disabled, true);
  view.nodes.find((node) => node.type === "TenantPicker")?.props.onSelect?.(tenant);
  assert.equal(f.selected(), 0);
  f.props.busy = false;
  f.time.mono += 120_000;
  picker.props.onSelect?.(tenant);
  assert.equal(f.selected(), 0);
  view = f.render();
  assert.equal(view.nodes.some((node) => node.type === "TenantPicker"), false);
  f.unmount();
});

test("screen invalid monotonic/expiry timing gives an explicit reason and immediate return action", async () => {
  for (const invalid of ["clock", "expiry"]) {
    const f = await screenFixture();
    f.render();
    if (invalid === "clock") f.time.mono = -1;
    else f.props.challenge.expiresAt = "invalid";
    f.resume();
    const view = f.render();
    assert.match(view.text, /No se pudo validar el tiempo/);
    assert.equal(view.nodes.some((node) => node.type === "TenantPicker"), false);
    assert.equal(view.nodes.filter((node) => node.type === "Button").length, 1);
    assert.equal(f.timers.size, 0);
    f.unmount();
  }
});