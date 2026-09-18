/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as gatewayPolicy from "../../../config/gatewayPolicy";
import * as tenantSession from "../../domain/tenantSession";
import { NetworkError } from "../../infrastructure/errors";
import type { Session } from "../../domain/models";
import type { StoredSession } from "../../infrastructure/sessionStorage";
import * as state from "../state";
import { MemoryStore, user } from "./fakes";

type Profiles = typeof import("../profiles");
function profiles(): Profiles {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../profiles.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    module, exports: module.exports, URL, Error,
    require: (id: string): unknown => {
      if (id === "expo-crypto") return { CryptoDigestAlgorithm: { SHA256: "SHA256" }, digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex") };
      if (id === "../infrastructure/errors") return { NetworkError };
      if (id === "../domain/tenantSession") return tenantSession;
      if (id === "../../config/gatewayPolicy") return gatewayPolicy;
      if (id === "./state") return state;
      if (id === "./DurableStore") return { createDurableStore: () => { throw new Error("TEST_REQUIRES_EXPLICIT_STORE"); } };
      throw new Error(`UNEXPECTED_IMPORT:${id}`);
    },
  });
  return module.exports as Profiles;
}
const api = profiles();
assert.ok(user.tenant);
const session: Session = { mode: "live", token: `qzm_${"a".repeat(43)}`, tenant: user.tenant, user, branchId: 1 };
function stored(gatewayUrl: string): StoredSession { return { token: session.token, tenant: session.tenant, gatewayUrl, branchId: 1 }; }

test("root offline passport hash and namespace remain exactly compatible with persisted profiles", async () => {
  const store = new MemoryStore();
  const gateway = "https://EXAMPLE.com:443/";
  const { tenant, token } = session;
  const oldKey = createHash("sha256").update(JSON.stringify(["offline-passport-v2", new URL(gateway).origin, tenant.id, tenant.portalOrigin, tenant.environment, token])).digest("hex");
  await state.updateState(store, "offline-passports-v1", (value) => { value.passports.push({ key: oldKey, user, verifiedAt: 100, disabled: false }); });
  const before = await store.read("offline-passports-v1");
  assert.equal((await api.restoreOfflineSession(stored(gateway), new NetworkError("network"), store))?.verifiedAt, 100);
  assert.deepEqual(await store.read("offline-passports-v1"), before);
  await api.saveOfflineProfile(session, gateway, store, 200);
  assert.equal((await store.read("offline-passports-v1")).passports[0].key, oldKey);
  assert.equal((await store.read("offline-passports-v1")).passports.length, 1);
});

test("same token/user/tenant cannot restore or disable a passport belonging to another mounted base", async () => {
  const store = new MemoryStore();
  const origin = "https://api.example.com";
  await api.saveOfflineProfile(session, `${origin}/mobile/`, store, 100);
  const before = await store.read("offline-passports-v1");
  for (const gateway of [origin, `${origin}/other`, `${origin}/Mobile`]) assert.equal(await api.restoreOfflineProfile(stored(gateway), store), null);
  assert.equal((await api.restoreOfflineProfile(stored(`${origin}/mobile`), store))?.verifiedAt, 100);
  assert.deepEqual(await store.read("offline-passports-v1"), before);
  await api.disableOfflineProfile(stored(`${origin}/other`), store);
  assert.equal((await api.restoreOfflineProfile(stored(`${origin}/mobile`), store))?.verifiedAt, 100);
  await api.saveOfflineProfile(session, `${origin}/other`, store, 200);
  assert.equal((await store.read("offline-passports-v1")).passports.length, 2);
  await api.disableOfflineProfile(stored(`${origin}/mobile/`), store);
  assert.equal(await api.restoreOfflineProfile(stored(`${origin}/mobile`), store), null);
  assert.equal((await api.restoreOfflineProfile(stored(`${origin}/other`), store))?.verifiedAt, 200);
});

test("mounted base never adopts legacy origin-only passports or rewrites persisted data", async () => {
  const store = new MemoryStore();
  await api.saveOfflineProfile(session, "https://api.example.com", store, 100);
  const before = await store.read("offline-passports-v1");
  assert.equal(await api.restoreOfflineProfile(stored("https://api.example.com/mobile"), store), null);
  for (const path of ["/mobile/../", "/mobile/%2e%2e", "/mobile?", "/mobile/%2fother"]) await assert.rejects(api.restoreOfflineProfile(stored(`https://api.example.com${path}`), store));
  assert.deepEqual(await store.read("offline-passports-v1"), before);
});

test("offline startup accepts the saved verified identity without a network failure, but not another token, branch or revoked passport", async () => {
  const store = new MemoryStore();
  const gateway = "https://api.example.com/mobile";
  await api.saveOfflineProfile(session, gateway, store, 100);
  const candidate = stored(gateway);
  assert.equal((await api.restoreOfflineProfile(candidate, store))?.user.id, session.user.id);
  assert.equal(await api.restoreOfflineProfile({ ...candidate, token: `qzm_${"b".repeat(43)}` }, store), null);
  assert.equal(await api.restoreOfflineProfile({ ...candidate, branchId: 999 }, store), null);
  assert.equal(await api.restoreOfflineProfile({ ...candidate, tenant: { ...candidate.tenant, id: "another" } }, store), null);
  await api.disableOfflineProfile(candidate, store);
  assert.equal(await api.restoreOfflineProfile(candidate, store), null);
  const stateAfter = await store.read("offline-passports-v1");
  assert.equal(stateAfter.passports.length, 1);
  assert.equal(stateAfter.passports[0].disabled, true);
});