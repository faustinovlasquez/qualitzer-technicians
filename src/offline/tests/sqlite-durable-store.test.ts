/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import * as stateModule from "../state";
import { emptyState, updateState } from "../state";
import type { DurableStore, OfflineState } from "../contracts";
import { loadSource } from "../../../tests/helpers/tenant-challenge";

/** SQLite simulado: solo las sentencias que usa el almacén, con transacción que se deshace si falla. */
function fakeDatabase() {
  let states = new Map<string, { revision: number; json: string }>();
  let cache = new Map<string, { meta: string; json: string }>();
  const log: string[] = [];
  const control = { failNextTransaction: false };
  const id = (namespace: string, key: string) => JSON.stringify([namespace, key]);
  const db = {
    execAsync: async () => {},
    getFirstAsync: async (sql: string, namespace: string) => {
      log.push(sql.startsWith("SELECT revision, json") ? "read-json" : "read-revision");
      const row = states.get(namespace);
      return row ? { ...row } : null;
    },
    getAllAsync: async (sql: string, namespace?: string) => {
      if (sql.includes("offline_cache_entries")) {
        log.push("read-cache");
        return [...cache].map(([key, row]) => ({ parsed: JSON.parse(key) as [string, string], row }))
          .filter(({ parsed }) => parsed[0] === namespace).map(({ parsed, row }) => ({ key: parsed[1], ...row }));
      }
      return [...states.keys()].map((name) => ({ namespace: name }));
    },
    runAsync: async (sql: string, ...params: Array<string | number>) => {
      if (sql.startsWith("INSERT INTO offline_states")) { log.push("write-core"); states.set(String(params[0]), { revision: Number(params[1]), json: String(params[2]) }); return; }
      if (sql.startsWith("INSERT INTO offline_cache_entries")) { log.push(`write-cache:${params[1]}`); cache.set(id(String(params[0]), String(params[1])), { meta: String(params[2]), json: String(params[3]) }); return; }
      if (sql.startsWith("DELETE FROM offline_cache_entries WHERE namespace = ? AND key = ?")) { log.push(`delete-cache:${params[1]}`); cache.delete(id(String(params[0]), String(params[1]))); return; }
      if (sql.startsWith("DELETE FROM offline_cache_entries WHERE namespace = ?")) {
        log.push("delete-all-cache");
        for (const key of [...cache.keys()]) if ((JSON.parse(key) as string[])[0] === params[0]) cache.delete(key);
        return;
      }
      throw new Error(`UNEXPECTED_SQL:${sql}`);
    },
    withExclusiveTransactionAsync: async (work: (tx: unknown) => Promise<void>) => {
      const savedStates = new Map(states); const savedCache = new Map(cache);
      try {
        await work(db);
        if (control.failNextTransaction) { control.failNextTransaction = false; throw new Error("DISK_FULL"); }
      } catch (error) { states = savedStates; cache = savedCache; throw error; }
    },
  };
  return {
    db, log, control,
    rawState: (namespace: string) => states.get(namespace),
    cacheKeys: (namespace: string) => [...cache.keys()].map((key) => JSON.parse(key) as [string, string]).filter(([name]) => name === namespace).map(([, key]) => key).sort(),
    putLegacy: (namespace: string, state: OfflineState) => states.set(namespace, { revision: state.revision, json: JSON.stringify(state) }),
    bumpExternally: (namespace: string, change: (record: Record<string, unknown>) => void) => {
      const row = states.get(namespace)!; const record = JSON.parse(row.json) as Record<string, unknown>;
      change(record); record.revision = row.revision + 1;
      states.set(namespace, { revision: row.revision + 1, json: JSON.stringify(record) });
    },
  };
}

function load() {
  const fake = fakeDatabase();
  const module = loadSource<typeof import("../DurableStore")>("offline/DurableStore.ts", (id) => {
    if (id === "expo-sqlite") return { openDatabaseAsync: async () => fake.db };
    if (id === "./state") return stateModule;
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  }, { JSON, Map, Promise });
  return { fake, store: () => module.createDurableStore() };
}

const entry = (key: string, json: string, fetchedAt = 1) => ({ key, json, fetchedAt });

