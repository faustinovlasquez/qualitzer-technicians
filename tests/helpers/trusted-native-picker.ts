import assert from "node:assert/strict";
import { DeviceLockController } from "../../src/security/DeviceLockController";
import type { DeviceAuthenticationResult, DeviceLockPreference, DeviceSecurityAdapter, NativeInteractionClock } from "../../src/security/contracts";
import type { DeviceSecurityUi } from "../../src/security/DeviceSecurityContext";
import { loadSource, reactFixture } from "./tenant-challenge";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function microtasks(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

export class PickerClock implements NativeInteractionClock {
  time = 1000;
  readonly timers = new Map<() => void, number>();
  now = () => this.time;
  schedule = (callback: () => void, milliseconds: number) => {
    this.timers.set(callback, this.time + milliseconds);
    return () => { this.timers.delete(callback); };
  };
  advance(milliseconds: number): void {
    this.time += milliseconds;
    for (const [callback, deadline] of [...this.timers]) {
      if (deadline <= this.time && this.timers.delete(callback)) callback();
    }
  }
}

export class PickerSecurityAdapter implements DeviceSecurityAdapter {
  platformSupported = true;
  initialForeground = true;
  preference: DeviceLockPreference | null = "enabled";
  reads = 0;
  readonly writes: DeviceLockPreference[] = [];
  readonly prompts: ReturnType<typeof deferred<DeviceAuthenticationResult>>[] = [];
  readPreference = async () => { this.reads += 1; return this.preference; };
  writePreference = async (value: DeviceLockPreference) => { this.writes.push(value); this.preference = value; };
  available = async () => true;
  authenticate = () => { const prompt = deferred<DeviceAuthenticationResult>(); this.prompts.push(prompt); return prompt.promise; };
  cancel = async () => {};
}

export async function unlockedController() {
  const clock = new PickerClock();
  const adapter = new PickerSecurityAdapter();
  const controller = new DeviceLockController(adapter, clock);
  await controller.initialize();
  const unlock = controller.unlock();
  await microtasks();
  adapter.prompts[0].resolve({ success: true });
  await unlock;
  return { clock, adapter, controller };
}

interface Memo<T> { dependencies: readonly unknown[]; value: T; }
interface FixtureElement { type: unknown; props: { value?: DeviceSecurityUi; children?: unknown; [name: string]: unknown }; }

export function pickerProviderFixture(preference: DeviceLockPreference | null = "enabled") {
  const hooks = reactFixture();
  const adapter = new PickerSecurityAdapter();
  adapter.preference = preference;
  const clock = new PickerClock();
  const controller = new DeviceLockController(adapter, clock);
  const foregroundListeners = new Set<(active: boolean) => void>();
  const captures: string[] = [];
  const ports = { allow: async () => {}, prevent: async () => {} };
  let active = true;
  function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T {
    const slot = hooks.react.useRef<Memo<T> | null>(null) as { current: Memo<T> | null };
    if (!slot.current || dependencies.length !== slot.current.dependencies.length || dependencies.some((value, i) => !Object.is(value, slot.current?.dependencies[i]))) {
      slot.current = { dependencies, value: factory() };
    }
    return slot.current.value;
  }
  const react = { ...hooks.react, useMemo, useCallback: <T>(callback: T, dependencies: readonly unknown[]) => useMemo(() => callback, dependencies) };
  const context = { Provider: "SecurityProvider" };
  const native = {
    View: "View", Platform: { OS: "android" },
    StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: {} },
    Keyboard: { dismiss() {} }, BackHandler: { addEventListener: () => ({ remove() {} }) },
  };
  const provider = loadSource<{ DeviceSecurityProvider(props: { children: string }): FixtureElement }>("security/DeviceSecurityProvider.tsx", id => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: (type: unknown, props: FixtureElement["props"]) => ({ type, props }), jsxs: (type: unknown, props: FixtureElement["props"]) => ({ type, props }) };
    if (id === "react-native") return native;
    if (id === "./DeviceLockController") return { DeviceLockController: class { constructor() { return controller; } } };
    if (id === "./deviceSecurityAdapter") return { createDeviceSecurityAdapter: () => adapter };
    if (id === "./DeviceSecurityContext") return { DeviceSecurityContext: context };
    if (id === "./DeviceLockScreen") return { DeviceLockScreen: "LockScreen" };
    if (id === "../ui/theme") return { palette: { background: "white" } };
    if (id === "../offline/foreground") return {
      readForeground: () => active,
      subscribeForeground: (listener: (value: boolean) => void) => { foregroundListeners.add(listener); return () => { foregroundListeners.delete(listener); }; },
    };
    if (id === "expo-screen-capture") return {
      allowScreenCaptureAsync: async () => { captures.push("allow"); await ports.allow(); },
      preventScreenCaptureAsync: async () => { captures.push("prevent"); await ports.prevent(); },
    };
    throw new Error(`UNEXPECTED_PROVIDER_IMPORT:${id}`);
  });
  let tree: FixtureElement;
  function render(): void {
    tree = hooks.render(() => provider.DeviceSecurityProvider({ children: "retained-private-child" }));
    hooks.flush();
  }
  render();
  return {
    adapter, clock, controller, captures, ports, render,
    get security(): DeviceSecurityUi { const security = tree.props.value; assert.ok(security); return security; },
    get tree() { return tree; },
    emit(foreground: boolean) { active = foreground; for (const listener of [...foregroundListeners]) listener(foreground); },
    async settle() { for (let i = 0; i < 4; i += 1) { await microtasks(); render(); } },
    close() { hooks.unmount(); },
    get foregroundListenerCount() { return foregroundListeners.size; },
  };
}

export async function unlockedProvider() {
  const fixture = pickerProviderFixture();
  await fixture.settle();
  assert.equal(fixture.adapter.prompts.length, 1);
  fixture.adapter.prompts[0].resolve({ success: true });
  await fixture.settle();
  assert.equal(fixture.security.isUnlocked(), true);
  return fixture;
}