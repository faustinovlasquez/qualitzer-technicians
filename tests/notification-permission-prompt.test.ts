import assert from "node:assert/strict";
import { test } from "node:test";
import type { MobileNotificationsModel } from "../src/notifications/useMobileNotifications";
import type { MobileNotificationState } from "../src/notifications/MobileNotificationClient";
import * as zod from "zod";
import * as dedupe from "../src/notifications/notificationPresentationDedupe";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";

type Button = { text: string; onPress?: () => void };

function fixture() {
  const hooks = reactFixture();
  const alerts: Array<{ title: string; buttons: Button[] }> = [];
  const native = { Alert: { alert: (title: string, _message: string, buttons: Button[]) => { alerts.push({ title, buttons }); } }, AppState: { currentState: "active" } };
  const module = loadSource<typeof import("../src/notifications/useNotificationPermissionPrompt")>("notifications/useNotificationPermissionPrompt.ts", id => {
    if (id === "react") return hooks.react;
    if (id === "react-native") return native;
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  });
  const calls = { enable: 0, settings: 0 };
  const client = { isCurrent: () => true, retryEnable: async () => { calls.enable++; return true; }, openSettings: async () => { calls.settings++; return true; } };
  const state = { ready: true, busy: false, optedIn: true, registered: false, permission: "undetermined", status: { enabled: true } } as MobileNotificationState;
  const model = (value: Partial<MobileNotificationState> = {}, storageKey = "tenant-a") => ({ client, state: { ...state, ...value }, storageKey }) as unknown as MobileNotificationsModel;
  const render = (value: MobileNotificationsModel, allow = true, unlocked = true) => { hooks.render(() => module.useNotificationPermissionPrompt(value, allow, () => unlocked)); hooks.flush(); };
  const press = (label: string) => alerts.at(-1)?.buttons.find(button => button.text === label)?.onPress?.();
  return { alerts, calls, model, render, press, native };
}

test("missing permission shows the explanation once and Permitir opens the system dialog through the client", () => {
  const current = fixture();
  current.render(current.model());
  assert.deepEqual(current.alerts.map(alert => alert.title), ["Activa las notificaciones"]);
  current.press("Permitir");
  assert.equal(current.calls.enable, 1);
  current.render(current.model({ busy: true }));
  current.render(current.model({ permission: "denied" }));
  assert.equal(current.alerts.length, 1, "no se repite en la misma sesión");
  current.render(current.model({ permission: "denied" }, "tenant-b"));
  assert.equal(current.alerts.length, 2, "una sesión distinta vuelve a avisar");
});

test("blocked permission offers Ajustes instead of a system dialog", () => {
  const current = fixture();
  current.render(current.model({ permission: "blocked" }));
  assert.equal(JSON.stringify(current.alerts.at(-1)?.buttons.map(button => button.text)), JSON.stringify(["Ahora no", "Abrir ajustes"]));
  current.press("Abrir ajustes");
  assert.deepEqual(current.calls, { enable: 0, settings: 1 });
});

test("no prompt when granted, registered, explicitly disabled, server disabled, locked, busy or in background", () => {
  const current = fixture();
  for (const value of [{ permission: "granted" }, { registered: true }, { optedIn: false }, { status: { enabled: false } }, { ready: false }] as Array<Partial<MobileNotificationState>>) {
    current.render(current.model(value));
  }
  current.render(current.model(), false);
  current.render(current.model(), true, false);
  current.native.AppState.currentState = "background";
  current.render(current.model());
  assert.equal(current.alerts.length, 0);
});

test("notifications are enabled by default unless the technician explicitly disabled them", async () => {
  const stored = new Map<string, string>();
  const adapter = loadSource<typeof import("../src/notifications/notificationAdapter")>("notifications/notificationAdapter.ts", id => {
    if (id === "react-native") return { Platform: { OS: "android" }, Linking: {} };
    if (id === "expo-constants") return { __esModule: true, default: { executionEnvironment: "standalone", expoConfig: { extra: {} } }, ExecutionEnvironment: { StoreClient: "storeClient" } };
    if (id === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: async (key: string) => stored.get(key) ?? null, setItem: async (key: string, value: string) => { stored.set(key, value); } } };
    if (id === "zod") return zod;
    if (id === "./notificationPresentationDedupe") return dedupe;
    if (id === "./MobileNotificationClient") return { notificationReadWithTimeout: <T>(value: Promise<T>) => value };
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  }).createNotificationAdapter();
  assert.equal(await adapter.readConsent("k"), true);
  await adapter.writeConsent("k", false);
  assert.equal(await adapter.readConsent("k"), false);
  await adapter.writeConsent("k", true);
  assert.equal(await adapter.readConsent("k"), true);
});
