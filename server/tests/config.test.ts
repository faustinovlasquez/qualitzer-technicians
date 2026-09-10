import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { decodeSessionSecret, loadConfig, resolveConfig, tenantsSchema, type TenantConfig } from "../config";
import { createSessionPersistence } from "../session-persistence";
import { TenantRegistry } from "../tenants";

const tenant: TenantConfig = { id: "grupo-eliseo-local", name: "Grupo Eliseo", tenantOrigin: "http://localhost:3000", backendUrl: "http://127.0.0.1:5001/api", environment: "development", enabled: true };
const fixture = (file: string): string => resolve(__dirname, "fixtures", file);

test("configuration-only compatibility creates exactly one local tenant using the existing environment routing", () => {
  const config = resolveConfig({ backendUrl: "http://backend.invalid:5001/api/", tenantOrigin: "http://portal.invalid", environment: "test" });
  assert.deepEqual(config.tenants, [{ id: "local", name: "Entorno local", backendUrl: "http://backend.invalid:5001/api", tenantOrigin: "http://portal.invalid", environment: "development", enabled: true }]);
  assert.equal(resolveConfig({}).tenants.length, 1);
  assert.deepEqual(resolveConfig({ tenants: [] }).tenants, []);
  assert.deepEqual(resolveConfig({ tenants: [{ ...tenant, enabled: false }] }).tenants, []);
});

test("tenant registry is strict, rejects unsafe URLs and requires typed explicit identity, environment and enabled flag", () => {
  for (const invalid of [
    { ...tenant, id: "" }, { ...tenant, id: "../escape" }, { ...tenant, name: "   " }, { ...tenant, environment: "test" },
    { ...tenant, enabled: "true" }, { ...tenant, enabled: undefined }, { ...tenant, database: "not-allowed" },
    { ...tenant, portalOrigin: tenant.tenantOrigin }, { ...tenant, backendUrl: "ftp://backend.invalid/api" },
    { ...tenant, backendUrl: "http:backend.invalid/api" }, { ...tenant, backendUrl: "http://@backend.invalid/api" },
    { ...tenant, backendUrl: "http://fixture-user:fixture-password@backend.invalid/api" },
    { ...tenant, backendUrl: "http://backend.invalid/api#fragment" }, { ...tenant, backendUrl: "http://backend.invalid/api#" },
    { ...tenant, backendUrl: "http://backend.invalid/api?target=arbitrary" }, { ...tenant, backendUrl: "http://backend.invalid/api?" },
    { ...tenant, backendUrl: "http://backend.invalid\\other/api" }, { ...tenant, backendUrl: " http://backend.invalid/api" },
    { ...tenant, backendUrl: "http://*.invalid/api" }, { ...tenant, backendUrl: "http://backend.invalid/\napi" },
    { ...tenant, tenantOrigin: "http://portal.invalid/path" }, { ...tenant, tenantOrigin: "http://portal.invalid/" },
    { ...tenant, tenantOrigin: "http://user:password@portal.invalid" }, { ...tenant, tenantOrigin: "http://portal.invalid#" },
  ]) assert.equal(tenantsSchema.safeParse([invalid]).success, false);
  assert.equal(tenantsSchema.safeParse({ tenants: [tenant] }).success, false);
  assert.throws(() => resolveConfig({ tenants: [tenant], ...{ discoveryUrl: "http://arbitrary.invalid" } }), { message: "GATEWAY_CONFIGURATION_ERROR" });
});

