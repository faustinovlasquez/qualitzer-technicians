/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { DeviceLockController } from "../src/security/DeviceLockController";
import type { DeviceAuthenticationResult } from "../src/security/contracts";
import type { DeviceSecurityUi } from "../src/security/DeviceSecurityContext";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

interface Props {
  children?: unknown;
  value?: unknown;
  visible?: boolean;
  title?: string;
  onPress?: () => void;
  [name: string]: unknown;
}
interface Element { type: unknown; props: Props; key?: string; }
interface Context { provider: true; value: unknown; Provider: Context; }
interface Tree { type: string; props: Props; children: Tree[]; }
interface Memo<T> { dependencies: readonly unknown[]; value: T; }
type Component = (props: Props) => unknown;

function element(type: unknown, props: Props = {}, key?: string): Element { return { type, props, key }; }
function isElement(value: unknown): value is Element { return typeof value === "object" && value !== null && "type" in value && "props" in value; }
function isContext(value: unknown): value is Context { return typeof value === "object" && value !== null && "provider" in value; }

// Reconcile source-generated JSX by position/type; hook slots and hidden/modal children survive rerenders.
function renderer(unmountHiddenModals = false) {
  const instances = new Map<string, { type: Component; hooks: ReturnType<typeof reactFixture> }>();
  let active: ReturnType<typeof reactFixture> | null = null;
  let security: DeviceSecurityUi | null = null;
  const hooks = () => { assert.ok(active, "HOOK_OUTSIDE_COMPONENT"); return active; };
  function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T {
    const slot = hooks().react.useRef<Memo<T> | null>(null) as { current: Memo<T> | null };
    if (!slot.current || dependencies.length !== slot.current.dependencies.length || dependencies.some((value, i) => !Object.is(value, slot.current?.dependencies[i]))) {
      slot.current = { dependencies, value: factory() };
    }
    return slot.current.value;
  }
  const react = {
    useState: <T>(initial: T | (() => T)) => hooks().react.useState(initial),
    useRef: <T>(initial: T) => hooks().react.useRef(initial),
    useEffect: (effect: () => void | (() => void), dependencies: readonly unknown[]) => hooks().react.useEffect(effect, dependencies),
    useSyncExternalStore: (subscribe: unknown, snapshot: () => unknown) => hooks().react.useSyncExternalStore(subscribe, snapshot),
    useMemo,
    useCallback: <T>(callback: T, dependencies: readonly unknown[]) => useMemo(() => callback, dependencies),
    createContext: (value: unknown) => {
      const context = { provider: true, value } as Context;
      context.Provider = context;
      return context;
    },
    useContext: (context: Context) => context.value,
  };
  const jsx = { jsx: element, jsxs: element, Fragment: "Fragment" };
  return {
    react, jsx,
    get security(): DeviceSecurityUi { assert.ok(security); return security; },
    render(root: Element): Tree[] {
      const visited = new Set<string>();
      function visit(value: unknown, path: string): Tree[] {
        if (value === null || value === undefined || typeof value === "boolean") return [];
        if (Array.isArray(value)) return value.flatMap((child, i) => visit(child, `${path}/${i}`));
        if (!isElement(value)) return [{ type: "#text", props: { value }, children: [] }];
        if (isContext(value.type)) {
          const previous = value.type.value;
          value.type.value = value.props.value;
          security = value.props.value as DeviceSecurityUi;
          const children = visit(value.props.children, `${path}/context`);
          value.type.value = previous;
          return children;
        }
        if (typeof value.type === "function") {
          const type = value.type as Component;
          const identity = `${path}:${value.key ?? ""}`;
          let instance = instances.get(identity);
          if (instance?.type !== type) {
            instance?.hooks.unmount();
            instance = { type, hooks: reactFixture() };
            instances.set(identity, instance);
          }
          visited.add(identity);
          const previous = active;
          active = instance.hooks;
          const output = instance.hooks.render(() => type(value.props));
          active = previous;
          return visit(output, `${identity}/render`);
        }
        assert.equal(typeof value.type, "string", "UNEXPECTED_JSX_TYPE");
        return [{ type: String(value.type), props: value.props, children: unmountHiddenModals && value.type === "NativeModal" && value.props.visible === false ? [] : visit(value.props.children, `${path}/children`) }];
      }
      const tree = visit(root, "root");
      for (const [path, instance] of instances) {
        if (!visited.has(path)) { instance.hooks.unmount(); instances.delete(path); }
        else instance.hooks.flush();
      }
      return tree;
    },
    unmount() { for (const instance of instances.values()) instance.hooks.unmount(); instances.clear(); },
  };
}

interface NativeOptions {
  unmountHiddenModals?: boolean;
  os?: "android" | "ios" | "web";
  version?: number | string;
  preference?: string | null;
  level?: number;
  initialState?: string;
  read?: () => Promise<string | null>;
  capture?: () => Promise<void>;
  allow?: () => Promise<void>;
  switcher?: () => Promise<void>;
}

