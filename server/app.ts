import { loadConfig, resolveConfig, type GatewayConfig, type ResolvedConfig, type TenantConfig } from "./config";
import { TenantRegistry } from "./tenants";
import { BackendDirectory } from "./backend-directory";
import { SessionManager } from "./sessions";
import { createSessionPersistence } from "./session-persistence";
import { assembleApp } from "./gateway-runtime";
import { developmentRouter } from "./development";

export function createApp(input: GatewayConfig = {}) {
  const config = resolveConfig(input);
  if (config.tenantResolution === "backend") throw new Error("BACKEND_BOOTSTRAP_REQUIRED");
  const tenants = new TenantRegistry(config.tenants);
  return assembleApp(config, tenants, new SessionManager(Date.now, createSessionPersistence(config)), standaloneDevelopmentRouter(config));
}

export interface BackendBootstrapOptions {
  now?: () => number;
  legacyMigrationTenants?: () => readonly TenantConfig[];
}

export async function createConfiguredApp(input: GatewayConfig = loadConfig(), options: BackendBootstrapOptions = {}) {
  const config = resolveConfig(input);
  if (config.tenantResolution === "legacy") return createApp(config);
  const now = options.now ?? Date.now;
  const tenants = new TenantRegistry([], now, new BackendDirectory(config.backendUrl));
  await tenants.ensureFresh(true);
  const persistence = createSessionPersistence(config, { registry: tenants, legacyMigrationTenants: options.legacyMigrationTenants });
  const sessions = new SessionManager(now, persistence, (id) => tenants.bindingKey(id));
  sessions.reconcileBindings();
  tenants.onCatalogChange(() => sessions.reconcileBindings());
  return assembleApp(config, tenants, sessions, standaloneDevelopmentRouter(config));
}

function standaloneDevelopmentRouter(config: ResolvedConfig) {
  return developmentRouter({ enabled: config.environment === "development", metroPort: 8081, gatewayPort: config.port, preferredHost: process.env.REACT_NATIVE_PACKAGER_HOSTNAME });
}

export type { GatewayConfig } from "./config";