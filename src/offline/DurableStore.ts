import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { CacheEntry, DurableStore, OfflineState } from "./contracts";
import { copyState, decodeStateValue, emptyState } from "./state";

/*
 * Formato (fluidez, 12-11-2026):
 * - `offline_states` guarda lo pendiente y el resto del estado en un texto pequeño, con `cache: []` y `cacheTable: true`.
 *   Una versión anterior de la app lo sigue leyendo: ve su cola intacta y la caché vacía (la vuelve a descargar).
 * - `offline_cache_entries` guarda cada entrada de caché (agendas, catálogos, archivos…) en su propia fila:
 *   solo se escribe la que cambió, no los hasta 16 MB completos en cada respuesta.
 * - En memoria queda el último estado leído o escrito por namespace; si la revisión de la base coincide se entrega una
 *   copia sin volver a leer ni validar todo. Si otro proceso escribió, la revisión no coincide y se relee de la base.
 */
let database: Promise<SQLiteDatabase> | undefined;
let queue: Promise<void> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(() => undefined, () => undefined);
  return result;
}
async function open(): Promise<SQLiteDatabase> {
  if (!database) database = (async () => {
    const db = await openDatabaseAsync("qualitzer-offline-v1.db");
    await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000; "
      + "CREATE TABLE IF NOT EXISTS offline_states (namespace TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL); "
      + "CREATE TABLE IF NOT EXISTS offline_cache_entries (namespace TEXT NOT NULL, key TEXT NOT NULL, meta TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (namespace, key));");
    return db;
  })().catch((error: unknown) => { database = undefined; throw error; });
  return database;
}

interface StoredRow { meta: string; json: string; }
interface Known {
  /** Revisión de la base con la que coinciden `state` y `rows`. */
  revision: number;
  state: OfflineState;
  /** Filas de caché tal como están en la base (clave de la base → contenido); null si no se conocen. */
  rows: Map<string, StoredRow> | null;
}
const known = new Map<string, Known>();

function metaOf(entry: CacheEntry): string {
  const { key: _key, json: _json, ...rest } = entry;
  return JSON.stringify(rest);
}

export class SQLiteDurableStore implements DurableStore {
  read(namespace: string): Promise<OfflineState> {
    return serialize(async () => {
      const db = await open();
      const head = await db.getFirstAsync<{ revision: number }>("SELECT revision FROM offline_states WHERE namespace = ?", namespace);
      if (!head) { known.delete(namespace); return emptyState(); }
      const memo = known.get(namespace);
      if (memo && memo.revision === head.revision) return copyState(memo.state);
      const row = await db.getFirstAsync<{ revision: number; json: string }>("SELECT revision, json FROM offline_states WHERE namespace = ?", namespace);
      if (!row) { known.delete(namespace); return emptyState(); }
      const raw: unknown = JSON.parse(row.json);
      const record = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
      // Formato anterior (caché dentro del texto): no se sabe qué filas hay en la tabla, la primera escritura las reemplaza.
      let rows: Map<string, StoredRow> | null = null;
      if (record.cacheTable === true) {
        rows = new Map();
        const entries = await db.getAllAsync<{ key: string; meta: string; json: string }>("SELECT key, meta, json FROM offline_cache_entries WHERE namespace = ?", namespace);
        const cache: unknown[] = [];
        for (const entry of entries) {
          rows.set(entry.key, { meta: entry.meta, json: entry.json });
          const meta: unknown = JSON.parse(entry.meta);
          cache.push({ ...(meta !== null && typeof meta === "object" ? meta : {}), key: entry.key, json: entry.json });
        }
        record.cache = cache;
      }
      delete record.cacheTable;
      const state = decodeStateValue(record);
      known.set(namespace, { revision: row.revision, state: copyState(state), rows });
      return state;
    });
  }

  compareAndSwap(namespace: string, revision: number, next: OfflineState): Promise<boolean> {
    return serialize(async () => {
      const db = await open();
      const memo = known.get(namespace);
      let written = false;
      let rows = new Map<string, StoredRow>();
      await db.withExclusiveTransactionAsync(async (tx) => {
        const row = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM offline_states WHERE namespace = ?", namespace);
        if ((row?.revision ?? 0) !== revision || next.revision !== revision + 1) return;
        // Solo se puede comparar contra las filas conocidas si están al día con la revisión que se reemplaza;
        // si no (otro proceso escribió o venimos del formato anterior), se reescribe la caché completa una vez.
        const previous = memo && memo.revision === revision && (row?.revision ?? 0) === memo.revision ? memo.rows : null;
        if (!previous) await tx.runAsync("DELETE FROM offline_cache_entries WHERE namespace = ?", namespace);
        rows = new Map();
        for (const entry of next.cache) {
          const stored: StoredRow = { meta: metaOf(entry), json: entry.json };
          rows.set(entry.key, stored);
          const before = previous?.get(entry.key);
          if (before && before.meta === stored.meta && before.json === stored.json) continue;
          await tx.runAsync("INSERT INTO offline_cache_entries (namespace, key, meta, json) VALUES (?, ?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET meta = excluded.meta, json = excluded.json", namespace, entry.key, stored.meta, stored.json);
        }
        if (previous) for (const key of previous.keys()) {
          if (!rows.has(key)) await tx.runAsync("DELETE FROM offline_cache_entries WHERE namespace = ? AND key = ?", namespace, key);
        }
        const core = JSON.stringify({ ...next, cache: [], cacheTable: true });
        await tx.runAsync("INSERT INTO offline_states (namespace, revision, json) VALUES (?, ?, ?) ON CONFLICT(namespace) DO UPDATE SET revision = excluded.revision, json = excluded.json", namespace, next.revision, core);
        written = true;
      });
      if (written) known.set(namespace, { revision: next.revision, state: copyState(next), rows });
      else known.delete(namespace);
      return written;
    });
  }

  async namespaces(): Promise<string[]> { return (await (await open()).getAllAsync<{ namespace: string }>("SELECT namespace FROM offline_states")).map((row: { namespace: string }) => row.namespace); }
}

export async function createDurableStore(): Promise<DurableStore> { await open(); return new SQLiteDurableStore(); }
