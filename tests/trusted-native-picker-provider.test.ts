/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { NATIVE_INTERACTION_TIMEOUT_MS } from "../src/security/trustedNativeInteraction";
import type { DeviceSecurityUi } from "../src/security/DeviceSecurityContext";
import { loadSource } from "./helpers/tenant-challenge";
import { deferred, microtasks, pickerProviderFixture, unlockedProvider } from "./helpers/trusted-native-picker";

for (const order of ["result-first", "active-first"] as const) {
  for (const canceled of [false, true]) {
    test(`provider ${order} canceled=${canceled}: suppresses extra authentication and returns only after latest native privacy`, async t => {
      const f = await unlockedProvider();
      t.after(() => f.close());
      const native = deferred<{ canceled: boolean }>();
      const allow = deferred<void>();
      f.ports.allow = () => allow.promise;
      let received = false;
      assert.ok(f.security.runTrustedNativePicker);
      const result = f.security.runTrustedNativePicker(() => native.promise).then(value => { received = true; return value; });
      assert.equal(f.security.isUnlocked(), false);
      await microtasks();
      f.emit(false);
      await f.settle();
      assert.equal(f.captures.at(-1), "prevent");
      assert.equal(f.security.blocked, true);
      assert.equal(f.security.state.locked, true);
      const hiddenTree = JSON.stringify(f.tree);
      assert.match(hiddenTree, /retained-private-child/);
      assert.match(hiddenTree, /"pointerEvents":"none"/);
      assert.match(hiddenTree, /"accessibilityElementsHidden":true/);
      if (order === "result-first") native.resolve({ canceled });
      else f.emit(true);
      await f.settle();
      assert.equal(received, false);
      assert.equal(f.security.isUnlocked(), false);
      assert.equal(f.adapter.prompts.length, 1);
      if (order === "result-first") f.emit(true);
      else native.resolve({ canceled });
      await microtasks();
      assert.equal(f.security.isUnlocked(), false);
      assert.equal(f.captures.at(-1), "allow");
      assert.equal(received, false);
      allow.resolve();
      assert.equal((await result).canceled, canceled);
      // Deliberately no React render after foreground/result/privacy completion.
      assert.equal(f.security.isUnlocked(), true);
      assert.equal(f.adapter.prompts.length, 1);
      assert.equal(f.clock.timers.size, 0);
    });
  }
}

test("provider supports permission then camera immediately without a render between successful leases", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  for (const name of ["permission", "camera"]) {
    const native = deferred<string>();
    const result: Promise<string> = f.security.runTrustedNativePicker(() => native.promise);
    await microtasks();
    f.emit(false); f.emit(true); native.resolve(name);
    assert.equal(await result, name);
    assert.equal(f.security.isUnlocked(), true);
  }
  assert.equal(f.adapter.prompts.length, 1);
});

test("Home active while picker never settles stays private, then expiry resumes normal authentication without new AppState", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  const native = deferred<string>();
  const result = f.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  await microtasks();
  f.emit(false); f.emit(true); await f.settle();
  assert.equal(f.security.isUnlocked(), false);
  assert.equal(f.adapter.prompts.length, 1);
  f.clock.advance(NATIVE_INTERACTION_TIMEOUT_MS);
  await rejected; await f.settle();
  assert.equal(f.adapter.prompts.length, 2);
  assert.equal(f.security.isUnlocked(), false);
  f.adapter.prompts[1].resolve({ success: false, error: "user_cancel" });
  await f.settle(); f.emit(false); f.emit(true); await f.settle();
  assert.equal(f.adapter.prompts.length, 2);
  native.resolve("late-photo"); await f.settle();
  assert.equal(f.security.isUnlocked(), false);
});

test("native rejection in foreground resumes authentication but never returns a photo", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  const native = deferred<string>();
  const result = f.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /camera-error/);
  await microtasks();
  f.emit(false); f.emit(true); native.reject(new Error("camera-error"));
  await rejected; await f.settle();
  assert.equal(f.adapter.prompts.length, 2);
  assert.equal(f.security.isUnlocked(), false);
});

test("second unresolved SDK background remains protected without another prompt; settlement ends the exception", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  const native = deferred<string>();
  const result = f.security.runTrustedNativePicker(() => native.promise);
  await microtasks();
  f.emit(false); f.emit(true); f.emit(false);
  await f.settle();
  assert.equal(f.adapter.prompts.length, 1);
  assert.equal(f.security.isUnlocked(), false);
  assert.equal(f.security.state.nativeInteractionPending, true);
  f.emit(true); await f.settle();
  assert.equal(f.security.isUnlocked(), false);
  native.resolve("photo");
  assert.equal(await result, "photo");
  assert.equal(f.security.isUnlocked(), true);
  f.emit(false); f.emit(true); await f.settle();
  assert.equal(f.adapter.prompts.length, 2);
  assert.equal(f.security.isUnlocked(), false);
});

