import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceLockController } from "../src/security/DeviceLockController";
import type {
  DeviceAuthenticationResult,
  DeviceLockPreference,
  DeviceLockSnapshot,
  DeviceSecurityAdapter,
} from "../src/security/contracts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class SecurityAdapter implements DeviceSecurityAdapter {
  platformSupported = true;
  initialForeground = true;
  preference: DeviceLockPreference | null = null;
  reads = 0;
  availabilityChecks = 0;
  authentications = 0;
  cancellations = 0;
  writes: DeviceLockPreference[] = [];
  read: () => Promise<DeviceLockPreference | null> = async () => this.preference;
  availability: () => Promise<boolean> = async () => true;
  authentication: () => Promise<DeviceAuthenticationResult> = async () => ({ success: true });
  write: (value: DeviceLockPreference) => Promise<void> = async () => {};
  cancellation: () => Promise<void> = async () => {};

  async readPreference(): Promise<DeviceLockPreference | null> {
    this.reads += 1;
    return this.read();
  }

  async available(): Promise<boolean> {
    this.availabilityChecks += 1;
    return this.availability();
  }

  async authenticate(): Promise<DeviceAuthenticationResult> {
    this.authentications += 1;
    return this.authentication();
  }

  async writePreference(value: DeviceLockPreference): Promise<void> {
    this.writes.push(value);
    await this.write(value);
    this.preference = value;
  }

  async cancel(): Promise<void> {
    this.cancellations += 1;
    await this.cancellation();
  }
}

async function create(preference: DeviceLockPreference | null = null) {
  const adapter = new SecurityAdapter();
  adapter.preference = preference;
  const controller = new DeviceLockController(adapter);
  await controller.initialize();
  return { controller, adapter };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function protectedState(controller: DeviceLockController): void {
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().enabled, true);
  assert.equal(controller.getSnapshot().locked, true);
}

test("focused tests run on Node 22 or newer", () => {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22);
});

test("cold native boot exposes exactly the gated snapshot fields", () => {
  const adapter = new SecurityAdapter();
  const controller = new DeviceLockController(adapter);
  assert.deepEqual(controller.getSnapshot(), {
    ready: false, enabled: false, locked: false, offered: false, busy: false,
    foreground: true, error: null, supported: true,
  });
  assert.equal(adapter.reads, 0);
});

test("initialization is single-flight and keeps ready false until storage resolves", async () => {
  const adapter = new SecurityAdapter();
  const read = deferred<DeviceLockPreference | null>();
  adapter.read = () => read.promise;
  const controller = new DeviceLockController(adapter);
  const first = controller.initialize();
  assert.equal(first, controller.initialize());
  await settle();
  assert.equal(adapter.reads, 1);
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.getSnapshot().busy, true);
  read.resolve(null);
  await first;
  await controller.initialize();
  assert.equal(adapter.reads, 1);
  assert.equal(controller.getSnapshot().busy, false);
});

for (const preference of [null, "declined"] as const) {
  test(`cold ${String(preference)} preference opens without offering or authenticating`, async () => {
    const { controller, adapter } = await create(preference);
    assert.equal(controller.getSnapshot().ready, true);
    assert.equal(controller.getSnapshot().enabled, false);
    assert.equal(controller.getSnapshot().locked, false);
    assert.equal(controller.getSnapshot().offered, false);
    assert.equal(adapter.authentications, 0);
    assert.equal(adapter.availabilityChecks, 0);
  });
}

test("cold enabled preference locks without automatically authenticating", async () => {
  const { controller, adapter } = await create("enabled");
  protectedState(controller);
  controller.offer();
  await controller.initialize();
  assert.equal(controller.getSnapshot().offered, false);
  assert.equal(adapter.authentications, 0);
  assert.equal(adapter.writes.length, 0);
});

