import { canonicalGatewayUrl } from "../../config/gatewayPolicy";
import { tenantSchema } from "../infrastructure/tenantSchemas";
import type { CompanyBrandingInput, CompanyBrandingPayload } from "./contracts";

export const MAX_COMPANY_LOGO_BYTES = 512 * 1024;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function companyLogoHttpsUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 8192 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) return null;
    if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host) || host.endsWith(".") || /^\d+(\.\d+)*$/.test(host)) return null;
    if (host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(host)) return null;
    return value;
  } catch {
    return null;
  }
}

export function companyBrandingInputKey(input: CompanyBrandingInput): string {
  const tenant = input.session?.tenant;
  return JSON.stringify([input.session?.mode, tenant?.id, tenant?.name, tenant?.logo, tenant?.portalOrigin, tenant?.environment, input.gatewayUrl, input.branchName, input.verified]);
}

export function companyLogoDataUri(value: string | null | undefined): string | null {
  if (!value || value.length > Math.ceil(MAX_COMPANY_LOGO_BYTES / 3) * 4 + 32) return null;
  const header = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
  if (!header) return null;
  const base64 = value.slice(header[0].length);
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if (base64.length * 3 / 4 - padding > MAX_COMPANY_LOGO_BYTES) return null;
  if (padding && (alphabet.indexOf(base64[base64.length - padding - 1]) & (padding === 2 ? 15 : 3)) !== 0) return null;
  const bytes: number[] = [];
  for (let index = 0; index < Math.min(base64.length, 24); index += 4) {
    const bits = alphabet.indexOf(base64[index]) << 18 | alphabet.indexOf(base64[index + 1]) << 12 | Math.max(0, alphabet.indexOf(base64[index + 2])) << 6 | Math.max(0, alphabet.indexOf(base64[index + 3]));
    bytes.push(bits >>> 16 & 255, bits >>> 8 & 255, bits & 255);
  }
  const matches = (offset: number, signature: number[]) => signature.every((byte, index) => bytes[offset + index] === byte);
  const raster = header[1] === "png" ? matches(0, [137, 80, 78, 71, 13, 10, 26, 10])
    : header[1] === "jpeg" ? matches(0, [255, 216, 255])
      : matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80]);
  return raster ? value : null;
}

export function companyBrandingNamespace(input: CompanyBrandingInput): string | null {
  if (!input.verified || input.session?.mode !== "live") return null;
  const parsed = tenantSchema.safeParse(input.session.tenant);
  if (!parsed.success || !parsed.data.name.trim()) return null;
  try {
    const tenant = parsed.data;
    return JSON.stringify(["company-shortcut-v1", canonicalGatewayUrl(input.gatewayUrl), tenant.id, tenant.portalOrigin, tenant.environment]);
  } catch {
    return null;
  }
}

export async function prepareCompanyBranding(input: CompanyBrandingInput, digest: (namespace: string) => Promise<string>): Promise<CompanyBrandingPayload | null> {
  const namespace = companyBrandingNamespace(input);
  if (!namespace || !input.session) return null;
  const name = input.session.tenant.name;
  const branch = input.branchName;
  const logo = input.session.tenant.logo;
  const hash = await digest(namespace);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("COMPANY_BRANDING_INVALID_HASH");
  const cleanLabel = (value: string) => value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 120);
  const displayName = cleanLabel(name);
  if (!displayName) return null;
  const logoHttpsUrl = companyLogoHttpsUrl(logo);
  return {
    shortcutId: `qz-company-${hash}`,
    displayName,
    branchName: branch ? cleanLabel(branch) || null : null,
    logoDataUri: companyLogoDataUri(logo),
    ...(logoHttpsUrl ? { logoHttpsUrl } : {}),
  };
}