function nativeFixture(options: NativeOptions = {}) {
  const events: string[] = [];
  const applied: string[] = [];
  const privacy: { captureBlocked: boolean | null; switcherEnabled: boolean | null } = { captureBlocked: null, switcherEnabled: null };
  const reads: string[] = [];
  const writes: Array<{ key: string; value: string; options: { keychainAccessible: number } }> = [];
  const prompts: Array<{ options: Props; result: ReturnType<typeof deferred<DeviceAuthenticationResult>> }> = [];
  const listeners = new Set<(state: string) => void>();
  const backHandlers = new Set<() => boolean>();
  const appState = {
    currentState: options.initialState ?? "active",
    addEventListener(name: string, listener: (state: string) => void) {
      assert.equal(name, "change"); listeners.add(listener);
      return { remove: () => { listeners.delete(listener); } };
    },
  };
  const native = {
    Platform: { OS: options.os ?? "android", Version: options.version ?? 36 },
    AppState: appState,
    StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } },
    View: "View", Text: "Text", Modal: "NativeModal", ActivityIndicator: "ActivityIndicator", ScrollView: "ScrollView",
    Keyboard: { dismiss: () => { events.push("keyboard.dismiss"); } },
    BackHandler: { addEventListener: (name: string, handler: () => boolean) => {
      assert.equal(name, "hardwareBackPress"); backHandlers.add(handler);
      return { remove: () => { backHandlers.delete(handler); } };
    } },
  };
  function forbidden(id: string): never { throw new Error(`UNEXPECTED_IMPORT:${id}`); }
  const binding = loadSource<typeof import("../src/offline/foregroundBinding")>("offline/foregroundBinding.ts", forbidden);
  const foreground = loadSource<typeof import("../src/offline/foreground")>("offline/foreground.ts", id => {
    if (id === "react-native") return native;
    if (id === "./foregroundBinding") return binding;
    return forbidden(id);
  });
  const adapterModule = loadSource<typeof import("../src/security/deviceSecurityAdapter")>("security/deviceSecurityAdapter.ts", id => {
    if (id === "react-native") return native;
    if (id === "../offline/foreground") return foreground;
    if (id === "expo-secure-store") return {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 73,
      getItemAsync: async (key: string) => { reads.push(key); return options.read ? options.read() : options.preference ?? null; },
      setItemAsync: async (key: string, value: string, writeOptions: { keychainAccessible: number }) => { writes.push({ key, value, options: writeOptions }); },
    };
    if (id === "expo-local-authentication") return {
      SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
      getEnrolledLevelAsync: async () => { events.push("auth.enrolled"); return options.level ?? 1; },
      isEnrolledAsync: () => { throw new Error("BIOMETRIC_ONLY_CHECK_FORBIDDEN"); },
      hasHardwareAsync: () => { throw new Error("BIOMETRIC_HARDWARE_CHECK_FORBIDDEN"); },
      authenticateAsync: (promptOptions: Props) => {
        events.push("auth.prompt");
        const result = deferred<DeviceAuthenticationResult>(); prompts.push({ options: promptOptions, result }); return result.promise;
      },
      cancelAuthenticate: async () => { events.push("auth.cancel"); },
    };
    return forbidden(id);
  });
  const capture = {
    preventScreenCaptureAsync: async (key: string) => {
      assert.equal(key, "qualitzer-device-security"); events.push(`capture.prevent:${key}`);
      await options.capture?.(); privacy.captureBlocked = true; applied.push("capture.prevent");
    },
    allowScreenCaptureAsync: async (key: string) => {
      assert.equal(key, "qualitzer-device-security"); events.push(`capture.allow:${key}`);
      await options.allow?.(); privacy.captureBlocked = false; applied.push("capture.allow");
    },
    enableAppSwitcherProtectionAsync: async (intensity: number) => {
      events.push(`switcher.enable:${intensity}`);
      await options.switcher?.(); privacy.switcherEnabled = true; applied.push("switcher.enable");
    },
    disableAppSwitcherProtectionAsync: async () => {
      events.push("switcher.disable"); privacy.switcherEnabled = false; applied.push("switcher.disable");
    },
  };
  return {
    native, foreground, adapterModule, capture, events, applied, privacy, reads, writes, prompts, listeners, backHandlers,
    emit(state: string) { appState.currentState = state; for (const listener of [...listeners]) listener(state); },
  };
}

function nodes(tree: Tree[], type: string): Tree[] { return tree.flatMap(node => [...(node.type === type ? [node] : []), ...nodes(node.children, type)]); }
function text(tree: Tree[]): string { return nodes(tree, "#text").map(node => String(node.props.value)).join(" "); }

