import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tenant } from "../src/domain/models";
import { BrandingCache } from "./branding";
import { originSchema, tenantIdSchema, tenantsSchema, type TenantConfig } from "./config";
import { BackendDirectory, BACKEND_CATALOG_TTL_MS, backendTenantSchema, type BackendTenant } from "./backend-directory";
import { GatewayError } from "./errors";
import { Upstream } from "./upstream";

export interface TenantRuntime {
  tenant: Tenant;
  readonly upstream: Upstream;
  readonly serverId?: string;
  readonly routeKey?: string;
}

export const MAX_RUNTIME_TENANTS = 50;
export const backendBindingsSchema = z.array(z.object({
  alias: tenantIdSchema,
  serverId: backendTenantSchema.shape.id,
  portalOrigin: originSchema,
  environment: z.enum(["development", "production"]),
}).strict()).max(10_000).superRefine((bindings, context) => {
  if (new Set(bindings.map(({ alias }) => alias)).size !== bindings.length || new Set(bindings.map(({ serverId }) => serverId)).size !== bindings.length) {
    context.addIssue({ code: "custom", message: "DUPLICATE_BACKEND_BINDING" });
  }
});
export type BackendBinding = z.infer<typeof backendBindingsSchema>[number];

export class TenantRegistry {
  private readonly entries = new Map<string, TenantRuntime>();
  private branding: BrandingCache;
  private bindings: BackendBinding[] = [];
  private catalog: BackendTenant[] = [];
  private refreshedAt = -Infinity;
  private pending?: Promise<void>;
  private changed?: () => void;

  constructor(tenants: readonly TenantConfig[], private readonly now: () => number = Date.now, readonly backend?: BackendDirectory) {
    const parsed = tenantsSchema.safeParse(tenants);
    if (!parsed.success || parsed.data.filter((tenant) => tenant.enabled).length > MAX_RUNTIME_TENANTS) throw new Error("GATEWAY_CONFIGURATION_ERROR");
    for (const config of parsed.data) {
      if (!config.enabled) continue;
      const tenant: Tenant = Object.freeze({ id: config.id, name: config.name, portalOrigin: config.tenantOrigin, environment: config.environment });
      this.entries.set(tenant.id, { tenant, upstream: new Upstream({ backendUrl: config.backendUrl, tenantOrigin: config.tenantOrigin }) });
    }
    this.branding = new BrandingCache(this.entries, now);
  }

  onCatalogChange(changed: () => void): void { this.changed = changed; }

  async ensureFresh(force = false): Promise<void> {
    if (!this.backend) return;
    if (this.pending) return this.pending;
    if (!force && this.now() - this.refreshedAt < BACKEND_CATALOG_TTL_MS) return;
    this.pending = this.refresh();
    try { await this.pending; }
    finally { this.pending = undefined; }
  }

  private async refresh(): Promise<void> {
    try {
      const catalog = await this.backend!.catalog();
      this.replaceBackendCatalog(catalog);
      this.changed?.();
      this.refreshedAt = this.now();
    } catch (error) {
      this.refreshedAt = -Infinity;
      throw error;
    }
  }

  private replaceBackendCatalog(catalog: BackendTenant[], bindings: BackendBinding[] = this.bindings): void {
    const nextBindings = [...bindings];
    const nextEntries = new Map<string, TenantRuntime>();
    for (const tenant of catalog) {
      let binding = nextBindings.find(({ serverId }) => serverId === tenant.id);
      if (binding && (binding.portalOrigin !== tenant.portalOrigin || binding.environment !== tenant.environment)) {
        throw new GatewayError(503, "BACKEND_TENANT_BINDING_CHANGED");
      }
      if (!binding) {
        binding = { alias: tenant.id, serverId: tenant.id, portalOrigin: tenant.portalOrigin, environment: tenant.environment };
        nextBindings.push(binding);
      }
      const routeKey = createHash("sha256").update(JSON.stringify([this.backend!.backendUrl, binding.serverId, binding.portalOrigin, binding.environment])).digest("hex");
      const previous = this.entries.get(binding.alias);
      nextEntries.set(binding.alias, previous?.routeKey === routeKey ? previous : {
        tenant: Object.freeze({ ...tenant, id: binding.alias }), serverId: tenant.id, routeKey,
        upstream: new Upstream({ backendUrl: this.backend!.backendUrl, tenantOrigin: tenant.portalOrigin }),
      });
    }
    if (!backendBindingsSchema.safeParse(nextBindings).success) throw new GatewayError(503, "BACKEND_TENANT_BINDING_CHANGED");
    for (const tenant of catalog) {
      const binding = nextBindings.find(({ serverId }) => serverId === tenant.id)!;
      nextEntries.get(binding.alias)!.tenant = Object.freeze({ ...tenant, id: binding.alias });
    }
    this.bindings = nextBindings;
    this.catalog = catalog;
    this.entries.clear();
    for (const [id, runtime] of nextEntries) this.entries.set(id, runtime);
    this.branding = new BrandingCache(this.entries, this.now);
  }

  restoreBackendBindings(input: unknown): void {
    const bindings = backendBindingsSchema.parse(input);
    this.replaceBackendCatalog(this.catalog, bindings);
  }

  migrateLegacyBindings(tenants: readonly TenantConfig[]): void {
    const bindings = tenants.map((tenant): BackendBinding => {
      const match = this.catalog.find((entry) => entry.portalOrigin === tenant.tenantOrigin && entry.environment === tenant.environment);
      if (tenant.backendUrl !== this.backend?.backendUrl || !match) throw new Error("SESSION_MIGRATION_ROUTE_NOT_VERIFIED");
      return { alias: tenant.id, serverId: match.id, portalOrigin: match.portalOrigin, environment: match.environment };
    });
    this.restoreBackendBindings(bindings);
  }

  snapshotBackendBindings(): BackendBinding[] { return this.bindings.map((binding) => ({ ...binding })); }

  bindingKey(id: string): string | undefined { return this.entries.get(id)?.routeKey; }

  matchBackendTenant(tenant: BackendTenant): TenantRuntime {
    this.assertFresh();
    const runtime = [...this.entries.values()].find(({ serverId }) => serverId === tenant.id);
    if (!runtime || runtime.tenant.portalOrigin !== tenant.portalOrigin || runtime.tenant.environment !== tenant.environment) throw new GatewayError(503, "BACKEND_DIRECTORY_INVALID");
    return runtime;
  }

  assertFresh(): void {
    if (this.backend && this.now() - this.refreshedAt >= BACKEND_CATALOG_TTL_MS) throw new GatewayError(503, "BACKEND_DIRECTORY_UNAVAILABLE");
  }

  list(): Tenant[] { this.assertFresh(); return [...this.entries.values()].map(({ tenant }) => tenant); }

  display(id: string): Promise<Tenant> { this.assertFresh(); return this.branding.display(id); }

  get(id: string): TenantRuntime {
    this.assertFresh();
    const runtime = this.entries.get(id);
    if (!runtime) throw new GatewayError(404, "TENANT_NOT_FOUND");
    return runtime;
  }

  async reachable(): Promise<boolean> {
    if (this.backend) {
      try { await this.ensureFresh(true); return true; } catch { return false; }
    }
    const results = await Promise.all([...this.entries.values()].map(({ upstream }) => upstream.reachable()));
    return results.length > 0 && results.every(Boolean);
  }
}