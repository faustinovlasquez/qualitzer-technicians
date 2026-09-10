/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineOperation, OfflineSnapshot } from "../../domain/offline";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { OfflineEngine } from "../engine";
import { compactConnectionPresentation, connectionPresentation } from "../connectionPresentation";
import { updateState } from "../state";
import { creation, fixture, result, uuid } from "./fakes";

const scope = { companyBranchId: 1, groupId: "direct-80", workId: "80", startDate: "2026-09-08", endDate: "2026-09-08" };
const base = (id: number) => ({ id: uuid(id), status: "pending" as const, createdAt: 100, attempts: 0, nextAttemptAt: 0 });
const create = (id = 1): OfflineOperation => ({ ...base(id), kind: "create", input: creation(id), localGroupId: `local-${uuid(id)}`, localWorkId: `local-${uuid(id)}` });
const comment = (id = 2): OfflineOperation => ({ ...base(id), kind: "comment", scope, text: "Preservar texto" });
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

test("unknown link starts checking, not ready or falsely disconnected; authorized service read proves readiness", async () => {
  const f = fixture(); f.dependencies.connectivity.current = async () => null;
  const e = new OfflineEngine(f.dependencies);
  assert.equal(e.getSnapshot().connection?.status, "checking"); assert.equal(e.getSnapshot().online, false);
  await e.syncNow();
  assert.deepEqual(e.getSnapshot().connection, { status: "ready", networkConnected: null, foreground: true, checkedAt: 1000, errorCode: undefined });
  assert.equal(e.getSnapshot().online, true);
});

for (const connected of [true, null, false]) test(`link ${connected} never conflates transport failure with proven internet loss`, async () => {
  const f = fixture(); f.dependencies.connectivity.current = async () => connected;
  f.upstream.verifyError = new NetworkError("network");
  const e = new OfflineEngine(f.dependencies); await e.syncNow();
  const snapshot = e.getSnapshot();
  assert.equal(snapshot.online, false);
  assert.equal(snapshot.connection?.status, connected === false ? "offline" : "unreachable");
  assert.equal(connectionPresentation(snapshot).title, connected === false ? "Sin red" : "Sin acceso a Qualitzer");
  assert.doesNotMatch(connectionPresentation(snapshot).label, /Sin internet|Sin conexión/);
  assert.equal(f.upstream.verifyCount, connected === false ? 0 : 1);
});

for (const status of [502, 503]) test(`HTTP ${status} is service_error with network available and blocks the online alias`, async () => {
  const f = fixture(); f.upstream.sendError = new ApiError(status, "UPSTREAM_UNAVAILABLE", "Unavailable");
  const e = new OfflineEngine(f.dependencies); await e.enqueue([comment()]); await e.syncNow();
  assert.equal(e.getSnapshot().connection?.networkConnected, true);
  assert.equal(e.getSnapshot().connection?.status, "service_error"); assert.equal(e.getSnapshot().online, false);
  assert.equal(connectionPresentation(e.getSnapshot()).title, "Servidor no disponible");
  assert.equal(e.getSnapshot().operations[0]?.status, "pending");
});

test("malformed authorized response is service error, auth is distinct, cache refresh never claims a new connection", async () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  f.upstream.verifyError = new SyntaxError("Invalid JSON"); await e.syncNow();
  assert.equal(e.getSnapshot().connection?.status, "service_error");
  const connection = e.getSnapshot().connection;
  await updateState(f.store, "a", (state) => { state.cache.push({ key: "me", json: "{}", fetchedAt: 100 }); });
  await e.refresh(); assert.deepEqual(e.getSnapshot().connection, connection);
  f.upstream.verifyError = new ApiError(401, "UNAUTHORIZED", "Denied"); await e.syncNow();
  assert.equal(e.getSnapshot().connection?.status, "auth_required");
  assert.equal(connectionPresentation(e.getSnapshot()).title, "Verificar sesión");
});