function providerFixture(options: NativeOptions = {}) {
  const ports = nativeFixture(options);
  const view = renderer(options.unmountHiddenModals);
  const theme = loadSource<object>("ui/theme.ts", id => { throw new Error(`UNEXPECTED_THEME_IMPORT:${id}`); });
  const context = loadSource<{ DeviceSecurityContext: Context; PrivateModal: Component; useDeviceSecurity(): DeviceSecurityUi }>("security/DeviceSecurityContext.tsx", id => {
    if (id === "react") return view.react;
    if (id === "react/jsx-runtime") return view.jsx;
    if (id === "react-native") return ports.native;
    throw new Error(`UNEXPECTED_CONTEXT_IMPORT:${id}`);
  });
  const ui = { BodyText: "BodyText", Brand: "Brand", Button: "Button", Card: "Card", SectionTitle: "SectionTitle" };
  const screen = loadSource<{ DeviceLockScreen: Component }>("security/DeviceLockScreen.tsx", id => {
    if (id === "react/jsx-runtime") return view.jsx;
    if (id === "react-native") return ports.native;
    if (id === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (id === "@expo/vector-icons") return { Ionicons: "Ionicons" };
    if (id === "../ui/components") return ui;
    if (id === "../ui/theme") return theme;
    throw new Error(`UNEXPECTED_SCREEN_IMPORT:${id}`);
  });
  const provider = loadSource<{ DeviceSecurityProvider: Component }>("security/DeviceSecurityProvider.tsx", id => {
    if (id === "react") return view.react;
    if (id === "react/jsx-runtime") return view.jsx;
    if (id === "react-native") return ports.native;
    if (id === "expo-screen-capture") return ports.capture;
    if (id === "../offline/foreground") return ports.foreground;
    if (id === "./DeviceLockController") return { DeviceLockController };
    if (id === "./deviceSecurityAdapter") return ports.adapterModule;
    if (id === "./DeviceSecurityContext") return context;
    if (id === "./DeviceLockScreen") return screen;
    if (id === "../ui/theme") return theme;
    throw new Error(`UNEXPECTED_PROVIDER_IMPORT:${id}`);
  });
  const lifecycle = { mounts: 0, unmounts: 0, draft: "unsaved fixture draft", identities: new Set<object>() };
  const modalVisibility = { value: true as boolean | undefined };
  function Draft(): Element {
    const identity = view.react.useRef({});
    lifecycle.identities.add(identity as object);
    view.react.useEffect(() => { lifecycle.mounts += 1; return () => { lifecycle.unmounts += 1; }; }, []);
    return element("Draft", { children: lifecycle.draft });
  }
  function Child(): Element {
    context.useDeviceSecurity();
    return element("PrivateChild", { children: element(context.PrivateModal, { visible: modalVisibility.value, children: element(Draft) }) });
  }
  const root = element(provider.DeviceSecurityProvider, { children: element(Child) });
  let tree: Tree[] = [];
  const render = () => { tree = view.render(root); return tree; };
  render();
  return {
    ...ports, view, lifecycle, modalVisibility, render,
    get tree() { return tree; },
    get security() { return view.security; },
    async settle() { for (let i = 0; i < 6; i += 1) { await new Promise<void>(done => setImmediate(done)); render(); } },
    press(title: string) {
      const button = nodes(tree, "Button").find(node => node.props.title === title);
      assert.ok(button, `BUTTON_NOT_FOUND:${title}`); assert.equal(typeof button.props.onPress, "function"); button.props.onPress?.(); render();
    },
    close() { view.unmount(); },
  };
}

function assertBlocked(f: ReturnType<typeof providerFixture>, retained = false): void {
  assert.equal(f.security.blocked, true);
  assert.equal(f.security.isUnlocked(), false);
  assert.equal(nodes(f.tree, "PrivateChild").length, retained ? 1 : 0);
  const hidden = nodes(f.tree, "View").find(node => node.props.pointerEvents === "none");
  assert.ok(hidden);
  assert.equal(hidden.props.accessibilityElementsHidden, true);
  assert.equal(hidden.props.importantForAccessibility, "no-hide-descendants");
  assert.ok(Array.isArray(hidden.props.style) && hidden.props.style.some(style => style && style.display === "none"));
  assert.ok(nodes(f.tree, "View").some(node => node.props.accessibilityViewIsModal === true));
  for (const modal of nodes(f.tree, "NativeModal")) {
    assert.equal(modal.props.visible, f.security.nativePickerActive === true && f.modalVisibility.value !== false);
    if (modal.props.visible) {
      const covered = nodes(modal.children, "View").find(node => node.props.pointerEvents === "none");
      assert.ok(covered);
      assert.equal(covered.props.accessibilityElementsHidden, true);
      assert.equal(covered.props.importantForAccessibility, "no-hide-descendants");
      assert.ok(nodes(modal.children, "View").some(node => typeof node.props.style === "object" && node.props.style !== null && "backgroundColor" in node.props.style && node.props.style.backgroundColor === "#F5F7FA"));
    }
  }
}

test("integration runner uses Node 22+", () => { assert.ok(Number(process.versions.node.split(".")[0]) >= 22); });

for (const preference of ["enabled", "declined"]) for (const order of ["active-first", "result-first"]) {
  test(`Android modal preserves its child throughout ${preference} picker ${order}, including privacy restoration`, async t => {
    const allow = deferred<void>();
    let delayPrivacy = false;
    const fixture = providerFixture({ preference, unmountHiddenModals: true, allow: async () => { if (delayPrivacy) await allow.promise; } });
    t.after(() => fixture.close());
    await fixture.settle();
    if (preference === "enabled") { fixture.prompts[0].result.resolve({ success: true }); await fixture.settle(); }
    assert.equal(fixture.lifecycle.mounts, 1);
    const native = deferred<string>();
    let delivered = false;
    delayPrivacy = true;
    const result = fixture.security.runTrustedNativePicker!(async () => native.promise).then(value => { delivered = true; return value; });
    await fixture.settle();
    assertBlocked(fixture, true);
    fixture.emit("background"); await fixture.settle();
    assert.equal(fixture.lifecycle.unmounts, 0);
    assertBlocked(fixture, true);
    if (order === "active-first") fixture.emit("active");
    else native.resolve("selected-file");
    await fixture.settle();
    assert.equal(delivered, false);
    if (order === "active-first") native.resolve("selected-file");
    else fixture.emit("active");
    await fixture.settle();
    assert.equal(fixture.security.nativePickerActive, true);
    assert.equal(fixture.lifecycle.unmounts, 0);
    assertBlocked(fixture, true);
    allow.resolve();
    assert.equal(await result, "selected-file");
    await fixture.settle();
    assert.equal(fixture.security.blocked, false);
    assert.equal(fixture.security.nativePickerActive, false);
    assert.equal(fixture.lifecycle.mounts, 1);
    assert.equal(fixture.lifecycle.unmounts, 0);
    assert.equal(fixture.prompts.length, preference === "enabled" ? 1 : 0);
    if (preference === "enabled") {
      fixture.emit("background"); await fixture.settle();
      assertBlocked(fixture, true);
      assert.equal(fixture.lifecycle.unmounts, 1, "Background privacy must still hide the native modal");
      fixture.emit("active"); await fixture.settle();
      assert.equal(fixture.security.isUnlocked(), true);
      assert.equal(fixture.prompts.length, 1);
    }
  });
}

for (const order of ["result-first", "active-first"] as const) {
  for (const canceled of [false, true]) {
    test(`real lock screen ${order} canceled=${canceled}: pending picker stays neutral and ordinary Home retains authentication`, async t => {
      const f = providerFixture({ preference: "enabled" });
      t.after(() => f.close());
      await f.settle();
      assert.equal(f.prompts.length, 1);
      f.prompts[0].result.resolve({ success: true });
      await f.settle();
      assert.equal(f.security.isUnlocked(), true);
      assert.ok(f.security.runTrustedNativePicker);
      const native = deferred<{ canceled: boolean }>();
      const result = f.security.runTrustedNativePicker(() => native.promise);
      const neutral = () => {
        assertBlocked(f, true);
        assert.equal(f.security.state.nativeInteractionPending, true);
        assert.match(text(f.tree), /Esperando selección…/);
        assert.doesNotMatch(text(f.tree), /huella|desbloque|vincular|protegido/i);
        assert.equal(nodes(f.tree, "Button").length, 0);
        assert.equal(nodes(f.tree, "Ionicons").length, 0);
        assert.equal(nodes(f.tree, "SectionTitle").length, 0);
        assert.equal(nodes(f.tree, "ActivityIndicator").filter(node => node.props.accessibilityLabel === "Esperando selección").length, 1);
        assert.equal(f.prompts.length, 1);
      };
      await f.settle(); neutral();
      for (let bounce = 0; bounce < 3; bounce += 1) {
        f.emit("background"); f.emit("active"); await f.settle(); neutral();
        assert.equal(f.privacy.captureBlocked, true);
      }
      f.emit("background"); await f.settle(); neutral();
      if (order === "result-first") native.resolve({ canceled });
      else f.emit("active");
      await f.settle(); neutral();
      if (order === "result-first") f.emit("active");
      else native.resolve({ canceled });
      assert.equal((await result).canceled, canceled);
      await f.settle();
      assert.equal(f.security.isUnlocked(), true);
      assert.equal(f.security.state.nativeInteractionPending, false);
      assert.equal(f.prompts.length, 1);
      assert.equal(f.lifecycle.mounts, 1);
      assert.equal(f.lifecycle.unmounts, 0);
      f.emit("background"); f.emit("active"); await f.settle();
      assert.equal(f.security.isUnlocked(), true);
      assert.equal(f.prompts.length, 1);
      assert.doesNotMatch(text(f.tree), /huella/);
      assert.doesNotMatch(text(f.tree), /Esperando selección/);
    });
  }
}

for (const preference of ["enabled", "declined"] as const) {
  test(`real provider and cover ${preference}: deferred protection prevents launch and keeps disabled security neutral`, async t => {
    const preparation = deferred<void>();
    const restoration = deferred<void>();
    let deferPrivacy = false;
    const f = providerFixture({
      preference,
      capture: () => deferPrivacy ? preparation.promise : Promise.resolve(),
      allow: () => deferPrivacy ? restoration.promise : Promise.resolve(),
    });
    t.after(() => f.close());
    await f.settle();
    if (preference === "enabled") { f.prompts[0].result.resolve({ success: true }); await f.settle(); }
    const prompts = f.prompts.length;
    assert.equal(f.security.isUnlocked(), true);
    assert.ok(f.security.runTrustedNativePicker);
    deferPrivacy = true;
    let launches = 0;
    const native = deferred<string>();
    const result = f.security.runTrustedNativePicker(() => {
      assert.equal(f.privacy.captureBlocked, true);
      launches += 1;
      f.emit("background");
      return native.promise;
    });
    await f.settle();
    assert.equal(launches, 0);
    assertBlocked(f, true);
    assert.doesNotMatch(text(f.tree), /huella|desbloque|vincular/i);
    assert.equal(nodes(f.tree, "Button").length, 0);
    preparation.resolve(); await f.settle();
    assert.equal(launches, 1);
    f.emit("active"); native.resolve("photo"); await f.settle();
    assertBlocked(f, true);
    if (preference === "declined") {
      assert.doesNotMatch(text(f.tree), /huella|desbloque|vincular/i);
      assert.equal(nodes(f.tree, "Button").length, 0);
      assert.equal(nodes(f.tree, "Ionicons").length, 0);
    }
    restoration.resolve(); assert.equal(await result, "photo"); await f.settle();
    assert.equal(f.security.isUnlocked(), true);
    assert.equal(f.prompts.length, prompts);
    assert.equal(f.lifecycle.mounts, 1);
    assert.equal(f.lifecycle.unmounts, 0);
  });
}

test("iOS preflight waits for app switcher protection after prevent, before invoking native SDK", async t => {
  const switcher = deferred<void>();
  let deferSwitcher = false;
  const f = providerFixture({ os: "ios", preference: "enabled", switcher: () => deferSwitcher ? switcher.promise : Promise.resolve() });
  t.after(() => f.close());
  await f.settle(); f.prompts[0].result.resolve({ success: true }); await f.settle();
  assert.ok(f.security.runTrustedNativePicker);
  deferSwitcher = true;
  let launches = 0;
  const result = f.security.runTrustedNativePicker(async () => { launches += 1; return "photo"; });
  await f.settle();
  assert.equal(f.privacy.captureBlocked, true);
  assert.equal(launches, 0);
  assertBlocked(f, true);
  switcher.resolve();
  assert.equal(await result, "photo");
  assert.equal(launches, 1);
  assert.equal(f.prompts.length, 1);
});

test("native adapter reads/writes only the exact preference key and device-only unlocked accessibility", async () => {
  const f = nativeFixture({ preference: "enabled" });
  const adapter = f.adapterModule.createDeviceSecurityAdapter();
  assert.equal(await adapter.readPreference(), "enabled");
  await adapter.writePreference("enabled"); await adapter.writePreference("declined");
  assert.deepEqual(f.reads, ["qualitzer.mobile.device-security.v1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [
    { key: "qualitzer.mobile.device-security.v1", value: "enabled", options: { keychainAccessible: 73 } },
    { key: "qualitzer.mobile.device-security.v1", value: "declined", options: { keychainAccessible: 73 } },
  ]);
  assert.doesNotMatch(JSON.stringify(f.writes), /token|password|qzm_|pin|pattern|biometric/i);
});

for (const [name, level, available] of [["NONE", 0, false], ["SECRET without biometrics", 1, true], ["BIOMETRIC_WEAK", 2, true], ["BIOMETRIC_STRONG", 3, true]] as const) {
  test(`native adapter enrollment ${name} => ${available}`, async () => {
    const f = nativeFixture({ level });
    assert.equal(await f.adapterModule.createDeviceSecurityAdapter().available(), available);
    assert.deepEqual(f.events, ["auth.enrolled"]);
  });
}

for (const [os, version, strength] of [["android", 29, "weak"], ["android", 30, "strong"], ["android", "36", "strong"], ["ios", "26.0", "strong"]] as const) {
  test(`${os} ${version}: Spanish system prompt permits device credential fallback with ${strength} policy`, async () => {
    const f = nativeFixture({ os, version });
    const result = f.adapterModule.createDeviceSecurityAdapter().authenticate();
    assert.deepEqual(JSON.parse(JSON.stringify(f.prompts[0].options)), {
      promptMessage: "Desbloquear Qualitzer técnicos", promptSubtitle: "Confirma que eres tú",
      promptDescription: "Usa la huella o la seguridad configurada en tu teléfono.", cancelLabel: "Cancelar",
      fallbackLabel: "Usar código del teléfono", disableDeviceFallback: false,
      biometricsSecurityLevel: strength, requireConfirmation: true,
    });
    f.prompts[0].result.resolve({ success: true });
    assert.equal((await result).success, true);
  });
}

for (const os of ["android", "ios"] as const) {
  test(`${os}: cancellation invokes only the supported native cancellation port`, async () => {
    const f = nativeFixture({ os }); await f.adapterModule.createDeviceSecurityAdapter().cancel();
    assert.deepEqual(f.events, os === "android" ? ["auth.cancel"] : []);
  });
}

for (const preference of ["", "ENABLED", "true", '{"enabled":true}', "enabled\n"]) {
  test(`corrupt preference ${JSON.stringify(preference)} rejects and provider stays fail-closed`, async t => {
    const f = providerFixture({ preference }); t.after(() => f.close());
    await assert.rejects(f.adapterModule.createDeviceSecurityAdapter().readPreference(), /DEVICE_SECURITY_PREFERENCE_INVALID/);
    await f.settle(); assertBlocked(f);
    assert.equal(f.security.state.ready, false);
    assert.equal(f.prompts.length, 0); assert.equal(f.writes.length, 0);
    assert.match(text(f.tree), /No se pudo leer la configuración/);
    assert.ok(nodes(f.tree, "Button").some(node => node.props.title === "Reintentar lectura segura"));
  });
}

test("web provider/controller never invoke native storage, authentication or capture ports", async t => {
  const f = providerFixture({ os: "web", read: async () => { throw new Error("WEB_STORAGE_FORBIDDEN"); } });
  t.after(() => f.close()); await f.settle();
  await f.security.controller.initialize(); await f.security.controller.enable(); await f.security.controller.unlock(); await f.security.controller.disable();
  f.security.controller.offer(); f.emit("background"); f.render(); f.emit("active"); await f.settle();
  assert.equal(f.security.state.supported, false); assert.equal(f.security.blocked, false);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []); assert.equal(f.prompts.length, 0);
});

