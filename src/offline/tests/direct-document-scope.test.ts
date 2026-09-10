import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { CreationKind } from "../../domain/creation";
import type { LocalPhoto } from "../../domain/models";
import { OfflineUnavailableError, type OfflineOperation, type OfflineScope } from "../../domain/offline";
import { syncDocumentSchema, type SyncDocument, type SyncReceipt } from "../../domain/offlineProtocol";
import type { HttpTechnicianRepository } from "../../infrastructure/HttpTechnicianRepository";
import { resourceCacheKey, sameResource } from "../cacheSchemas";
import { OfflineEngine, resolveDocumentScope, resolveScope } from "../engine";
import { OfflineTechnicianRepository } from "../OfflineTechnicianRepository";
import { updateState } from "../state";
import { creation, fixture, result, uuid } from "./fakes";

type Document = Extract<OfflineOperation, { kind: "document" }>;
type Parent = Extract<OfflineOperation, { kind: "create" }>;
const bytes = new Uint8Array([0, 1, 2, 128, 255]);
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const legacyCode = "OFFLINE_DOCUMENT_UNEXPECTED_ERROR";
const rootScope = (groupId: string): OfflineScope => ({ companyBranchId: 1, groupId, startDate: "2026-09-08", endDate: "2026-09-08" });

function readableFormData(form: unknown): form is { keys(): IterableIterator<string>; get(name: string): FormDataEntryValue | null } {
  return typeof form === "object" && form !== null && "get" in form && typeof form.get === "function" && "keys" in form && typeof form.keys === "function";
}

function parent(kind: CreationKind = "work"): Parent {
  const common = creation();
  const input = kind === "work" ? common : kind === "non_productive"
    ? { kind, companyBranchId: 1, clientRequestId: common.clientRequestId, schedule: common.schedule, nonProductive: { reason: "training" as const } }
    : { kind, companyBranchId: 1, clientRequestId: common.clientRequestId, schedule: common.schedule, maintenance: { type: "correctivo" as const, title: "Fixture", motive: "Fixture", equipmentId: 1 } };
  return { id: uuid(1), kind: "create", input, result: result(input), localGroupId: `local-${uuid(1)}`, localWorkId: `local-${uuid(1)}`,
    status: "applied", attempts: 1, nextAttemptAt: 0, createdAt: 100 };
}

