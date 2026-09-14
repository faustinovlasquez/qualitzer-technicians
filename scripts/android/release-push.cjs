"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { z } = require("zod");
const { packageName, gatewayUrl } = require("./release-policy.cjs");
const { zipEntries, entryBytes } = require("./inspect-apk.cjs");

const pushPolicy = Object.freeze({
  expoProjectId: "be200e44-9d60-4881-9050-1c67afaeb650",
  firebaseProjectId: "qualitzer-7612f",
  senderId: "689385636534",
  firebaseAppId: "1:689385636534:android:482d71eca3832f7b225c17",
  googleServicesFile: "./config/firebase/google-services.json",
});
const MAX_CONFIG_BYTES = 64 * 1024;
const publicString = z.string().min(1).max(1024);
const oauthSchema = z.object({
  client_id: publicString,
  client_type: z.number().int().min(1).max(3),
  android_info: z.object({ package_name: publicString, certificate_hash: z.string().regex(/^[a-fA-F0-9]{40}$/) }).strict().optional(),
  ios_info: z.object({ bundle_id: publicString, app_store_id: publicString.optional() }).strict().optional(),
}).strict();
const firebaseSchema = z.object({
  configuration_version: z.literal("1"),
  project_info: z.object({
    project_number: z.literal(pushPolicy.senderId),
    project_id: z.literal(pushPolicy.firebaseProjectId),
    storage_bucket: z.enum([`${pushPolicy.firebaseProjectId}.firebasestorage.app`, `${pushPolicy.firebaseProjectId}.appspot.com`]),
    firebase_url: z.string().url().max(1024).optional(),
  }).strict(),
  client: z.array(z.object({
    client_info: z.object({
      mobilesdk_app_id: publicString,
      android_client_info: z.object({ package_name: publicString }).strict(),
    }).strict(),
    api_key: z.array(z.object({ current_key: z.string().regex(/^AIza[A-Za-z0-9_-]{35}$/) }).strict()).length(1),
    oauth_client: z.array(oauthSchema).max(50).optional(),
    services: z.object({
      appinvite_service: z.object({ other_platform_oauth_client: z.array(oauthSchema).max(50) }).strict().optional(),
    }).strict().optional(),
  }).strict()).min(1).max(50),
}).strict();

function parsePublicJson(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_CONFIG_BYTES) throw new Error("PUSH_CONFIG_SIZE_INVALID");
  let value;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  }
  catch { throw new Error("PUSH_CONFIG_JSON_INVALID"); }
  const decodedText = text.replace(/\\u([a-f\d]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  if (/service[_ -]?account|-----BEGIN[^\r\n]*PRIVATE KEY-----/i.test(decodedText)) throw new Error("PUSH_PRIVATE_CREDENTIAL_REJECTED");
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 4096 || depth > 16) throw new Error("PUSH_CONFIG_COMPLEXITY_INVALID");
    if (typeof item === "string") {
      if (/service[_ -]?account|-----BEGIN[^\r\n]*PRIVATE KEY-----/i.test(item)) throw new Error("PUSH_PRIVATE_CREDENTIAL_REJECTED");
      if (item.length > 4096) throw new Error("PUSH_CONFIG_STRING_TOO_LONG");
    } else if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (/privatekey|serviceaccount|clientemail|clientsecret|refreshtoken|accesstoken/.test(key.replace(/[^a-z]/gi, "").toLowerCase())) throw new Error("PUSH_PRIVATE_CREDENTIAL_REJECTED");
        visit(child, depth + 1);
      }
    }
  }
  visit(value, 0);
  return value;
}

function parseFirebaseConfig(bytes) {
  const parsed = firebaseSchema.safeParse(parsePublicJson(bytes));
  if (!parsed.success) throw new Error("PUSH_FIREBASE_SCHEMA_OR_PROJECT_INVALID");
  const data = parsed.data;
  const matches = data.client.filter(client => client.client_info.android_client_info.package_name === packageName);
  if (matches.length !== 1) throw new Error("PUSH_FIREBASE_ANDROID_CLIENT_INVALID");
  const client = matches[0];
  if (client.client_info.mobilesdk_app_id !== pushPolicy.firebaseAppId) throw new Error("PUSH_FIREBASE_APP_ID_MISMATCH");
  const result = {
    expoProjectId: pushPolicy.expoProjectId,
    firebaseProjectId: data.project_info.project_id,
    firebaseAppId: client.client_info.mobilesdk_app_id,
    senderId: data.project_info.project_number,
    packageName,
    firebaseConfigSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  Object.defineProperty(result, "resources", { value: Object.freeze({
    google_app_id: client.client_info.mobilesdk_app_id,
    gcm_defaultSenderId: data.project_info.project_number,
    project_id: data.project_info.project_id,
    google_storage_bucket: data.project_info.storage_bucket,
    google_api_key: client.api_key[0].current_key,
  }) });
  return Object.freeze(result);
}

function releaseEnvironment(source) {
  const environment = {};
  for (const [name, value] of Object.entries(source)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|USERNAME|USERDOMAIN|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES|OS|NUMBER_OF_PROCESSORS|PROCESSOR_.*|JAVA_HOME|ANDROID_HOME|ANDROID_SDK_ROOT|ANDROID_USER_HOME|GRADLE_USER_HOME)$/i.test(name)) environment[name] = value;
  }
  return Object.assign(environment, {
    NODE_ENV: "production", EXPO_NO_DOTENV: "1", EXPO_NO_TELEMETRY: "1", CI: "1",
    EAS_BUILD_PROFILE: "standalone-apk", EXPO_PUBLIC_STANDALONE: "true", EXPO_PUBLIC_GATEWAY_URL: gatewayUrl,
  });
}

