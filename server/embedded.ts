import { z } from "zod";
import { BackendDirectory } from "./backend-directory";
import { resolveConfig } from "./config";
import { assembleApp } from "./gateway-runtime";
import { prepareEmbeddedSessionStorage } from "./session-persistence";
import { SessionManager } from "./sessions";
import { TenantRegistry } from "./tenants";
import type { EmbeddedGatewayHandler, EmbeddedGatewayOptions } from "./embedded-contract";

export type { EmbeddedGatewayHandler, EmbeddedGatewayOptions } from "./embedded-contract";

const optionsSchema = z.object({
  backendUrl: z.string(),
  sessionFile: z.string(),
  trustedProxyIps: z.array(z.string()),
  corsOrigins: z.array(z.string()).optional(),
}).strict();

export async function createEmbeddedGateway(options: EmbeddedGatewayOptions): Promise<EmbeddedGatewayHandler> {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success) throw new Error("GATEWAY_CONFIGURATION_ERROR");
  const config = resolveConfig({
    ...parsed.data,
    corsOrigins: parsed.data.corsOrigins ?? [],
    tenantResolution: "backend",
    environment: "production",
  }, { nativeOnly: true });
  const storage = prepareEmbeddedSessionStorage(config.sessionFile!);
  try {
    const tenants = new TenantRegistry([], Date.now, new BackendDirectory(config.backendUrl));
    await tenants.ensureFresh(true);
    const persistence = storage.createPersistence({ registry: tenants, legacyMigrationTenants: () => { throw new Error("SESSION_MIGRATION_LEGACY_ROUTES_REQUIRED"); } });
    const sessions = new SessionManager(Date.now, persistence, (id) => tenants.bindingKey(id));
    sessions.reconcileBindings();
    tenants.onCatalogChange(() => sessions.reconcileBindings());
    const app: EmbeddedGatewayHandler = assembleApp(config, tenants, sessions, undefined, true);
    return (request, response, next) => { app(request, response, next); };
  } catch (error) {
    storage.release();
    throw error;
  }
}