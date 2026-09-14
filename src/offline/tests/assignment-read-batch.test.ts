/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { HttpTechnicianRepository } from "../../infrastructure/HttpTechnicianRepository";
import type { OfflineTechnicianRepository } from "../OfflineTechnicianRepository";
import type * as BatchModule from "../../infrastructure/assignmentReadBatch";
import { AssignmentReadCancelledError } from "../../domain/assignmentRead";
import { dailyRange } from "../../domain/assignmentSchedule";
import type { Assignments, Session } from "../../domain/models";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { canUseCache } from "../engine";
import { updateState } from "../state";
import { assignmentsWithStep, creation, fixture, user } from "./fakes";

const week = { startDate: "2026-09-08", endDate: "2026-09-14" };
const day = dailyRange(week.startDate);
const previousMissingDates = ["2026-09-01"];
const flush = () => new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => { resolvePromise = resolveValue; rejectPromise = rejectValue; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

class Clock {
  now = 0;
  sequence = 0;
  timers = new Map<number, { due: number; callback: () => void }>();
  delays: number[] = [];
  setTimeout = (callback: () => void, delay: number): number => {
    this.delays.push(delay);
    const id = ++this.sequence;
    this.timers.set(id, { due: this.now + delay, callback });
    return id;
  };
  clearTimeout = (id: number): void => { this.timers.delete(id); };
  tick(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.due <= this.now && this.timers.delete(id)) timer.callback();
    }
  }
}

interface SourceExports {
  HttpTechnicianRepository?: typeof HttpTechnicianRepository;
  OfflineTechnicianRepository?: typeof OfflineTechnicianRepository;
  AssignmentReadBatch?: typeof BatchModule.AssignmentReadBatch;
  withAssignmentReadBatch?: typeof BatchModule.withAssignmentReadBatch;
  ASSIGNMENT_READ_TIMEOUT_MS?: number;
}
function load(relative: string, clock: Clock, mocks: (id: string) => unknown): SourceExports {
  const path = resolve(__dirname, relative);
  const requireSource = createRequire(path);
  const exports: SourceExports = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, module: { exports }, FormData, Blob, AbortController, Error, TypeError, URLSearchParams,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    require: (id: string): unknown => mocks(id) ?? requireSource(id),
  });
  return exports;
}
interface Request {
  url: string;
  init: RequestInit;
}
function harness(reply: (request: Request) => Promise<Response>) {
  const clock = new Clock();
  const batch = load("../../infrastructure/assignmentReadBatch.ts", clock, () => undefined);
  const requests: Request[] = [];
  const http = load("../../infrastructure/HttpTechnicianRepository.ts", clock, (id) => {
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "./assignmentReadBatch") return batch;
    if (id === "./photos") return {
      appendPhoto: async (body: FormData) => { body.append("files", new Blob(["fixture"]), "fixture.png"); },
      uploadFetch: (url: string, init: RequestInit) => { const request = { url, init }; requests.push(request); return reply(request); },
    };
    return undefined;
  });
  const offline = load("../OfflineTechnicianRepository.ts", clock, (id) => id === "../infrastructure/assignmentReadBatch" ? batch : undefined);
  assert.ok(http.HttpTechnicianRepository); assert.ok(offline.OfflineTechnicianRepository);
  const remote = new http.HttpTechnicianRepository("https://fixture.invalid");
  remote.tenant = user.tenant;
  const f = fixture();
  const session: Session = { token: "fixture-only", tenant: user.tenant!, user, branchId: 1, mode: "live" };
  const dependencies = { ...f.dependencies, upstream: remote };
  const repository = new offline.OfflineTechnicianRepository(remote, session, dependencies);
  repository.engine.setMissingDates(previousMissingDates);
  return { ...f, dependencies, clock, batch, remote, repository, requests };
}
const cancelled = (error: unknown): boolean => error instanceof AssignmentReadCancelledError && error.name === "AbortError" && !canUseCache(error);
const timedOut = (error: unknown): boolean => error instanceof NetworkError && error.kind === "timeout";
function remember(f: ReturnType<typeof harness>, data = assignmentsWithStep()) {
  return updateState(f.store, "a", (state) => {
    state.cache.push({ key: `assignments:${week.startDate}`, json: JSON.stringify(data), fetchedAt: 1000, coverage: { date: week.startDate, branchId: 1, fetchedAt: 1000 } });
  });
}

