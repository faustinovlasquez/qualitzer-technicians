/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { NATIVE_INTERACTION_TIMEOUT_MS } from "../src/security/trustedNativeInteraction";
import { deferred, microtasks, pickerProviderFixture, unlockedController, unlockedProvider } from "./helpers/trusted-native-picker";

test("controller third callback prepares before SDK; second callback still gates result delivery", async t => {
  const { controller, clock } = await unlockedController();
  t.after(() => controller.dispose());
  const preparation = deferred<void>();
  const restoration = deferred<void>();
  const events: string[] = [];
  let received = false;
  const result = controller.runTrustedNativePicker(async () => { events.push("sdk"); return "photo"; }, async () => {
    events.push("restore"); await restoration.promise;
  }, async signal => { assert.equal(signal.aborted, false); events.push("prepare"); await preparation.promise; })
    .then(value => { received = true; return value; });
  await microtasks();
  assert.deepEqual(events, ["prepare"]);
  assert.equal(clock.timers.size, 1);
  preparation.resolve(); await microtasks();
  assert.deepEqual(events, ["prepare", "sdk", "restore"]);
  assert.equal(received, false);
  restoration.resolve();
  assert.equal(await result, "photo");
  assert.equal(clock.timers.size, 0);
});

for (const failure of ["reject", "throw", "timeout", "clock-expired", "clock-regressed", "clock-invalid", "session", "dispose", "background"] as const) {
  test(`preflight ${failure}: never invokes SDK or returns a raw native permission error`, async t => {
    const { controller, clock } = await unlockedController();
    t.after(() => controller.dispose());
    const preparation = deferred<void>();
    let launches = 0;
    const result = controller.runTrustedNativePicker(async () => { launches += 1; return "asset"; }, undefined, () => {
      if (failure === "throw") throw new Error("MissingActivity: CAMERA_PERMISSION raw");
      return preparation.promise;
    });
    const rejected = assert.rejects(result, /^Error: TRUSTED_NATIVE_INTERACTION_(REVOKED|PRIVACY_UNAVAILABLE)$/);
    if (failure === "reject") preparation.reject(new Error("MissingActivity: CAMERA_PERMISSION raw"));
    if (failure === "timeout") clock.advance(NATIVE_INTERACTION_TIMEOUT_MS);
    if (failure === "clock-expired") clock.time += NATIVE_INTERACTION_TIMEOUT_MS;
    if (failure === "clock-regressed") clock.time -= 1;
    if (failure === "clock-invalid") clock.time = Number.NaN;
    if (failure === "session") controller.invalidateTrustedNativeInteraction();
    if (failure === "dispose") controller.dispose();
    if (failure === "background") { controller.setForeground(false); controller.setForeground(true); }
    preparation.resolve();
    await rejected; await microtasks();
    assert.equal(launches, 0);
    assert.equal(controller.getSnapshot().locked, true);
    assert.equal(clock.timers.size, 0);
  });
}

for (const preference of ["enabled", "declined"] as const) {
  test(`provider ${preference}: deferred prevent completes while Activity exists, before launch`, async t => {
    const f = preference === "enabled" ? await unlockedProvider() : pickerProviderFixture(preference);
    t.after(() => f.close());
    await f.settle();
    const prompts = f.adapter.prompts.length;
    assert.ok(f.security.runTrustedNativePicker);
    const prevent = deferred<void>();
    const native = deferred<string>();
    const restore = deferred<void>();
    let activityAvailable = true;
    let protectedApplied = false;
    let launches = 0;
    f.ports.prevent = async () => {
      if (!activityAvailable) throw new Error("MissingActivity");
      await prevent.promise;
      if (!activityAvailable) throw new Error("MissingActivity");
      protectedApplied = true;
    };
    f.ports.allow = () => restore.promise;
    const result = f.security.runTrustedNativePicker(() => {
      launches += 1;
      assert.equal(protectedApplied, true);
      activityAvailable = false;
      f.emit(false);
      return native.promise;
    });
    await f.settle();
    assert.equal(launches, 0);
    assert.equal(f.security.blocked, true);
    assert.equal(f.security.state.nativeInteractionPending, true);
    assert.equal(f.captures.at(-1), "prevent");
    prevent.resolve(); await f.settle();
    assert.equal(launches, 1);
    assert.equal(f.adapter.prompts.length, prompts);
    activityAvailable = true;
    f.emit(true); native.resolve("photo"); await f.settle();
    assert.equal(f.security.isUnlocked(), false);
    restore.resolve();
    assert.equal(await result, "photo");
    assert.equal(f.security.isUnlocked(), true);
    assert.equal(f.adapter.prompts.length, prompts);
  });
}