test("corrupt storage rejection fails closed and only explicit retry reloads", async () => {
  const adapter = new SecurityAdapter();
  adapter.read = async () => { throw new Error("secret corrupt data"); };
  const controller = new DeviceLockController(adapter);
  await controller.initialize();
  const failed = controller.getSnapshot();
  assert.equal(failed.ready, false);
  assert.equal(failed.busy, false);
  assert.match(failed.error ?? "", /Reintenta/);
  assert.doesNotMatch(failed.error ?? "", /secret|corrupt/);
  controller.offer();
  await controller.enable();
  await controller.disable();
  await controller.decline();
  await controller.unlock();
  await controller.initialize();
  assert.equal(controller.getSnapshot(), failed);
  assert.equal(adapter.reads, 1);
  assert.equal(adapter.authentications, 0);
  assert.deepEqual(adapter.writes, []);
  adapter.read = async () => "enabled";
  await controller.retry();
  protectedState(controller);
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(adapter.reads, 2);
});

test("retry is single-flight and does not reload an initialized store", async () => {
  const adapter = new SecurityAdapter();
  adapter.read = async () => { throw new Error(); };
  const controller = new DeviceLockController(adapter);
  await controller.initialize();
  const read = deferred<DeviceLockPreference | null>();
  adapter.read = () => read.promise;
  const first = controller.retry();
  assert.equal(controller.retry(), first);
  read.resolve("enabled");
  await first;
  await controller.retry();
  assert.equal(adapter.reads, 2);
  protectedState(controller);
});

test("unsupported web is ready and never touches any port", async () => {
  const adapter = new SecurityAdapter();
  adapter.platformSupported = false;
  const controller = new DeviceLockController(adapter);
  assert.equal(controller.getSnapshot().ready, true);
  await controller.initialize();
  await controller.retry();
  controller.offer();
  await controller.enable();
  await controller.unlock();
  await controller.decline();
  await controller.disable();
  controller.setForeground(false);
  controller.setForeground(true);
  controller.dispose();
  assert.equal(controller.getSnapshot().supported, false);
  assert.equal(controller.getSnapshot().enabled, false);
  assert.equal(controller.getSnapshot().locked, false);
  assert.equal(controller.getSnapshot().offered, false);
  assert.deepEqual([adapter.reads, adapter.availabilityChecks, adapter.authentications, adapter.cancellations], [0, 0, 0, 0]);
  assert.deepEqual(adapter.writes, []);
});

test("offer is explicit, ready-only, foreground-only and once per process", async () => {
  const adapter = new SecurityAdapter();
  const controller = new DeviceLockController(adapter);
  controller.offer();
  assert.equal(controller.getSnapshot().offered, false);
  await controller.initialize();
  controller.setForeground(false);
  controller.offer();
  assert.equal(controller.getSnapshot().offered, false);
  controller.setForeground(true);
  controller.offer();
  const offered = controller.getSnapshot();
  assert.equal(offered.offered, true);
  controller.offer();
  assert.equal(controller.getSnapshot(), offered);
  assert.equal(adapter.authentications, 0);
  assert.deepEqual(adapter.writes, []);
});

test("decline waits for storage and is remembered by a new controller", async () => {
  const { controller, adapter } = await create();
  controller.offer();
  const write = deferred<void>();
  adapter.write = () => write.promise;
  const declining = controller.decline();
  await settle();
  assert.equal(controller.getSnapshot().offered, true);
  assert.equal(controller.getSnapshot().busy, true);
  write.resolve();
  await declining;
  controller.offer();
  assert.equal(controller.getSnapshot().offered, false);
  const next = new DeviceLockController(adapter);
  await next.initialize();
  next.offer();
  assert.equal(next.getSnapshot().offered, false);
  assert.equal(adapter.authentications, 0);
  assert.deepEqual(adapter.writes, ["declined"]);
});

test("decline write failure retains the offered choice and permits explicit retry", async () => {
  const { controller, adapter } = await create();
  controller.offer();
  adapter.write = async () => { throw new Error("storage-secret"); };
  await controller.decline();
  assert.equal(controller.getSnapshot().offered, true);
  assert.equal(adapter.preference, null);
  assert.match(controller.getSnapshot().error ?? "", /guardar/);
  adapter.write = async () => {};
  await controller.decline();
  assert.equal(controller.getSnapshot().offered, false);
  assert.equal(controller.getSnapshot().error, null);
});

