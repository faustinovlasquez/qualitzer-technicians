/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { TechnicianRepository } from "../../domain/TechnicianRepository";
import { OfflineUnavailableError, type OfflineCommand, type OfflineOperation, type OfflineReceipt } from "../../domain/offline";
import { syncAnswerSchema } from "../../domain/offlineProtocol";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { OFFLINE_LIMITS, type DurableFileStore, type DurableStore } from "../contracts";
import { OfflineEngine } from "../engine";
import { OfflineTechnicianRepository } from "../OfflineTechnicianRepository";
import { updateState, validateQuota } from "../state";
import { creation, fixture, uuid } from "./fakes";

const scope = { companyBranchId: 1, groupId: "direct-80", workId: "80", startDate: "2026-09-08", endDate: "2026-09-08" };
const base = (id: number) => ({ id: uuid(id), status: "pending" as const, createdAt: 100, attempts: 0, nextAttemptAt: 0 });
const comment = (id: number): OfflineOperation => ({ ...base(id), kind: "comment", scope, text: `Original ${id}` });
const timer = (id: number, dependencyId?: string): OfflineOperation => ({ ...base(id), kind: "timer", scope, dependencyId,
  payload: { status: id % 2 ? "in_progress" : "paused", baseStatus: id === 1 ? "pending" : id % 2 ? "paused" : "in_progress" } });
const checklist = (id: number): OfflineOperation => ({ ...base(id), kind: "checklist", scope, payload: { checklistId: 17 } });
const create = (id: number): OfflineOperation => ({ ...base(id), kind: "create", input: creation(id), localGroupId: `local-${uuid(id)}`, localWorkId: `local-${uuid(id)}` });
const deployment = () => new ApiError(503, "MOBILE_SYNC_ACTIONS_UNAVAILABLE", "Deployment required");
const settle = async () => { for (let i = 0; i < 2_000; i++) await Promise.resolve(); };
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
}

function nativeFiles(storage: DurableStore, contents: Map<string, Uint8Array>): DurableFileStore {
  class Directory {
    readonly uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create(): void {}
  }
  class File {
    readonly uri: string;
    constructor(parent: string | Directory, name?: string) { this.uri = typeof parent === "string" ? parent : `${parent.uri}/${name}`; }
    get exists(): boolean { return contents.has(this.uri); }
    get size(): number { return contents.get(this.uri)?.length ?? 0; }
    async bytes(): Promise<Uint8Array> { const bytes = contents.get(this.uri); assert.ok(bytes); return bytes.slice(); }
    async copy(target: File): Promise<void> { contents.set(target.uri, await this.bytes()); }
    delete(): void { contents.delete(this.uri); }
  }
  const exports: { NativeDurableFileStore?: new (store: DurableStore) => DurableFileStore } = {};
  const module = { exports };
  runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../FileStore.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports, Uint8Array,
    require: (id: string): unknown => {
      if (id === "expo-file-system") return { File, Directory, Paths: { document: "file:///sandbox" } };
      if (id === "expo-crypto") return { randomUUID: () => uuid(500), CryptoDigestAlgorithm: { SHA256: "SHA-256" },
        digest: async (_algorithm: string, data: Uint8Array) => Uint8Array.from(createHash("sha256").update(data).digest()).buffer };
      if (id === "../domain/offline") return { OfflineUnavailableError };
      if (id === "./state") return { updateState, validateQuota };
      throw new Error(`UNEXPECTED_NATIVE_IMPORT:${id}`);
    },
  });
  assert.ok(module.exports.NativeDurableFileStore);
  return new module.exports.NativeDurableFileStore(storage);
}