for (const os of ["android", "ios"] as const) {
  test(`${os}: cold child mount waits for preference, unlock and every resolved privacy flag`, async t => {
    const read = deferred<string | null>(); const capture = deferred<void>(); const allow = deferred<void>();
    const switchers = [deferred<void>(), deferred<void>()]; let switcherCalls = 0;
    const f = providerFixture({ os, read: () => read.promise, capture: () => capture.promise, allow: () => allow.promise,
      switcher: () => { const call = switchers[switcherCalls++]; assert.ok(call, "UNEXPECTED_SWITCHER_CALL"); return call.promise; } });
    t.after(() => f.close()); assertBlocked(f); await f.settle(); assertBlocked(f);
    assert.equal(f.reads.length, 1); assert.equal(f.prompts.length, 0);
    assert.equal(f.applied.length, 0); assert.equal(f.privacy.captureBlocked, null);
    read.resolve("enabled"); await f.settle(); assertBlocked(f);
    assert.equal(f.prompts.length, 1); assert.equal(f.lifecycle.mounts, 0);
    assert.ok(f.events.includes("capture.prevent:qualitzer-device-security"));
    assert.ok(!f.events.includes("capture.allow:qualitzer-device-security"));
    f.prompts[0].result.resolve({ success: true }); await f.settle();
    assert.equal(f.security.state.locked, false); assertBlocked(f);
    capture.resolve(); await f.settle();
    assert.equal(f.privacy.captureBlocked, true); assertBlocked(f);
    if (os === "ios") {
      assert.equal(switcherCalls, 1); assert.equal(f.privacy.switcherEnabled, null);
      assert.ok(!f.events.includes("capture.allow:qualitzer-device-security"));
      switchers[0].resolve(); await f.settle(); assertBlocked(f);
    }
    assert.ok(f.events.includes("capture.allow:qualitzer-device-security"));
    assert.equal(f.lifecycle.mounts, 0);
    allow.resolve(); await f.settle();
    assert.equal(f.privacy.captureBlocked, false);
    if (os === "ios") {
      assert.equal(switcherCalls, 2); assertBlocked(f);
      switchers[1].resolve(); await f.settle();
      assert.equal(f.privacy.switcherEnabled, true);
      assert.ok(!f.events.includes("switcher.disable"));
    }
    assert.equal(f.security.blocked, false); assert.equal(f.security.isUnlocked(), true); assert.equal(f.lifecycle.mounts, 1);
    assert.equal(f.security.state.enabled, true); assert.equal(f.lifecycle.unmounts, 0);
    assert.equal(nodes(f.tree, "NativeModal")[0].props.visible, true);
    assert.deepEqual(f.applied.filter(event => event.startsWith("capture.")), ["capture.prevent", "capture.allow"]);
    if (os === "android") assert.ok(!f.events.some(event => event.startsWith("switcher.")));
  });
}