test("decline cannot bypass enabled protection or silently dismiss an unseen offer", async () => {
  const fresh = await create();
  await fresh.controller.decline();
  const enabled = await create("enabled");
  await enabled.controller.decline();
  protectedState(enabled.controller);
  assert.deepEqual(fresh.adapter.writes, []);
  assert.deepEqual(enabled.adapter.writes, []);
});

test("enrollment authenticates before writing and stays busy until persistence finishes", async () => {
  const { controller, adapter } = await create();
  controller.offer();
  const auth = deferred<DeviceAuthenticationResult>();
  const write = deferred<void>();
  adapter.authentication = () => auth.promise;
  adapter.write = () => write.promise;
  const enabling = controller.enable();
  await settle();
  assert.deepEqual(adapter.writes, []);
  auth.resolve({ success: true });
  await settle();
  assert.deepEqual(adapter.writes, ["enabled"]);
  assert.equal(controller.getSnapshot().enabled, false);
  assert.equal(controller.getSnapshot().busy, true);
  write.resolve();
  await enabling;
  assert.equal(controller.getSnapshot().enabled, true);
  assert.equal(controller.getSnapshot().locked, false);
  assert.equal(controller.getSnapshot().offered, false);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().error, null);
});

for (const error of ["user_cancel", "system_cancel", "app_cancel", "cancel", "authentication_failed", "unknown", "private-token@example.com"]) {
  test(`failed enrollment ${error} never writes or repeats the offer automatically`, async () => {
    const { controller, adapter } = await create();
    controller.offer();
    adapter.authentication = async () => ({ success: false, error });
    await controller.enable();
    const failed = controller.getSnapshot();
    assert.equal(failed.enabled, false);
    assert.equal(failed.offered, true);
    assert.equal(failed.busy, false);
    assert.ok(failed.error);
    assert.doesNotMatch(failed.error, /private-token|authentication_failed/);
    controller.offer();
    assert.equal(controller.getSnapshot(), failed);
    controller.setForeground(false);
    controller.setForeground(true);
    assert.equal(adapter.authentications, 1);
    assert.deepEqual(adapter.writes, []);
  });
}

test("unavailable phone may choose Later without configuring security", async () => {
  const { controller, adapter } = await create();
  adapter.availability = async () => false;
  controller.offer();
  await controller.enable();
  assert.match(controller.getSnapshot().error ?? "", /Configura un PIN, patrón o contraseña/);
  assert.equal(controller.getSnapshot().supported, true);
  assert.equal(controller.getSnapshot().offered, true);
  assert.equal(adapter.authentications, 0);
  assert.deepEqual(adapter.writes, []);
  await controller.decline();
  assert.equal(adapter.preference, "declined");
});

for (const error of ["NONE", "not_enrolled", "passcode_not_set", "not_available"]) {
  test(`authentication ${error} maps only to the safe configuration message`, async () => {
    const { controller, adapter } = await create("enabled");
    adapter.authentication = async () => ({ success: false, error });
    await controller.unlock();
    protectedState(controller);
    assert.match(controller.getSnapshot().error ?? "", /Configura un PIN/);
    assert.deepEqual(adapter.writes, []);
  });
}

test("availability and authentication exceptions are sanitized", async () => {
  const { controller, adapter } = await create("enabled");
  adapter.availability = async () => { throw new Error("https://private.example.com/token"); };
  await controller.unlock();
  const error = controller.getSnapshot().error;
  assert.match(error ?? "", /verificar tu identidad/);
  assert.equal(adapter.authentications, 0);
  adapter.availability = async () => true;
  adapter.authentication = async () => { throw { password: "private" }; };
  await controller.unlock();
  assert.equal(controller.getSnapshot().error, error);
  protectedState(controller);
});

