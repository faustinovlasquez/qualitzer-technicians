import * as Crypto from "expo-crypto";
import type { Session } from "../domain/models";
import type { StoredSession } from "../infrastructure/sessionStorage";
import type { VerifiedOfflineProfile } from "../domain/offline";
import { NetworkError } from "../infrastructure/errors";
import { sameTenant } from "../domain/tenantSession";
import type { DurableStore } from "./contracts";
import { createDurableStore } from "./DurableStore";
import { offlineUserSchema, updateState } from "./state";
import { canonicalGatewayUrl } from "../../config/gatewayPolicy";

export const OFFLINE_PROFILE_MAX_AGE_MS: number | null = null;
const profilesNamespace = "offline-passports-v1";
async function passportKey(stored: StoredSession): Promise<string> {
  const tenant = stored.tenant;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(["offline-passport-v2", canonicalGatewayUrl(stored.gatewayUrl), tenant.id, tenant.portalOrigin, tenant.environment, stored.token]));
}
export async function saveOfflineProfile(session: Session, gatewayUrl: string, store?: DurableStore, now = Date.now()): Promise<void> {
  if (session.mode !== "live") return;
  if (!session.user.tenant || !sameTenant(session.tenant, session.user.tenant)) throw new Error("OFFLINE_PROFILE_TENANT_MISMATCH");
  const key = await passportKey({ token: session.token, tenant: session.tenant, branchId: session.branchId, gatewayUrl });
  const user = offlineUserSchema.parse(session.user);
  await updateState(store ?? await createDurableStore(), profilesNamespace, (state) => {
    state.passports = state.passports.filter((passport) => passport.key !== key);
    state.passports.push({ key, user, verifiedAt: now, disabled: false });
  });
}
export async function disableOfflineProfile(stored: StoredSession, store?: DurableStore): Promise<void> {
  const key = await passportKey(stored);
  await updateState(store ?? await createDurableStore(), profilesNamespace, (state) => {
    for (const passport of state.passports) if (passport.key === key) passport.disabled = true;
  });
}
export async function restoreOfflineProfile(stored: StoredSession, store?: DurableStore, maxAgeMs = OFFLINE_PROFILE_MAX_AGE_MS, now = Date.now()): Promise<VerifiedOfflineProfile | null> {
  const key = await passportKey(stored);
  const state = await (store ?? await createDurableStore()).read(profilesNamespace);
  const passport = state.passports.find((entry) => entry.key === key && !entry.disabled);
  if (!passport || !passport.user.tenant || !sameTenant(stored.tenant, passport.user.tenant)) return null;
  if (stored.branchId !== null && !passport.user.accessBranchs.some((branch) => branch.id === stored.branchId && branch.isEnabled !== false && branch.isDeleted !== true)) return null;
  if (maxAgeMs !== null && (now < passport.verifiedAt || now - passport.verifiedAt > maxAgeMs)) return null;
  return { user: passport.user, verifiedAt: passport.verifiedAt };
}
export async function restoreOfflineSession(stored: StoredSession, failure: unknown, store?: DurableStore): Promise<VerifiedOfflineProfile | null> {
  if (!(failure instanceof NetworkError)) return null;
  return restoreOfflineProfile(stored, store);
}