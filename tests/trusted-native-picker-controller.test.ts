/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceLockController } from "../src/security/DeviceLockController";
import { NATIVE_INTERACTION_TIMEOUT_MS } from "../src/security/trustedNativeInteraction";
import { deferred, microtasks, PickerClock, PickerSecurityAdapter, unlockedController } from "./helpers/trusted-native-picker";

for (const order of ["result-first", "active-first"] as const) {
  for (const canceled of [false, true]) {
    test(`${order}, canceled=${canceled}: only settled native result AND foreground restore the grant once`, async t => {
      const { controller, adapter, clock } = await unlockedController();
      t.after(() => controller.dispose());
      const native = deferred<{ canceled: boolean }>();
      let delivered = false;
      const result = controller.runTrustedNativePicker(() => native.promise).then(value => { delivered = true; return value; });
      controller.setForeground(false);
      assert.equal(controller.getSnapshot().locked, true);
      if (order === "result-first") native.resolve({ canceled });
      else controller.setForeground(true);
      await microtasks();
      assert.equal(delivered, false);
      assert.equal(controller.getSnapshot().nativeInteractionPending, true);
      assert.equal(controller.getSnapshot().locked, true);
      if (order === "result-first") controller.setForeground(true);
      else native.resolve({ canceled });
      assert.equal((await result).canceled, canceled);
      assert.equal(controller.getSnapshot().locked, false);
      assert.equal(controller.getSnapshot().nativeInteractionPending, false);
      assert.equal(adapter.prompts.length, 1);
      assert.equal(clock.timers.size, 0);
      controller.setForeground(false); controller.setForeground(true);
      assert.equal(controller.getSnapshot().locked, true);
    });
  }
}

test("permission then camera use two successful successive leases, including a no-background permission", async t => {
  const { controller, clock, adapter } = await unlockedController();
  t.after(() => controller.dispose());
  assert.equal(await controller.runTrustedNativePicker(async () => "granted"), "granted");
  for (const expected of ["permission", "camera"]) {
    const native = deferred<string>();
    const result = controller.runTrustedNativePicker(() => native.promise);
    controller.setForeground(false); native.resolve(expected); await microtasks(); controller.setForeground(true);
    assert.equal(await result, expected);
  }
  assert.equal(clock.timers.size, 0);
  assert.equal(adapter.prompts.length, 1);
  assert.deepEqual(adapter.writes, []);
});

test("Home/active without native settlement never restores; timeout rejects even a forever pending SDK call", async t => {
  const { controller, clock } = await unlockedController();
  t.after(() => controller.dispose());
  const native = deferred<string>();
  const result = controller.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  controller.setForeground(false); controller.setForeground(true);
  await microtasks();
  assert.equal(controller.getSnapshot().locked, true);
  clock.advance(NATIVE_INTERACTION_TIMEOUT_MS);
  await rejected;
  assert.equal(controller.getSnapshot().nativeInteractionPending, false);
  native.resolve("late"); await microtasks();
  assert.equal(controller.getSnapshot().locked, true);
});

test("unresolved SDK may bounce repeatedly without granting access; duplicate background notifications are harmless", async t => {
  const { controller } = await unlockedController();
  t.after(() => controller.dispose());
  const native = deferred<string>();
  const result = controller.runTrustedNativePicker(() => native.promise);
  controller.setForeground(false); controller.setForeground(false);
  assert.equal(controller.getSnapshot().nativeInteractionPending, true);
  controller.setForeground(true); controller.setForeground(false);
  await microtasks();
  assert.equal(controller.getSnapshot().nativeInteractionPending, true);
  assert.equal(controller.getSnapshot().locked, true);
  controller.setForeground(true);
  assert.equal(controller.getSnapshot().locked, true);
  native.resolve("photo");
  assert.equal(await result, "photo");
  assert.equal(controller.getSnapshot().locked, false);
});

for (const mode of ["error", "sync-throw", "session", "dispose", "enable", "disable", "unlock"] as const) {
  test(`${mode}: revokes the outstanding native promise without persisting a lease`, async t => {
    const { controller, adapter, clock } = await unlockedController();
    t.after(() => controller.dispose());
    const native = deferred<string>();
    const result = controller.runTrustedNativePicker(() => {
      if (mode === "sync-throw") throw new Error("native-error");
      return native.promise;
    });
    const rejected = assert.rejects(result, /native-error|REVOKED/);
    if (mode === "error") native.reject(new Error("native-error"));
    if (mode === "session") controller.invalidateTrustedNativeInteraction();
    if (mode === "dispose") controller.dispose();
    if (mode === "enable") void controller.enable();
    if (mode === "disable") void controller.disable();
    if (mode === "unlock") void controller.unlock();
    await rejected;
    native.resolve("late"); await microtasks();
    assert.equal(clock.timers.size, 0);
    assert.deepEqual(adapter.writes, []);
    assert.equal(controller.getSnapshot().locked, true);
  });
}