test("lockout offers device credentials or a later retry without bypass", async () => {
  const { controller, adapter } = await create("enabled");
  adapter.authentication = async () => ({ success: false, error: "lockout" });
  await controller.unlock();
  protectedState(controller);
  assert.match(controller.getSnapshot().error ?? "", /PIN, patrón o contraseña/);
});

test("enable write failure does not claim enabled and retry needs fresh authentication", async () => {
  const { controller, adapter } = await create();
  controller.offer();
  adapter.write = async () => { throw new Error("private write error"); };
  await controller.enable();
  assert.equal(controller.getSnapshot().enabled, false);
  assert.equal(controller.getSnapshot().offered, true);
  assert.equal(adapter.preference, null);
  assert.match(controller.getSnapshot().error ?? "", /Reintenta para confirmar/);
  assert.doesNotMatch(controller.getSnapshot().error ?? "", /private/);
  adapter.write = async () => {};
  await controller.enable();
  assert.equal(controller.getSnapshot().enabled, true);
  assert.equal(adapter.authentications, 2);
});

test("manual enrollment is possible after previously declining", async () => {
  const { controller, adapter } = await create("declined");
  controller.offer();
  assert.equal(controller.getSnapshot().offered, false);
  await controller.enable();
  assert.equal(adapter.preference, "enabled");
  assert.equal(adapter.authentications, 1);
});

test("disable requires fresh authentication even after an unlock", async () => {
  const { controller, adapter } = await create("enabled");
  await controller.unlock();
  const auth = deferred<DeviceAuthenticationResult>();
  const write = deferred<void>();
  adapter.authentication = () => auth.promise;
  adapter.write = () => write.promise;
  const disabling = controller.disable();
  await settle();
  assert.equal(adapter.authentications, 2);
  assert.deepEqual(adapter.writes, []);
  auth.resolve({ success: true });
  await settle();
  assert.equal(controller.getSnapshot().enabled, true);
  assert.equal(controller.getSnapshot().busy, true);
  write.resolve();
  await disabling;
  assert.equal(controller.getSnapshot().enabled, false);
  assert.equal(controller.getSnapshot().locked, false);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(adapter.preference, "declined");
  controller.offer();
  assert.equal(controller.getSnapshot().offered, false);
});

for (const error of ["user_cancel", "system_cancel", "authentication_failed"]) {
  test(`disable ${error} keeps the enabled preference and locked session`, async () => {
    const { controller, adapter } = await create("enabled");
    adapter.authentication = async () => ({ success: false, error });
    await controller.disable();
    protectedState(controller);
    assert.equal(adapter.preference, "enabled");
    assert.deepEqual(adapter.writes, []);
    assert.match(controller.getSnapshot().error ?? "", /Reintentar/);
  });
}

test("disable on an unavailable phone does not write", async () => {
  const { controller, adapter } = await create("enabled");
  adapter.availability = async () => false;
  await controller.disable();
  protectedState(controller);
  assert.equal(adapter.authentications, 0);
  assert.deepEqual(adapter.writes, []);
});

test("disable write rejection locks even a previously open enabled session", async () => {
  const { controller, adapter } = await create("enabled");
  await controller.unlock();
  adapter.write = async () => { throw new Error("private"); };
  await controller.disable();
  protectedState(controller);
  assert.equal(adapter.preference, "enabled");
  assert.match(controller.getSnapshot().error ?? "", /guardar/);
});

test("unlock is transient and a new cold controller is locked again", async () => {
  const { controller, adapter } = await create("enabled");
  await controller.unlock();
  assert.equal(controller.getSnapshot().locked, false);
  assert.deepEqual(adapter.writes, []);
  const next = new DeviceLockController(adapter);
  await next.initialize();
  protectedState(next);
  assert.equal(adapter.authentications, 1);
});

test("background locks immediately and foreground never starts an automatic prompt", async () => {
  const { controller, adapter } = await create("enabled");
  await controller.unlock();
  controller.setForeground(false);
  protectedState(controller);
  const hidden = controller.getSnapshot();
  controller.setForeground(false);
  assert.equal(controller.getSnapshot(), hidden);
  controller.setForeground(true);
  protectedState(controller);
  await settle();
  assert.equal(adapter.authentications, 1);
  await controller.unlock();
  assert.equal(controller.getSnapshot().locked, false);
});