async function httpFixture(t: TestContext) {
  const f = fixture();
  const requests: Array<{ method: string; path: string }> = [];
  const posts: Array<{ metadata: SyncDocument; signature: string }> = [];
  const receipts = new Map<string, SyncReceipt>();
  const signatures = new Map<string, string>();
  const serverErrors: unknown[] = [];
  const behavior = { loseResponse: false, collision: false, missingFileId: false, appendError: false };
  let effects = 0;
  let appends = 0;
  const server = createServer((req, res) => {
    const json = (status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requests.push({ method: req.method ?? "GET", path: url.pathname });
      if (req.method === "GET" && url.pathname === "/api/auth/me") return json(200, f.dependencies.user);
      if (req.method === "GET" && url.pathname.startsWith("/api/offline/receipts/")) {
        assert.equal(url.searchParams.get("companyBranchId"), "1");
        const receipt = receipts.get(url.pathname.split("/").at(-1)!);
        return receipt ? json(receipt.state === "applied" || receipt.state === "rejected" ? 200 : 409, receipt) : json(404, { error: "OFFLINE_RECEIPT_NOT_FOUND" });
      }
      if (req.method === "GET" && /^\/api\/assignments\/[^/]+(?:\/works\/[^/]+)?\/files$/.test(url.pathname)) return json(200, { data: [] });
      if (req.method !== "POST" || url.pathname !== "/api/offline/documents") return json(404, { error: "FIXTURE_ROUTE_NOT_FOUND" });
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers["content-type"] ?? "" } }).formData();
      assert.ok(readableFormData(form));
      assert.deepEqual([...form.keys()].sort(), ["files", "metadata"]);
      const raw = form.get("metadata");
      assert.equal(typeof raw, "string");
      assert.ok(typeof raw === "string");
      const wire: unknown = JSON.parse(raw);
      const metadata = syncDocumentSchema.parse(wire);
      assert.deepEqual(wire, metadata, "HTTP must serialize normalized numeric IDs, not rely on server coercion");
      const file = form.get("files");
      assert.ok(file && typeof file !== "string");
      const actual = new Uint8Array(await file.arrayBuffer());
      assert.deepEqual(actual, bytes);
      assert.equal(metadata.sha256, digest(actual));
      const signature = JSON.stringify({ metadata, name: file.name, type: file.type, bytes: Buffer.from(actual).toString("base64") });
      posts.push({ metadata, signature });
      if (behavior.collision || signatures.has(metadata.operationId) && signatures.get(metadata.operationId) !== signature) {
        return json(409, { operationId: metadata.operationId, state: "conflict", error: "MOBILE_SYNC_OPERATION_REUSED" });
      }
      if (!signatures.has(metadata.operationId)) { effects++; signatures.set(metadata.operationId, signature); }
      const receipt: SyncReceipt = { operationId: metadata.operationId, state: "applied", ...(behavior.missingFileId ? {} : { fileId: 321 }) };
      receipts.set(metadata.operationId, receipt);
      if (behavior.loseResponse) { behavior.loseResponse = false; req.socket.destroy(); return; }
      json(200, receipt);
    })().catch((error: unknown) => { serverErrors.push(error); json(500, { error: "FIXTURE_ASSERTION_FAILED" }); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.deepEqual(serverErrors, []);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const path = resolve(__dirname, "../../infrastructure/HttpTechnicianRepository.ts");
  const requireSource = createRequire(path);
  const exports: { HttpTechnicianRepository?: typeof HttpTechnicianRepository } = {};
  const module = { exports };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    module, exports, FormData, Blob, AbortController, Error, TypeError, setTimeout, clearTimeout, URLSearchParams,
    require: (id: string): unknown => {
      if (id === "react-native") return { Platform: { OS: "android" } };
      if (id === "./photos") return {
        appendPhoto: async (body: FormData, photo: LocalPhoto) => {
          appends++;
          if (behavior.appendError) throw new Error("private unexpected native error");
          assert.equal(photo.uri, `memory:${photo.id}`);
          const content = f.files.contents.get(photo.id);
          assert.ok(content);
          body.append("files", new Blob([content.slice()], { type: photo.mimeType }), photo.name);
        },
        uploadFetch: (url: string, options: RequestInit) => {
          assert.equal(new URL(url).origin, baseUrl);
          return fetch(url, options);
        },
      };
      return requireSource(id);
    },
  });
  assert.ok(module.exports.HttpTechnicianRepository);
  const client = new module.exports.HttpTechnicianRepository(baseUrl, f.dependencies.user.tenant);
  f.dependencies.upstream = client;
  const queue = async (scope: OfflineScope, parents: Parent[] = [], patch: Partial<Document> = {}) => {
    f.files.sources.set("source:", bytes);
    const file = await f.files.own("a", { id: "draft", name: "evidencia original.pdf", mimeType: "application/pdf", uri: "source:" });
    const operation: Document = { id: uuid(2), kind: "document", scope, file, sourceDraftId: "draft", status: "pending", attempts: 0, createdAt: 100, nextAttemptAt: 0, ...patch };
    await updateState(f.store, "a", (state) => {
      state.operations.push(...parents, operation);
      state.reservations.push({ id: file.id, namespace: "a", size: file.size });
    });
    return structuredClone(operation);
  };
  const read = async () => {
    const document = (await f.store.read("a")).operations.find((op) => op.kind === "document");
    assert.ok(document?.kind === "document");
    return document;
  };
  return { ...f, client, queue, read, requests, posts, receipts, behavior, effects: () => effects, appends: () => appends };
}