for (const platform of ["memory", "native"] as const) test(`${platform}: unsupported first timer isolates actions, legacy writes apply this cycle and restart drains unchanged chain automatically`, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 17, 29]);
  const source = "file:///sandbox/proof.png";
  const contents = new Map([[source, bytes]]);
  f.files.sources.set(source, bytes);
  const fileStore = platform === "native" ? nativeFiles(f.store, contents) : f.files;
  f.dependencies.fileStore = fileStore;
  const file = await fileStore.own("a", { id: "photo", uri: source, name: "proof.png", mimeType: "image/png" });
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(file.sha256, hash);
  const answer = syncAnswerSchema.parse({ responseValue: "Original answer" });
  const original: OfflineOperation[] = [timer(1), timer(2, uuid(1)), checklist(3), { ...comment(4), dependencyId: uuid(2) }, comment(10),
    { ...base(11), kind: "answer", scope, stepId: "9", answer, base: answer, wire: { answer, base: answer } },
    { ...base(12), kind: "document", scope, file }];
  await updateState(f.store, "a", (state) => { state.operations = original; });
  let upgraded = false;
  const sent: OfflineCommand[] = [];
  const receipt = f.upstream.offlineCommand.bind(f.upstream);
  f.upstream.offlineCommand = async (command) => {
    sent.push(structuredClone(command));
    if (!upgraded && (command.kind === "timer" || command.kind === "checklist")) throw deployment();
    return receipt(command);
  };
  const upload = f.upstream.offlineDocument.bind(f.upstream);
  let fingerprints = 0;
  const fingerprint = fileStore.fingerprint!.bind(fileStore);
  fileStore.fingerprint = async (photo) => { fingerprints++; return fingerprint(photo); };
  f.dependencies.upstream.offlineDocument = async (metadata, photo) => {
    assert.equal(metadata.sha256, hash);
    assert.equal((await fingerprint(photo))?.sha256, hash);
    return upload(metadata);
  };
  const engine = new OfflineEngine(f.dependencies);
  engine.start(); t.mock.timers.tick(0); await settle();
  assert.deepEqual(sent.map((command) => command.operationId), [uuid(1), uuid(10), uuid(11)]);
  assert.equal(f.upstream.documents.length, 1); assert.equal(fingerprints, 1);
  assert.deepEqual(engine.getSnapshot().operations.map((operation) => operation.status), ["pending", "pending", "pending", "pending", "applied", "applied", "applied"]);
  assert.equal(engine.getSnapshot().operations[0]!.nextAttemptAt, 61_000);
  assert.equal(engine.getSnapshot().operations[1]!.attempts, 0);
  assert.deepEqual(engine.getSnapshot().awaitingDeploymentByKind, { timer: 2, checklist: 1, comment: 1, answer: 0, document: 0, create: 0 });
  assert.equal(engine.getSnapshot().connection?.status, "service_error");
  assert.equal(engine.getSnapshot().connection?.errorCode, "MOBILE_SYNC_ACTIONS_UNAVAILABLE");
  assert.ok(engine.getSnapshot().operations[6]!.receipt?.fileId);
  const beforeRestart = (await f.store.read("a")).operations;
  engine.stop();
  const restored = new OfflineEngine(f.dependencies); t.after(() => restored.stop());
  restored.start(); t.mock.timers.tick(0); await settle();
  assert.deepEqual((await f.store.read("a")).operations, beforeRestart);
  const probes = f.upstream.verifyCount;
  f.advance(59_999); t.mock.timers.tick(59_999); await settle();
  assert.equal(f.upstream.verifyCount, probes); assert.equal(sent.length, 3);
  upgraded = true; f.advance(1); t.mock.timers.tick(1); await settle();
  assert.deepEqual(sent.slice(3).map((command) => command.operationId), [uuid(1), uuid(2), uuid(3), uuid(4)]);
  assert.deepEqual(sent[3], sent[0]);
  assert.deepEqual(sent[4], { kind: "timer", scope, operationId: uuid(2), payload: { status: "paused", baseStatus: "in_progress" } });
  assert.equal(restored.getSnapshot().pending, 0); assert.equal(restored.getSnapshot().online, true);
  const applied = (await f.store.read("a")).operations;
  assert.deepEqual(applied.map((operation) => [operation.id, operation.createdAt, operation.dependencyId]), original.map((operation) => [operation.id, operation.createdAt, operation.dependencyId]));
  assert.equal(f.upstream.documents.length, 1); assert.equal(fingerprints, 1);
  assert.equal((await fileStore.fingerprint!({ ...file, uri: await fileStore.resolveURI(file) }))?.sha256, hash);
});

