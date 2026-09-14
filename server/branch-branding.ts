import { z } from "zod";
import { standaloneGatewayUrl } from "../config/gatewayPolicy";
import type { Tenant } from "../src/domain/models";
import { sanitizeLogo } from "./branding";
import { GatewayError } from "./errors";
import type { Upstream } from "./upstream";

const branchNameSchema = z.string().trim().min(1).max(120).optional().catch(undefined);
const branchBrandingSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: branchNameSchema,
  logo: z.unknown().optional(),
});

interface BranchDisplay {
  tenant: Tenant;
  branchBranding: {
    companyBranchId: number;
    status: "APPLIED" | "FALLBACK";
    error?: "BRANCH_BRANDING_UNAVAILABLE" | "BRANCH_BRANDING_INVALID_RESPONSE";
  };
}

export function sanitizeBranchLogo(value: unknown): string | undefined {
  const logo = sanitizeLogo(value);
  if (!logo?.startsWith("https://")) return undefined;
  try {
    const url = new URL(logo);
    if (url.port || url.hash) return undefined;
    standaloneGatewayUrl(url.origin);
    return logo;
  } catch { return undefined; }
}

export async function selectedBranchDisplay(upstream: Upstream, token: string, tenant: Tenant, branch: { id: number; name: string }): Promise<BranchDisplay> {
  let input: unknown;
  try {
    input = await upstream.request(`/branches/${branch.id}`, { token });
  } catch (error) {
    if (error instanceof GatewayError && (error.status === 401 || error.status === 403)) throw error;
    return { tenant, branchBranding: { companyBranchId: branch.id, status: "FALLBACK", error: "BRANCH_BRANDING_UNAVAILABLE" } };
  }
  const parsed = branchBrandingSchema.safeParse(input);
  if (!parsed.success || parsed.data.id !== branch.id) {
    return { tenant, branchBranding: { companyBranchId: branch.id, status: "FALLBACK", error: "BRANCH_BRANDING_INVALID_RESPONSE" } };
  }
  const name = parsed.data.name ?? branchNameSchema.parse(branch.name) ?? tenant.name;
  const logo = sanitizeBranchLogo(parsed.data.logo);
  return {
    tenant: Object.freeze({ ...tenant, name, ...(logo === undefined ? {} : { logo }) }),
    branchBranding: { companyBranchId: branch.id, status: "APPLIED" },
  };
}