test("cold background enabled boot cannot prompt until explicitly requested while active", async () => {
  const adapter = new SecurityAdapter();
  adapter.preference = "enabled";
  adapter.initialForeground = false;
  const controller = new DeviceLockController(adapter);
  await controller.initialize();
  await controller.unlock();
  protectedState(controller);
  assert.equal(adapter.authentications, 0);
  controller.setForeground(true);
  assert.equal(adapter.authentications, 0);
  await controller.unlock();
  assert.equal(controller.getSnapshot().locked, false);
});

test("system PIN success before active waits for foreground without canceling the native prompt", async () => {
  const { controller, adapter } = await create("enabled");
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  const unlocking = controller.unlock();
  await settle();
  controller.setForeground(false);
  assert.equal(adapter.cancellations, 0);
  auth.resolve({ success: true });
  await unlocking;
  protectedState(controller);
  assert.equal(controller.getSnapshot().busy, false);
  controller.setForeground(false);
  controller.setForeground(true);
  assert.equal(controller.getSnapshot().locked, false);
  assert.equal(adapter.authentications, 1);
  controller.setForeground(false);
  controller.setForeground(true);
  protectedState(controller);
});

test("system PIN active before success unlocks within the same prompt", async () => {
  const { controller, adapter } = await create("enabled");
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  const unlocking = controller.unlock();
  await settle();
  controller.setForeground(false);
  controller.setForeground(true);
  protectedState(controller);
  auth.resolve({ success: true });
  await unlocking;
  assert.equal(controller.getSnapshot().locked, false);
  assert.equal(adapter.authentications, 1);
});

test("failed prompt after background remains locked with no reentrant authentication", async () => {
  const { controller, adapter } = await create("enabled");
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  const unlocking = controller.unlock();
  await settle();
  controller.setForeground(false);
  auth.resolve({ success: false, error: "system_cancel" });
  await unlocking;
  controller.setForeground(true);
  await settle();
  protectedState(controller);
  assert.match(controller.getSnapshot().error ?? "", /Reintentar/);
  assert.equal(adapter.authentications, 1);
});

test("background before availability completes never starts a native prompt", async () => {
  const { controller, adapter } = await create("enabled");
  const availability = deferred<boolean>();
  adapter.availability = () => availability.promise;
  const unlocking = controller.unlock();
  controller.setForeground(false);
  availability.resolve(true);
  await unlocking;
  assert.equal(adapter.authentications, 0);
  protectedState(controller);
});

test("enrollment success while hidden persists but cannot expose the app before active", async () => {
  const { controller, adapter } = await create();
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  const enabling = controller.enable();
  await settle();
  controller.setForeground(false);
  auth.resolve({ success: true });
  await enabling;
  protectedState(controller);
  assert.equal(adapter.preference, "enabled");
  controller.setForeground(true);
  assert.equal(controller.getSnapshot().locked, false);
});

for (const resumeBeforeCompletion of [false, true]) {
  test(`background after enrollment auth invalidates its grant during persistence (resume=${resumeBeforeCompletion})`, async () => {
    const { controller, adapter } = await create();
    const write = deferred<void>();
    adapter.write = () => write.promise;
    const enabling = controller.enable();
    await settle();
    assert.deepEqual(adapter.writes, ["enabled"]);
    controller.setForeground(false);
    if (resumeBeforeCompletion) controller.setForeground(true);
    write.resolve();
    await enabling;
    protectedState(controller);
    controller.setForeground(true);
    protectedState(controller);
    assert.match(controller.getSnapshot().error ?? "", /segundo plano/);
    assert.equal(adapter.authentications, 1);
  });
}

