import * as Crypto from "expo-crypto";
import type { LocalPhoto } from "../domain/models";
import { OfflineUnavailableError, type OfflineFile } from "../domain/offline";
import type { DurableFileStore, DurableStore } from "./contracts";
import { validateQuota } from "./state";
import { openOfflineDatabase, transactionComplete } from "./indexedDatabase.web";

interface StoredBlob { blob: Blob; namespace: string; }
function storedBlob(value: unknown): StoredBlob {
  if (typeof value !== "object" || !value || !("blob" in value) || !(value.blob instanceof Blob) || !("namespace" in value) || typeof value.namespace !== "string") throw new OfflineUnavailableError("OFFLINE_INVALID_BLOB");
  return { blob: value.blob, namespace: value.namespace };
}
export class IndexedDBFileStore implements DurableFileStore {
  private urls = new Map<string, string>();
  async fingerprint(photo: LocalPhoto): Promise<Pick<OfflineFile, "size" | "sha256"> | null> {
    if (!/^(blob:|data:)/.test(photo.uri)) throw new OfflineUnavailableError("OFFLINE_EXPECTS_LOCAL_BLOB");
    let response: Response;
    try { response = await fetch(photo.uri); }
    catch (error) {
      if (photo.uri.startsWith("blob:") && error instanceof TypeError) return null;
      throw error;
    }
    if (!response.ok) throw new OfflineUnavailableError("OFFLINE_SOURCE_FILE_UNREADABLE");
    const blob = await response.blob();
    validateQuota(blob.size, 0);
    const sha256 = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { size: blob.size, sha256 };
  }
  async own(namespace: string, photo: LocalPhoto): Promise<OfflineFile> {
    if (!/^(blob:|data:)/.test(photo.uri)) throw new OfflineUnavailableError("OFFLINE_EXPECTS_LOCAL_BLOB");
    const response = await fetch(photo.uri);
    if (!response.ok) throw new OfflineUnavailableError("OFFLINE_SOURCE_FILE_MISSING");
    const blob = await response.blob();
    validateQuota(blob.size, 0);
    const sha256 = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const id = Crypto.randomUUID();
    const db = await openOfflineDatabase();
    const tx = db.transaction("blobs", "readwrite");
    const completed = transactionComplete(tx);
    const store = tx.objectStore("blobs");
    let used = 0;
    let failure: unknown;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      try {
        if (cursor.result) { used += storedBlob(cursor.result.value).blob.size; cursor.result.continue(); }
        else { validateQuota(blob.size, used); store.add({ blob, namespace } satisfies StoredBlob, id); }
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await completed; } catch (error) { throw failure ?? error; }
    return { id, namespace, size: blob.size, sha256, name: photo.name, mimeType: photo.mimeType };
  }
  async resolveURI(file: OfflineFile): Promise<string> {
    const urlKey = JSON.stringify([file.namespace, file.id]);
    const db = await openOfflineDatabase();
    const tx = db.transaction("blobs", "readonly");
    const completed = transactionComplete(tx);
    let blob: Blob | undefined;
    let failure: unknown;
    const request = tx.objectStore("blobs").get(file.id);
    request.onsuccess = () => {
      try {
        const value = storedBlob(request.result);
        if (value.namespace !== file.namespace || value.blob.size !== file.size) throw new OfflineUnavailableError("OFFLINE_BLOB_IDENTITY_MISMATCH");
        blob = value.blob;
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await completed; } catch (error) { throw failure ?? error; }
    if (!blob) throw new OfflineUnavailableError("OFFLINE_LOCAL_FILE_MISSING");
    const sha256 = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (sha256 !== file.sha256) throw new OfflineUnavailableError("OFFLINE_FILE_INTEGRITY_MISMATCH");
    const current = this.urls.get(urlKey);
    if (current) return current;
    const uri = URL.createObjectURL(blob);
    this.urls.set(urlKey, uri);
    return uri;
  }
  async remove(file: OfflineFile): Promise<void> {
    const db = await openOfflineDatabase();
    const tx = db.transaction("blobs", "readwrite");
    const completed = transactionComplete(tx);
    const store = tx.objectStore("blobs");
    const request = store.get(file.id);
    request.onsuccess = () => {
      if (request.result === undefined) return;
      try { if (storedBlob(request.result).namespace === file.namespace) store.delete(file.id); } catch { tx.abort(); }
    };
    await completed;
    const urlKey = JSON.stringify([file.namespace, file.id]);
    const uri = this.urls.get(urlKey);
    if (uri) URL.revokeObjectURL(uri);
    this.urls.delete(urlKey);
  }
  releaseURLs(): void { for (const uri of this.urls.values()) URL.revokeObjectURL(uri); this.urls.clear(); }
}
export function createFileStore(_store: DurableStore): DurableFileStore { return new IndexedDBFileStore(); }