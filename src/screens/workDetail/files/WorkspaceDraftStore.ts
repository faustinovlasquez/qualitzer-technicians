import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { z } from "zod";
import type { LocalPhoto } from "../../../domain/models";
import { errorMessage } from "../detailRules";
import { describeFile, DOCUMENT_MIME_TYPES, fileExtension, MAX_COMMENT_LENGTH, MAX_FILE_BYTES, MAX_FILES, MAX_FILES_BYTES, type SelectedFile, type WorkspaceMode } from "./fileRules";

const namespace = "@qualitzer/file-workspace/v1/";
const directorySchema = z.string().regex(/^scope-[a-z0-9-]{10,100}$/);
const storedFileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{10,100}$/),
  name: z.string().min(1).max(240).refine((value) => !/[\u0000-\u001f\u007f/\\]/.test(value)),
  mimeType: z.string().refine((value) => DOCUMENT_MIME_TYPES.includes(value)),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  uploaded: z.boolean(),
});
const filesSchema = z.array(storedFileSchema).max(MAX_FILES).refine((files) => new Set(files.map((file) => file.id)).size === files.length && files.reduce((sum, file) => sum + file.size, 0) <= MAX_FILES_BYTES);
const textSchema = z.string().max(MAX_COMMENT_LENGTH);
const stores = new Map<string, WorkspaceDraftStore>();
const cleanups = new Map<string, Promise<void>>();
const suffixes = ["files", "directory", "comment", "comment-sent"];
let fileSequence = 0;

export interface WorkspaceFileDraft extends LocalPhoto { size: number; uploaded: boolean; }
interface WorkspaceSnapshot {
  files: WorkspaceFileDraft[];
  text: string;
  confirmedText: string | null;
  hydrated: boolean;
  saving: boolean;
  error: string | null;
  fileBusy: boolean;
  commentBusy: boolean;
  closed: boolean;
}

function storageBase(scopeKey: string, mode: WorkspaceMode): string { return `${namespace}${mode}/${encodeURIComponent(scopeKey)}`; }
function localId(): string { return `${Date.now().toString(36)}-${(++fileSequence).toString(36)}-${Math.random().toString(36).slice(2).padEnd(12, "0")}`; }
function rootDirectory(): Directory { return new Directory(Paths.document, "qualitzer-file-workspaces"); }
function readJson(raw: string): unknown { return JSON.parse(raw); }

export class WorkspaceDraftStore {
  private snapshot: WorkspaceSnapshot = { files: [], text: "", confirmedText: null, hydrated: false, saving: false, error: null, fileBusy: false, commentBusy: false, closed: false };
  private listeners = new Set<() => void>();
  private tail: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private directory: Directory | null = null;
  private fileLease: symbol | null = null;
  readonly key: string;