for (const groupId of ["direct-80", "direct-np-80"]) test(`raw ${groupId} root fails typed validation before multipart, independently of receipt GET`, async (t) => {
  const f = await httpFixture(t);
  const op = await f.queue(rootScope(groupId));
  assert.equal(await f.client.offlineReceipt(op.id, 1), null);
  await assert.rejects(f.client.offlineDocument({ operationId: op.id, scope: op.scope, sha256: op.file.sha256 }, { ...op.file, uri: `memory:${op.file.id}` }),
    (error: unknown) => error instanceof OfflineUnavailableError && error.code === "OFFLINE_DOCUMENT_INVALID_METADATA");
  assert.equal(f.appends(), 0);
  assert.equal(f.requests.filter((req) => req.method === "POST").length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal((await f.read()).status, "pending");
});

for (const kind of ["work", "non_productive", "maintenance"] as const) test(`${kind} local root: send scope changes only on the wire, fileList/cache identity stays root`, async (t) => {
  const f = await httpFixture(t);
  const p = parent(kind);
  const op = await f.queue(rootScope(p.localGroupId), [p], { dependencyId: p.id });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(f.posts.length, 1);
  const expected = rootScope(p.result!.groupId);
  assert.deepEqual(f.posts[0]!.metadata.scope, { ...expected, ...(kind === "maintenance" ? {} : { workId: 80 }) });
  assert.equal(Object.hasOwn(f.posts[0]!.metadata, "stepId"), false);
  assert.equal(f.posts[0]!.metadata.operationId, op.id);
  assert.equal(f.posts[0]!.metadata.sha256, op.file.sha256);
  assert.ok(f.requests.findIndex((req) => req.path === `/api/offline/receipts/${op.id}`) < f.requests.findIndex((req) => req.method === "POST"));
  const saved = await f.read();
  assert.equal(saved.status, "applied");
  assert.deepEqual(saved.scope, op.scope);
  assert.deepEqual(saved.file, op.file);
  assert.equal(saved.dependencyId, op.dependencyId);
  assert.equal(saved.sourceDraftId, op.sourceDraftId);
  const state = await f.store.read("a");
  assert.deepEqual(state.reservations, [{ id: op.file.id, namespace: "a", size: bytes.length }]);
  assert.deepEqual(state.attachments[0]?.scope, expected);
  assert.deepEqual(resolveScope(op.scope, state.operations), expected);
  assert.equal(sameResource(expected, { ...expected, workId: "80" }), false);
  assert.ok(f.dependencies.user.tenant);
  const repository = new OfflineTechnicianRepository(f.client, { token: "fixture", user: f.dependencies.user, tenant: f.dependencies.user.tenant, branchId: 1, mode: "live" }, f.dependencies);
  const listed = await repository.groupFiles(expected);
  assert.equal(listed.length, 1);
  assert.equal(String(listed[0]!.id), "321");
  assert.equal(listed[0]!.url, `memory:${op.file.id}`);
  assert.ok((await f.store.read("a")).cache.some((entry) => entry.key === resourceCacheKey("files", expected)));
  assert.equal((await repository.files({ ...expected, workId: "80" })).length, 0, "Root document must not leak into child fileList");
  assert.deepEqual(f.files.contents.get(op.file.id), bytes);
});

for (const groupId of ["direct-80", "direct-np-80", "maintenance-80", "external-80"]) test(`${groupId} canonical root and explicit child scopes`, async (t) => {
  const f = await httpFixture(t);
  const root = rootScope(groupId);
  const expected = { ...root, ...(groupId.startsWith("direct-") ? { workId: "80" } : {}) };
  assert.deepEqual(resolveDocumentScope(root, []), expected);
  assert.deepEqual(resolveScope(root, []), root);
  const child = { ...root, workId: "80" };
  assert.deepEqual(resolveDocumentScope(child, []), child);
  const op = await f.queue(root);
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "applied");
  assert.deepEqual((await f.read()).scope, op.scope);
  assert.deepEqual(f.posts[0]!.metadata.scope, { ...root, ...(groupId.startsWith("direct-") ? { workId: 80 } : {}) });
});

