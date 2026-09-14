import assert from "node:assert/strict";
import { test } from "node:test";
import { pickerAppRootFixture } from "./helpers/picker-messages-app";
import { deferred, microtasks, unlockedProvider } from "./helpers/trusted-native-picker";

for (const change of ["token", "branch", "tenant", "worker", "logout", "unmount"] as const) test(`actual ApplicationRoot ${change} invalidates a real provider lease and rejects its late picker result`, async t => {
  const provider = await unlockedProvider();
  const f = pickerAppRootFixture(() => provider.security);
  t.after(() => { f.close(); provider.close(); });
  assert.equal(f.accessCalls.at(-1)?.isAllowed(), true);
  const native = deferred<string>();
  assert.ok(provider.security.runTrustedNativePicker);
  const result = provider.security.runTrustedNativePicker(() => native.promise);
  const rejected = assert.rejects(result, /REVOKED/);
  await microtasks();
  provider.emit(false); await provider.settle(); f.render();
  assert.equal(provider.controller.getSnapshot().nativeInteractionPending, true);
  assert.equal(f.accessCalls.at(-1)?.isAllowed(), false);
  const before = f.model.session!;
  if (change === "unmount") f.close();
  else {
    if (change === "logout") f.setSession(null);
    if (change === "token") f.setSession({ ...before, token: "fixture-reauthenticated" });
    if (change === "branch") f.setSession({ ...before, branchId: 2 });
    if (change === "tenant") f.setSession({ ...before, tenant: { ...before.tenant, id: "tenant-2", portalOrigin: "https://two.example.test" } });
    if (change === "worker") f.setSession({ ...before, user: { ...before.user, workerId: before.user.workerId! + 1 } });
    f.render();
  }
  await rejected;
  assert.equal(provider.controller.getSnapshot().nativeInteractionPending, false);
  native.resolve("obsolete-private-photo"); await provider.settle();
  assert.equal(provider.security.isUnlocked(), false);
  assert.equal(provider.adapter.prompts.length, 1);
  assert.equal(provider.clock.timers.size, 0);
  assert.deepEqual(provider.adapter.writes, []);
});

test("actual ApplicationRoot same-session rerenders preserve the pending lease; privacy completion returns the original selection", async t => {
  const provider = await unlockedProvider(); const f = pickerAppRootFixture(() => provider.security);
  t.after(() => { f.close(); provider.close(); });
  const native = deferred<string>(); assert.ok(provider.security.runTrustedNativePicker);
  const result = provider.security.runTrustedNativePicker(() => native.promise);
  await microtasks();
  provider.emit(false); await provider.settle(); f.render();
  f.setSession({ ...f.model.session!, user: { ...f.model.session!.user } }); f.render();
  assert.equal(provider.controller.getSnapshot().nativeInteractionPending, true);
  provider.emit(true); native.resolve("same-session-photo");
  assert.equal(await result, "same-session-photo");
  assert.equal(provider.security.isUnlocked(), true);
  assert.equal(provider.adapter.prompts.length, 1);
});