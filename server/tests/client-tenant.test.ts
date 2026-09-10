import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_TENANT, requireSessionTenant, sameTenant, tenantStorageNamespace } from "../../src/domain/tenantSession";
import type { Tenant } from "../../src/domain/models";
import { tenantListSchema, tenantLoginSchema } from "../../src/infrastructure/tenantSchemas";
import { user } from "./fixtures";

const first: Tenant = { id: "first", name: "Primera empresa", portalOrigin: "https://first.example", environment: "production" };
const second: Tenant = { id: "second", name: "Segunda empresa", portalOrigin: "https://second.example", environment: "production" };
test("client namespaces isolate identical users and branches by tenant, portal, gateway and mode", () => {
  const session = { mode: "live" as const, tenant: first, user: user() };
  const key = tenantStorageNamespace(session, "https://gateway.example", 1);
  const others = [
    tenantStorageNamespace({ ...session, tenant: second }, "https://gateway.example", 1),
    tenantStorageNamespace({ ...session, tenant: { ...first, portalOrigin: "https://changed.example" } }, "https://gateway.example", 1),
    tenantStorageNamespace(session, "https://gateway2.example", 1),
    tenantStorageNamespace(session, "https://gateway.example", 2),
    tenantStorageNamespace({ ...session, mode: "demo", tenant: DEMO_TENANT }, "https://gateway.example", 1),
  ];
  for (const other of others) assert.notEqual(key, other);
});
test("client fails closed on missing or changed session tenant even if user IDs match", () => {
  assert.throws(() => requireSessionTenant(first, undefined));
  assert.throws(() => requireSessionTenant(first, second));
  assert.throws(() => requireSessionTenant(first, { ...first, environment: "development" }));
  assert.throws(() => requireSessionTenant(first, { ...first, portalOrigin: second.portalOrigin }));
  assert.equal(requireSessionTenant(first, { ...first, name: "Nombre actualizado" }).id, first.id);
  assert.equal(sameTenant(first, second), false);
});
test("catalog rejects duplicate tenant IDs and unsafe portal origins", () => {
  assert.equal(tenantListSchema.safeParse({ data: [first, { ...second, id: first.id }] }).success, false);
  assert.equal(tenantListSchema.safeParse({ data: [{ ...first, portalOrigin: "https://user:secret@first.example" }] }).success, false);
  assert.equal(tenantListSchema.safeParse({ data: [first, second] }).success, true);
});
test("client login requires opaque gateway credentials and explicit tenant metadata", () => {
  const login = { username: "same", email: "same@example.invalid", nextStep: "DONE", token: `qzm_${"a".repeat(43)}`, tenant: first };
  assert.equal(tenantLoginSchema.safeParse(login).success, true);
  assert.equal(tenantLoginSchema.safeParse({ ...login, token: "raw.jwt.token" }).success, false);
  assert.equal(tenantLoginSchema.safeParse({ ...login, tenant: undefined }).success, false);
});