test("background is a pause, not transport offline; foreground wakes immediately after a long probe backoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const e = new OfflineEngine(f.dependencies); t.after(() => e.stop());
  await e.syncNow(); e.start(); e.setForeground(false);
  assert.equal(e.getSnapshot().connection?.status, "ready"); assert.equal(e.getSnapshot().online, true);
  assert.equal(e.getSnapshot().connection?.foreground, false);
  assert.match(connectionPresentation(e.getSnapshot()).secondary, /en pausa/);
  t.mock.timers.tick(300_000); await settle(); assert.equal(f.upstream.verifyCount, 1);
  e.setForeground(true); f.upstream.verifyError = new NetworkError("network");
  for (let i = 0; i < 10; i++) await e.syncNow();
  e.setForeground(false); f.upstream.verifyError = undefined; const before = f.upstream.verifyCount;
  e.setForeground(true); t.mock.timers.tick(0); await settle();
  assert.equal(f.upstream.verifyCount, before + 1); assert.equal(e.getSnapshot().online, true);
});

test("reactivation during an in-flight probe keeps its wakeup and ignores stale subscriptions", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const listeners: Array<(connected: boolean | null) => void> = [];
  let unsubscribed = 0;
  f.dependencies.connectivity.subscribe = (listener) => { listeners.push(listener); return () => { unsubscribed++; }; };
  let release: (() => void) | undefined;
  f.upstream.duringVerify = () => new Promise<void>((resolve) => { release = resolve; });
  const e = new OfflineEngine(f.dependencies); t.after(() => e.stop());
  await e.enqueue([comment()]); e.start(); t.mock.timers.tick(0); await settle();
  assert.ok(release); e.setForeground(false); e.setForeground(true);
  assert.equal(unsubscribed, 1); assert.equal(listeners.length, 2);
  listeners[0]?.(false); assert.notEqual(e.getSnapshot().connection?.status, "offline");
  t.mock.timers.tick(0); f.upstream.duringVerify = undefined; release(); await settle();
  assert.equal(f.upstream.commands.length, 0);
  t.mock.timers.tick(0); await settle();
  assert.equal(f.upstream.commands.length, 1); assert.equal(e.getSnapshot().pending, 0);
});

test("reconnect events coalesce and reset only transport waits, never deployment backoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); let network: ((connected: boolean | null) => void) | undefined;
  f.dependencies.connectivity.subscribe = (listener) => { network = listener; return () => undefined; };
  await updateState(f.store, "a", (state) => {
    state.operations = [{ ...comment(), attempts: 12, nextAttemptAt: 301_000, lastError: "OFFLINE_TIMEOUT_UNCERTAIN" },
      { ...create(), attempts: 2, nextAttemptAt: 61_000, lastError: "MOBILE_CREATION_SCHEMA_NOT_READY" }];
  });
  const e = new OfflineEngine(f.dependencies); t.after(() => e.stop()); e.start();
  f.connect(false); network?.(false); f.connect(true); network?.(true); network?.(true); network?.(true);
  t.mock.timers.tick(0); await settle();
  assert.equal(f.upstream.verifyCount, 1); assert.equal(f.upstream.commands.length, 1); assert.equal(f.upstream.creates.length, 0);
  assert.equal(e.getSnapshot().operations.find((op) => op.kind === "create")?.nextAttemptAt, 61_000);
});

for (const [code, status] of [["MOBILE_CREATION_SCHEMA_NOT_READY", 409], ["MOBILE_SYNC_SCHEMA_NOT_READY", 503], ["OFFLINE_SYNC_ROUTE_NOT_FOUND", 404]] as const) test(`${code} retains UUID/body with at least 60s retry delay and no child sends`, async () => {
  const f = fixture(); f.upstream.sendError = new ApiError(status, code, "Needs deployment");
  const e = new OfflineEngine(f.dependencies);
  const child = { ...comment(), dependencyId: uuid(1) };
  await e.enqueue([create(), child]); await e.syncNow();
  const first = e.getSnapshot().operations[0]!;
  assert.equal(first.status, "pending"); assert.equal(first.nextAttemptAt, 61_000);
  assert.equal(e.getSnapshot().connection?.status, "service_error"); assert.equal(e.getSnapshot().online, false);
  await e.retry(uuid(1)); await e.syncNow(); assert.equal(f.upstream.creates.length, 1);
  assert.equal(f.upstream.commands.length, 0); assert.equal(e.getSnapshot().operations[1]?.attempts, 0);
  e.noteConnectionSuccess(); assert.equal(e.getSnapshot().online, false);
  f.upstream.sendError = undefined; f.advance(60_000);
  const restored = new OfflineEngine(f.dependencies); await restored.syncNow(); await restored.syncNow();
  assert.equal(restored.getSnapshot().pending, 0);
  assert.deepEqual(f.upstream.creates[0], f.upstream.creates[1]); assert.equal(f.upstream.creates.length, 2);
  assert.equal(f.upstream.commands.length, 1);
});

