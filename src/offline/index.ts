import * as Crypto from "expo-crypto";
import type { TechnicianRepository } from "../domain/TechnicianRepository";
import type { Session } from "../domain/models";
import { tenantStorageNamespace } from "../domain/tenantSession";
import { OfflineUnavailableError } from "../domain/offline";
import { createDurableStore } from "./DurableStore";
import { createFileStore } from "./FileStore";
import { createConnectivity } from "./connectivity";
import { disableOfflineProfile, restoreOfflineProfile, saveOfflineProfile } from "./profiles";
import { OfflineTechnicianRepository } from "./OfflineTechnicianRepository";
import { offlineUserSchema, putCache, updateState } from "./state";
import type { Connectivity, DurableFileStore, DurableStore } from "./contracts";

export { OfflineTechnicianRepository } from "./OfflineTechnicianRepository";
export { OfflineEngine } from "./engine";
export { saveOfflineProfile, restoreOfflineProfile, restoreOfflineSession, disableOfflineProfile, OFFLINE_PROFILE_MAX_AGE_MS } from "./profiles";
export { OfflineQueuedError, OfflineUnavailableError, isOfflineQueuedError } from "../domain/offline";
export type { OfflineController, OfflineSnapshot, OfflineOperation, OfflineSyncPort } from "../domain/offline";
export { hasPendingChanges } from "./state";
export { OFFLINE_LIMITS } from "./contracts";

export interface OfflineRepositoryOptions {
  gatewayUrl: string;
  storageKey?: string;
  store?: DurableStore;
  fileStore?: DurableFileStore;
  connectivity?: Connectivity;
}
export async function createOfflineRepository(remote: TechnicianRepository, session: Session, input: string | OfflineRepositoryOptions): Promise<OfflineTechnicianRepository> {
  if (session.branchId === null || session.user.workerId === null) throw new OfflineUnavailableError("OFFLINE_BRANCH_AND_WORKER_REQUIRED");
  const options = typeof input === "string" ? { gatewayUrl: input } : input;
  const storageKeyHash = options.storageKey ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, options.storageKey) : "";
  const namespace = JSON.stringify(["offline-v1", tenantStorageNamespace(session, options.gatewayUrl, session.branchId), session.user.workerId, storageKeyHash]);
  const store = options.store ?? await createDurableStore();
  const stored = { token: session.token, tenant: session.tenant, branchId: session.branchId, gatewayUrl: options.gatewayUrl };
  const disableProfile = () => disableOfflineProfile(stored, store);
  const repository = new OfflineTechnicianRepository(remote, session, {
    namespace, store, fileStore: options.fileStore ?? createFileStore(store), connectivity: options.connectivity ?? createConnectivity(), upstream: remote,
    branchId: session.branchId, user: session.user, now: Date.now, uuid: Crypto.randomUUID,
    onVerified: (user) => saveOfflineProfile({ ...session, user }, options.gatewayUrl, store),
    onAuthBlocked: disableProfile,
    canAccessLocal: session.mode === "demo" ? undefined : async () => {
      const profile = await restoreOfflineProfile(stored, store);
      return profile?.user.id === session.user.id && profile.user.workerId === session.user.workerId;
    },
  }, disableProfile);
  const profile = session.mode === "live" ? await restoreOfflineProfile(stored, store) : null;
  if (profile && profile.user.id === session.user.id && profile.user.workerId === session.user.workerId) {
    await updateState(store, namespace, (state) => putCache(state, { key: "me", json: JSON.stringify(profile.user), fetchedAt: profile.verifiedAt }));
  }
  await repository.engine.refresh();
  return repository;
}

export async function establishVerifiedOfflineSession(repository: OfflineTechnicianRepository): Promise<void> {
  const user = await repository.engine.revalidate();
  const { store, namespace, now } = repository.dependencies;
  await updateState(store, namespace, (state) => {
    state.authBlocked = false;
    for (const operation of state.operations) if (operation.status === "auth_required") operation.status = "pending";
    putCache(state, { key: "me", json: JSON.stringify(offlineUserSchema.parse(user)), fetchedAt: now() });
  });
  await repository.engine.refresh();
}