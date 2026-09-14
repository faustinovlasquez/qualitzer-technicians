import type { Tenant } from "./models";

export const QUALITZER_APP_NAME = "Qualitzer técnicos";

export function brandName(tenant?: Tenant): string {
  return tenant?.name.trim() || QUALITZER_APP_NAME;
}

export function safeBrandLogo(logo: Tenant["logo"]): string | null {
  if (!logo || /[\s\u0000-\u001f\u007f\\]/.test(logo)) return null;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(logo)) return logo;
  if (!/^https?:\/\//i.test(logo)) return null;
  try {
    const url = new URL(logo);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}