test("explicit local child preserves valid step and numeric wire IDs", async (t) => {
  const f = await httpFixture(t); const p = parent();
  const scope = { ...rootScope(p.localGroupId), workId: p.localWorkId };
  const op = await f.queue(scope, [p], { dependencyId: p.id, stepId: "9" });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "applied");
  assert.equal(f.posts[0]!.metadata.scope.workId, 80);
  assert.equal(f.posts[0]!.metadata.stepId, 9);
  assert.deepEqual((await f.read()).scope, op.scope);
});

test("document scope resolver rejects mismatched, unsafe and unconfirmed identities without mutation", () => {
  const p = parent();
  const malformed: Array<{ scope: OfflineScope; parents: Parent[] }> = [
    ...["0", "-1", "01", "1.5", "9007199254740992", "80suffix"].map((id) => ({ scope: rootScope(`direct-${id}`), parents: [] })),
    ...["81", "9007199254740992", "local-elsewhere"].map((workId) => ({ scope: { ...rootScope("direct-80"), workId }, parents: [] })),
    ...["pending", "conflict"].map((status) => ({ scope: rootScope(p.localGroupId), parents: [{ ...p, status: status as Parent["status"] }] })),
    { scope: rootScope(p.localGroupId), parents: [] },
    { scope: { ...rootScope(p.localGroupId), workId: "local-wrong" }, parents: [p] },
    { scope: rootScope(p.localGroupId), parents: [{ ...p, result: undefined }] },
    { scope: rootScope(p.localGroupId), parents: [{ ...p, result: { ...p.result!, workId: 81 } }] },
    { scope: rootScope(p.localGroupId), parents: [{ ...p, result: { ...p.result!, workId: Number.MAX_SAFE_INTEGER + 1 } }] },
    { scope: rootScope(p.localGroupId), parents: [{ ...p, input: { ...p.input, companyBranchId: 2 } }] },
    { scope: rootScope(p.localGroupId), parents: [{ ...p, result: { ...p.result!, companyBranchId: 2 } }] },
    { scope: rootScope(p.localGroupId), parents: [{ ...p, result: { ...p.result!, kind: "non_productive", groupId: "direct-np-80" } }] },
  ];
  for (const value of malformed) {
    const before = structuredClone(value);
    assert.equal(resolveDocumentScope(value.scope, value.parents), null, JSON.stringify(value));
    assert.deepEqual(value, before);
  }
});

for (const scope of [rootScope("direct-9007199254740992"), rootScope("direct-np-9007199254740992"), { ...rootScope("direct-80"), workId: "81" }]) test(`${JSON.stringify(scope)} never sends or falsely applies`, async (t) => {
  const f = await httpFixture(t);
  const op = await f.queue(scope);
  await new OfflineEngine(f.dependencies).syncNow();
  assert.notEqual((await f.read()).status, "applied");
  assert.equal(f.appends(), 0); assert.equal(f.posts.length, 0);
  assert.equal((await f.store.read("a")).attachments.length, 0);
  assert.deepEqual((await f.read()).scope, op.scope);
});

for (const groupId of ["direct-80", "direct-np-80"]) test(`legacy canonical ${groupId} root recovers without a local parent`, async (t) => {
  const f = await httpFixture(t);
  await f.queue(rootScope(groupId), [], { status: "needs_review", lastError: legacyCode, attempts: 2 });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "applied");
  assert.equal((await f.read()).attempts, 3);
  assert.equal(f.posts[0]!.metadata.scope.workId, 80);
});

test("generic legacy recovery still accepts explicit child scope with step", async (t) => {
  const f = await httpFixture(t);
  await f.queue({ ...rootScope("direct-80"), workId: "80" }, [], { status: "needs_review", lastError: "OFFLINE_SYNC_UNEXPECTED_RESPONSE", attempts: 1, stepId: "9" });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "applied");
  assert.equal(f.posts[0]!.metadata.stepId, 9);
});

