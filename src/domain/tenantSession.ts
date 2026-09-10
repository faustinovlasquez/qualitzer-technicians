import type { Session, Tenant } from "./models";
import { canonicalGatewayUrl } from "../../config/gatewayPolicy";

export const DEMO_TENANT: Tenant = { id: "demo", name: "Demostración", portalOrigin: "https://demo.example", environment: "development" };

export function sameTenant(left: Tenant, right: Tenant): boolean {
  return left.id === right.id && left.portalOrigin === right.portalOrigin && left.environment === right.environment;
}

export function tenantStorageNamespace(session: Pick<Session, "tenant" | "mode" | "user">, gatewayUrl: string, branchId: number | null): string {
  return JSON.stringify(["tenant-v2", session.mode, canonicalGatewayUrl(gatewayUrl), session.tenant.id, session.tenant.portalOrigin, session.tenant.environment, session.user.id, branchId]);
}

export function requireSessionTenant(expected: Tenant, returned: Tenant | undefined): Tenant {
  if (!returned || !sameTenant(expected, returned)) throw new Error("La empresa de la sesión no coincide con la seleccionada. Vuelve a elegir la empresa e ingresa otra vez.");
  return returned;
}