for (const wrapper of [false, true]) test(`${wrapper ? "offline + HTTP" : "HTTP"}: seven days use exactly two simultaneous reads`, async () => {
  const pending: Array<ReturnType<typeof deferred<Response>>> = [];
  const f = harness(async () => { const response = deferred<Response>(); pending.push(response); return response.promise; });
  const client = wrapper ? f.repository : f.remote;
  const result = client.assignments(week, 1);
  await flush(); assert.equal(f.requests.length, 2);
  for (let start = 0; start < 7; start += 2) {
    assert.equal(pending.length, Math.min(start + 2, 7));
    for (const response of pending.slice(start, start + 2)) response.resolve(Response.json(assignmentsWithStep()));
    await flush();
  }
  const value = await result;
  assert.ok(value.groups.length > 0);
  assert.equal(new Set(f.requests.map((request) => new URL(request.url).searchParams.get("startDate"))).size, 7);
  assert.ok(f.requests.every((request) => request.init.method === "GET"));
  assert.equal(f.clock.timers.size, 0);
});

for (const wrapper of [false, true]) test(`${wrapper ? "offline + HTTP" : "HTTP"}: total deadline is 45000, not seven per-request deadlines`, async () => {
  const pending: Array<ReturnType<typeof deferred<Response>>> = [];
  const f = harness(async () => { const response = deferred<Response>(); pending.push(response); return response.promise; });
  await remember(f);
  let succeeded = false;
  const result = (wrapper ? f.repository : f.remote).assignments(week, 1).then((value) => { succeeded = true; return value; });
  const rejected = assert.rejects(result, timedOut);
  await flush(); f.clock.tick(30_000);
  pending[0]!.resolve(Response.json(assignmentsWithStep())); pending[1]!.resolve(Response.json(assignmentsWithStep()));
  await flush(); assert.equal(f.requests.length, 4);
  f.clock.tick(14_999); await flush(); assert.equal(succeeded, false);
  f.clock.tick(1); await rejected;
  assert.equal(f.batch.ASSIGNMENT_READ_TIMEOUT_MS, 45_000);
  assert.ok(f.requests.slice(2).every((request) => request.init.signal?.aborted));
  for (const response of pending.slice(2)) response.resolve(Response.json(assignmentsWithStep()));
  await flush(); assert.equal(f.requests.length, 4); assert.equal(succeeded, false);
  assert.deepEqual(f.repository.getSnapshot().missingDates, previousMissingDates);
  assert.equal(f.clock.timers.size, 0);
});

test("caller abort rejects immediately, never consumes cache, and ignores non-cooperative late HTTP", async () => {
  const response = deferred<Response>();
  const f = harness(() => response.promise); await remember(f);
  const controller = new AbortController();
  let published = false;
  const result = f.repository.assignments(week, 1, { signal: controller.signal }).then(() => { published = true; });
  const rejected = assert.rejects(result, cancelled);
  await flush(); controller.abort(); await rejected;
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every((request) => request.init.signal?.aborted));
  response.resolve(Response.json(assignmentsWithStep())); await flush();
  assert.equal(published, false); assert.equal(f.requests.length, 2);
  assert.equal((await f.store.read("a")).cache.length, 1);
  assert.equal(f.clock.timers.size, 0);
});