for (const order of ["result-first", "active-first"] as const) {
  for (const canceled of [true, false]) {
    test(`provider repeated bounces ${order} canceled=${canceled}: unresolved Home never authorizes`, async t => {
      const f = await unlockedProvider();
      t.after(() => f.close());
      assert.ok(f.security.runTrustedNativePicker);
      const native = deferred<{ canceled: boolean; assets: string[] | null }>();
      let received = false;
      let launches = 0;
      const result = f.security.runTrustedNativePicker(() => { launches += 1; return native.promise; })
        .then(value => { received = true; return value; });
      await f.settle();
      assert.equal(launches, 1);
      for (let bounce = 0; bounce < 3; bounce += 1) {
        f.emit(false); f.emit(true); await f.settle();
        assert.equal(f.security.isUnlocked(), false);
        assert.equal(f.security.state.nativeInteractionPending, true);
        assert.equal(f.adapter.prompts.length, 1);
        assert.equal(received, false);
        assert.equal(f.captures.at(-1), "prevent");
      }
      f.emit(false);
      const expected = { canceled, assets: canceled ? null : ["photo"] };
      if (order === "result-first") native.resolve(expected);
      else f.emit(true);
      await f.settle();
      assert.equal(received, false);
      assert.equal(f.security.isUnlocked(), false);
      if (order === "result-first") f.emit(true);
      else native.resolve(expected);
      assert.deepEqual(await result, expected);
      assert.equal(f.security.isUnlocked(), true);
      assert.equal(f.adapter.prompts.length, 1);
      f.emit(false); f.emit(true); await f.settle();
      assert.equal(f.adapter.prompts.length, 2);
      assert.equal(f.security.isUnlocked(), false);
    });
  }
}

for (const phase of ["prepare", "restore"] as const) {
  for (const failure of ["privacy-error", "session", "timeout", "unmount", "background"] as const) {
    test(`provider ${phase}/${failure}: fails closed and ignores late privacy and asset`, async t => {
      const f = await unlockedProvider();
      let closed = false;
      t.after(() => { if (!closed) f.close(); });
      assert.ok(f.security.runTrustedNativePicker);
      const barrier = deferred<void>();
      let launches = 0;
      let received = false;
      if (phase === "prepare") f.ports.prevent = () => barrier.promise;
      else f.ports.allow = () => barrier.promise;
      const result = f.security.runTrustedNativePicker(async () => { launches += 1; return "asset"; })
        .then(value => { received = true; return value; });
      const rejected = assert.rejects(result, /^Error: TRUSTED_NATIVE_INTERACTION_(REVOKED|PRIVACY_UNAVAILABLE)$/);
      await f.settle();
      assert.equal(launches, phase === "prepare" ? 0 : 1);
      if (failure === "privacy-error") barrier.reject(new Error("MissingActivity CAMERA permission"));
      if (failure === "session") f.controller.invalidateTrustedNativeInteraction();
      if (failure === "timeout") f.clock.advance(NATIVE_INTERACTION_TIMEOUT_MS);
      if (failure === "unmount") { f.close(); closed = true; }
      if (failure === "background") f.emit(false);
      await rejected;
      barrier.resolve();
      if (!closed) await f.settle();
      assert.equal(received, false);
      assert.equal(launches, phase === "prepare" ? 0 : 1);
      assert.equal(f.security.isUnlocked(), false);
      assert.equal(f.clock.timers.size, 0);
    });
  }
}

test("background in the SDK settlement microtask revokes before the controller continuation", async t => {
  const { controller } = await unlockedController();
  t.after(() => controller.dispose());
  const native = deferred<string>();
  const result = controller.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  const background = native.promise.then(() => { controller.setForeground(false); controller.setForeground(true); });
  native.resolve("photo");
  await background;
  await rejected;
  assert.equal(controller.getSnapshot().locked, true);
});

test("deadline check wins over a late native permission rejection when timer has not fired", async t => {
  const { controller, clock } = await unlockedController();
  t.after(() => controller.dispose());
  const native = deferred<string>();
  const result = controller.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /^Error: TRUSTED_NATIVE_INTERACTION_REVOKED$/);
  clock.time += NATIVE_INTERACTION_TIMEOUT_MS;
  native.reject(new Error("CAMERA_PERMISSION MissingActivity"));
  await rejected;
  assert.equal(controller.getSnapshot().locked, true);
});