test("capture readiness alone cannot expose children before authentication succeeds", async t => {
  const f = providerFixture({ preference: "enabled" }); t.after(() => f.close()); await f.settle();
  assert.ok(f.events.includes("capture.prevent:qualitzer-device-security")); assertBlocked(f);
  assert.equal(f.privacy.captureBlocked, true);
  f.prompts[0].result.resolve({ success: false, error: "user_cancel" }); await f.settle(); assertBlocked(f);
  assert.equal(f.privacy.captureBlocked, true); assert.ok(!f.events.includes("capture.allow:qualitzer-device-security"));
  assert.equal(f.lifecycle.mounts, 0); assert.equal(f.prompts.length, 1);
});

for (const failure of ["allow", "switcher"] as const) {
  test(`${failure} rejection keeps authenticated private content unmounted and explains preservation`, async t => {
    const fail = async () => { throw new Error("FIXTURE_VISUAL_FAILURE"); };
    const f = providerFixture({ os: "ios", preference: "enabled", [failure]: fail }); t.after(() => f.close());
    await f.settle(); f.prompts[0].result.resolve({ success: true }); await f.settle(); assertBlocked(f);
    assert.equal(f.security.state.locked, false); assert.equal(f.lifecycle.mounts, 0);
    assert.equal(f.privacy.captureBlocked, failure === "allow");
    if (failure === "switcher") assert.equal(f.privacy.switcherEnabled, null);
    assert.match(text(f.tree), /No se pudo activar la protección visual/);
    assert.match(text(f.tree), /Cierra y vuelve a abrir la aplicación\. No borres sus datos; tus pendientes se conservan\./);
    assert.equal(nodes(f.tree, "Button").length, 0);
    await f.settle(); assertBlocked(f); assert.equal(f.prompts.length, 1); assert.deepEqual(f.writes, []);
  });
}