test("IDs and normalized routing tuples must each be unique including disabled tenants", () => {
  assert.throws(() => resolveConfig({ tenants: [tenant, { ...tenant, backendUrl: "http://other.invalid/api" }] }));
  assert.throws(() => resolveConfig({ tenants: [tenant, { ...tenant, id: "duplicate-route" }] }));
  assert.throws(() => resolveConfig({ tenants: [tenant, { ...tenant, id: "disabled-duplicate", enabled: false }] }));
  assert.throws(() => resolveConfig({ tenants: [
    { ...tenant, backendUrl: "http://backend.invalid/api" },
    { ...tenant, id: "canonical-duplicate", backendUrl: "http://BACKEND.invalid:80/api/" },
  ] }));
  const distinct = resolveConfig({ tenants: [tenant, { ...tenant, id: "same-backend", tenantOrigin: "http://second.invalid" }] });
  assert.equal(distinct.tenants.length, 2);
  assert.throws(() => new TenantRegistry([tenant, tenant]), { message: "GATEWAY_CONFIGURATION_ERROR" });
  const registry = new TenantRegistry([tenant, { ...tenant, id: "disabled", tenantOrigin: "http://disabled.invalid", enabled: false }]);
  assert.deepEqual(registry.list(), [{ id: tenant.id, name: tenant.name, portalOrigin: tenant.tenantOrigin, environment: tenant.environment }]);
  assert.throws(() => registry.get("disabled"), { status: 404, code: "TENANT_NOT_FOUND" });
  assert.throws(() => registry.get("local"), { status: 404, code: "TENANT_NOT_FOUND" });
});

test("production enforces HTTPS on every configured tenant plus existing explicit CORS and proxy protections", () => {
  const secure = { ...tenant, backendUrl: "https://backend.invalid/api", tenantOrigin: "https://portal.invalid", environment: "production" as const };
  const production = { environment: "production" as const, corsOrigins: ["https://mobile.invalid"], trustedProxyIps: ["127.0.0.1"] };
  assert.equal(resolveConfig({ ...production, tenants: [secure] }).host, "127.0.0.1");
  assert.throws(() => resolveConfig({ ...production, tenants: [secure, { ...tenant, id: "dev" }] }));
  assert.throws(() => resolveConfig({ ...production, tenants: [secure, { ...tenant, id: "disabled", enabled: false }] }));
  assert.throws(() => resolveConfig({ ...production, tenants: [secure], corsOrigins: ["http://mobile.invalid"] }));
  assert.throws(() => resolveConfig({ ...production, tenants: [secure], corsOrigins: undefined }));
  assert.throws(() => resolveConfig({ ...production, tenants: [secure], trustedProxyIps: [] }));
  assert.throws(() => resolveConfig({ tenants: [{ ...tenant, environment: "production" }] }));
});

test("loadConfig reads a local allowlist with explicit routes and never substitutes legacy env routing", () => {
  const config = loadConfig({ NODE_ENV: "test", GATEWAY_TENANTS_FILE: fixture("tenant-registry.json"), BACKEND_URL: "http://ignored.invalid/api", TENANT_ORIGIN: "http://ignored.invalid" });
  assert.deepEqual(config.tenants, [tenant]);
  const fromRelativePath = loadConfig({ NODE_ENV: "test", GATEWAY_TENANTS_FILE: relative(process.cwd(), fixture("tenant-registry.json")) });
  assert.deepEqual(fromRelativePath.tenants, config.tenants);
});

test("unreadable, malformed, remote or unsafe tenant files fail closed with sanitized errors", () => {
  for (const file of [
    fixture("absent-registry-file.json"), fixture("unsafe-registry.json"), fixture("malformed-registry.txt"),
    "https://backend.invalid/discovery", "file:///private/registry.json", "\\\\remote-server\\share\\tenants.json", "//remote-server/share/tenants.json", "",
  ]) {
    assert.throws(() => loadConfig({ GATEWAY_TENANTS_FILE: file, NODE_ENV: "test" }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^GATEWAY_TENANTS_FILE_(INVALID|UNREADABLE)$/);
      assert.doesNotMatch(error.message, /fixture-password|fixture-user|backend.invalid|private|remote-server/);
      return true;
    });
  }
  assert.throws(() => resolveConfig({ tenants: [{ ...tenant, backendUrl: "http://fixture-user:fixture-password@backend.invalid/api" }] }), { message: "GATEWAY_CONFIGURATION_ERROR" });
});