function resolveReleaseConfig(root, environment) {
  const saved = { ...process.env };
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, environment);
  try { return require("@expo/config").getConfig(root, { skipSDKVersionRequirement: true }).exp; }
  catch { throw new Error("PUSH_EXPO_CONFIG_RESOLUTION_FAILED"); }
  finally {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

function verifyExpoIdentity(config) {
  if (!z.uuid().safeParse(config?.extra?.eas?.projectId).success || config.extra.eas.projectId !== pushPolicy.expoProjectId) throw new Error("PUSH_EXPO_PROJECT_ID_MISMATCH");
  if (config.android?.package !== packageName) throw new Error("PUSH_ANDROID_PACKAGE_MISMATCH");
}

function verifyPushConfig(root, config) {
  verifyExpoIdentity(config);
  const filename = path.resolve(root, pushPolicy.googleServicesFile);
  if (typeof config.android.googleServicesFile !== "string" || path.resolve(root, config.android.googleServicesFile) !== filename) throw new Error("PUSH_FIREBASE_FILE_PATH_INVALID");
  let descriptor;
  let bytes;
  try {
    if (path.relative(path.resolve(fs.realpathSync(root), pushPolicy.googleServicesFile), fs.realpathSync(filename)) !== "") throw new Error();
    descriptor = fs.openSync(filename, "r");
    const info = fs.fstatSync(descriptor);
    if (!info.isFile() || info.size === 0 || info.size > MAX_CONFIG_BYTES) throw new Error();
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, length);
  } catch { throw new Error("PUSH_FIREBASE_FILE_UNREADABLE_OR_SIZE_INVALID"); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  return parseFirebaseConfig(bytes);
}

function readApkResources(aapt, apk, environment) {
  try {
    return execFileSync(aapt, ["dump", "--values", "resources", apk], {
      env: environment, encoding: "utf8", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], maxBuffer: 24 * 1024 * 1024, timeout: 60000,
    });
  } catch { throw new Error("PUSH_APK_RESOURCE_DUMP_FAILED"); }
}

function verifyPushResources(text, expected) {
  const lines = text.split(/\r?\n/);
  const defaults = new Set();
  let configuration = "";
  for (let index = 0; index < lines.length; index++) {
    const config = /^\s+config ([^:]+):/.exec(lines[index]);
    if (config) configuration = config[1];
    const resource = /^\s+resource \S+ com\.qualitzer\.field:string\/(\w+):/.exec(lines[index]);
    if (!resource || !Object.hasOwn(expected.resources, resource[1])) continue;
    const value = /^\s+\(string(?:8|16)?\) "([^"\r\n]*)"\s*$/.exec(lines[index + 1] ?? "");
    if (!value || value[1] !== expected.resources[resource[1]]) throw new Error("PUSH_APK_FIREBASE_RESOURCE_MISMATCH");
    if (configuration === "(default)") defaults.add(resource[1]);
  }
  if (defaults.size !== Object.keys(expected.resources).length) throw new Error("PUSH_APK_FIREBASE_RESOURCES_MISSING");
}

function verifyCompiledPush(apk, expected, resourceValues, manifest) {
  let config;
  try {
    const bytes = fs.readFileSync(apk);
    const entry = zipEntries(bytes).get("assets/app.config");
    if (!entry || entry.size > MAX_CONFIG_BYTES) throw new Error();
    config = parsePublicJson(entryBytes(bytes, entry, MAX_CONFIG_BYTES));
  } catch { throw new Error("PUSH_APK_EXPO_CONFIG_INVALID"); }
  verifyExpoIdentity(config);
  verifyPushResources(resourceValues, expected);
  if (!/^\s+A: android:name\([^)]*\)="com\.google\.firebase\.provider\.FirebaseInitProvider"/m.test(manifest)) throw new Error("PUSH_APK_FIREBASE_PROVIDER_MISSING");
  return {
    ...expected, pushConfigured: true, clientConfigured: true, remotePending: true,
    scope: "CLIENT_ONLY", embeddedExpoProjectVerified: true, firebaseResourcesVerified: true,
    firebaseInitProvider: true,
  };
}

module.exports = { pushPolicy, MAX_CONFIG_BYTES, parseFirebaseConfig, releaseEnvironment, resolveReleaseConfig, verifyPushConfig, readApkResources, verifyPushResources, verifyCompiledPush };