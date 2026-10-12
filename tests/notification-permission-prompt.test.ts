import assert from "node:assert/strict";
import { test } from "node:test";
import type { MobileNotificationsModel } from "../src/notifications/useMobileNotifications";
import type { MobileNotificationState } from "../src/notifications/MobileNotificationClient";
import * as zod from "zod";
import * as dedupe from "../src/notifications/notificationPresentationDedupe";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";

type Button = { text: string; onPress?: () => void };
type Device = { granted: boolean; canAskAgain?: boolean };

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
  const hooks = reactFixture();
  const alerts: Array<{ title: string; message: string; buttons: Button[] }> = [];
  const appListeners: Array<(state: string) => void> = [];
  const asked: string[] = [];
  const device: { camera: Device; location: Device } = { camera: { granted: false, canAskAgain: true }, location: { granted: false, canAskAgain: true } };
  const native = { Alert: { alert: (title: string, message: string, buttons: Button[]) => { alerts.push({ title, message, buttons }); } }, Platform: { OS: "android" },
    AppState: { currentState: "active", addEventListener: (_event: string, listener: (state: string) => void) => { appListeners.push(listener); return { remove: () => undefined }; } } };
  const module = loadSource<typeof import("../src/notifications/useNotificationPermissionPrompt")>("notifications/useNotificationPermissionPrompt.ts", id => {
    if (id === "react") return hooks.react;
    if (id === "react-native") return native;
    if (id === "expo-image-picker") return { getCameraPermissionsAsync: async () => device.camera, requestCameraPermissionsAsync: async () => { asked.push("camera"); return device.camera; } };
    if (id === "expo-location") return { getForegroundPermissionsAsync: async () => device.location, requestForegroundPermissionsAsync: async () => { asked.push("location"); return device.location; } };
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  });
  const calls = { enable: 0, settings: 0 };
  // Lo que responde el teléfono al mostrar su ventana de notificaciones.
  const push = { answer: "granted" as string, optedOut: false };
  const client = {
    isCurrent: () => true,
    // Con "Recibir avisos" apagado a propósito el cliente no muestra la ventana del teléfono.
    requestDevicePermission: async () => { if (!push.optedOut) asked.push("notifications"); return { permission: push.answer, optedOut: push.optedOut }; },
    retryEnable: async () => { calls.enable++; return true; },
    openSettings: async () => { calls.settings++; return true; },
  };
  const state = { ready: true, busy: false, optedIn: true, registered: false, permission: "undetermined", status: { enabled: true } } as MobileNotificationState;
  const model = (value: Partial<MobileNotificationState> = {}, storageKey = "tenant-a") => ({ client, state: { ...state, ...value }, storageKey }) as unknown as MobileNotificationsModel;
  const render = async (value: MobileNotificationsModel, allow = true, unlocked = true) => { hooks.render(() => module.useNotificationPermissionPrompt(value, allow, () => unlocked)); hooks.flush(); await settle(); await settle(); await settle(); };
  const press = (label: string) => alerts.at(-1)?.buttons.find(button => button.text === label)?.onPress?.();
  /** La app vuelve al frente: avisa a los oyentes como lo haría el teléfono. */
  const foreground = () => { for (const listener of appListeners) listener("active"); };
  return { alerts, asked, device, push, calls, model, render, press, native, foreground };
}

test("al iniciar sesión pide, una tras otra, notificaciones, cámara y ubicación con la ventana del teléfono", async () => {
  const current = fixture();
  await current.render(current.model());
  assert.deepEqual(current.asked, ["notifications", "camera", "location"]);
  assert.equal(current.calls.enable, 1, "con el permiso concedido registra el teléfono en el servidor");
  assert.equal(current.alerts.length, 0, "no hay un aviso previo: aparece directo la ventana del teléfono");
  await current.render(current.model({ permission: "denied" }));
  assert.equal(current.asked.length, 3, "no se repite en la misma sesión");
  await current.render(current.model({ permission: "denied" }, "tenant-b"));
  assert.equal(current.asked.length, 6, "una sesión distinta vuelve a pedir");
});

test("la ventana de notificaciones aparece aunque el servidor no tenga listo el servicio de avisos", async () => {
  const current = fixture();
  await current.render(current.model({ status: { enabled: false } } as Partial<MobileNotificationState>));
  assert.deepEqual(current.asked, ["notifications", "camera", "location"]);
  assert.equal(current.calls.enable, 0, "sin servicio en el servidor no intenta registrar el teléfono");
  const offline = fixture();
  await offline.render(offline.model({ status: null } as unknown as Partial<MobileNotificationState>));
  assert.equal(offline.asked[0], "notifications");
});