test("automatic bounded batches drain independent writes then an upgraded chain longer than cycleOperations without manual sync or busy polling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); let upgraded = false;
  const chainLength = OFFLINE_LIMITS.cycleOperations * 2 + 5;
  const chain = Array.from({ length: chainLength }, (_, index) => timer(index + 1, index ? uuid(index) : undefined));
  const comments = Array.from({ length: chainLength }, (_, index) => comment(index + 200));
  await updateState(f.store, "a", (state) => { state.operations = [...chain, ...comments]; });
  const send = f.upstream.offlineCommand.bind(f.upstream);
  const attempts: OfflineCommand[] = [];
  f.upstream.offlineCommand = async (command) => {
    attempts.push(structuredClone(command));
    if (!upgraded && command.kind === "timer") throw deployment();
    return send(command);
  };
  const engine = new OfflineEngine(f.dependencies); t.after(() => engine.stop());
  engine.start(); t.mock.timers.tick(0); await settle();
  assert.equal(attempts.length, OFFLINE_LIMITS.cycleOperations);
  for (let batch = 0; batch < 2; batch++) { f.advance(2_000); t.mock.timers.tick(2_000); await settle(); }
  assert.equal(engine.getSnapshot().pending, chainLength);
  assert.equal(attempts.filter((command) => command.kind === "timer").length, 1);
  const probes = f.upstream.verifyCount;
  f.advance(55_999); t.mock.timers.tick(55_999); await settle();
  assert.equal(f.upstream.verifyCount, probes);
  upgraded = true; f.advance(1); t.mock.timers.tick(1); await settle();
  assert.equal(engine.getSnapshot().pending, chainLength - OFFLINE_LIMITS.cycleOperations);
  for (let batch = 0; batch < 2; batch++) { f.advance(2_000); t.mock.timers.tick(2_000); await settle(); }
  assert.equal(engine.getSnapshot().pending, 0);
  assert.deepEqual(f.upstream.commands.filter((command) => command.kind === "timer").map((command) => command.operationId), chain.map((operation) => operation.id));
  assert.deepEqual(attempts[0], attempts.find((command, index) => index > 0 && command.operationId === uuid(1)));
});

test("creation schema gates only create and dependents, never independent legacy operations", async () => {
  const f = fixture();
  f.upstream.sendError = undefined;
  f.upstream.createRecord = async (input) => { f.upstream.creates.push(input); throw new ApiError(409, "MOBILE_CREATION_SCHEMA_NOT_READY", "Deployment"); };
  await updateState(f.store, "a", (state) => { state.operations = [create(1), { ...comment(2), dependencyId: uuid(1) }, create(3), comment(4)]; });
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  assert.equal(f.upstream.creates.length, 1);
  assert.deepEqual(f.upstream.commands.map((command) => command.operationId), [uuid(4)]);
  assert.deepEqual(engine.getSnapshot().awaitingDeploymentByKind, { create: 2, comment: 1, answer: 0, document: 0, timer: 0, checklist: 0 });
});

for (const error of [new NetworkError("network"), new ApiError(500, "UPSTREAM_UNAVAILABLE", "Failure"),
  new ApiError(503, "UNKNOWN_ACTION_FAILURE", "Failure"), new ApiError(503, "MOBILE_SYNC_SCHEMA_NOT_READY", "Deployment"),
  new ApiError(404, "OFFLINE_SYNC_ROUTE_NOT_FOUND", "Route"), new ApiError(401, "UNAUTHORIZED", "Auth")]) {
  test(`${error instanceof ApiError ? error.code : "network"} remains a conservative global cycle stop`, async () => {
    const f = fixture(); f.upstream.sendError = error;
    await updateState(f.store, "a", (state) => { state.operations = [timer(1), comment(2)]; });
    const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
    assert.equal(f.upstream.commands.length, 1);
    assert.equal(engine.getSnapshot().operations[1]!.attempts, 0);
    if (error instanceof ApiError && error.status === 401) assert.equal(engine.getSnapshot().authBlocked, true);
  });
}

test("an actions-unavailable code on a legacy operation is not evidence that other action routes work", async () => {
  const f = fixture(); f.upstream.sendError = deployment();
  await updateState(f.store, "a", (state) => { state.operations = [comment(1), comment(2)]; });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(f.upstream.commands.length, 1);
});

