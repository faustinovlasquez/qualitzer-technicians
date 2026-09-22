/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { OfflineUnavailableError } from "../../domain/offline";
import type { LocalPhoto } from "../../domain/models";
import type { DurableFileStore, DurableStore } from "../contracts";
import { updateState, validateQuota } from "../state";
import { MemoryStore, uuid } from "./fakes";
import { storageCapacity } from "../storageCapacity";

const photo: LocalPhoto = { id: "persisted-draft", name: "proof.png", mimeType: "image/png", uri: "file:///sandbox/proof.png", size: 3 };
const bytes = new Uint8Array([1, 2, 3]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const noStorage: DurableStore = {
  read: async () => { throw new Error("FINGERPRINT_MUST_NOT_READ_STORAGE"); },
  compareAndSwap: async () => { throw new Error("FINGERPRINT_MUST_NOT_RESERVE_STORAGE"); },
  namespaces: async () => { throw new Error("FINGERPRINT_MUST_NOT_SCAN_STORAGE"); },
};

function adapter(platform: "native" | "web", source?: { bytes: Uint8Array | null; error?: Error }, storage: DurableStore = noStorage): DurableFileStore {
  const exports: { NativeDurableFileStore?: new (store: DurableStore) => DurableFileStore; IndexedDBFileStore?: new () => DurableFileStore } = {};
  const module = { exports };
  class SourceFile {
    readonly uri = "file:///sandbox/offline/owned";
    get exists(): boolean { return source?.bytes !== null; }
    get size(): number { return source?.bytes?.length ?? 0; }
    async bytes(): Promise<Uint8Array> { if (source?.error) throw source.error; return source?.bytes ?? new Uint8Array(); }
    create(): void { if (source) source.bytes = new Uint8Array(); }
    write(text: string): void { if (source) source.bytes = new TextEncoder().encode(text); }
    delete(): void { if (source) source.bytes = null; }
  }
  const code = ts.transpileModule(readFileSync(resolve(__dirname, platform === "native" ? "../FileStore.ts" : "../FileStore.web.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    module, exports, Uint8Array, Blob, URL, TypeError, fetch,
    require: (id: string): unknown => {
      if (id === "expo-crypto") return { randomUUID: () => uuid(42), CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: async (_algorithm: string, data: Uint8Array | ArrayBuffer) => Uint8Array.from(createHash("sha256").update(data instanceof Uint8Array ? data : new Uint8Array(data)).digest()).buffer };
      if (id === "expo-file-system") return { File: SourceFile, Directory: class {}, Paths: { document: "file:///sandbox", cache: "file:///sandbox/cache" } };
      if (id === "../domain/offline") return { OfflineUnavailableError };
      if (id === "./state") return { validateQuota };
      if (id === "./storageCapacity") return { storageCapacity };
      if (id === "./indexedDatabase.web") return { openOfflineDatabase: () => { throw new Error("FINGERPRINT_MUST_NOT_OPEN_DATABASE"); } };
      throw new Error(`UNEXPECTED_ADAPTER_IMPORT:${id}`);
    },
  });
  const Constructor = platform === "native" ? module.exports.NativeDurableFileStore : module.exports.IndexedDBFileStore;
  assert.ok(Constructor);
  return new Constructor(storage);
}

test("native fingerprint hashes real source bytes without copying or reserving quota", async () => {
  const store = adapter("native", { bytes });
  const fingerprint = await store.fingerprint!(photo);
  assert.equal(fingerprint?.sha256, sha256); assert.equal(fingerprint?.size, 3);
});

test("native missing source returns null but readable-file errors remain errors", async () => {
  assert.equal(await adapter("native", { bytes: null }).fingerprint!(photo), null);
  await assert.rejects(adapter("native", { bytes, error: new Error("READ_FAILED") }).fingerprint!(photo), /READ_FAILED/);
});

test("native fingerprint refuses remote URLs before opening a file", async () => {
  await assert.rejects(adapter("native", { bytes }).fingerprint!({ ...photo, uri: "https://remote.invalid/proof.png" }), /EXPECTS_LOCAL_FILE/);
});

test("native fingerprint distinguishes changed bytes with identical size", async () => {
  const changed = await adapter("native", { bytes: new Uint8Array([1, 2, 4]) }).fingerprint!(photo);
  assert.notEqual(changed?.sha256, sha256); assert.equal(changed?.size, 3);
});

test("web fingerprint hashes a local Blob without opening IndexedDB or allocating storage", async () => {
  const uri = URL.createObjectURL(new Blob([bytes]));
  try {
    const fingerprint = await adapter("web").fingerprint!({ ...photo, uri });
    assert.equal(fingerprint?.sha256, sha256); assert.equal(fingerprint?.size, 3);
  } finally { URL.revokeObjectURL(uri); }
});

test("web revoked Blob returns null for immutable draft recovery", async () => {
  const uri = URL.createObjectURL(new Blob([bytes])); URL.revokeObjectURL(uri);
  assert.equal(await adapter("web").fingerprint!({ ...photo, uri }), null);
});

test("web fingerprint refuses remote fetches and does not suppress malformed data URLs", async () => {
  const store = adapter("web");
  await assert.rejects(store.fingerprint!({ ...photo, uri: "https://remote.invalid/proof.png" }), /EXPECTS_LOCAL_BLOB/);
  await assert.rejects(store.fingerprint!({ ...photo, uri: "data:invalid" }), TypeError);
});

test("native owned URI requires exact reservation namespace and size before the file can be hashed or posted", async () => {
  const storage = new MemoryStore();
  const file = { id: uuid(1), namespace: "a", name: photo.name, mimeType: photo.mimeType, size: bytes.length, sha256 };
  const store = adapter("native", { bytes }, storage);
  await assert.rejects(store.resolveURI(file), /OFFLINE_LOCAL_FILE_MISSING/);
  for (const reservation of [{ id: file.id, namespace: "other-user", size: file.size }, { id: file.id, namespace: file.namespace, size: file.size + 1 }]) {
    await updateState(storage, "offline-file-reservations-v1", (state) => { state.reservations = [reservation]; });
    await assert.rejects(store.resolveURI(file), /OFFLINE_LOCAL_FILE_MISSING/);
  }
  await updateState(storage, "offline-file-reservations-v1", (state) => { state.reservations = [{ id: file.id, namespace: file.namespace, size: file.size }]; });
  assert.equal(await store.resolveURI(file), "file:///sandbox/offline/owned");
  await assert.rejects(adapter("native", { bytes: null }, storage).resolveURI(file), /OFFLINE_LOCAL_FILE_MISSING/);
  await assert.rejects(adapter("native", { bytes: new Uint8Array([1]) }, storage).resolveURI(file), /OFFLINE_LOCAL_FILE_MISSING/);
});

test("web owned URI rechecks persisted ownership and fresh bytes despite a cached object URL", async () => {
  const file = { id: uuid(1), namespace: "a", name: photo.name, mimeType: photo.mimeType, size: bytes.length, sha256 };
  let stored: { blob: Blob; namespace: string } | undefined = { blob: new Blob([bytes]), namespace: "a" };
  class ReadTransaction {
    complete: () => void = () => undefined;
    fail: (reason: unknown) => void = () => undefined;
    completed = new Promise<void>((resolve, reject) => { this.complete = resolve; this.fail = reject; });
    abort(): void { this.fail(new Error("ABORTED")); }
    objectStore() {
      return { get: () => {
        const request = { result: stored, onsuccess: () => undefined };
        queueMicrotask(() => { request.onsuccess(); this.complete(); });
        return request;
      } };
    }
  }
  const exports: { IndexedDBFileStore?: new () => DurableFileStore } = {};
  const module = { exports };
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../FileStore.web.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    module, exports, Blob, URL, Uint8Array, fetch, TypeError,
    require: (id: string): unknown => {
      if (id === "expo-crypto") return { CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: async (_algorithm: string, data: ArrayBuffer) => Uint8Array.from(createHash("sha256").update(new Uint8Array(data)).digest()).buffer };
      if (id === "../domain/offline") return { OfflineUnavailableError };
      if (id === "./state") return { validateQuota };
      if (id === "./storageCapacity") return { storageCapacity };
      if (id === "./indexedDatabase.web") return {
        openOfflineDatabase: async () => ({ transaction: () => new ReadTransaction() }),
        transactionComplete: (tx: ReadTransaction) => tx.completed,
      };
      throw new Error(`UNEXPECTED_IMPORT:${id}`);
    },
  });
  assert.ok(module.exports.IndexedDBFileStore);
  const store = new module.exports.IndexedDBFileStore();
  try {
    const first = await store.resolveURI(file);
    assert.deepEqual(new Uint8Array(await (await fetch(first)).arrayBuffer()), bytes);
    const concurrent = await Promise.all([store.resolveURI(file), store.resolveURI(file)]);
    assert.deepEqual(concurrent, [first, first]);
    assert.deepEqual(new Uint8Array(await (await fetch(first)).arrayBuffer()), bytes);
    const changed = new Uint8Array([1, 2, 4]);
    stored = { blob: new Blob([changed]), namespace: "a" };
    await assert.rejects(store.resolveURI(file), /OFFLINE_FILE_INTEGRITY_MISMATCH/);
    assert.deepEqual(new Uint8Array(await (await fetch(first)).arrayBuffer()), bytes);
    stored = { blob: new Blob([bytes]), namespace: "other-user" };
    await assert.rejects(store.resolveURI(file), /OFFLINE_BLOB_IDENTITY_MISMATCH/);
    stored = { blob: new Blob([new Uint8Array([1])]), namespace: "a" };
    await assert.rejects(store.resolveURI(file), /OFFLINE_BLOB_IDENTITY_MISMATCH/);
    stored = undefined;
    await assert.rejects(store.resolveURI(file), /OFFLINE_INVALID_BLOB/);
  } finally { store.releaseURLs(); }
});

for (const platform of ["native", "web"] as const) test(`${platform} report text delegates to durable ownership and cleans only its temporary source`, async () => {
  const source = { bytes: null as Uint8Array | null };
  const store = adapter(platform, source);
  const text = "Revision completada\nConservar observaciones";
  let incoming: LocalPhoto | undefined;
  const saved = { id: uuid(43), namespace: "a", name: "reporte.txt", size: new TextEncoder().encode(text).length, sha256: "a".repeat(64), mimeType: "text/plain" };
  store.own = async (namespace, photo) => {
    incoming = photo; assert.equal(namespace, "a"); assert.ok(photo.id);
    const actual = platform === "native" ? new TextDecoder().decode(source.bytes!) : await (await fetch(photo.uri)).text();
    assert.equal(actual, text); return saved;
  };
  assert.deepEqual(await store.ownText!("a", text, saved.name), saved);
  assert.ok(incoming);
  if (platform === "native") assert.equal(source.bytes, null);
  else await assert.rejects(fetch(incoming.uri));
  store.own = async () => { throw new Error("STORAGE_FAILED"); };
  await assert.rejects(store.ownText!("a", text, saved.name), /STORAGE_FAILED/);
  if (platform === "native") assert.equal(source.bytes, null);
});