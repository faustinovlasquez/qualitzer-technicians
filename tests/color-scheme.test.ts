import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "./helpers/tenant-challenge";

const theme = loadSource<typeof import("../src/ui/theme")>("ui/theme.ts", (id) => { throw new Error(`UNEXPECTED_TEST_IMPORT:${id}`); });
const stored = new Map<string, string>();
const scheme = loadSource<typeof import("../src/ui/colorScheme")>("ui/colorScheme.ts", (id) => {
  if (id === "react-native") return { Platform: { OS: "android" }, Appearance: { getColorScheme: () => "dark" } };
  if (id === "expo-secure-store") return { getItem: (key: string) => stored.get(key) ?? null, setItemAsync: async (key: string, value: string) => { stored.set(key, value); } };
  if (id === "expo") return { reloadAppAsync: async () => undefined };
  if (id === "./theme") return theme;
  throw new Error(`UNEXPECTED_TEST_IMPORT:${id}`);
});

test("light is the default; dark and phone preferences resolve and switch the shared palette", async () => {
  assert.equal(scheme.readColorPreference(), "light");
  assert.equal(scheme.initColorScheme(), "light");
  const lightSurface = theme.palette.surface;
  await scheme.changeColorPreference("dark");
  assert.equal(scheme.readColorPreference(), "dark");
  assert.equal(scheme.initColorScheme(), "dark");
  assert.notEqual(theme.palette.surface, lightSurface);
  assert.equal(theme.activeColorScheme, "dark");
  assert.equal(theme.palette.white, "#FFFFFF", "text on solid colors stays white in both themes");
  assert.equal(scheme.resolveColorScheme("system", "dark"), "dark");
  assert.equal(scheme.resolveColorScheme("system", "light"), "light");
  assert.equal(scheme.resolveColorScheme("system", null), "light");
  stored.set("qualitzer.colorScheme", "unexpected");
  assert.equal(scheme.readColorPreference(), "light");
  theme.applyColorScheme("light");
  assert.equal(theme.palette.surface, lightSurface);
});
