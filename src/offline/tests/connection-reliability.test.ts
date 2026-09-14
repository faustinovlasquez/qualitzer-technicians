/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { OfflineEngine } from "../engine";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { fixture, uuid } from "./fakes";
import { updateState } from "../state";

const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

test("overlapping auth failures invalidate once, preserve UUID and block pending writes", async () => {
  const f = fixture(); let invalidations = 0;
  f.dependencies.onAuthBlocked = async () => { invalidations++; };
  const e = new OfflineEngine(f.dependencies);
  const operation = { id: uuid(1), kind: "comment" as const, status: "pending" as const, createdAt: 100, attempts: 0, nextAttemptAt: 0,
    scope: { companyBranchId: 1, groupId: "direct-80", workId: "80", startDate: "2026-09-08", endDate: "2026-09-08" }, text: "Immutable" };
  await e.enqueue([operation]);
  await Promise.all([e.blockAuth(), e.blockAuth(), e.blockAuth()]);
  await e.blockAuth(); await e.syncNow();
  assert.equal(invalidations, 1);
  assert.deepEqual(e.getSnapshot().operations, [{ ...operation, status: "auth_required" }]);
  assert.equal(e.getSnapshot().online, false); assert.equal(f.upstream.commands.length, 0);
});

test("auth invalidation can be retried after persistence failure and after explicit reauthorization", async () => {
  const f = fixture(); let invalidations = 0;
  f.dependencies.onAuthBlocked = async () => { invalidations++; };
  const e = new OfflineEngine(f.dependencies);
  f.store.failWrites = true; await assert.rejects(e.blockAuth(), /DISK_FULL/);
  f.store.failWrites = false; await e.blockAuth();
  assert.equal(invalidations, 1);
  await updateState(f.store, "a", (state) => { state.authBlocked = false; });
  await e.refresh(); await e.blockAuth(); assert.equal(invalidations, 2);
});

test("an older failed me probe does not overwrite a newer verified authorized read", async () => {
  const f = fixture(); let release: (() => void) | undefined;
  f.upstream.duringVerify = () => new Promise<void>((resolve) => { release = resolve; });
  f.upstream.verifyError = new NetworkError("timeout");
  const e = new OfflineEngine(f.dependencies); const pending = e.syncNow(); await settle();
  assert.ok(release); e.noteConnectionSuccess(e.getConnectionGeneration());
  const verified = e.getSnapshot().connection;
  release(); await pending;
  assert.deepEqual(e.getSnapshot().connection, verified);
  assert.equal(e.getSnapshot().online, true);
});

test("a fresh transport failure still marks unreachable and the existing timer recovers without pending writes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const e = new OfflineEngine(f.dependencies); t.after(() => e.stop());
  e.start(); t.mock.timers.tick(0); await settle(); assert.equal(e.getSnapshot().online, true);
  f.upstream.verifyError = new NetworkError("network"); t.mock.timers.tick(30_000); await settle();
  assert.equal(e.getSnapshot().connection?.status, "unreachable");
  f.upstream.verifyError = undefined; const before = f.upstream.verifyCount;
  t.mock.timers.tick(1_999); await settle(); assert.equal(f.upstream.verifyCount, before);
  t.mock.timers.tick(1); await settle(); assert.equal(f.upstream.verifyCount, before + 1);
  assert.equal(e.getSnapshot().online, true); assert.equal(f.upstream.commands.length, 0);
});

for (const status of [401, 429, 503]) test(`newer success never masks an overlapping HTTP ${status}`, async () => {
  const f = fixture(); let release: (() => void) | undefined;
  f.upstream.duringVerify = () => new Promise<void>((resolve) => { release = resolve; });
  f.upstream.verifyError = new ApiError(status, status === 401 ? "UNAUTHORIZED" : "UPSTREAM_UNAVAILABLE", "Unavailable");
  const e = new OfflineEngine(f.dependencies); const pending = e.syncNow(); await settle();
  assert.ok(release); e.noteConnectionSuccess(); release(); await pending;
  assert.equal(e.getSnapshot().connection?.status, status === 401 ? "auth_required" : "service_error");
  assert.equal(e.getSnapshot().online, false);
});

test("background generation cannot refresh the offline passport; foreground performs a fresh verification", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); let release: (() => void) | undefined; let verified = 0;
  f.dependencies.onVerified = async () => { verified++; };
  f.upstream.duringVerify = () => new Promise<void>((resolve) => { release = resolve; });
  const e = new OfflineEngine(f.dependencies); t.after(() => e.stop());
  e.start(); t.mock.timers.tick(0); await settle(); assert.ok(release);
  e.setForeground(false); e.setForeground(true); t.mock.timers.tick(0);
  f.upstream.duringVerify = undefined; release(); await settle();
  assert.equal(verified, 0); assert.equal(e.getSnapshot().online, false);
  t.mock.timers.tick(0); await settle();
  assert.equal(verified, 1); assert.equal(e.getSnapshot().online, true);
});

test("a verified response arriving after auth invalidation cannot recreate the offline passport", async () => {
  const f = fixture(); let release: (() => void) | undefined; let verified = 0;
  f.dependencies.onVerified = async () => { verified++; };
  f.upstream.duringVerify = () => new Promise<void>((resolve) => { release = resolve; });
  const e = new OfflineEngine(f.dependencies); const pending = e.syncNow(); await settle();
  assert.ok(release); await e.blockAuth(); release(); await pending;
  assert.equal(verified, 0); assert.equal(e.getSnapshot().authBlocked, true);
  assert.equal(e.getSnapshot().online, false);
});