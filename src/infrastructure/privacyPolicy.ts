import Constants from "expo-constants";
import { Linking } from "react-native";

/** URL pública exigida por Google Play; se reemplaza con PRIVACY_POLICY_URL en el .env (ver app.config.ts). */
export const DEFAULT_PRIVACY_POLICY_URL = "https://qualitzer.com/app/tecnicos/politica-de-privacidad";

export function validPrivacyPolicyUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function privacyPolicyUrl(extra: unknown = Constants.expoConfig?.extra): string {
  const configured = extra && typeof extra === "object" && "privacyPolicyUrl" in extra ? extra.privacyPolicyUrl : undefined;
  return validPrivacyPolicyUrl(configured) ?? DEFAULT_PRIVACY_POLICY_URL;
}

export async function openPrivacyPolicy(): Promise<void> {
  await Linking.openURL(privacyPolicyUrl());
}
