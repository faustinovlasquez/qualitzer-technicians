import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const httpUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return /^https?:\/\//i.test(value) && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash &&
      !/^https?:\/\/[^/]*@/i.test(value) && !/[\s\u0000-\u001f\u007f\\?#*]/.test(value);
  } catch { return false; }
});
export const originSchema = httpUrl.refine((value) => {
  try { return new URL(value).origin === value; } catch { return false; }
});
const origin = originSchema;
export const tenantIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/);
const tenantConfiguration = z.object({
  id: tenantIdSchema,
  name: z.string().trim().min(1).max(120),
  tenantOrigin: origin,
  backendUrl: httpUrl.transform((value) => new URL(value).href.replace(/\/+$/, "")),
  environment: z.enum(["development", "production"]),
  enabled: z.boolean(),
}).strict();
export const tenantsSchema = z.array(tenantConfiguration).superRefine((tenants, context) => {
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const tenant of tenants) {
    const route = JSON.stringify([tenant.backendUrl, tenant.tenantOrigin]);
    if (ids.has(tenant.id) || routes.has(route)) context.addIssue({ code: "custom", message: "DUPLICATE_TENANT_ID_OR_ROUTE" });
    if (tenant.environment === "production" && (!tenant.backendUrl.startsWith("https://") || !tenant.tenantOrigin.startsWith("https://"))) {
      context.addIssue({ code: "custom", message: "PRODUCTION_TENANT_REQUIRES_HTTPS" });
    }
    ids.add(tenant.id);
    routes.add(route);
  }
});
const configuration = z.object({
  backendUrl: httpUrl.default("http://127.0.0.1:5001/api"),
  tenantOrigin: origin.optional(),
  tenantResolution: z.enum(["backend", "legacy"]).optional(),
  tenants: tenantsSchema.optional(),
  port: z.number().int().min(1).max(65535).default(8787),
  host: z.string().min(1).optional(),
  environment: z.enum(["development", "test", "production"]).default("development"),
  corsOrigins: z.array(origin).default(["http://localhost:8081", "http://127.0.0.1:8081"]),
  trustedProxyIps: z.array(z.string().refine((value) => isIP(value) !== 0)).default([]),
  sessionFile: z.string().refine((value) => value.trim() === value && value.length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value) && !/^(?:[a-z][a-z\d+.-]*:\/\/|file:|\\\\|\/\/)/i.test(value)).optional(),
  sessionSecret: z.string().refine((value) => {
    try { decodeSessionSecret(value); return true; } catch { return false; }
  }).optional(),
}).strict();

export type GatewayConfig = z.input<typeof configuration>;
export type TenantConfig = z.output<typeof tenantConfiguration>;
export type ResolvedConfig = Omit<z.output<typeof configuration>, "tenants" | "tenantResolution"> & { tenants: TenantConfig[]; tenantResolution: "backend" | "legacy" };

export function decodeSessionSecret(value: string): Buffer {
  if (/^[a-f\d]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
    const key = Buffer.from(value, "base64url");
    if (key.length === 32 && key.toString("base64url") === value) return key;
  }
  throw new Error("GATEWAY_SESSION_SECRET_INVALID");
}

