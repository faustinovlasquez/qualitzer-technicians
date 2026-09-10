let database: Promise<IDBDatabase> | undefined;
export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("qualitzer-offline-v1", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("states")) db.createObjectStore("states");
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => { database = undefined; reject(request.error ?? new Error("OFFLINE_IDB_UNAVAILABLE")); };
    request.onblocked = () => { database = undefined; reject(new Error("OFFLINE_IDB_UPGRADE_BLOCKED")); };
  });
  return database;
}
export function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("OFFLINE_IDB_TRANSACTION_ABORTED"));
    tx.onerror = () => reject(tx.error ?? new Error("OFFLINE_IDB_TRANSACTION_FAILED"));
  });
}