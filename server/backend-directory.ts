import { z } from "zod";
import { originSchema, tenantIdSchema } from "./config";
import { GatewayError } from "./errors";
import { MOBILE_USER_AGENT } from "./upstream";

export const BACKEND_CATALOG_TTL_MS = 60_000;
export const BACKEND_RESPONSE_LIMIT = 128 * 1024;
export const BACKEND_REQUEST_TIMEOUT_MS = 25_000;
export const backendTenantSchema = z.object({
  id: tenantIdSchema.refine((id) => /^tenant-[1-9]\d*$/.test(id)),
  name: z.string().min(1).max(120).refine((name) => name.trim() === name),
  portalOrigin: originSchema,
  environment: z.enum(["development", "production"]),
}).strict().refine((tenant) => tenant.environment !== "production" || tenant.portalOrigin.startsWith("https://"));
export type BackendTenant = z.infer<typeof backendTenantSchema>;
export const backendCatalogSchema = z.object({ version: z.literal(1), tenants: z.array(backendTenantSchema).max(50) }).strict().superRefine(({ tenants }, context) => {
  if (new Set(tenants.map(({ id }) => id)).size !== tenants.length || new Set(tenants.map(({ portalOrigin }) => portalOrigin)).size !== tenants.length) {
    context.addIssue({ code: "custom", message: "DUPLICATE_BACKEND_TENANT" });
  }
});
export const backendDiscoverySchema = z.object({ matches: z.array(z.object({
  tenant: backendTenantSchema,
  grant: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
}).strict()).max(50) }).strict();

export class BackendDirectory {
  constructor(readonly backendUrl: string) {}

  async request(path: "/auth/mobile/config" | "/auth/mobile/discover" | "/auth/mobile/complete", json?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BACKEND_REQUEST_TIMEOUT_MS);
    timeout.unref();
    try {
      const response = await fetch(`${this.backendUrl}${path}`, {
        method: json === undefined ? "GET" : "POST", redirect: "manual", signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": MOBILE_USER_AGENT, "Cache-Control": "no-cache", ...(json === undefined ? {} : { "Content-Type": "application/json" }) },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 429) throw new GatewayError(429, "AUTH_RATE_LIMITED");
        if (response.status === 401 && path !== "/auth/mobile/config") throw new GatewayError(401, "UNAUTHORIZED");
        throw new GatewayError(503, "BACKEND_DIRECTORY_UNAVAILABLE");
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel(); throw new Error(); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > BACKEND_RESPONSE_LIMIT) { await reader.cancel(); throw new Error(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(503, "BACKEND_DIRECTORY_UNAVAILABLE");
    } finally { clearTimeout(timeout); }
  }

  async catalog(): Promise<BackendTenant[]> {
    const parsed = backendCatalogSchema.safeParse(await this.request("/auth/mobile/config"));
    if (!parsed.success) throw new GatewayError(503, "BACKEND_DIRECTORY_INVALID");
    if (parsed.data.tenants.some((tenant) => tenant.environment === "production" && !this.backendUrl.startsWith("https://"))) throw new GatewayError(503, "BACKEND_DIRECTORY_INVALID");
    return parsed.data.tenants;
  }
}