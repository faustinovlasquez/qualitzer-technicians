import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadSource } from "./helpers/tenant-challenge";

const opened: string[] = [];
const policy = loadSource<typeof import("../src/infrastructure/privacyPolicy")>("infrastructure/privacyPolicy.ts", (id) => {
  if (id === "expo-constants") return { default: { expoConfig: { extra: { privacyPolicyUrl: "https://qualitzer.com/app/tecnicos/politica-de-privacidad" } } } };
  if (id === "react-native") return { Linking: { openURL: async (url: string) => { opened.push(url); } } };
  throw new Error(`UNEXPECTED_TEST_IMPORT:${id}`);
}, { URL });

test("privacy policy uses the configured HTTPS URL and falls back to the public default", async () => {
  assert.equal(policy.privacyPolicyUrl({ privacyPolicyUrl: "https://example.com/privacidad" }), "https://example.com/privacidad");
  for (const value of [undefined, "", "http://qualitzer.com/politica", "javascript:alert(1)", "https://user:pass@qualitzer.com/x", " https://qualitzer.com"]) {
    assert.equal(policy.privacyPolicyUrl({ privacyPolicyUrl: value }), policy.DEFAULT_PRIVACY_POLICY_URL, String(value));
  }
  await policy.openPrivacyPolicy();
  assert.deepEqual(opened, ["https://qualitzer.com/app/tecnicos/politica-de-privacidad"]);
});

test("the policy link is reachable from login and profile, and configurable from .env", () => {
  const read = (file: string) => readFileSync(resolve(__dirname, "..", file), "utf8");
  assert.match(read("src/screens/LoginScreen.tsx"), /accessibilityLabel="Política de privacidad"[\s\S]*openPrivacyPolicy/);
  assert.match(read("src/screens/ProfileScreen.tsx"), /title="Política de privacidad"[\s\S]*openPrivacyPolicy/);
  assert.match(read("app.config.ts"), /PRIVACY_POLICY_URL/);
  assert.match(read(".env.example"), /^PRIVACY_POLICY_URL=https:\/\//m);
});