for (const status of ["conflict", "blocked"] as const) test(`legacy schema ${status} resumes exactly once even when the backend already applied the UUID`, async () => {
  const f = fixture(); const parent = create(); assert.ok(parent.kind === "create");
  f.upstream.created.set(parent.id, result(parent.input));
  const file = await f.files.own("a", { id: "photo", uri: "source:", name: "proof.png", mimeType: "image/png" });
  const child: OfflineOperation = { ...base(2), kind: "document", file, scope: { ...scope, groupId: parent.localGroupId, workId: parent.localWorkId }, dependencyId: parent.id };
  await updateState(f.store, "a", (state) => { state.operations = [{ ...parent, status, lastError: "MOBILE_CREATION_SCHEMA_NOT_READY", attempts: 1 }, child]; });
  const e = new OfflineEngine(f.dependencies); await e.syncNow();
  const restarted = new OfflineEngine(f.dependencies); await restarted.syncNow();
  assert.equal(f.upstream.created.size, 1); assert.equal(f.upstream.creates.length, 1);
  assert.deepEqual(f.upstream.creates[0], parent.input); assert.equal(f.upstream.documents.length, 1);
  assert.deepEqual((await f.store.read("a")).operations[1]?.kind === "document" && f.upstream.documents[0]?.sha256, file.sha256);
  assert.equal(f.files.removes.length, 0); assert.equal(f.files.files.size, 1);
  assert.equal(restarted.getSnapshot().pending, 0);
});

test("migration never resets conflicts, review, rejected receipts, applied results, or noncreation failures", async () => {
  const f = fixture();
  const held: OfflineOperation[] = [
    { ...create(1), status: "conflict", lastError: "MOBILE_CREATION_REQUEST_CONFLICT" },
    { ...create(2), status: "needs_review", lastError: "MOBILE_CREATION_SCHEMA_NOT_READY" },
    { ...create(3), status: "blocked", lastError: "MOBILE_CREATION_SCHEMA_NOT_READY", receipt: { operationId: uuid(3), state: "rejected" } },
    { ...comment(4), status: "blocked", lastError: "MOBILE_CREATION_SCHEMA_NOT_READY" },
    { ...create(5), status: "conflict", lastError: "OTHER_409" },
  ];
  const applied = create(6); assert.ok(applied.kind === "create"); held.push({ ...applied, status: "blocked", result: result(applied.input), lastError: "MOBILE_CREATION_SCHEMA_NOT_READY" });
  await updateState(f.store, "a", (state) => { state.operations = held; });
  const e = new OfflineEngine(f.dependencies); await e.syncNow();
  assert.deepEqual(e.getSnapshot().operations, held); assert.equal(f.upstream.creates.length, 0); assert.equal(f.upstream.commands.length, 0);
});

test("manual retry cannot reset a blocked permanent creation conflict or arbitrary rejection", async () => {
  const f = fixture();
  const held: OfflineOperation[] = [{ ...create(1), status: "blocked", lastError: "MOBILE_CREATION_REQUEST_CONFLICT" }, { ...comment(2), status: "blocked", lastError: "FORBIDDEN" }];
  await updateState(f.store, "a", (state) => { state.operations = held; });
  const e = new OfflineEngine(f.dependencies);
  for (const op of held) await assert.rejects(e.retry(op.id), /REVIEW_REQUIRED/);
  assert.deepEqual((await f.store.read("a")).operations, held);
  assert.equal(f.upstream.creates.length, 0); assert.equal(f.upstream.commands.length, 0);
});