for (const state of ["applied", "conflict", "rejected", "needs_review"] as const) test(`persisted ${state} receipt prevents direct legacy migration`, async (t) => {
  const f = await httpFixture(t);
  const op = await f.queue(rootScope("direct-80"), [], { status: "needs_review", lastError: legacyCode, attempts: 2, receipt: { operationId: uuid(2), state, ...(state === "applied" ? { fileId: 999 } : {}) } });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.deepEqual(await f.read(), op);
  assert.equal(f.requests.filter((req) => req.path.startsWith("/api/offline/")).length, 0);
});

for (const kind of ["work", "non_productive"] as const) for (const dependency of [true, false]) test(`legacy attempts=2 ${kind} root migrates once (dependency=${dependency})`, async (t) => {
  const f = await httpFixture(t); const p = parent(kind);
  const op = await f.queue(rootScope(p.localGroupId), [p], { status: "needs_review", lastError: legacyCode, attempts: 2, ...(dependency ? { dependencyId: p.id } : {}) });
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "applied");
  assert.equal((await f.read()).attempts, 3);
  assert.equal(f.posts[0]!.metadata.operationId, op.id);
  assert.equal(f.posts[0]!.metadata.scope.workId, 80);
  assert.deepEqual((await f.read()).scope, op.scope);
  f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal(f.posts.length, 1); assert.equal(f.effects(), 1);
});

for (const exclusion of ["pending-parent", "conflict-parent", "missing-parent", "missing-result", "wrong-kind", "wrong-input-branch", "wrong-result-branch", "wrong-root-id", "dependency", "explicit-work", "step", "maintenance", "external", "receipt", "other-error", "new-unknown", "trailing-error", "blocked"] as const) test(`legacy root migration excludes ${exclusion}`, async (t) => {
  const f = await httpFixture(t); let p = parent();
  if (exclusion === "pending-parent" || exclusion === "conflict-parent") p = { ...p, status: exclusion === "pending-parent" ? "pending" : "conflict", nextAttemptAt: Number.MAX_SAFE_INTEGER };
  if (exclusion === "missing-result") p.result = undefined;
  if (exclusion === "wrong-kind") p.result = { ...p.result!, kind: "non_productive", groupId: "direct-np-80" };
  if (exclusion === "wrong-input-branch") p.input.companyBranchId = 2;
  if (exclusion === "wrong-result-branch") p.result!.companyBranchId = 2;
  if (exclusion === "wrong-root-id") p.result!.workId = 81;
  if (exclusion === "maintenance") p = parent("maintenance");
  const scope = rootScope(exclusion === "external" ? "external-80" : p.localGroupId);
  if (exclusion === "explicit-work") scope.workId = p.localWorkId;
  const op = await f.queue(scope, exclusion === "missing-parent" ? [] : [p], {
    status: exclusion === "blocked" ? "blocked" : "needs_review", attempts: 2,
    lastError: exclusion === "other-error" ? "OFFLINE_INVALID_RECEIPT" : exclusion === "new-unknown" ? "OFFLINE_DOCUMENT_SUBMISSION_FAILED" : exclusion === "trailing-error" ? `${legacyCode} ` : legacyCode,
    dependencyId: exclusion === "dependency" ? uuid(99) : p.id,
    ...(exclusion === "step" ? { stepId: "9" } : {}),
    ...(exclusion === "receipt" ? { receipt: { operationId: uuid(2), state: "needs_review" as const } } : {}),
  });
  for (let round = 0; round < 2; round++) { await new OfflineEngine(f.dependencies).syncNow(); f.advance(); }
  assert.deepEqual(await f.read(), op);
  assert.equal(f.posts.length, 0);
  assert.equal(f.requests.filter((req) => req.path.startsWith("/api/offline/receipts/")).length, 0);
});