test("activa Recibir avisos aunque estuviera desactivado y no vuelve a pedir permisos ya concedidos o bloqueados", async () => {
  const current = fixture();
  current.device.camera = { granted: true };
  current.device.location = { granted: false, canAskAgain: false };
  await current.render(current.model({ optedIn: false, registered: true, permission: "granted" }));
  assert.deepEqual(current.asked, ["notifications"]);
});

test("notificaciones bloqueadas ofrecen Ajustes y se siguen pidiendo cámara y ubicación", async () => {
  const current = fixture();
  current.push.answer = "blocked";
  await current.render(current.model({ permission: "blocked" }));
  assert.equal(JSON.stringify(current.alerts.at(-1)?.buttons.map(button => button.text)), JSON.stringify(["Ahora no", "Abrir ajustes"]));
  current.press("Abrir ajustes");
  assert.deepEqual(current.calls, { enable: 0, settings: 1 });
  assert.deepEqual(current.asked, ["notifications", "camera", "location"]);
});

test("si el teléfono ya está registrado no vuelve a pedir notificaciones; nada si no está listo, bloqueada o en segundo plano", async () => {
  const current = fixture();
  current.device.camera = { granted: true };
  current.device.location = { granted: true };
  await current.render(current.model({ registered: true, permission: "granted" }), true);
  assert.deepEqual(current.asked, []);
  assert.equal(current.calls.enable, 0);
  const idle = fixture();
  for (const value of [{ ready: false }, { busy: true }] as Array<Partial<MobileNotificationState>>) await idle.render(idle.model(value));
  await idle.render(idle.model(), false);
  await idle.render(idle.model(), true, false);
  idle.native.AppState.currentState = "background";
  await idle.render(idle.model());
  assert.deepEqual(idle.asked, []);
  assert.equal(idle.alerts.length, 0);
});

test("cámara y ubicación bloqueadas: un solo aviso con la lista y acceso a Ajustes", async () => {
  const current = fixture();
  current.device.camera = { granted: false, canAskAgain: false };
  current.device.location = { granted: false, canAskAgain: false };
  await current.render(current.model({ registered: true, permission: "granted" }));
  assert.deepEqual(current.asked, [], "el teléfono ya no deja mostrar su ventana");
  assert.equal(current.alerts.length, 1);
  assert.match(current.alerts[0].message, /^Cámara y Ubicación están bloqueados/);
  current.press("Abrir ajustes");
  assert.equal(current.calls.settings, 1);
});

test("al volver a la app revisa de nuevo los permisos, como máximo cada 5 minutos", async () => {
  const current = fixture();
  const realNow = Date.now;
  try {
    await current.render(current.model());
    assert.deepEqual(current.asked, ["notifications", "camera", "location"]);
    current.device.camera = { granted: false, canAskAgain: true };
    current.foreground();
    await current.render(current.model());
    assert.equal(current.asked.length, 3, "recién revisado: no vuelve a preguntar");
    const later = realNow() + 6 * 60_000;
    Date.now = () => later;
    current.foreground();
    await current.render(current.model());
    assert.deepEqual(current.asked.slice(3), ["notifications", "camera", "location"], "el técnico desactivó la cámara en Ajustes: se vuelve a pedir");
  } finally { Date.now = realNow; }
});

test("permissionList arma la lista en español", async () => {
  const { permissionList } = loadSource<typeof import("../src/notifications/useNotificationPermissionPrompt")>("notifications/useNotificationPermissionPrompt.ts", id => {
    if (id === "react") return reactFixture().react;
    return {};
  });
  assert.equal(permissionList(["Cámara"]), "Cámara");
  assert.equal(permissionList(["Notificaciones", "Cámara", "Ubicación"]), "Notificaciones, Cámara y Ubicación");
});

test("si el técnico apagó Recibir avisos no se reactiva ni se avisa como bloqueado; cámara y ubicación se revisan igual", async () => {
  const current = fixture();
  current.push.optedOut = true;
  current.push.answer = "blocked";
  await current.render(current.model({ optedIn: false, registered: false }));
  assert.deepEqual(current.asked, ["camera", "location"]);
  assert.equal(current.calls.enable, 0, "no vuelve a registrar el teléfono");
  assert.equal(current.alerts.length, 0, "no insiste con las notificaciones");
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
