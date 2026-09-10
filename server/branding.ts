import { z } from "zod";
import type { Tenant } from "../src/domain/models";
import { GatewayError } from "./errors";
import type { TenantRuntime } from "./tenants";

export const BRANDING_TTL_MS = 5 * 60_000;
export const MAX_BRANDING_IMAGE_BYTES = 500 * 1024;
const brandingSchema = z.object({
  name: z.string().trim().min(1).max(120).optional().catch(undefined),
  description: z.string().trim().max(5000).nullable().optional().catch(undefined),
  logo: z.unknown().optional(),
});

export function sanitizeLogo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("data:")) {
    if (value.length > 4 * Math.ceil(MAX_BRANDING_IMAGE_BYTES / 3) + 32) return undefined;
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match?.[1]) return undefined;
    const bytes = Buffer.from(match[1], "base64");
    return bytes.length <= MAX_BRANDING_IMAGE_BYTES && bytes.toString("base64") === match[1] ? value : undefined;
  }
  if (value.length > 2048 || !/^https:\/\//i.test(value) || /[\s\u0000-\u001f\u007f\\]/.test(value) || /^https:\/\/[^/?#]*@/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function brandedTenant(tenant: Tenant, input: unknown): Tenant {
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) return tenant;
  const { name, description, logo } = parsed.data;
  const safeLogo = logo === null ? null : sanitizeLogo(logo);
  return Object.freeze({
    ...tenant,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(safeLogo === undefined ? {} : { logo: safeLogo }),
  });
}

export class BrandingCache {
  private readonly cache = new Map<string, { tenant: Tenant; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<Tenant>>();

  constructor(private readonly entries: ReadonlyMap<string, TenantRuntime>, private readonly now: () => number = Date.now) {}

  async display(id: string): Promise<Tenant> {
    const runtime = this.entries.get(id);
    if (!runtime) throw new GatewayError(404, "TENANT_NOT_FOUND");
    for (const [key, entry] of this.cache) if (entry.expiresAt <= this.now()) this.cache.delete(key);
    const cached = this.cache.get(id);
    if (cached) return cached.tenant;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const request = this.load(runtime);
    this.pending.set(id, request);
    try { return await request; }
    finally { this.pending.delete(id); }
  }

  private async load({ tenant, upstream }: TenantRuntime): Promise<Tenant> {
    let display = tenant;
    try { display = brandedTenant(tenant, await upstream.request("/companies/branding")); } catch {}
    this.cache.set(tenant.id, { tenant: display, expiresAt: this.now() + BRANDING_TTL_MS });
    return display;
  }
}