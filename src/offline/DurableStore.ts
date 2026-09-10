import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { DurableStore, OfflineState } from "./contracts";
import { decodeState, emptyState } from "./state";

let database: Promise<SQLiteDatabase> | undefined;
let writes: Promise<void> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = writes.then(task, task);
  writes = result.then(() => undefined, () => undefined);
  return result;
}
async function open(): Promise<SQLiteDatabase> {
  if (!database) database = (async () => {
    const db = await openDatabaseAsync("qualitzer-offline-v1.db");
    await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS offline_states (namespace TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL);");
    return db;
  })().catch((error: unknown) => { database = undefined; throw error; });
  return database;
}
export class SQLiteDurableStore implements DurableStore {
  async read(namespace: string): Promise<OfflineState> {
    const row = await (await open()).getFirstAsync<{ json: string }>("SELECT json FROM offline_states WHERE namespace = ?", namespace);
    return row ? decodeState(row.json) : emptyState();
  }
  compareAndSwap(namespace: string, revision: number, next: OfflineState): Promise<boolean> {
    return serialize(async () => {
      const db = await open();
      let written = false;
      await db.withExclusiveTransactionAsync(async (tx) => {
        const row = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM offline_states WHERE namespace = ?", namespace);
        if ((row?.revision ?? 0) !== revision || next.revision !== revision + 1) return;
        await tx.runAsync("INSERT INTO offline_states (namespace, revision, json) VALUES (?, ?, ?) ON CONFLICT(namespace) DO UPDATE SET revision = excluded.revision, json = excluded.json", namespace, next.revision, JSON.stringify(next));
        written = true;
      });
      return written;
    });
  }
  async namespaces(): Promise<string[]> { return (await (await open()).getAllAsync<{ namespace: string }>("SELECT namespace FROM offline_states")).map((row: { namespace: string }) => row.namespace); }
}
export async function createDurableStore(): Promise<DurableStore> { await open(); return new SQLiteDurableStore(); }