test("lost creation response followed by missing migration 409 restores through identical replay without duplicate creation", async () => {
  const f = fixture(); let calls = 0;
  f.upstream.createRecord = async (input) => {
    f.upstream.creates.push(structuredClone(input)); calls++;
    if (calls === 2) throw new ApiError(409, "MOBILE_CREATION_SCHEMA_NOT_READY", "Deployment");
    const value = f.upstream.created.get(input.clientRequestId) ?? result(input);
    f.upstream.created.set(input.clientRequestId, value);
    if (calls === 1) throw new NetworkError("timeout");
    return value;
  };
  const e = new OfflineEngine(f.dependencies); await e.enqueue([create()]); await e.syncNow(); f.advance();
  const restored = new OfflineEngine(f.dependencies); await restored.syncNow();
  assert.equal(restored.getSnapshot().operations[0]?.status, "pending");
  assert.equal(restored.getSnapshot().operations[0]?.lastError, "MOBILE_CREATION_SCHEMA_NOT_READY");
  f.advance(60_000); await restored.syncNow(); await restored.syncNow();
  assert.equal(f.upstream.created.size, 1); assert.equal(calls, 3); assert.equal(restored.getSnapshot().pending, 0);
  assert.deepEqual(f.upstream.creates, [creation(), creation(), creation()]);
});

test("partial sync retains applied state, a blocked parent and its unsent zero-attempt file", async () => {
  const f = fixture(); const file = await f.files.own("a", { id: "photo", uri: "source:", name: "proof.png", mimeType: "image/png" });
  f.upstream.createRecord = async () => { throw new ApiError(409, "MOBILE_CREATION_REQUEST_CONFLICT", "Conflict"); };
  const e = new OfflineEngine(f.dependencies);
  await e.enqueue([comment(3), create(1), { ...base(2), kind: "document", scope, file, dependencyId: uuid(1) }]);
  await e.syncNow();
  assert.deepEqual(e.getSnapshot().operations.map((op) => [op.status, op.attempts]), [["applied", 1], ["conflict", 1], ["pending", 0]]);
  assert.equal(f.upstream.documents.length, 0); assert.equal(f.files.files.size, 1); assert.equal(f.files.removes.length, 0);
});

test("explicit connection overrides an inconsistent legacy online fixture without changing cached availability", () => {
  const f = fixture(); const e = new OfflineEngine(f.dependencies);
  const snapshot: OfflineSnapshot = { ...e.getSnapshot(), online: true, connection: { status: "service_error", networkConnected: true, foreground: true, checkedAt: 1, errorCode: "UPSTREAM_UNAVAILABLE" }, coverage: [{ date: "2026-09-08", branchId: 1, fetchedAt: 1 }] };
  const ui = connectionPresentation(snapshot);
  assert.equal(ui.title, "Servidor no disponible"); assert.equal(ui.ready, false); assert.match(ui.secondary, /Agenda disponible offline/);
});

test("compact status separates connection from pending counts into two lines without duplicating the company", async () => {
  const e = new OfflineEngine(fixture().dependencies); await e.syncNow();
  const snapshot: OfflineSnapshot = { ...e.getSnapshot(), pending: 1, conflicts: 1, coverage: [{ date: "2026-09-10", branchId: 1, fetchedAt: 1 }] };
  assert.deepEqual(compactConnectionPresentation(snapshot), { title: "Conectado a Qualitzer", detail: "1 pendiente · 1 por revisar" });
  assert.match(connectionPresentation(snapshot).secondary, /datos al/);
  assert.equal(compactConnectionPresentation({ ...snapshot, pending: 0, conflicts: 0 }).detail, "Sin pendientes · copia offline");
  assert.equal(compactConnectionPresentation({ ...snapshot, pending: 3, conflicts: 0 }).detail, "3 pendientes");
});

test("compact labels retain offline, service, auth and pause distinctions", () => {
  const e = new OfflineEngine(fixture().dependencies);
  const snapshot = e.getSnapshot();
  const titleFor = (status: "offline" | "unreachable" | "service_error" | "auth_required") => compactConnectionPresentation({ ...snapshot, connection: { status, networkConnected: true, foreground: true, checkedAt: 1 } }).title;
  assert.equal(titleFor("offline"), "Sin red");
  assert.equal(titleFor("unreachable"), "Sin acceso a Qualitzer");
  assert.equal(titleFor("service_error"), "Servidor no disponible");
  assert.equal(titleFor("auth_required"), "Verificar sesión");
  assert.equal(compactConnectionPresentation({ ...snapshot, connection: { status: "ready", networkConnected: true, foreground: false, checkedAt: 1 } }).detail, "En pausa · vuelve a la app");
  assert.equal(compactConnectionPresentation(snapshot).detail, "Sin pendientes · sin copia offline");
  assert.equal(compactConnectionPresentation(null).title, "Recuperando estado local…");
});