export function resolveConfig(input: GatewayConfig): ResolvedConfig {
  const parsed = configuration.safeParse(input);
  if (!parsed.success) throw new Error("GATEWAY_CONFIGURATION_ERROR");
  const config = parsed.data;
  const backendUrl = new URL(config.backendUrl).href.replace(/\/+$/, "");
  const tenantResolution = config.tenantResolution ?? "legacy";
  if (tenantResolution === "backend" && (config.tenantOrigin !== undefined || config.tenants?.length)) throw new Error("BACKEND_MODE_FORBIDS_MANUAL_TENANTS");
  const tenantOrigin = tenantResolution === "legacy" ? config.tenantOrigin ?? "http://localhost:3000" : undefined;
  const tenants = tenantResolution === "backend" ? [] : config.tenants ?? [{
    id: "local", name: "Entorno local", backendUrl, tenantOrigin: tenantOrigin!,
    environment: config.environment === "production" ? "production" as const : "development" as const, enabled: true,
  }];
  if (config.environment === "production") {
    if ((tenantResolution === "backend" && !backendUrl.startsWith("https://")) || tenants.some((tenant) => !tenant.backendUrl.startsWith("https://") || !tenant.tenantOrigin.startsWith("https://")) ||
        !input.corsOrigins?.length || config.corsOrigins.some((value) => !value.startsWith("https://")) ||
        config.trustedProxyIps.length === 0) {
      throw new Error("PRODUCTION_REQUIRES_HTTPS_BACKEND_TENANT_CORS_AND_TRUSTED_PROXY_IPS");
    }
  }
  const resolved = {
    ...config, backendUrl, tenantOrigin, tenantResolution, tenants: tenants.filter((tenant) => tenant.enabled),
    host: config.host ?? (config.environment === "production" ? "127.0.0.1" : "0.0.0.0"),
    sessionFile: config.environment === "test" || config.sessionFile === undefined ? undefined : resolve(config.sessionFile),
  };
  return Object.defineProperty(resolved, "sessionSecret", { value: config.sessionSecret, enumerable: false, writable: false });
}

export function readMigrationTenants(): TenantConfig[] {
  const tenants = readTenants(undefined);
  if (!tenants) throw new Error("SESSION_MIGRATION_LEGACY_ROUTES_REQUIRED");
  return tenants.filter((tenant) => tenant.enabled);
}

function readTenants(file: string | undefined): TenantConfig[] | undefined {
  if (file !== undefined && (!file.trim() || /^(?:[a-z][a-z\d+.-]*:\/\/|file:|\\\\|\/\/)/i.test(file))) throw new Error("GATEWAY_TENANTS_FILE_INVALID");
  let content: string;
  try { content = readFileSync(file === undefined ? resolve(__dirname, "../config/tenants.json") : resolve(file), "utf8"); }
  catch (error) {
    if (file === undefined && error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("GATEWAY_TENANTS_FILE_UNREADABLE");
  }
  try {
    const data: unknown = JSON.parse(content);
    return tenantsSchema.parse(data);
  } catch { throw new Error("GATEWAY_TENANTS_FILE_INVALID"); }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const list = (value: string | undefined): string[] | undefined => value?.split(",").map((item) => item.trim()).filter(Boolean);
  const environment = z.enum(["development", "test", "production"]).safeParse(env.NODE_ENV ?? "development");
  if (!environment.success) throw new Error("GATEWAY_CONFIGURATION_ERROR");
  if (environment.data === "production" && env.GATEWAY_SESSION_SECRET === undefined) throw new Error("GATEWAY_SESSION_SECRET_REQUIRED");
  if (env.GATEWAY_SESSION_SECRET !== undefined) decodeSessionSecret(env.GATEWAY_SESSION_SECRET);
  const legacy = env.TENANT_ORIGIN !== undefined || env.GATEWAY_TENANTS_FILE !== undefined;
  return resolveConfig({
    backendUrl: env.BACKEND_URL,
    tenantResolution: legacy ? "legacy" : "backend",
    tenantOrigin: env.TENANT_ORIGIN,
    tenants: env.GATEWAY_TENANTS_FILE === undefined ? undefined : readTenants(env.GATEWAY_TENANTS_FILE),
    port: env.GATEWAY_PORT === undefined ? undefined : Number(env.GATEWAY_PORT),
    host: env.GATEWAY_HOST,
    environment: environment.data,
    corsOrigins: list(env.GATEWAY_CORS_ORIGINS),
    trustedProxyIps: list(env.GATEWAY_TRUSTED_PROXIES),
    sessionFile: environment.data === "test" ? undefined : env.GATEWAY_SESSION_FILE ?? resolve(__dirname, "../.data/sessions.enc"),
    sessionSecret: env.GATEWAY_SESSION_SECRET,
  });
}