test("manual deployment retry uses the local clock once per 30s, preserves attempts and drains after upgrade", async () => {
  const f = fixture(); f.upstream.sendError = deployment();
  f.store.conflicts = 2;
  await updateState(f.store, "a", (state) => { state.operations = [{ ...timer(1), attempts: 9, nextAttemptAt: 301_000, lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" }, timer(2, uuid(1))]; });
  const engine = new OfflineEngine(f.dependencies);
  const first = engine.requestSync(); assert.equal(engine.requestSync(), first); await first;
  assert.equal(f.upstream.commands.length, 1); assert.equal(engine.getSnapshot().operations[0]!.attempts, 10);
  await engine.requestSync(); f.advance(29_999); await engine.requestSync();
  assert.equal(f.upstream.commands.length, 1);
  f.upstream.sendError = undefined; f.advance(1); await engine.requestSync();
  assert.equal(engine.getSnapshot().pending, 0);
  assert.deepEqual(f.upstream.commands[0], f.upstream.commands[1]);
  assert.equal(engine.getSnapshot().operations[0]!.attempts, 11);
  assert.equal(engine.getSnapshot().operations[1]!.attempts, 1);
});

test("manual request during an active send latches exactly one pass after release without a concurrent retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const gate = deferred(); let entered = false;
  await updateState(f.store, "a", (state) => { state.operations = [timer(1), timer(2, uuid(1)), comment(3)]; });
  const send = f.upstream.offlineCommand.bind(f.upstream); let timerCalls = 0;
  f.upstream.offlineCommand = async (command) => {
    if (command.kind === "timer" && ++timerCalls === 1) { entered = true; await gate.promise; throw deployment(); }
    return send(command);
  };
  const engine = new OfflineEngine(f.dependencies); t.after(() => engine.stop());
  engine.start(); t.mock.timers.tick(0); await settle(); assert.equal(entered, true);
  const current = engine.syncNow(); const requested = engine.requestSync();
  assert.equal(engine.requestSync(), requested); assert.equal(engine.syncNow(), current);
  const during = (await f.store.read("a")).operations[0]!;
  assert.equal(during.status, "syncing"); assert.equal(during.attempts, 1);
  t.mock.timers.tick(0); await settle(); assert.equal(timerCalls, 1); assert.equal(f.upstream.verifyCount, 1);
  gate.release(); await requested;
  assert.equal(timerCalls, 3); assert.equal(f.upstream.verifyCount, 2);
  assert.equal(engine.getSnapshot().pending, 0);
  t.mock.timers.tick(0); await settle(); assert.equal(f.upstream.verifyCount, 2);
});

for (const code of ["OFFLINE_NETWORK_UNAVAILABLE", "OFFLINE_TIMEOUT_UNCERTAIN", "OFFLINE_CYCLE_INTERRUPTED"]) test(`manual safely advances known transport wait ${code}`, async () => {
  const f = fixture();
  await updateState(f.store, "a", (state) => { state.operations = [{ ...comment(1), attempts: 7, nextAttemptAt: 301_000, lastError: code }]; });
  const engine = new OfflineEngine(f.dependencies); await engine.requestSync();
  assert.equal(engine.getSnapshot().operations[0]!.attempts, 8); assert.equal(f.upstream.commands.length, 1);
});

for (const [status, code] of [[429, "RATE_LIMITED"], [409, "MOBILE_SYNC_IN_PROGRESS"]] as const) test(`manual never resets ${code} or terminal receipts`, async () => {
  const f = fixture(); f.upstream.sendError = new ApiError(status, code, "Wait");
  const held: OfflineOperation = { ...comment(3), status: "needs_review", lastError: "MOBILE_SYNC_OPERATION_REUSED", attempts: 2,
    receipt: { operationId: uuid(3), state: "needs_review", error: "MOBILE_SYNC_OPERATION_REUSED" } };
  await updateState(f.store, "a", (state) => { state.operations = [timer(1), { ...comment(2), dependencyId: uuid(1) }, held]; });
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  const before = (await f.store.read("a")).operations;
  f.upstream.sendError = undefined; await engine.requestSync();
  assert.deepEqual((await f.store.read("a")).operations, before);
  assert.equal(f.upstream.commands.length, 1);
});

test("manual cannot change a foreign lease or its syncing operation", async () => {
  const f = fixture();
  await updateState(f.store, "a", (state) => {
    state.lease = { owner: "other-engine", until: 100_000 };
    state.operations = [{ ...timer(1), status: "syncing", attempts: 4, nextAttemptAt: 61_000, lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" },
      { ...comment(2), nextAttemptAt: 61_000, lastError: "OFFLINE_NETWORK_UNAVAILABLE" }];
  });
  const before = await f.store.read("a");
  const engine = new OfflineEngine(f.dependencies); await engine.requestSync();
  const after = await f.store.read("a");
  assert.deepEqual(after.operations, before.operations); assert.deepEqual(after.lease, before.lease);
  assert.equal(f.upstream.verifyCount, 0); assert.equal(f.upstream.commands.length, 0);
});

test("enqueue and foreground wakes during a busy cycle preserve automatic legacy batching and deployment deadlines", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const gate = deferred();
  await updateState(f.store, "a", (state) => { state.operations = [{ ...timer(1), attempts: 1, nextAttemptAt: 61_000, lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" }]; });
  f.upstream.duringVerify = () => gate.promise;
  const engine = new OfflineEngine(f.dependencies); t.after(() => engine.stop());
  engine.start(); t.mock.timers.tick(0); await settle();
  engine.setForeground(false); engine.setForeground(true); t.mock.timers.tick(0);
  await engine.enqueue([comment(2)]); t.mock.timers.tick(0);
  f.upstream.duringVerify = undefined; gate.release(); await settle();
  t.mock.timers.tick(0); await settle();
  assert.deepEqual(f.upstream.commands.map((command) => command.operationId), [uuid(2)]);
  assert.equal(engine.getSnapshot().operations[0]!.nextAttemptAt, 61_000);
  assert.equal(engine.getSnapshot().operations[0]!.attempts, 1);
});

test("terminal action receipts never become deployment retries or unblock their children", async () => {
  const f = fixture();
  const rejected: OfflineReceipt = { operationId: uuid(1), state: "rejected", error: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" };
  f.upstream.receipts.set(uuid(1), rejected);
  await updateState(f.store, "a", (state) => { state.operations = [timer(1), timer(2, uuid(1)), comment(3)]; });
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  const held = (await f.store.read("a")).operations[0];
  await engine.requestSync(); f.advance(300_000); await new OfflineEngine(f.dependencies).requestSync();
  assert.deepEqual((await f.store.read("a")).operations[0], held);
  assert.equal((await f.store.read("a")).operations[1]!.attempts, 0);
  assert.deepEqual(f.upstream.commands.map((command) => command.operationId), [uuid(3)]);
  assert.equal(engine.getSnapshot().awaitingDeploymentByKind?.timer, 0);
});

test("repository requestSync forwards the coalesced engine promise without changing automatic syncNow", async () => {
  const f = fixture();
  const unused = async (): Promise<never> => { throw new Error("UNEXPECTED_REMOTE_CALL"); };
  const remote: TechnicianRepository = {
    me: () => f.upstream.me(), createRecord: (input) => f.upstream.createRecord(input), assignments: unused,
    files: unused, comments: unused, creationOptions: unused, health: unused, login: unused, logout: unused, forcePassword: unused,
    notificationStatus: unused, notificationInbox: unused, registerNotificationDevice: unused, unregisterNotificationDevice: unused,
    readNotification: unused, deleteNotification: unused, testNotification: unused, status: unused, answer: unused, stepFiles: unused,
    upload: unused, report: unused, addComment: unused, uploadDocuments: unused, deleteFile: unused, groupFiles: unused,
    uploadGroupFiles: unused, deleteGroupFile: unused, orderDelivery: unused, startOrder: unused, deliverOrder: unused,
  };
  const tenant = f.dependencies.user.tenant;
  assert.ok(tenant);
  const repository = new OfflineTechnicianRepository(remote, { token: "test-only", user: f.dependencies.user, tenant, branchId: 1, mode: "live" }, f.dependencies);
  const gate = deferred(); f.upstream.duringVerify = () => gate.promise;
  const requested = repository.requestSync();
  assert.equal(repository.requestSync(), requested); assert.equal(repository.engine.requestSync(), requested);
  assert.equal(repository.syncNow(), repository.engine.syncNow());
  gate.release(); await requested;
  assert.equal(f.upstream.verifyCount, 1);
});