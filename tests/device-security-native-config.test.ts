/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("screen protection keeps the permission required during Expo native initialization without broad image access", () => {
  const config: { expo: { android: { blockedPermissions: string[]; permissions: string[] }; plugins: Array<string | [string, { faceIDPermission?: string }]> } } = JSON.parse(readFileSync(resolve(__dirname, "../app.json"), "utf8"));
  assert.ok(!config.expo.android.blockedPermissions.includes("android.permission.DETECT_SCREEN_CAPTURE"));
  assert.ok(config.expo.android.permissions.includes("android.permission.DETECT_SCREEN_CAPTURE"));
  assert.ok(config.expo.android.blockedPermissions.includes("android.permission.READ_MEDIA_IMAGES"));
  const plugin = config.expo.plugins.find(value => Array.isArray(value) && value[0] === "expo-local-authentication");
  assert.ok(Array.isArray(plugin) && plugin[1].faceIDPermission?.includes("desbloquear"));
});