for (const state of ["uninitialized", "locked", "background", "busy", "offered", "disposed"] as const) {
  test(`${state}: rejects before invoking native SDK`, async () => {
    const adapter = new PickerSecurityAdapter();
    const controller = new DeviceLockController(adapter, new PickerClock());
    try {
      if (state !== "uninitialized") {
        if (state === "offered") adapter.preference = null;
        await controller.initialize();
      }
      if (state === "background") controller.setForeground(false);
      if (state === "busy") void controller.unlock();
      if (state === "offered") controller.offer();
      if (state === "disposed") controller.dispose();
      let calls = 0;
      await assert.rejects(controller.runTrustedNativePicker(async () => { calls += 1; }), /NOT_ALLOWED/);
      assert.equal(calls, 0);
    } finally { controller.dispose(); }
  });
}

test("concurrent picker cannot steal or revoke the first lease", async t => {
  const { controller } = await unlockedController();
  t.after(() => controller.dispose());
  const native = deferred<string>();
  const first = controller.runTrustedNativePicker(() => native.promise);
  await assert.rejects(controller.runTrustedNativePicker(async () => "second"), /NOT_ALLOWED/);
  native.resolve("first");
  assert.equal(await first, "first");
});

for (const time of ["expired", "regressed", "not-finite"] as const) {
  test(`${time}: monotonic recheck fails closed even when the timeout callback has not run`, async t => {
    const { controller, clock } = await unlockedController();
    t.after(() => controller.dispose());
    const native = deferred<string>();
    const result = controller.runTrustedNativePicker(() => native.promise);
    const rejected = assert.rejects(result, /REVOKED/);
    clock.time = time === "expired" ? clock.time + NATIVE_INTERACTION_TIMEOUT_MS : time === "regressed" ? clock.time - 1 : Number.NaN;
    native.resolve("late");
    await rejected;
    assert.equal(controller.getSnapshot().locked, true);
  });
}

test("privacy wait is part of the same bounded lease and second background invalidates it", async t => {
  const { controller, clock } = await unlockedController();
  t.after(() => controller.dispose());
  const privacy = deferred<void>();
  const result = controller.runTrustedNativePicker(async () => {
    controller.setForeground(false); controller.setForeground(true); return "photo";
  }, () => privacy.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  await microtasks();
  assert.equal(clock.timers.size, 1);
  controller.setForeground(false);
  await rejected;
  privacy.resolve(); controller.setForeground(true); await microtasks();
  assert.equal(controller.getSnapshot().locked, true);
});

test("restart reads only preference and old controller result cannot unlock new controller", async () => {
  const { controller, adapter } = await unlockedController();
  const native = deferred<string>();
  const result = controller.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  controller.dispose();
  const restarted = new DeviceLockController(adapter, new PickerClock());
  await restarted.initialize();
  native.resolve("old-process"); await rejected; await microtasks();
  assert.equal(restarted.getSnapshot().locked, true);
  assert.equal(restarted.getSnapshot().nativeInteractionPending, undefined);
  assert.deepEqual(adapter.writes, []);
  restarted.dispose();
});

test("first Home after a foreground-only SDK result revokes a pending privacy transition immediately", async t => {
  const { controller } = await unlockedController();
  t.after(() => controller.dispose());
  const privacy = deferred<void>();
  const result = controller.runTrustedNativePicker(async () => "already-selected", () => privacy.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  await microtasks();
  controller.setForeground(false);
  await rejected;
  controller.setForeground(true); privacy.resolve(); await microtasks();
  assert.equal(controller.getSnapshot().locked, true);
});

test("session generation change during a biometric prompt rejects the old authentication grant", async () => {
  const adapter = new PickerSecurityAdapter();
  const controller = new DeviceLockController(adapter, new PickerClock());
  await controller.initialize();
  const unlock = controller.unlock();
  await microtasks();
  controller.invalidateTrustedNativeInteraction();
  adapter.prompts[0].resolve({ success: true });
  await unlock;
  assert.equal(controller.getSnapshot().locked, true);
  controller.dispose();
});