test("PIN success then active then another background while saving invalidates the pending grant", async () => {
  const { controller, adapter } = await create();
  const auth = deferred<DeviceAuthenticationResult>();
  const write = deferred<void>();
  adapter.authentication = () => auth.promise;
  adapter.write = () => write.promise;
  const enabling = controller.enable();
  await settle();
  controller.setForeground(false);
  auth.resolve({ success: true });
  await settle();
  controller.setForeground(true);
  controller.setForeground(false);
  write.resolve();
  await enabling;
  controller.setForeground(true);
  protectedState(controller);
});

test("duplicate unlocks share one promise and one authentication", async () => {
  const { controller, adapter } = await create("enabled");
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  const first = controller.unlock();
  assert.equal(controller.unlock(), first);
  await settle();
  assert.equal(adapter.authentications, 1);
  auth.resolve({ success: true });
  await first;
  await controller.unlock();
  assert.equal(adapter.authentications, 1);
});

test("competing mutations cannot queue behind enrollment or release busy early", async () => {
  const { controller, adapter } = await create();
  controller.offer();
  const write = deferred<void>();
  adapter.write = () => write.promise;
  const first = controller.enable();
  assert.equal(controller.enable(), first);
  assert.equal(controller.decline(), first);
  assert.equal(controller.disable(), first);
  await settle();
  assert.equal(controller.getSnapshot().busy, true);
  assert.deepEqual(adapter.writes, ["enabled"]);
  write.resolve();
  await first;
  assert.equal(adapter.preference, "enabled");
  assert.equal(adapter.authentications, 1);
});

test("snapshots and subscription functions are stable and snapshots are immutable", async () => {
  const { controller } = await create();
  const { getSnapshot, subscribe } = controller;
  const initial = getSnapshot();
  assert.equal(getSnapshot(), initial);
  assert.ok(Object.isFrozen(initial));
  const snapshots: DeviceLockSnapshot[] = [];
  const unsubscribe = subscribe(() => snapshots.push(getSnapshot()));
  controller.setForeground(true);
  assert.equal(snapshots.length, 0);
  controller.offer();
  assert.equal(snapshots.length, 1);
  assert.notEqual(getSnapshot(), initial);
  assert.equal(initial.offered, false);
  unsubscribe();
  unsubscribe();
  controller.setForeground(false);
  assert.equal(snapshots.length, 1);
});

test("throwing observers do not corrupt a committed preference or stop other observers", async () => {
  const { controller, adapter } = await create();
  let notifications = 0;
  controller.subscribe(() => { throw new Error("observer-private"); });
  controller.subscribe(() => { notifications += 1; });
  await controller.enable();
  assert.equal(adapter.preference, "enabled");
  assert.equal(controller.getSnapshot().enabled, true);
  assert.equal(controller.getSnapshot().error, null);
  assert.ok(notifications > 0);
});

test("reentrant busy observers cannot start a second authentication", async () => {
  const { controller, adapter } = await create("enabled");
  controller.subscribe(() => {
    if (controller.getSnapshot().busy) void controller.unlock();
  });
  await controller.unlock();
  assert.equal(adapter.authentications, 1);
});

test("dispose before initialization executes touches no ports", async () => {
  const adapter = new SecurityAdapter();
  const controller = new DeviceLockController(adapter);
  const initializing = controller.initialize();
  controller.dispose();
  const snapshot = controller.getSnapshot();
  await initializing;
  assert.equal(adapter.reads, 0);
  assert.equal(controller.getSnapshot(), snapshot);
});

test("dispose ignores an outstanding storage read", async () => {
  const adapter = new SecurityAdapter();
  const read = deferred<DeviceLockPreference | null>();
  adapter.read = () => read.promise;
  const controller = new DeviceLockController(adapter);
  const initializing = controller.initialize();
  await settle();
  controller.dispose();
  const snapshot = controller.getSnapshot();
  read.resolve("enabled");
  await initializing;
  assert.equal(controller.getSnapshot(), snapshot);
  assert.equal(adapter.cancellations, 0);
});