test("session persistence defaults only in loadConfig outside tests; direct app configuration remains memory-only", () => {
  const config = loadConfig({ NODE_ENV: "development", GATEWAY_TENANTS_FILE: fixture("tenant-registry.json") });
  assert.equal(config.sessionFile, resolve(__dirname, "../../.data/sessions.enc"));
  assert.equal(config.sessionSecret, undefined);
  const explicit = loadConfig({ GATEWAY_TENANTS_FILE: fixture("tenant-registry.json"), GATEWAY_SESSION_FILE: ".data/custom.enc" });
  assert.equal(explicit.sessionFile, resolve(".data/custom.enc"));
  const testing = loadConfig({ NODE_ENV: "test", GATEWAY_TENANTS_FILE: fixture("tenant-registry.json"), GATEWAY_SESSION_FILE: ".data/never-created.enc" });
  assert.equal(testing.sessionFile, undefined);
  assert.equal(createSessionPersistence(testing), undefined);
  assert.equal(createSessionPersistence(resolveConfig({ environment: "test", sessionFile: ".data/never-created.enc" })), undefined);
  assert.equal(createSessionPersistence(resolveConfig({})), undefined);
});

test("production loadConfig requires a 32-byte secret even without an explicit session file", (context) => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), { message: "GATEWAY_SESSION_SECRET_REQUIRED" });
  const directory = mkdtempSync(resolve(tmpdir(), "qzm-config-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = resolve(directory, "tenants.json");
  writeFileSync(file, JSON.stringify([{ ...tenant, backendUrl: "https://backend.invalid/api", tenantOrigin: "https://portal.invalid", environment: "production" }]));
  const key = Buffer.alloc(32, 171);
  for (const secret of [key.toString("hex"), key.toString("hex").toUpperCase(), key.toString("base64url")]) {
    const config = loadConfig({
      NODE_ENV: "production", GATEWAY_TENANTS_FILE: file, GATEWAY_CORS_ORIGINS: "https://mobile.invalid",
      GATEWAY_TRUSTED_PROXIES: "127.0.0.1", GATEWAY_SESSION_SECRET: secret,
    });
    assert.deepEqual(decodeSessionSecret(config.sessionSecret!), key);
    assert.equal(config.sessionFile, resolve(__dirname, "../../.data/sessions.enc"));
    assert.doesNotMatch(JSON.stringify(config), new RegExp(secret));
    assert.equal(inspect(config).includes(secret), false);
    assert.equal(resolveConfig(config).sessionSecret, secret);
  }
});

test("invalid session secrets fail with sanitized errors, never including supplied bytes or parser diagnostics", () => {
  const canonical = Buffer.alloc(32, 255).toString("base64url");
  for (const secret of ["", "sensitive-invalid-value", "a".repeat(63), "a".repeat(65), "g".repeat(64), `${canonical}=`, ` ${canonical}`, `${canonical}\n`, `${canonical.slice(0, -1)}9`]) {
    assert.throws(() => loadConfig({ NODE_ENV: "production", GATEWAY_SESSION_SECRET: secret }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "GATEWAY_SESSION_SECRET_INVALID");
      assert.equal("cause" in error, false);
      if (secret) assert.equal(inspect(error).includes(secret), false);
      return true;
    });
    assert.throws(() => resolveConfig({ sessionSecret: secret }), { message: "GATEWAY_CONFIGURATION_ERROR" });
  }
});

test("session storage paths reject remote, empty and control-character configuration", () => {
  for (const sessionFile of ["", " ", " .data/sessions.enc", "https://remote.invalid/sessions", "file:///private/sessions", "\\\\remote\\share\\sessions", "//remote/share/sessions", ".data/\nsessions.enc", ".data/\0sessions.enc"]) {
    assert.throws(() => resolveConfig({ sessionFile }), { message: "GATEWAY_CONFIGURATION_ERROR" });
  }
});