test("already aborted legacy-compatible third argument starts no store or HTTP read", async () => {
  const f = harness(async () => Response.json(assignmentsWithStep()));
  f.store.read = async () => { throw new Error("STORE_MUST_NOT_RUN"); };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.repository.assignments(week, 1, { signal: controller.signal }), cancelled);
  await assert.rejects(f.remote.assignments(week, 1, { signal: controller.signal }), cancelled);
  assert.equal(f.requests.length, 0); assert.equal(f.clock.timers.size, 0);
});

for (const stage of ["store", "connectivity", "body", "cache write", "local permission"] as const) test(`deadline includes stalled ${stage} and does not resume day launches`, async () => {
  const gate = deferred<void>();
  const f = harness(async () => {
    const response = Response.json(assignmentsWithStep());
    if (stage === "body") response.text = async () => { await gate.promise; return JSON.stringify(assignmentsWithStep()); };
    return response;
  });
  if (stage === "store") {
    const read = f.store.read.bind(f.store);
    f.store.read = async (namespace) => { await gate.promise; return read(namespace); };
  }
  if (stage === "connectivity") f.dependencies.connectivity.current = async () => { await gate.promise; return true; };
  if (stage === "local permission") f.dependencies.canAccessLocal = async () => { await gate.promise; return true; };
  if (stage === "cache write") {
    const save = f.store.compareAndSwap.bind(f.store);
    f.store.compareAndSwap = async (...args) => { await gate.promise; return save(...args); };
  }
  const result = f.repository.assignments(week, 1);
  const rejected = assert.rejects(result, timedOut);
  await flush(); const count = f.requests.length;
  f.clock.tick(45_000); await rejected;
  gate.resolve(); await flush(); assert.equal(f.requests.length, count);
  assert.deepEqual(f.repository.getSnapshot().missingDates, previousMissingDates);
  assert.equal(f.clock.timers.size, 0);
});

for (const status of [401, 403]) test(`HTTP ${status} rejects whole cached week, aborts peer and never publishes partial authorization`, async () => {
  const response = deferred<Response>();
  let index = 0;
  const f = harness(async () => ++index === 1 ? Response.json({ error: "DENIED" }, { status }) : response.promise);
  await remember(f);
  let unauthorized = 0;
  f.remote.onUnauthorized = () => { unauthorized++; };
  await assert.rejects(f.repository.assignments(week, 1), (error: unknown) => error instanceof ApiError && error.status === status);
  await flush();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1]?.init.signal?.aborted, true);
  assert.equal(unauthorized, status === 401 ? 1 : 0);
  response.resolve(Response.json(assignmentsWithStep())); await flush();
  const state = await f.store.read("a");
  if (status === 401) assert.equal(state.authBlocked, true);
  else assert.equal(state.revokedResources[0]?.status, 403);
  assert.ok(!state.cache.some((entry) => entry.key === "assignments:2026-09-09"));
  assert.deepEqual(f.repository.getSnapshot().missingDates, previousMissingDates);
});

test("401 remains the failure even when persisting the auth block stalls", async () => {
  const f = harness(async () => Response.json({ error: "UNAUTHORIZED" }, { status: 401 }));
  const gate = deferred<boolean>();
  f.store.compareAndSwap = () => gate.promise;
  await assert.rejects(f.repository.assignments(week, 1), (error: unknown) => error instanceof ApiError && error.status === 401);
  gate.reject(new Error("DISK_FAILED")); await flush();
  assert.equal(f.clock.timers.size, 0);
});

for (const payload of [null, {}, { groups: [] }, { ...assignmentsWithStep(), groups: null }]) test("invalid HTTP schema cannot become cached success", async () => {
  const f = harness(async () => Response.json(payload)); await remember(f);
  await assert.rejects(f.repository.assignments(week, 1), (error: unknown) => error instanceof ApiError && error.code === "UPSTREAM_INVALID_RESPONSE");
  assert.ok(f.requests.length <= 2);
});