  constructor(readonly scopeKey: string, readonly mode: WorkspaceMode) {
    this.key = storageBase(scopeKey, mode);
    void this.restore().catch(() => {});
  }

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  private publish(update: Partial<WorkspaceSnapshot>): void {
    if (this.snapshot.closed) return;
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Un observador no puede revertir archivos ya persistidos. */ }
    }
  }

  private enqueue<T>(operation: () => Promise<T>, protectDraft = true): Promise<T> {
    this.pendingWrites += 1;
    this.publish({ saving: true });
    const result = this.tail.then(async () => {
      if (this.snapshot.closed) throw new Error("La sesión de borradores está cerrada.");
      return operation();
    });
    this.tail = result.then(() => {}, (error: unknown) => { if (protectDraft) this.publish({ error: `No se pudo proteger el borrador: ${errorMessage(error)}` }); }).finally(() => {
      this.pendingWrites -= 1;
      this.publish({ saving: this.pendingWrites > 0 });
    });
    return result;
  }

  private requireReady(): void {
    if (!this.snapshot.hydrated || this.snapshot.closed) throw new Error("Primero recupera el borrador de este destino.");
  }

  private async restore(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.scopeKey.trim()) throw new Error("Falta la clave de almacenamiento del destino.");
      const [rawFiles, rawDirectory, rawText, rawSent] = await Promise.all(suffixes.map((suffix) => AsyncStorage.getItem(`${this.key}/${suffix}`)));
      const stored = rawFiles === null ? [] : filesSchema.parse(readJson(rawFiles));
      const text = rawText === null ? "" : textSchema.parse(readJson(rawText));
      const sent = rawSent === null ? null : textSchema.parse(readJson(rawSent));
      if (Platform.OS !== "web" && rawDirectory !== null) this.directory = new Directory(rootDirectory(), directorySchema.parse(readJson(rawDirectory)));
      if (Platform.OS !== "web" && stored.length > 0 && !this.directory) throw new Error("No se encontró la carpeta del borrador. No se sobrescribirán sus datos.");
      const files: WorkspaceFileDraft[] = Platform.OS === "web" ? this.snapshot.files : stored.map((file) => ({ ...file, uri: this.nativeFile(file).uri, uploaded: file.uploaded || this.sentMarker(file.id).exists }));
      this.publish({ files, text: text === sent ? "" : text, confirmedText: sent, hydrated: true, error: null });
    });
  }

  private nativeFile(file: Pick<WorkspaceFileDraft, "id" | "mimeType">): File {
    if (!this.directory) throw new Error("La carpeta del borrador no está disponible.");
    return new File(this.directory, `${file.id}.${fileExtension(file.mimeType)}`);
  }

  private sentMarker(id: string): File {
    if (!this.directory) throw new Error("La carpeta del borrador no está disponible.");
    return new File(this.directory, `${id}.sent`);
  }

  private async ensureDirectory(): Promise<void> {
    if (Platform.OS === "web") return;
    if (!this.directory) {
      let name = `scope-${localId()}`;
      while (new Directory(rootDirectory(), name).exists) name = `scope-${localId()}`;
      await AsyncStorage.setItem(`${this.key}/directory`, JSON.stringify(name));
      this.directory = new Directory(rootDirectory(), name);
    }
    this.directory.create({ idempotent: true, intermediates: true });
  }

  private async saveFiles(files: WorkspaceFileDraft[]): Promise<void> {
    if (Platform.OS === "web") return;
    const metadata = files.map(({ id, name, mimeType, size, uploaded }) => ({ id, name, mimeType, size, uploaded }));
    await AsyncStorage.setItem(`${this.key}/files`, JSON.stringify(filesSchema.parse(metadata)));
  }

  private deleteCopy(file: WorkspaceFileDraft): void {
    if (Platform.OS === "web") { URL.revokeObjectURL(file.uri); return; }
    const native = this.nativeFile(file);
    if (native.exists) native.delete();
    const marker = this.sentMarker(file.id);
    if (marker.exists) marker.delete();
  }

  beginFiles = (): symbol | null => {
    if (this.snapshot.closed || !this.snapshot.hydrated || this.snapshot.fileBusy) return null;
    this.fileLease = Symbol("workspace-files");
    this.publish({ fileBusy: true });
    return this.fileLease;
  };
  endFiles = (lease: symbol): void => {
    if (this.fileLease !== lease) return;
    this.fileLease = null;
    this.publish({ fileBusy: false });
  };
  beginComment = (): boolean => {
    if (this.snapshot.closed || !this.snapshot.hydrated || this.snapshot.commentBusy) return false;
    this.publish({ commentBusy: true });
    return true;
  };
  endComment = (): void => { this.publish({ commentBusy: false }); };

  addFiles = (assets: SelectedFile[]): Promise<void> => this.enqueue(async () => {
    this.requireReady();
    const existing = this.snapshot.files;
    if (existing.length + assets.length > MAX_FILES) throw new Error(`El máximo es de ${MAX_FILES} archivos pendientes por destino. No se añadió esta selección.`);
    const metadata = assets.map(describeFile);
    if (existing.reduce((sum, file) => sum + file.size, 0) + metadata.reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) throw new Error("La selección supera 40 MB (40 MiB) en total. No se añadió ningún archivo.");
    await this.ensureDirectory();
    const prepared: WorkspaceFileDraft[] = [];
    try {
      for (const [index, asset] of assets.entries()) {
        const info = metadata[index];
        const id = localId();
        if (Platform.OS === "web") {
          if (!asset.blob) throw new Error("El navegador no entregó el archivo. Vuelve a seleccionarlo.");
          prepared.push({ ...info, id, uri: URL.createObjectURL(asset.blob), uploaded: false });
        } else {
          const destination = this.nativeFile({ id, mimeType: info.mimeType });
          prepared.push({ ...info, id, uri: destination.uri, uploaded: false });
          await new File(asset.uri).copy(destination);
          if (!destination.exists || destination.size !== info.size) throw new Error(`No se pudo copiar íntegramente «${info.name}».`);
        }
      }
      const next = [...existing, ...prepared];
      this.requireReady();
      await this.saveFiles(next);
      this.requireReady();
      this.publish({ files: next });
    } catch (error) {
      let cleanupFailed = false;
      for (const file of prepared) { try { this.deleteCopy(file); } catch { cleanupFailed = true; } }
      throw new Error(`${errorMessage(error)}${cleanupFailed ? " Quedaron copias locales que se limpiarán al cerrar la sesión." : ""}`);
    }
  }, false);

  validateFile = (file: WorkspaceFileDraft, requireSource = true): void => {
    this.requireReady();
    if (file.uploaded) throw new Error("Este archivo ya fue confirmado; no se volverá a enviar.");
    if (requireSource && Platform.OS !== "web") {
      const native = this.nativeFile(file);
      if (!native.exists || native.size !== file.size) throw new Error(`«${file.name}» ya no está disponible o cambió de tamaño. Quítalo y vuelve a seleccionarlo.`);
    }
    storedFileSchema.parse(file);
  };

  private async forgetFile(id: string): Promise<void> {
    const file = this.snapshot.files.find((candidate) => candidate.id === id);
    if (!file) return;
    const next = this.snapshot.files.filter((candidate) => candidate.id !== id);
    await this.saveFiles(next);
    this.publish({ files: next });
    try { this.deleteCopy(file); }
    catch { throw new Error("El archivo ya no está pendiente, pero no se pudo borrar su copia local. Se volverá a limpiar al cerrar sesión."); }
  }

  removeFile = (id: string): Promise<void> => this.enqueue(async () => { this.requireReady(); await this.forgetFile(id); }, false);

  confirmFile = (id: string): Promise<void> => {
    this.publish({ files: this.snapshot.files.map((file) => file.id === id ? { ...file, uploaded: true } : file) });
    return this.enqueue(async () => {
      this.requireReady();
      let markerFailure: unknown;
      if (Platform.OS !== "web") {
        try { const marker = this.sentMarker(id); marker.create({ overwrite: true }); marker.write("confirmed"); }
        catch (error) { markerFailure = error; }
      }
      try { await this.saveFiles(this.snapshot.files); }
      catch (error) { throw new Error(`El envío fue confirmado, pero falta guardar la limpieza local. No vuelvas a enviarlo.${markerFailure ? " No cierres la app hasta reintentar la limpieza." : ""} ${errorMessage(error)}`); }
      await this.forgetFile(id);
    });
  };

  setText = (text: string): Promise<void> => {
    this.requireReady();
    textSchema.parse(text);
    const newComment = this.snapshot.confirmedText !== null && text !== this.snapshot.confirmedText;
    this.publish({ text, ...(newComment ? { confirmedText: null } : {}) });
    return this.enqueue(async () => {
      if (text.length === 0) await AsyncStorage.removeItem(`${this.key}/comment`);
      else await AsyncStorage.setItem(`${this.key}/comment`, JSON.stringify(text));
      if (newComment) await AsyncStorage.removeItem(`${this.key}/comment-sent`);
    });
  };

  confirmComment = (text: string): Promise<void> => {
    this.publish({ confirmedText: text });
    return this.enqueue(async () => {
      this.requireReady();
      await AsyncStorage.setItem(`${this.key}/comment-sent`, JSON.stringify(text));
      if (this.snapshot.text === text) {
        await AsyncStorage.removeItem(`${this.key}/comment`);
        if (this.snapshot.text === text) this.publish({ text: "" });
      }
    });
  };

  flush = async (): Promise<void> => {
    let pending: Promise<void>;
    do { pending = this.tail; await pending; } while (pending !== this.tail);
    this.requireReady();
    if (this.snapshot.error) throw new Error(this.snapshot.error);
  };

  retry = async (): Promise<void> => {
    if (!this.snapshot.hydrated) return this.restore();
    await this.enqueue(async () => {
      await this.saveFiles(this.snapshot.files);
      if (this.snapshot.confirmedText !== null) await AsyncStorage.setItem(`${this.key}/comment-sent`, JSON.stringify(this.snapshot.confirmedText));
      else await AsyncStorage.removeItem(`${this.key}/comment-sent`);
      const text = this.snapshot.text === this.snapshot.confirmedText ? "" : this.snapshot.text;
      if (text) await AsyncStorage.setItem(`${this.key}/comment`, JSON.stringify(text));
      else await AsyncStorage.removeItem(`${this.key}/comment`);
      if (this.snapshot.text === this.snapshot.confirmedText) this.publish({ text: "" });
      this.publish({ error: null });
    });
  };

  close = async (): Promise<void> => {
    const files = this.snapshot.files;
    this.publish({ closed: true, files: [], text: "", confirmedText: null, hydrated: false, error: "Sesión cerrada.", fileBusy: false, commentBusy: false });
    await this.tail;
    if (Platform.OS === "web") for (const file of files) URL.revokeObjectURL(file.uri);
  };
}