test("dispose during availability ignores its result and never starts authentication", async () => {
  const { controller, adapter } = await create("enabled");
  const availability = deferred<boolean>();
  adapter.availability = () => availability.promise;
  const unlocking = controller.unlock();
  await settle();
  controller.dispose();
  availability.resolve(true);
  await unlocking;
  assert.equal(adapter.authentications, 0);
});

test("dispose cancels an active prompt once and ignores its successful stale result", async () => {
  const { controller, adapter } = await create();
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  adapter.cancellation = async () => { throw new Error("cancel-private"); };
  const enabling = controller.enable();
  await settle();
  let notifications = 0;
  controller.subscribe(() => { notifications += 1; });
  controller.dispose();
  controller.dispose();
  const snapshot = controller.getSnapshot();
  auth.resolve({ success: true });
  await enabling;
  assert.equal(controller.getSnapshot(), snapshot);
  assert.deepEqual(adapter.writes, []);
  assert.equal(adapter.cancellations, 1);
  assert.equal(notifications, 0);
  controller.setForeground(false);
  controller.offer();
  await controller.enable();
  await controller.unlock();
  await controller.disable();
  await controller.decline();
  await controller.retry();
  await controller.initialize();
  assert.equal(controller.getSnapshot(), snapshot);
});

test("dispose during persistence cannot publish a late successful enrollment", async () => {
  const { controller, adapter } = await create();
  const write = deferred<void>();
  adapter.write = () => write.promise;
  const enabling = controller.enable();
  await settle();
  controller.dispose();
  const snapshot = controller.getSnapshot();
  write.resolve();
  await enabling;
  assert.equal(controller.getSnapshot(), snapshot);
  assert.equal(adapter.cancellations, 0);
  const next = new DeviceLockController(adapter);
  await next.initialize();
  protectedState(next);
});

test("dispose discards a pending foreground grant", async () => {
  const { controller, adapter } = await create("enabled");
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  const unlocking = controller.unlock();
  await settle();
  controller.setForeground(false);
  auth.resolve({ success: true });
  await unlocking;
  controller.dispose();
  controller.setForeground(true);
  protectedState(controller);
});

test("disable with system PIN success while hidden cannot unlock before foreground", async () => {
  const { controller, adapter } = await create("enabled");
  const auth = deferred<DeviceAuthenticationResult>();
  adapter.authentication = () => auth.promise;
  const disabling = controller.disable();
  await settle();
  controller.setForeground(false);
  auth.resolve({ success: true });
  await disabling;
  assert.equal(adapter.preference, "declined");
  assert.equal(controller.getSnapshot().enabled, false);
  assert.equal(controller.getSnapshot().locked, true);
  controller.setForeground(true);
  assert.equal(controller.getSnapshot().locked, false);
  controller.setForeground(false);
  controller.setForeground(true);
  assert.equal(controller.getSnapshot().locked, false);
  assert.equal(adapter.authentications, 1);
});

for (const resumeBeforeCompletion of [false, true]) {
  test(`disable persistence cannot reuse a grant after another background (resume=${resumeBeforeCompletion})`, async () => {
    const { controller, adapter } = await create("enabled");
    const write = deferred<void>();
    adapter.write = () => write.promise;
    const disabling = controller.disable();
    await settle();
    assert.deepEqual(adapter.writes, ["declined"]);
    controller.setForeground(false);
    if (resumeBeforeCompletion) controller.setForeground(true);
    write.resolve();
    await disabling;
    assert.equal(adapter.preference, "declined");
    assert.equal(controller.getSnapshot().enabled, false);
    assert.equal(controller.getSnapshot().locked, true);
    controller.setForeground(true);
    assert.equal(controller.getSnapshot().locked, true);
    assert.match(controller.getSnapshot().error ?? "", /segundo plano/);
    await controller.unlock();
    assert.equal(controller.getSnapshot().locked, false);
    assert.equal(adapter.authentications, 2);
    assert.deepEqual(adapter.writes, ["declined"]);
    controller.setForeground(false);
    controller.setForeground(true);
    assert.equal(controller.getSnapshot().locked, false);
  });
}