test("daily network timeout fallback preserves cache holes and local creations", async () => {
  const f = harness(async () => { throw new NetworkError("timeout"); }); await remember(f);
  await updateState(f.store, "a", (state) => {
    const input = creation(); input.schedule.date = "2026-09-10";
    state.operations.push({ id: input.clientRequestId, kind: "create", input, localGroupId: "local-test", localWorkId: "local-test", status: "pending", createdAt: 1000, attempts: 0, nextAttemptAt: 0 });
  });
  const data = await f.repository.assignments(week, 1);
  assert.ok(data.groups.some((group) => group.id === "local-test"));
  assert.deepEqual(f.repository.getSnapshot().missingDates, ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]);
  assert.equal(f.requests.length, 7);
});

test("late old read cannot replace a fresher post-mutation snapshot and overlapping calls are independently owned", async () => {
  const old = deferred<Response>(); let calls = 0;
  const fresh = assignmentsWithStep(); fresh.generatedAt = "2026-09-08T10:00:00Z";
  fresh.groups[0]!.works[0]!.checklists[0]!.steps[0]!.responseValue = "saved";
  const f = harness(async () => ++calls === 1 ? old.promise : Response.json(fresh));
  const first = f.repository.assignments(day, 1); await flush();
  await f.repository.assignments(day, 1);
  old.resolve(Response.json(assignmentsWithStep()));
  assert.equal((await first).generatedAt, fresh.generatedAt);
  const cached: Assignments = JSON.parse((await f.store.read("a")).cache[0]!.json);
  assert.equal(cached.groups[0]!.works[0]!.checklists[0]!.steps[0]!.responseValue, "saved");
  assert.equal(calls, 2);
});

test("cancelling one overlapping call neither cancels nor reuses another call", async () => {
  const first = deferred<Response>(); let calls = 0;
  const f = harness(async () => ++calls === 1 ? first.promise : Response.json(assignmentsWithStep()));
  const controller = new AbortController();
  const old = f.repository.assignments(day, 1, { signal: controller.signal });
  const rejected = assert.rejects(old, cancelled); await flush();
  const current = f.repository.assignments(day, 1); controller.abort();
  await rejected; assert.ok((await current).groups.length > 0);
  first.resolve(Response.json(assignmentsWithStep())); await flush(); assert.equal(calls, 2);
});

test("assignment cancellation leaves mutations and receipt requests independent with original timeout", async () => {
  const assignment = deferred<Response>(); const mutation = deferred<Response>(); const receipt = deferred<Response>();
  const f = harness((request) => request.url.includes("/status?") ? mutation.promise : request.url.includes("/receipts/") ? receipt.promise : assignment.promise);
  const controller = new AbortController();
  const read = f.remote.assignments(day, 1, { signal: controller.signal });
  const rejected = assert.rejects(read, cancelled);
  const write = f.remote.status({ ...day, companyBranchId: 1, groupId: "direct-80", workId: "80" }, { status: "delivered" });
  const operationId = "00000000-0000-4000-8000-000000000001";
  const receiptRead = f.remote.offlineReceipt(operationId, 1);
  await flush(); controller.abort(); await rejected;
  assert.equal(f.requests[1]?.init.signal?.aborted, false); assert.equal(f.requests[2]?.init.signal?.aborted, false);
  assert.ok(f.clock.delays.every((delay) => delay === 45_000));
  mutation.resolve(new Response(null, { status: 204 }));
  receipt.resolve(Response.json({ operationId, state: "applied" }));
  await write; assert.equal((await receiptRead)?.state, "applied");
  assignment.resolve(Response.json(assignmentsWithStep())); await flush(); assert.equal(f.clock.timers.size, 0);
});

