import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { LocalPhoto } from "../domain/models";
import { OfflineUnavailableError, type OfflineFile } from "../domain/offline";
import type { DurableFileStore, DurableStore } from "./contracts";
import { updateState, validateQuota } from "./state";
import { storageCapacity } from "./storageCapacity";

const ledger = "offline-file-reservations-v1";
let copies: Promise<void> = Promise.resolve();
const directory = () => new Directory(Paths.document, "offline");
function sourceFile(photo: LocalPhoto): File {
  if (!/^(file:\/\/\/|content:\/\/)/.test(photo.uri)) throw new OfflineUnavailableError("OFFLINE_EXPECTS_LOCAL_FILE");
  return new File(photo.uri);
}
function localFile(id: string): File {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new OfflineUnavailableError("OFFLINE_INVALID_FILE_ID");
  return new File(directory(), id);
}
export class NativeDurableFileStore implements DurableFileStore {
  constructor(private readonly store: DurableStore) {}
  async storageUsage() {
    const used = (await this.store.read(ledger)).reservations.reduce((total, reservation) => total + reservation.size, 0);
    return this.capacity(used);
  }
  private capacity(used: number) {
    try { return storageCapacity(used, Paths.availableDiskSpace, Paths.totalDiskSpace); }
    catch { return storageCapacity(used); }
  }
  async ownText(namespace: string, text: string, name: string): Promise<OfflineFile> {
    const id = Crypto.randomUUID();
    const temporary = new File(Paths.cache, `${id}.txt`);
    try {
      temporary.create();
      temporary.write(text);
      return await this.own(namespace, { id, uri: temporary.uri, name, mimeType: "text/plain" });
    } finally { try { if (temporary.exists) temporary.delete(); } catch {} }
  }
  async fingerprint(photo: LocalPhoto): Promise<Pick<OfflineFile, "size" | "sha256"> | null> {
    const source = sourceFile(photo);
    if (!source.exists) return null;
    validateQuota(source.size, 0);
    const bytes = await source.bytes();
    const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    return { size: bytes.length, sha256: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("") };
  }
  own(namespace: string, photo: LocalPhoto): Promise<OfflineFile> {
    const result = copies.then(() => this.copyOwned(namespace, photo));
    copies = result.then(() => undefined, () => undefined);
    return result;
  }
  private async copyOwned(namespace: string, photo: LocalPhoto): Promise<OfflineFile> {
    const source = sourceFile(photo);
    if (!source.exists) throw new OfflineUnavailableError("OFFLINE_SOURCE_FILE_MISSING");
    const id = Crypto.randomUUID();
    const size = source.size;
    await updateState(this.store, ledger, (state) => {
      const used = state.reservations.reduce((total, reservation) => total + reservation.size, 0);
      validateQuota(size, used, this.capacity(used).capacityBytes);
      state.reservations.push({ id, size, namespace });
    });
    const target = localFile(id);
    try {
      directory().create({ intermediates: true, idempotent: true });
      await source.copy(target);
      const bytes = await target.bytes();
      if (bytes.length !== size) throw new OfflineUnavailableError("OFFLINE_FILE_CHANGED_DURING_COPY");
      const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
      const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return { id, namespace, size, sha256, name: photo.name, mimeType: photo.mimeType };
    } catch (error) {
      if (target.exists) target.delete();
      await updateState(this.store, ledger, (state) => { state.reservations = state.reservations.filter((entry) => entry.id !== id); });
      throw error;
    }
  }
  async resolveURI(file: OfflineFile): Promise<string> {
    const reservation = (await this.store.read(ledger)).reservations.find((entry) => entry.id === file.id && entry.namespace === file.namespace);
    const target = localFile(file.id);
    if (!reservation || reservation.size !== file.size || !target.exists || target.size !== file.size) throw new OfflineUnavailableError("OFFLINE_LOCAL_FILE_MISSING");
    return target.uri;
  }
  async remove(file: OfflineFile): Promise<void> {
    const reservation = (await this.store.read(ledger)).reservations.find((entry) => entry.id === file.id && entry.namespace === file.namespace);
    if (!reservation) return;
    const target = localFile(file.id);
    if (target.exists) target.delete();
    await updateState(this.store, ledger, (state) => { state.reservations = state.reservations.filter((entry) => entry.id !== file.id); });
  }
  releaseURLs(): void {}
}
export function createFileStore(store: DurableStore): DurableFileStore { return new NativeDurableFileStore(store); }