test("normal background without lease still requires authentication", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  f.emit(false); await f.settle();
  assert.equal(f.security.isUnlocked(), false);
  f.emit(true); await f.settle();
  assert.equal(f.adapter.prompts.length, 2);
});

test("privacy ABA: stale allow completion cannot release a result after second background", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  const native = deferred<string>();
  const allow = deferred<void>();
  f.ports.allow = () => allow.promise;
  const result = f.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED|PRIVACY_UNAVAILABLE/);
  await microtasks();
  f.emit(false); f.emit(true); native.resolve("photo"); await microtasks();
  assert.equal(f.captures.at(-1), "allow");
  f.emit(false); await rejected;
  allow.resolve(); await f.settle();
  assert.equal(f.captures.at(-1), "prevent");
  assert.equal(f.security.isUnlocked(), false);
});

test("privacy promise that never resolves is bounded by the lease deadline", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  const allow = deferred<void>();
  f.ports.allow = () => allow.promise;
  const result = f.security.runTrustedNativePicker(async () => "photo");
  const rejected = assert.rejects(result, /REVOKED|PRIVACY_UNAVAILABLE/);
  await microtasks();
  assert.equal(f.security.isUnlocked(), false);
  f.clock.advance(NATIVE_INTERACTION_TIMEOUT_MS);
  await rejected;
  allow.resolve(); await f.settle();
  assert.equal(f.security.isUnlocked(), false);
});

test("failed native capture protection revokes even before picker promise settles", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  f.ports.prevent = async () => { throw new Error("privacy-error"); };
  const native = deferred<string>();
  const result = f.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED|PRIVACY_UNAVAILABLE/);
  await rejected;
  native.resolve("late"); await f.settle();
  assert.equal(f.security.isUnlocked(), false);
});

test("mounted session generation invalidation rejects old result; no persisted lease", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  const native = deferred<string>();
  const result = f.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  await microtasks();
  f.emit(false); f.controller.invalidateTrustedNativeInteraction(); f.emit(true);
  await rejected;
  native.resolve("old-session"); await f.settle();
  assert.equal(f.security.isUnlocked(), false);
  assert.deepEqual(f.adapter.writes, []);
});

test("unmount cancels pending result immediately and a fresh provider cold-starts locked", async () => {
  const f = await unlockedProvider();
  assert.ok(f.security.runTrustedNativePicker);
  const native = deferred<string>();
  const result = f.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  f.close();
  await rejected;
  assert.equal(f.foregroundListenerCount, 0);
  assert.equal(f.clock.timers.size, 0);
  const next = pickerProviderFixture();
  try {
    native.resolve("old-provider"); await next.settle();
    assert.equal(next.security.isUnlocked(), false);
    assert.equal(next.adapter.prompts.length, 1);
  } finally { next.close(); }
});

test("hook passes through only absent context; existing context without runner fails closed", async () => {
  let current: DeviceSecurityUi | null = null;
  const context = loadSource<typeof import("../src/security/DeviceSecurityContext")>("security/DeviceSecurityContext.tsx", id => {
    if (id === "react") return { createContext: () => ({}), useContext: () => current };
    if (id === "react-native") return { Modal: "Modal", View: "View" };
    if (id === "react/jsx-runtime") return {};
    throw new Error(`UNEXPECTED_CONTEXT_IMPORT:${id}`);
  });
  assert.equal(await context.useTrustedNativePicker()(async () => 7), 7);
  const f = await unlockedProvider();
  try {
    current = { controller: f.controller, state: f.controller.getSnapshot(), blocked: false, isUnlocked: () => true };
    await assert.rejects(context.useTrustedNativePicker()(async () => 8), /PROVIDER_REQUIRED/);
    current = f.security;
    assert.equal(context.useTrustedNativePicker(), f.security.runTrustedNativePicker);
  } finally { f.close(); }
});

test("expiry in background after a successful SDK result does not prompt until normal foreground", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  assert.ok(f.security.runTrustedNativePicker);
  const native = deferred<string>();
  const result = f.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  await microtasks();
  f.emit(false); native.resolve("photo"); await microtasks();
  f.clock.advance(NATIVE_INTERACTION_TIMEOUT_MS);
  await rejected; await f.settle();
  assert.equal(f.adapter.prompts.length, 1);
  f.emit(true); await f.settle();
  assert.equal(f.adapter.prompts.length, 2);
  assert.equal(f.security.isUnlocked(), false);
});