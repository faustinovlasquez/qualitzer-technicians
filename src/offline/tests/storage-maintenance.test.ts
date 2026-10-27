/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineOperation } from "../../domain/offline";
import { OFFLINE_LIMITS } from "../contracts";
import { OfflineEngine } from "../engine";
import { emptyState, pruneApplied, putCache, updateState } from "../state";
import { fixture, uuid } from "./fakes";

const scope = { companyBranchId: 1, groupId: "direct-10", workId: "10", startDate: "2026-09-08", endDate: "2026-09-08" };
const file = (id: number) => ({ id: `file-${id}`, namespace: "a", name: "foto.jpg", mimeType: "image/jpeg", size: 100, sha256: "a".repeat(64) });
const document = (id: number, status: OfflineOperation["status"], createdAt: number): OfflineOperation =>
  ({ id: uuid(id), createdAt, status, attempts: 0, nextAttemptAt: 0, kind: "document", scope, file: file(id), ...(status === "applied" ? { receipt: { operationId: uuid(id), state: "applied", fileId: id } } : {}) });

test("al llenarse la copia se borran antes archivos y búsquedas que el catálogo base, la identidad y la agenda", () => {
  const state = emptyState();
  putCache(state, { key: "me", json: "{}", fetchedAt: 1 });
  putCache(state, { key: `options:${JSON.stringify({ companyBranchId: 1, search: "", page: 0 })}`, json: "{}", fetchedAt: 2 });
  putCache(state, { key: "assignments:2026-09-08", json: "{}", fetchedAt: 3 });
  for (let i = 0; i < OFFLINE_LIMITS.cacheEntries + 5; i++) putCache(state, { key: `files:${i}`, json: "{}", fetchedAt: 10 + i });
  const keys = new Set(state.cache.map((entry) => entry.key));
  assert.equal(state.cache.length, OFFLINE_LIMITS.cacheEntries);
  assert.ok(keys.has("me"));
  assert.ok([...keys].some((key) => key.startsWith("options:")));
  assert.ok(keys.has("assignments:2026-09-08"));
});

test("lo confirmado antiguo se archiva y borra su copia; lo pendiente y lo que otro necesita se conserva", () => {
  const state = emptyState();
  const old = document(1, "applied", 1_000);
  const needed = document(2, "applied", 1_000);
  const recent = document(3, "applied", 9_000);
  const pending: OfflineOperation = { ...document(4, "pending", 1_000), dependencyId: uuid(2) } as OfflineOperation;
  state.operations.push(old, needed, recent, pending);
  state.attachments.push({ scope, attachmentId: "1", file: file(1) }, { scope, attachmentId: "3", file: file(3) });
  const files = pruneApplied(state, 5_000);
  assert.deepEqual(files.map((entry) => entry.id), ["file-1"]);
  assert.deepEqual(state.operations.map((op) => op.id), [uuid(2), uuid(3), uuid(4)]);
  assert.deepEqual(state.attachments.map((entry) => entry.file.id), ["file-3"]);
});

test("«Liberar espacio» borra copias de lo enviado y descargado, nunca lo pendiente", async () => {
  const f = fixture();
  await updateState(f.store, "a", (state) => {
    state.operations.push(document(1, "applied", 9_000), document(2, "pending", 9_000));
    state.attachments.push({ scope, attachmentId: "1", file: file(1) }, { scope, attachmentId: "77", file: file(77) });
  });
  for (const id of [1, 2, 77]) f.files.files.set(`file-${id}`, file(id));
  const freed = await new OfflineEngine(f.dependencies).freeSpace();
  assert.equal(freed, 200);
  assert.deepEqual([...f.files.removes].sort(), ["file-1", "file-77"]);
  const state = await f.store.read("a");
  assert.deepEqual(state.operations.map((op) => op.id), [uuid(2)]);
  assert.equal(state.attachments.length, 0);
});