test("lost HTTP response commits once; restart GET still requires identical same-UUID POST", async (t) => {
  const f = await httpFixture(t); const p = parent();
  const op = await f.queue(rootScope(p.localGroupId), [p], { dependencyId: p.id, status: "needs_review", attempts: 2, lastError: legacyCode });
  f.behavior.loseResponse = true;
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "pending");
  assert.equal((await f.read()).attempts, 3);
  assert.equal((await f.store.read("a")).attachments.length, 0);
  assert.equal(f.effects(), 1);
  await new OfflineEngine(f.dependencies).syncNow(); assert.equal(f.posts.length, 1);
  f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, "applied");
  assert.equal(f.effects(), 1); assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0]!.signature, f.posts[1]!.signature);
  assert.deepEqual(f.requests.filter((req) => req.path.startsWith("/api/offline/")), [
    { method: "GET", path: `/api/offline/receipts/${op.id}` }, { method: "POST", path: "/api/offline/documents" },
    { method: "GET", path: `/api/offline/receipts/${op.id}` }, { method: "POST", path: "/api/offline/documents" },
  ]);
  assert.deepEqual((await f.read()).scope, op.scope);
  assert.deepEqual(f.files.contents.get(op.file.id), bytes);
});

for (const state of ["conflict", "needs_review", "rejected"] as const) test(`terminal GET ${state} stops legacy direct recovery without POST`, async (t) => {
  const f = await httpFixture(t); const p = parent();
  const op = await f.queue(rootScope(p.localGroupId), [p], { status: "needs_review", attempts: 2, lastError: legacyCode });
  f.receipts.set(op.id, { operationId: op.id, state, error: "MOBILE_SYNC_REQUIRES_REVIEW" });
  await new OfflineEngine(f.dependencies).syncNow(); f.advance(); await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).status, state === "rejected" ? "blocked" : state);
  assert.equal(f.posts.length, 0); assert.equal(f.appends(), 0);
  assert.equal(f.requests.filter((req) => req.path.startsWith("/api/offline/receipts/")).length, 1);
});

test("applied GET cannot conceal UUID collision; collision remains held across restarts", async (t) => {
  const f = await httpFixture(t);
  const op = await f.queue(rootScope("direct-80"));
  f.receipts.set(op.id, { operationId: op.id, state: "applied", fileId: 999 });
  f.behavior.collision = true;
  const engine = new OfflineEngine(f.dependencies);
  await engine.syncNow();
  assert.equal((await f.read()).status, "needs_review");
  assert.equal((await f.read()).lastError, "MOBILE_SYNC_OPERATION_REUSED");
  for (let round = 0; round < 3; round++) { f.advance(); await new OfflineEngine(f.dependencies).syncNow(); }
  await assert.rejects(engine.retry(op.id), /REVIEW/);
  assert.equal(f.posts.length, 1); assert.equal(f.effects(), 0);
  assert.equal((await f.store.read("a")).attachments.length, 0);
  assert.equal(f.requests.filter((req) => req.path.startsWith("/api/offline/receipts/")).length, 1);
});

test("new unknown document failure gets a non-migratable code and only one attempt", async (t) => {
  const f = await httpFixture(t); const p = parent();
  await f.queue(rootScope(p.localGroupId), [p]);
  f.behavior.appendError = true;
  await new OfflineEngine(f.dependencies).syncNow();
  assert.equal((await f.read()).lastError, "OFFLINE_DOCUMENT_SUBMISSION_FAILED");
  for (let round = 0; round < 3; round++) { f.advance(); await new OfflineEngine(f.dependencies).syncNow(); }
  assert.equal((await f.read()).status, "needs_review");
  assert.equal((await f.read()).attempts, 1);
  assert.equal(f.appends(), 1); assert.equal(f.posts.length, 0);
});

test("HTTP applied without fileId never confirms root document or creates cache binding", async (t) => {
  const f = await httpFixture(t);
  await f.queue(rootScope("direct-80"));
  f.behavior.missingFileId = true;
  const engine = new OfflineEngine(f.dependencies); await engine.syncNow();
  assert.equal((await f.read()).status, "needs_review");
  assert.equal(engine.getSnapshot().lastSyncedAt, null);
  assert.equal((await f.store.read("a")).attachments.length, 0);
  f.advance(); await new OfflineEngine(f.dependencies).syncNow(); assert.equal(f.posts.length, 1);
});