test("prevent rejection keeps the cold locked app unmounted with reopen guidance", async t => {
  const f = providerFixture({ preference: "enabled", capture: async () => { throw new Error("FIXTURE_PREVENT_FAILURE"); } });
  t.after(() => f.close()); await f.settle(); assertBlocked(f);
  assert.equal(f.privacy.captureBlocked, null); assert.deepEqual(f.applied, []);
  assert.equal(f.security.state.locked, true); assert.equal(f.lifecycle.mounts, 0);
  assert.match(text(f.tree), /No se pudo activar la protección visual/);
  assert.match(text(f.tree), /Cierra y vuelve a abrir la aplicación\. No borres sus datos; tus pendientes se conservan\./);
  assert.equal(nodes(f.tree, "Button").length, 0);
  f.prompts[0].result.resolve({ success: false, error: "user_cancel" }); await f.settle(); assertBlocked(f);
  assert.equal(f.prompts.length, 1); assert.deepEqual(f.writes, []);
});

test("secure-store read failure never mounts the app, including failed explicit retries", async t => {
  const f = providerFixture({ read: async () => { throw new Error("FIXTURE_SECURE_STORE_FAILURE"); } });
  t.after(() => f.close()); await f.settle();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assertBlocked(f); assert.equal(f.security.state.ready, false); assert.equal(f.lifecycle.mounts, 0);
    assert.equal(f.reads.length, attempt); assert.equal(f.prompts.length, 0); assert.deepEqual(f.writes, []);
    assert.equal(f.privacy.captureBlocked, null); assert.deepEqual(f.applied, []);
    assert.ok(!f.events.some(event => event.startsWith("capture.") || event.startsWith("switcher.")));
    assert.match(text(f.tree), /No se pudo leer la configuración/);
    if (attempt < 3) { f.press("Reintentar lectura segura"); assertBlocked(f); await f.settle(); }
  }
});

