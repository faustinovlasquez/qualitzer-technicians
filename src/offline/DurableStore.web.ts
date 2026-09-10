import type { DurableStore, OfflineState } from "./contracts";
import { decodeState, emptyState } from "./state";
import { openOfflineDatabase, transactionComplete } from "./indexedDatabase.web";

export class IndexedDBDurableStore implements DurableStore {
  async read(namespace: string): Promise<OfflineState> {
    const db = await openOfflineDatabase();
    const tx = db.transaction("states", "readonly");
    const completed = transactionComplete(tx);
    let state = emptyState();
    let failure: unknown;
    const request = tx.objectStore("states").get(namespace);
    request.onsuccess = () => {
      try {
        const value: unknown = request.result;
        if (value !== undefined) {
          if (typeof value !== "string") throw new Error("OFFLINE_CORRUPT_STATE");
          state = decodeState(value);
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await completed; } catch (error) { throw failure ?? error; }
    return state;
  }
  async compareAndSwap(namespace: string, revision: number, next: OfflineState): Promise<boolean> {
    const db = await openOfflineDatabase();
    const tx = db.transaction("states", "readwrite");
    const completed = transactionComplete(tx);
    const store = tx.objectStore("states");
    let written = false;
    let failure: unknown;
    const request = store.get(namespace);
    request.onsuccess = () => {
      try {
        const value: unknown = request.result;
        if (value !== undefined && typeof value !== "string") throw new Error("OFFLINE_CORRUPT_STATE");
        const previous = typeof value === "string" ? decodeState(value) : emptyState();
        if (previous.revision !== revision || next.revision !== revision + 1) return;
        store.put(JSON.stringify(next), namespace);
        written = true;
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await completed; } catch (error) { throw failure ?? error; }
    return written;
  }
  async namespaces(): Promise<string[]> {
    const db = await openOfflineDatabase();
    const tx = db.transaction("states", "readonly");
    const completed = transactionComplete(tx);
    let keys: string[] = [];
    const request = tx.objectStore("states").getAllKeys();
    request.onsuccess = () => { keys = request.result.filter((key): key is string => typeof key === "string"); };
    await completed;
    return keys;
  }
}
export async function createDurableStore(): Promise<DurableStore> { await openOfflineDatabase(); return new IndexedDBDurableStore(); }