test("FormData upload retains its 150-second deadline and is not cancelled with an assignment read", async () => {
  const assignment = deferred<Response>(); const upload = deferred<Response>();
  const f = harness((request) => request.init.body instanceof FormData ? upload.promise : assignment.promise);
  const controller = new AbortController();
  const read = f.remote.assignments(day, 1, { signal: controller.signal });
  const rejected = assert.rejects(read, cancelled);
  const write = f.remote.upload({ ...day, companyBranchId: 1, groupId: "direct-80", workId: "80" }, [{ id: "fixture-photo", uri: "fixture:", name: "fixture.png", mimeType: "image/png" }]);
  await flush(); controller.abort(); await rejected;
  const request = f.requests.find((entry) => entry.init.body instanceof FormData);
  assert.ok(request); assert.equal(request.init.signal?.aborted, false);
  assert.equal(f.clock.delays.filter((delay) => delay === 150_000).length, 1);
  f.clock.tick(45_000); assert.equal(request.init.signal?.aborted, false);
  upload.resolve(new Response(null, { status: 204 })); await write;
  assignment.resolve(Response.json(assignmentsWithStep())); await flush(); assert.equal(f.clock.timers.size, 0);
});

for (const stage of ["store", "body", "cache write"] as const) test(`caller abort while awaiting ${stage} settles without a timeout or late successful result`, async () => {
  const gate = deferred<void>();
  const f = harness(async () => {
    const response = Response.json(assignmentsWithStep());
    if (stage === "body") response.text = async () => { await gate.promise; return JSON.stringify(assignmentsWithStep()); };
    return response;
  });
  if (stage === "store") {
    const read = f.store.read.bind(f.store);
    f.store.read = async (namespace) => { await gate.promise; return read(namespace); };
  }
  if (stage === "cache write") {
    const save = f.store.compareAndSwap.bind(f.store);
    f.store.compareAndSwap = async (...args) => { await gate.promise; return save(...args); };
  }
  const controller = new AbortController();
  const rejected = assert.rejects(f.repository.assignments(week, 1, { signal: controller.signal }), cancelled);
  await flush(); const count = f.requests.length;
  controller.abort(); await rejected;
  gate.resolve(); await flush(); assert.equal(f.requests.length, count);
  assert.deepEqual(f.repository.getSnapshot().missingDates, previousMissingDates);
  assert.equal(f.clock.timers.size, 0);
});

test("an auth change while cache persistence is pending prevents a late cache commit or result", async () => {
  const gate = deferred<void>();
  const f = harness(async () => Response.json(assignmentsWithStep()));
  const save = f.store.compareAndSwap.bind(f.store);
  f.store.compareAndSwap = async (...args) => {
    if (!args[2].authBlocked) await gate.promise;
    return save(...args);
  };
  const rejected = assert.rejects(f.repository.assignments(day, 1), /OFFLINE_AUTH_REQUIRED/);
  await flush(); await f.repository.engine.blockAuth();
  gate.resolve(); await rejected;
  assert.equal((await f.store.read("a")).cache.length, 0);
  assert.equal(f.repository.getSnapshot().authBlocked, true);
});

test("invalid JSON and unsupported checklist schemas reject instead of using valid cache", async () => {
  for (const response of [new Response("{broken", { status: 200 }), Response.json(JSON.parse(JSON.stringify(assignmentsWithStep()).replace('"type":"text"', '"type":"unknown"')))]) {
    const f = harness(async () => response.clone()); await remember(f);
    await assert.rejects(f.repository.assignments(week, 1), (error: unknown) => error instanceof ApiError && error.code === "UPSTREAM_INVALID_RESPONSE");
    assert.ok(f.requests.length <= 2);
  }
});

test("403 after one successful daily snapshot still rejects the entire range", async () => {
  const denied = deferred<Response>(); let calls = 0;
  const f = harness(async () => ++calls === 1 ? Response.json(assignmentsWithStep()) : denied.promise);
  const rejected = assert.rejects(f.repository.assignments(week, 1), (error: unknown) => error instanceof ApiError && error.status === 403);
  await flush(); assert.ok((await f.store.read("a")).cache.length > 0);
  denied.resolve(Response.json({ error: "DENIED" }, { status: 403 })); await rejected;
  assert.deepEqual(f.repository.getSnapshot().missingDates, previousMissingDates);
});