for (const os of ["android", "ios"] as const) {
  for (const preference of [null, "declined"] as const) {
    test(`${os}: preference=${String(preference)} explicitly allows capture even on initial false state`, async t => {
      const allow = deferred<void>();
      const f = providerFixture({ os, preference, allow: () => allow.promise }); t.after(() => f.close());
      await f.settle(); assert.equal(f.security.state.ready, true); assert.equal(f.security.state.enabled, false); assertBlocked(f);
      assert.ok(f.events.includes("capture.allow:qualitzer-device-security")); assert.equal(f.privacy.captureBlocked, null);
      assert.equal(f.lifecycle.mounts, 0); allow.resolve(); await f.settle();
      assert.equal(f.security.isUnlocked(), true); assert.equal(f.privacy.captureBlocked, false);
      f.emit("background"); f.render(); assertBlocked(f, true); await f.settle();
      assert.equal(f.privacy.captureBlocked, false); assert.equal(f.security.state.locked, false);
      f.emit("active"); await f.settle(); assert.equal(f.security.isUnlocked(), true);
      assert.equal(f.prompts.length, 0); assert.deepEqual(f.writes, []);
      assert.ok(!f.events.includes("capture.prevent:qualitzer-device-security"));
      assert.equal(f.privacy.switcherEnabled, os === "ios" ? false : null);
      assert.ok(!f.events.includes("switcher.enable:1"));
      assert.equal(f.lifecycle.mounts, 1); assert.equal(f.lifecycle.unmounts, 0);
    });
  }

  test(`${os}: initial allow failure stays fail-closed even when security was declined`, async t => {
    const f = providerFixture({ os, preference: "declined", allow: async () => { throw new Error("FIXTURE_ALLOW_FAILURE"); } });
    t.after(() => f.close()); await f.settle(); assertBlocked(f);
    assert.equal(f.security.state.enabled, false); assert.equal(f.security.state.locked, false);
    assert.equal(f.lifecycle.mounts, 0); assert.equal(f.privacy.captureBlocked, null);
    assert.match(text(f.tree), /Cierra y vuelve a abrir la aplicación\. No borres sus datos; tus pendientes se conservan\./);
    assert.equal(nodes(f.tree, "Button").length, 0); assert.equal(f.prompts.length, 0);
  });

  test(`${os}: background stays private until allow finishes without reauthentication`, async t => {
    const prevent = deferred<void>(); const allow = deferred<void>();
    let backgroundCycle = false;
    const f = providerFixture({ os, preference: "enabled", capture: () => backgroundCycle ? prevent.promise : Promise.resolve(),
      allow: () => backgroundCycle ? allow.promise : Promise.resolve() });
    t.after(() => f.close()); await f.settle();
    assertBlocked(f); assert.equal(f.privacy.captureBlocked, true);
    f.prompts[0].result.resolve({ success: true }); await f.settle();
    assert.equal(f.security.isUnlocked(), true); assert.equal(f.privacy.captureBlocked, false);
    assert.equal(f.privacy.switcherEnabled, os === "ios" ? true : null);
    backgroundCycle = true; const isUnlocked = f.security.isUnlocked;
    f.emit("background"); assert.equal(isUnlocked(), false); f.render(); await f.settle(); assertBlocked(f, true);
    assert.equal(f.privacy.captureBlocked, false); assert.equal(f.security.state.locked, false);
    assert.doesNotMatch(text(f.tree), /huella|desbloque/i);
    assert.equal(nodes(f.tree, "Button").length, 0);
    assert.equal(f.events.filter(event => event === "capture.prevent:qualitzer-device-security").length, 2);
    prevent.resolve(); await f.settle(); assertBlocked(f, true); assert.equal(f.privacy.captureBlocked, true);
    f.emit("active"); await f.settle(); assertBlocked(f, true); assert.equal(f.prompts.length, 1);
    assert.equal(f.privacy.captureBlocked, true);
    assert.equal(f.security.state.locked, false); assert.equal(f.privacy.captureBlocked, true);
    assert.equal(f.events.filter(event => event === "capture.allow:qualitzer-device-security").length, 2);
    allow.resolve(); await f.settle();
    assert.equal(f.security.isUnlocked(), true); assert.equal(f.privacy.captureBlocked, false);
    assert.equal(f.privacy.switcherEnabled, os === "ios" ? true : null);
    assert.ok(!f.events.includes("switcher.disable"));
    assert.deepEqual(f.applied.filter(event => event.startsWith("capture.")), ["capture.prevent", "capture.allow", "capture.prevent", "capture.allow"]);
    assert.equal(nodes(f.tree, "NativeModal")[0].props.visible, true);
    assert.equal(text(nodes(f.tree, "Draft")), "unsaved fixture draft");
    assert.equal(f.lifecycle.mounts, 1); assert.equal(f.lifecycle.unmounts, 0); assert.equal(f.lifecycle.identities.size, 1);
    assert.equal(f.security.state.enabled, true); assert.deepEqual(f.writes, []);
  });

  test(`${os}: fast app switching cannot reuse an old allowed target while reprotection is in flight`, async t => {
    const prevent = deferred<void>(); const allow = deferred<void>(); let backgroundCycle = false;
    const f = providerFixture({ os, preference: "enabled", capture: () => backgroundCycle ? prevent.promise : Promise.resolve(),
      allow: () => backgroundCycle ? allow.promise : Promise.resolve() });
    t.after(() => { prevent.resolve(); allow.resolve(); f.close(); });
    await f.settle(); f.prompts[0].result.resolve({ success: true }); await f.settle();
    assert.equal(f.security.isUnlocked(), true); assert.equal(f.privacy.captureBlocked, false);
    backgroundCycle = true; f.emit("background"); f.render(); await f.settle(); assertBlocked(f, true);
    f.emit("active"); await f.settle(); assert.equal(f.prompts.length, 1);
    prevent.resolve(); await f.settle();
    assert.equal(f.security.state.locked, false); assert.equal(f.privacy.captureBlocked, true);
    assert.equal(f.events.filter(event => event === "capture.allow:qualitzer-device-security").length, 2);
    assert.equal(f.applied.filter(event => event === "capture.allow").length, 1);
    assert.equal(f.security.blocked, true, "A previously applied true:false target cannot expose private UI before the latest allow resolves");
    assertBlocked(f, true);
    allow.resolve(); await f.settle();
    assert.equal(f.security.isUnlocked(), true); assert.equal(f.privacy.captureBlocked, false);
    assert.equal(f.privacy.switcherEnabled, os === "ios" ? true : null);
    assert.equal(f.lifecycle.mounts, 1); assert.equal(f.lifecycle.unmounts, 0); assert.equal(f.lifecycle.identities.size, 1);
  });

  test(`${os}: allow failure after app switching keeps private content concealed`, async t => {
    let failAllow = false;
    const f = providerFixture({ os, preference: "enabled", allow: async () => { if (failAllow) throw new Error("FIXTURE_ALLOW_FAILURE"); } });
    t.after(() => f.close()); await f.settle();
    f.prompts[0].result.resolve({ success: true }); await f.settle();
    assert.equal(f.security.isUnlocked(), true); assert.equal(f.privacy.captureBlocked, false);
    failAllow = true; f.emit("background"); f.render(); await f.settle(); assertBlocked(f, true);
    assert.equal(f.privacy.captureBlocked, true);
    f.emit("active"); await f.settle(); assert.equal(f.prompts.length, 1); assertBlocked(f, true);
    assert.equal(f.security.state.locked, false); assert.equal(f.security.state.enabled, true);
    assert.equal(f.privacy.captureBlocked, true);
    assert.match(text(f.tree), /No se pudo activar la protección visual/);
    assert.match(text(f.tree), /Cierra y vuelve a abrir la aplicación\. No borres sus datos; tus pendientes se conservan\./);
    assert.equal(nodes(f.tree, "Button").length, 0);
    assert.equal(text(nodes(f.tree, "Draft")), "unsaved fixture draft");
    assert.equal(f.lifecycle.mounts, 1); assert.equal(f.lifecycle.unmounts, 0); assert.equal(f.lifecycle.identities.size, 1);
    await f.settle(); assertBlocked(f, true); assert.equal(f.prompts.length, 1); assert.deepEqual(f.writes, []);
  });
}

for (const visible of [true, false, undefined]) {
  test(`PrivateModal visible=${String(visible)} hides during every blocked phase and preserves mounted draft`, async t => {
    const f = providerFixture({ preference: "enabled" }); t.after(() => f.close());
    f.modalVisibility.value = visible; await f.settle(); f.prompts[0].result.resolve({ success: true }); await f.settle();
    const allowed = visible ?? true;
    assert.equal(nodes(f.tree, "NativeModal")[0].props.visible, allowed);
    const isUnlocked = f.security.isUnlocked;
    f.emit("background"); assert.equal(isUnlocked(), false); f.render(); assertBlocked(f, true);
    assert.equal(f.lifecycle.mounts, 1); assert.equal(f.lifecycle.unmounts, 0);
    assert.ok([...f.backHandlers].every(handler => handler() === true));
    f.emit("active"); await f.settle(); assert.equal(f.prompts.length, 1);
    assert.equal(f.security.isUnlocked(), true); assert.equal(nodes(f.tree, "NativeModal")[0].props.visible, allowed);
    assert.equal(text(nodes(f.tree, "Draft")), "unsaved fixture draft");
    assert.equal(f.lifecycle.mounts, 1); assert.equal(f.lifecycle.unmounts, 0); assert.equal(f.lifecycle.identities.size, 1);
  });
}