test("round trip keeps operations and cache, and repeated reads use memory instead of decoding again", async () => {
  const { fake, store } = load(); const s: DurableStore = await store();
  await updateState(s, "a", (state) => { state.cache.push(entry("assignments:2026-11-12", "{\"big\":1}")); state.lastSyncedAt = 5; });
  fake.log.length = 0;
  const first = await s.read("a"); const second = await s.read("a");
  assert.deepEqual(first.cache.map((item) => item.key), ["assignments:2026-11-12"]);
  assert.equal(first.lastSyncedAt, 5); assert.equal(first.revision, 1);
  assert.deepEqual(fake.log, ["read-revision", "read-revision"], "no full read while the revision is unchanged");
  first.cache[0].json = "mutated"; first.operations.push({} as never);
  assert.equal((await s.read("a")).cache[0].json, "{\"big\":1}", "callers get independent copies");
  assert.equal(second.operations.length, 0);
  const core = JSON.parse(fake.rawState("a")!.json) as { cache: unknown[]; cacheTable: boolean };
  assert.deepEqual(core.cache, []); assert.equal(core.cacheTable, true);
});

test("writes only the cache rows that changed and deletes removed ones", async () => {
  const { fake, store } = load(); const s = await store();
  await updateState(s, "a", (state) => { state.cache.push(entry("x", "1"), entry("y", "2")); });
  fake.log.length = 0;
  await updateState(s, "a", (state) => { state.lastSyncedAt = 9; });
  assert.deepEqual(fake.log.filter((line) => line.startsWith("write") || line.startsWith("delete")), ["write-core"]);
  fake.log.length = 0;
  await updateState(s, "a", (state) => { state.cache = state.cache.filter((item) => item.key !== "x"); state.cache.push(entry("z", "3")); state.cache[0].fetchedAt = 7; });
  assert.deepEqual(fake.log.filter((line) => line.startsWith("write") || line.startsWith("delete")).sort(), ["delete-cache:x", "write-cache:y", "write-cache:z", "write-core"]);
  assert.deepEqual(fake.cacheKeys("a"), ["y", "z"]);
});

test("legacy single-row state is read whole and moved to rows on the first write", async () => {
  const { fake, store } = load(); const s = await store();
  const legacy = emptyState(); legacy.revision = 3; legacy.cache = [entry("old", "\"v\"")];
  fake.putLegacy("a", legacy);
  const read = await s.read("a");
  assert.deepEqual(read.cache.map((item) => item.key), ["old"]);
  await updateState(s, "a", (state) => { state.lastSyncedAt = 1; });
  assert.ok(fake.log.includes("delete-all-cache"), "unknown rows are replaced on the first write");
  assert.deepEqual(fake.cacheKeys("a"), ["old"]);
  assert.equal(JSON.parse(fake.rawState("a")!.json).cacheTable, true);
  assert.equal((await s.read("a")).cache[0].json, "\"v\"");
});

test("a write by another process invalidates memory and the next write rewrites the cache", async () => {
  const { fake, store } = load(); const s = await store();
  await updateState(s, "a", (state) => { state.cache.push(entry("x", "1")); });
  fake.bumpExternally("a", (record) => { record.lastSyncedAt = 42; });
  const read = await s.read("a");
  assert.equal(read.lastSyncedAt, 42); assert.equal(read.revision, 2);
  assert.deepEqual(read.cache.map((item) => item.key), ["x"]);
  assert.equal(await s.compareAndSwap("a", 1, { ...read, revision: 2 }), false, "stale revision is rejected");
  await updateState(s, "a", (state) => { state.cache.push(entry("y", "2")); });
  assert.deepEqual(fake.cacheKeys("a"), ["x", "y"]);
});

test("a failed transaction keeps the previous state in the database and in memory", async () => {
  const { fake, store } = load(); const s = await store();
  await updateState(s, "a", (state) => { state.cache.push(entry("x", "1")); });
  fake.control.failNextTransaction = true;
  await assert.rejects(updateState(s, "a", (state) => { state.cache = []; state.lastSyncedAt = 3; }), /DISK_FULL/);
  const read = await s.read("a");
  assert.equal(read.revision, 1); assert.equal(read.lastSyncedAt, null); assert.deepEqual(fake.cacheKeys("a"), ["x"]);
  await updateState(s, "a", (state) => { state.lastSyncedAt = 4; });
  assert.equal((await s.read("a")).lastSyncedAt, 4); assert.deepEqual(fake.cacheKeys("a"), ["x"]);
});
