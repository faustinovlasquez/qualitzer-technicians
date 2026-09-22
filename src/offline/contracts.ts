import type { CreationInput, CreationResult } from "../domain/creation";
import type { LocalPhoto, User } from "../domain/models";
import type { OfflineCoverage, OfflineFile, OfflineOperation, OfflineScope, OfflineSyncPort } from "../domain/offline";

export const OFFLINE_LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  totalFileBytes: 500 * 1024 * 1024,
  cacheBytes: 16 * 1024 * 1024,
  cacheEntries: 180,
  leaseMs: 240_000,
  cycleOperations: 30,
  prepareWorks: 30,
  maxBackoffMs: 300_000,
} as const;
export interface CacheEntry { key: string; json: string; fetchedAt: number; coverage?: OfflineCoverage; timerReadOperationIds?: string[]; fileReadOperationIds?: string[]; }
export interface Passport { key: string; user: User; verifiedAt: number; disabled: boolean; }
export interface OfflineState {
  version: 1;
  revision: number;
  operations: OfflineOperation[];
  cache: CacheEntry[];
  revokedResources: Array<{ key: string; status: 403 | 404 }>;
  passports: Passport[];
  reservations: Array<{ id: string; size: number; namespace: string }>;
  attachments: Array<{ scope: OfflineScope; stepId?: string; attachmentId: string; file: OfflineFile }>;
  lease: { owner: string; until: number } | null;
  authBlocked: boolean;
  lastSyncedAt: number | null;
}
export interface DurableStore {
  read(namespace: string): Promise<OfflineState>;
  compareAndSwap(namespace: string, revision: number, next: OfflineState): Promise<boolean>;
  namespaces(): Promise<string[]>;
}
export interface DurableFileStore {
  storageUsage?(): Promise<import("../domain/offline").OfflineStorageUsage>;
  // Null means the local source is unavailable; readable sources must return a SHA-256 of their bytes without reserving storage.
  fingerprint?(photo: LocalPhoto): Promise<Pick<OfflineFile, "size" | "sha256"> | null>;
  own(namespace: string, photo: LocalPhoto): Promise<OfflineFile>;
  ownText?(namespace: string, text: string, name: string): Promise<OfflineFile>;
  resolveURI(file: OfflineFile): Promise<string>;
  remove(file: OfflineFile): Promise<void>;
  releaseURLs(): void;
}
export interface Connectivity {
  current(): Promise<boolean | null>;
  subscribe(listener: (connected: boolean | null) => void): () => void;
}
export interface OfflineUpstream extends Partial<OfflineSyncPort> {
  me(branchId?: number): Promise<User>;
  createRecord(input: CreationInput): Promise<CreationResult>;
}
export interface EngineDependencies {
  store: DurableStore;
  fileStore: DurableFileStore;
  connectivity: Connectivity;
  upstream: OfflineUpstream;
  namespace: string;
  branchId: number;
  user: User;
  now(): number;
  uuid(): string;
  onVerified?(user: User): Promise<void>;
  onAuthBlocked?(): Promise<void>;
  canAccessLocal?(): Promise<boolean>;
}