test("unconfigured offer/busy gate hides retained modal; decline restores it without authentication", async t => {
  const f = providerFixture(); t.after(() => f.close()); await f.settle();
  f.security.controller.offer(); f.render(); assertBlocked(f, true);
  assert.ok(nodes(f.tree, "SectionTitle").some(node => node.props.title === "¿Vincular con la seguridad del teléfono?"));
  f.press("Ahora no"); assertBlocked(f, true); await f.settle();
  assert.equal(f.security.blocked, false); assert.equal(nodes(f.tree, "NativeModal")[0].props.visible, true);
  assert.equal(f.security.state.enabled, false); assert.equal(f.privacy.captureBlocked, false);
  assert.ok(!f.events.includes("capture.prevent:qualitzer-device-security"));
  assert.equal(f.prompts.length, 0); assert.equal(f.writes[0].value, "declined"); assert.equal(f.lifecycle.unmounts, 0);
});

test("system PIN success arriving in background waits for active without a second prompt", async t => {
  const f = providerFixture({ preference: "enabled" }); t.after(() => f.close()); await f.settle();
  f.emit("inactive"); f.render(); f.prompts[0].result.resolve({ success: true }); await f.settle(); assertBlocked(f);
  assert.equal(f.privacy.captureBlocked, true); assert.ok(!f.events.includes("capture.allow:qualitzer-device-security"));
  f.emit("active"); await f.settle();
  assert.equal(f.security.blocked, false); assert.equal(f.prompts.length, 1); assert.equal(f.privacy.captureBlocked, false);
});

for (const error of ["user_cancel", "system_cancel", "lockout"]) {
  test(`system PIN ${error} before active does not auto-reprompt; explicit screen retry works`, async t => {
    const f = providerFixture({ preference: "enabled" }); t.after(() => f.close()); await f.settle();
    f.emit("inactive"); f.emit("background"); f.render();
    f.prompts[0].result.resolve({ success: false, error }); await f.settle(); assertBlocked(f);
    f.emit("active"); await f.settle();
    assert.equal(f.prompts.length, 1, "Returning from a cancelled system credential activity must not reopen it automatically");
    assert.equal(f.privacy.captureBlocked, true);
    assertBlocked(f); f.press("Reintentar desbloqueo"); await f.settle(); assert.equal(f.prompts.length, 2);
    f.prompts[1].result.resolve({ success: true }); await f.settle(); assert.equal(f.security.blocked, false);
    assert.equal(f.privacy.captureBlocked, false);
  });
}

test("provider unmount detaches foreground/back subscriptions and cancels its pending Android prompt", async () => {
  const f = providerFixture({ preference: "enabled" }); await f.settle();
  assert.equal(f.listeners.size, 1); assert.equal(f.backHandlers.size, 1);
  f.close(); await Promise.resolve();
  assert.equal(f.listeners.size, 0); assert.equal(f.backHandlers.size, 0); assert.ok(f.events.includes("auth.cancel"));
  f.prompts[0].result.resolve({ success: true }); await Promise.resolve(); assert.equal(f.lifecycle.mounts, 0);
});

function source(relative: string): ts.SourceFile {
  const filename = resolve(__dirname, "..", relative);
  return ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, filename.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function descendants(node: ts.Node, predicate: (child: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(child: ts.Node) { if (predicate(child)) found.push(child); ts.forEachChild(child, visit); }
  visit(node); return found;
}

test("App wires the provider outside ApplicationRoot and passes render plus live access guards to the hook", () => {
  const app = source("App.tsx");
  const provider = descendants(app, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(app) === "DeviceSecurityProvider")[0];
  assert.ok(provider);
  assert.ok(descendants(provider, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === "ApplicationRoot").length);
  const hook = descendants(app, node => ts.isCallExpression(node) && node.expression.getText(app) === "useTechnicianApp")[0];
  assert.ok(hook && ts.isCallExpression(hook));
  assert.match(hook.arguments[0].getText(app), /allowed:\s*!security\.blocked/);
  assert.match(hook.arguments[0].getText(app), /isAllowed:\s*security\.isUnlocked/);
});

test("notification context short-circuits access before context evaluation; offline foreground is privacy-gated", () => {
  const hook = source("src/application/useTechnicianApp.ts");
  const guard = descendants(hook, node => ts.isFunctionDeclaration(node) && node.name?.text === "notificationContextIsCurrent")[0];
  assert.ok(guard && ts.isFunctionDeclaration(guard));
  const statement = guard.body?.statements.find(ts.isReturnStatement);
  assert.ok(statement?.expression);
  let left = statement.expression;
  while (ts.isBinaryExpression(left) && left.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) left = left.left;
  assert.equal(left.getText(hook), "isAccessAllowed()");
  assert.match(statement.expression.getText(hook), /context\.isCurrent\(\)/);
  const binding = descendants(hook, node => ts.isCallExpression(node) && node.expression.getText(hook) === "bindForeground")[0];
  assert.ok(binding && ts.isCallExpression(binding));
  assert.match(binding.getText(hook), /setForeground\(active && isAccessAllowed\(\)\)/);
  for (const name of ["openNotification", "refreshFromNotification"]) {
    const callback = descendants(hook, node => ts.isFunctionDeclaration(node) && node.name?.text === name)[0];
    assert.ok(callback);
    assert.ok(descendants(callback, node => ts.isCallExpression(node) && node.expression.getText(hook) === "notificationContextIsCurrent").length);
  }
});