export function useWorkspaceDraft(scopeKey: string, mode: WorkspaceMode) {
  const store = useMemo(() => {
    const key = storageBase(scopeKey, mode);
    const existing = stores.get(key);
    if (existing && !existing.getSnapshot().closed) return existing;
    const created = new WorkspaceDraftStore(scopeKey, mode);
    stores.set(key, created);
    if ([...cleanups.keys()].some((prefix) => scopeKey.startsWith(prefix))) void created.close();
    return created;
  }, [scopeKey, mode]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, store };
}

async function cleanupScopes(prefix: string): Promise<void> {
  const entries = [...stores.entries()].filter(([, store]) => store.scopeKey.startsWith(prefix));
  await Promise.all(entries.map(([, store]) => store.close()));
  const keys = await AsyncStorage.getAllKeys();
  const bases = new Set(entries.map(([key]) => key));
  for (const key of keys) {
    if (!key.startsWith(namespace)) continue;
    const parts = key.slice(namespace.length).split("/");
    if (parts.length !== 3 || !["live", "demo"].includes(parts[0]) || !suffixes.includes(parts[2])) continue;
    try { if (decodeURIComponent(parts[1]).startsWith(prefix)) bases.add(key.slice(0, key.lastIndexOf("/"))); } catch { continue; }
  }
  let failures = 0;
  for (const base of bases) {
    try {
      if (Platform.OS !== "web") {
        const raw = await AsyncStorage.getItem(`${base}/directory`);
        if (raw !== null) {
          const directory = new Directory(rootDirectory(), directorySchema.parse(readJson(raw)));
          if (directory.exists) directory.delete();
        }
      }
      await AsyncStorage.multiRemove(suffixes.map((suffix) => `${base}/${suffix}`));
      stores.delete(base);
    } catch { failures += 1; }
  }
  if (failures > 0) throw new Error(`No se pudieron limpiar los borradores de ${failures} destinos. Reintenta la limpieza de esta sesión.`);
}

export function cleanupFileWorkspace(storageKeyPrefix: string): Promise<void> {
  if (!storageKeyPrefix.trim()) return Promise.reject(new Error("La limpieza requiere un prefijo de sesión no vacío."));
  const current = cleanups.get(storageKeyPrefix);
  if (current) return current;
  const cleanup = cleanupScopes(storageKeyPrefix).finally(() => { cleanups.delete(storageKeyPrefix); });
  cleanups.set(storageKeyPrefix, cleanup);
  return cleanup;
}