import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tenant } from "../../src/domain/models";
import { BRANDING_TTL_MS, brandedTenant, MAX_BRANDING_IMAGE_BYTES, sanitizeLogo } from "../branding";
import type { TenantConfig } from "../config";
import { GatewayError } from "../errors";
import { MAX_RUNTIME_TENANTS, TenantRegistry } from "../tenants";
import type { Upstream } from "../upstream";
import { PNG } from "./fixtures";

const config = (id: string): TenantConfig => ({ id, name: `Configured ${id}`, backendUrl: "http://127.0.0.1:5001/api", tenantOrigin: `http://${id}.localhost:3000`, environment: "development", enabled: true });
const tenant: Tenant = { id: "a", name: "Configured a", portalOrigin: "http://a.localhost:3000", environment: "development" };
const logo = `data:image/png;base64,${PNG.toString("base64")}`;

test("branding allows bounded PNG/JPEG/WebP base64 only, rejecting SVG, malformed and oversized images", () => {
  for (const mime of ["png", "jpeg", "webp"]) {
    const value = `data:image/${mime};base64,${PNG.toString("base64")}`;
    assert.equal(sanitizeLogo(value), value);
  }
  const boundary = `data:image/png;base64,${Buffer.alloc(MAX_BRANDING_IMAGE_BYTES).toString("base64")}`;
  assert.equal(sanitizeLogo(boundary), boundary);
  for (const value of [null, {}, 1, "", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/gif;base64,R0lG", "data:text/html;base64,PHNjcmlwdD4=", "data:image/png;base64,", "data:image/png;base64,%%%%", "data:image/png;base64,YQ", "data:image/png;base64,YR==", "data:image/png;base64,YQ==\n", `data:image/png;base64,${Buffer.alloc(MAX_BRANDING_IMAGE_BYTES + 1).toString("base64")}`]) {
    assert.equal(sanitizeLogo(value), undefined);
  }
});

test("HTTPS logo URLs from the trusted backend are returned without downloads, credentials or URL normalization bypasses", () => {
  const https = "https://bucket.s3.example.invalid/brand.png?version=2";
  assert.equal(sanitizeLogo(https), https);
  assert.equal(sanitizeLogo("https://bucket.example.invalid?version=a@b"), "https://bucket.example.invalid/?version=a@b");
  for (const value of ["http://bucket.example.invalid/logo.png", "//example.invalid/logo.png", "javascript:alert(1)", "file:///logo.png", "https://user:password@example.invalid/logo", "https://@example.invalid/logo", " https://example.invalid/logo", "https://example.invalid/lo\tgo", "https://example.invalid/lo\ngo", "https:\\example.invalid/logo", "https://example.invalid/logo ", `https://example.invalid/${"a".repeat(2048)}`]) {
    assert.equal(sanitizeLogo(value), undefined);
  }
});

test("branding preserves frozen routing identity, strips extra metadata and bounds name and description independently", () => {
  const result = brandedTenant(tenant, { name: " Branded ", description: " About ", logo, id: "evil", portalOrigin: "https://evil.invalid", environment: "production", backendUrl: "private", token: "secret" });
  assert.deepEqual(result, { ...tenant, name: "Branded", description: "About", logo });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(brandedTenant(tenant, { name: "n".repeat(121), description: "d".repeat(5001), logo: "data:image/svg+xml;base64,PHN2Zy8+" }), tenant);
  assert.deepEqual(brandedTenant(tenant, { name: " ", description: {}, logo: 12 }), tenant);
  assert.deepEqual(brandedTenant(tenant, null), tenant);
  assert.deepEqual(brandedTenant(tenant, { name: "n".repeat(120), description: "d".repeat(5000), logo: null }), { ...tenant, name: "n".repeat(120), description: "d".repeat(5000), logo: null });
});

test("display cache is tenant-scoped, deduplicates concurrent fetches and refreshes at five minutes without mutating get/list", async (t) => {
  let now = 1000;
  const registry = new TenantRegistry([config("a"), config("b")], () => now);
  const original = registry.get("a").tenant;
  let name = "First";
  const calls: string[] = [];
  for (const id of ["a", "b"]) {
    t.mock.method(registry.get(id).upstream, "request", async (...[path, options]: Parameters<Upstream["request"]>): Promise<unknown> => {
      assert.equal(path, "/companies/branding");
      assert.equal(options?.token, undefined);
      calls.push(id);
      return { name: `${name} ${id}`, logo: "https://bucket.example.invalid/logo.png" };
    });
  }
  const [first, concurrent] = await Promise.all([registry.display("a"), registry.display("a")]);
  assert.equal(first, concurrent);
  assert.deepEqual(calls, ["a"]);
  assert.equal((await registry.display("b")).name, "First b");
  assert.deepEqual(calls, ["a", "b"]);
  name = "Updated";
  now += BRANDING_TTL_MS - 1;
  assert.equal((await registry.display("a")).name, "First a");
  now += 1;
  assert.equal((await registry.display("a")).name, "Updated a");
  assert.deepEqual(calls, ["a", "b", "a"]);
  assert.equal(registry.get("a").tenant, original);
  assert.equal(Object.isFrozen(original), true);
  assert.deepEqual(registry.list(), [tenant, { ...tenant, id: "b", name: "Configured b", portalOrigin: "http://b.localhost:3000" }]);
});

test("branding failure caches configured fallback without evicting another tenant or exposing unknown/disabled entries", async (t) => {
  let now = 1000;
  const registry = new TenantRegistry([config("a"), { ...config("disabled"), enabled: false }], () => now);
  let calls = 0;
  t.mock.method(registry.get("a").upstream, "request", async (): Promise<unknown> => {
    calls += 1;
    if (calls === 1) throw new GatewayError(504, "UPSTREAM_TIMEOUT");
    return { name: "Recovered" };
  });
  assert.deepEqual(await registry.display("a"), tenant);
  assert.deepEqual(await registry.display("a"), tenant);
  assert.equal(calls, 1);
  for (const id of ["unknown", "disabled", "https://attacker.invalid"]) await assert.rejects(registry.display(id), { status: 404, code: "TENANT_NOT_FOUND" });
  assert.equal(calls, 1);
  now += BRANDING_TTL_MS;
  assert.equal((await registry.display("a")).name, "Recovered");
  assert.equal(calls, 2);
});

test("registry rejects more than 50 enabled runtimes instead of silently omitting discovery entries", () => {
  const configs = Array.from({ length: MAX_RUNTIME_TENANTS }, (_, index) => config(`tenant-${index}`));
  assert.equal(new TenantRegistry(configs).list().length, MAX_RUNTIME_TENANTS);
  assert.throws(() => new TenantRegistry([...configs, config("overflow")]), { message: "GATEWAY_CONFIGURATION_ERROR" });
  assert.equal(new TenantRegistry([...configs, { ...config("disabled"), enabled: false }]).list().length, MAX_RUNTIME_TENANTS);
});