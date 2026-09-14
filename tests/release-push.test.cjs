"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { deflateRawSync } = require("node:zlib");
const {
  pushPolicy, MAX_CONFIG_BYTES, parseFirebaseConfig, releaseEnvironment, resolveReleaseConfig,
  verifyPushConfig, readApkResources, verifyPushResources, verifyCompiledPush,
} = require("../scripts/android/release-push.cjs");

const root = path.resolve(__dirname, "..");
const fakeApiKey = `AIza${"0".repeat(35)}`;
const manifest = '    E: provider (line=100)\n      A: android:name(0x01010003)="com.google.firebase.provider.FirebaseInitProvider" (Raw: "com.google.firebase.provider.FirebaseInitProvider")';
function fixture() {
  return {
    project_info: { project_number: pushPolicy.senderId, project_id: pushPolicy.firebaseProjectId, storage_bucket: "qualitzer-7612f.firebasestorage.app" },
    client: [{
      client_info: { mobilesdk_app_id: pushPolicy.firebaseAppId, android_client_info: { package_name: "com.qualitzer.field" } },
      oauth_client: [], api_key: [{ current_key: fakeApiKey }],
      services: { appinvite_service: { other_platform_oauth_client: [] } },
    }],
    configuration_version: "1",
  };
}
const encode = value => Buffer.from(JSON.stringify(value));
const parseFixture = value => parseFirebaseConfig(encode(value));
function expoConfig() {
  return { android: { package: "com.qualitzer.field", googleServicesFile: pushPolicy.googleServicesFile }, extra: { eas: { projectId: pushPolicy.expoProjectId } } };
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-release-push-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function writeFirebase(directory, bytes = encode(fixture())) {
  const filename = path.resolve(directory, pushPolicy.googleServicesFile);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes);
  return filename;
}
function resourceDump(expected, configuration = "(default)") {
  return `      config ${configuration}:\n${Object.entries(expected.resources).map(([key, value], index) =>
    `        resource 0x7f1200${index} com.qualitzer.field:string/${key}: t=0x03 d=0x00000001 (s=0x0008 r=0x00)\n          (string8) "${value}"`).join("\n")}\n`;
}
function apkFixture(directory, content = encode(expoConfig()), name = "assets/app.config", compressed = false) {
  const filename = path.join(directory, "fixture.apk");
  const nameBytes = Buffer.from(name);
  const payload = compressed ? deflateRawSync(content) : content;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(local.length + nameBytes.length + payload.length, 16);
  fs.writeFileSync(filename, Buffer.concat([local, nameBytes, payload, central, nameBytes, end]));
  return filename;
}

test("valid public Firebase config exposes IDs and hash but never serializes the API key", () => {
  const result = parseFixture(fixture());
  assert.equal(result.firebaseProjectId, pushPolicy.firebaseProjectId);
  assert.equal(result.firebaseAppId, pushPolicy.firebaseAppId);
  assert.match(result.firebaseConfigSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.resources.google_api_key === fakeApiKey, true);
  assert.equal(JSON.stringify(result).includes(fakeApiKey), false);
  assert.equal(JSON.stringify({ ...result }).includes("google_api_key"), false);
});

for (const [label, mutate] of [
  ["missing project", data => { delete data.project_info; }],
  ["wrong project ID", data => { data.project_info.project_id = "wrong-project"; }],
  ["wrong sender ID", data => { data.project_info.project_number = "123"; }],
  ["wrong storage bucket", data => { data.project_info.storage_bucket = "wrong.appspot.com"; }],
  ["wrong Android package", data => { data.client[0].client_info.android_client_info.package_name = "com.other.app"; }],
  ["missing Android client", data => { data.client = []; }],
  ["ambiguous Android clients", data => { data.client.push(structuredClone(data.client[0])); }],
  ["wrong mobile SDK ID", data => { data.client[0].client_info.mobilesdk_app_id = "1:123:android:bad"; }],
  ["missing API key", data => { delete data.client[0].api_key; }],
  ["malformed API key", data => { data.client[0].api_key[0].current_key = "fake-invalid-key"; }],
  ["multiple API keys", data => { data.client[0].api_key.push({ current_key: fakeApiKey }); }],
  ["unsupported version", data => { data.configuration_version = "2"; }],
  ["unknown credential-like field", data => { data.client[0].unknown = "unexpected"; }],
  ["excess clients", data => { data.client = Array.from({ length: 51 }, () => structuredClone(data.client[0])); }],
]) {
  test(`rejects ${label} with a value-free error`, () => {
    const data = fixture();
    mutate(data);
    assert.throws(() => parseFixture(data), error => /^PUSH_[A-Z_]+$/.test(error.message) && !error.message.includes(fakeApiKey));
  });
}

test("selects only the matching Android client, not the first client", () => {
  const data = fixture();
  const other = structuredClone(data.client[0]);
  other.client_info.android_client_info.package_name = "com.other.app";
  other.client_info.mobilesdk_app_id = "1:123:android:other";
  other.api_key[0].current_key = `AIza${"1".repeat(35)}`;
  data.client.unshift(other);
  assert.equal(parseFixture(data).resources.google_api_key === fakeApiKey, true);
});

for (const [label, input] of [
  ["empty", Buffer.alloc(0)], ["malformed JSON", Buffer.from('{"fake-invalid-key":')],
  ["oversized", Buffer.alloc(MAX_CONFIG_BYTES + 1, 32)], ["invalid UTF8", Buffer.from([0xff])],
  ["null", Buffer.from("null")], ["array", Buffer.from("[]")],
  ["too deep", Buffer.from('['.repeat(18) + '0' + ']'.repeat(18))],
  ["too many nodes", encode(Array(4097).fill(0))], ["oversized string", encode({ value: "a".repeat(4097) })],
]) test(`bounded parser rejects ${label}`, () => assert.throws(() => parseFirebaseConfig(input), /^Error: PUSH_[A-Z_]+$/));

for (const [label, fake] of [
  ["service account", { type: "service_account" }],
  ["nested private key", { nested: [{ private_key: "fake-not-a-key" }] }],
  ["normalized private key ID", { nested: { privateKeyId: "fake" } }],
  ["client email", { client_email: "fake@example.invalid" }],
  ["PEM in arbitrary value", { nested: { text: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----" } }],
  ["credential outside selected client", { nested: [{ refresh_token: "fake" }] }],
]) test(`rejects ${label} anywhere without echoing it`, () => {
  const data = fixture();
  data.unexpected = fake;
  assert.throws(() => parseFixture(data), { message: "PUSH_PRIVATE_CREDENTIAL_REJECTED" });
});

test("reads only the pinned public file and rejects missing/oversized/malformed files", t => {
  const directory = temporary(t);
  assert.throws(() => verifyPushConfig(directory, expoConfig()), /PUSH_FIREBASE_FILE_UNREADABLE/);
  writeFirebase(directory, Buffer.alloc(MAX_CONFIG_BYTES + 1));
  assert.throws(() => verifyPushConfig(directory, expoConfig()), /PUSH_FIREBASE_FILE_UNREADABLE/);
  writeFirebase(directory, Buffer.from("{"));
  assert.throws(() => verifyPushConfig(directory, expoConfig()), /PUSH_CONFIG_JSON_INVALID/);
  const filename = writeFirebase(directory);
  assert.equal(verifyPushConfig(directory, expoConfig()).senderId, pushPolicy.senderId);
  const config = expoConfig();
  config.android.googleServicesFile = filename;
  assert.equal(verifyPushConfig(directory, config).senderId, pushPolicy.senderId);
  for (const value of [undefined, "", "../google-services.json", "./.data/private.json", "https://example.invalid/file.json"]) {
    config.android.googleServicesFile = value;
    assert.throws(() => verifyPushConfig(directory, config), /PUSH_FIREBASE_FILE_PATH_INVALID/);
  }
});

test("private PEM or service-account markers cannot hide behind duplicate JSON fields", () => {
  for (const hidden of ['-----BEGIN PRIVATE KEY-----FAKE', 'service_account', '-----BEGIN \\u0050RIVATE KEY-----FAKE']) {
    const text = JSON.stringify(fixture()).replace(`"current_key":"${fakeApiKey}"`, `"current_key":"${hidden}","current_key":"${fakeApiKey}"`);
    assert.throws(() => parseFirebaseConfig(Buffer.from(text)), { message: "PUSH_PRIVATE_CREDENTIAL_REJECTED" });
  }
});

test("requires the exact Expo UUID and package before reading any Firebase file", () => {
  for (const id of [undefined, "", "not-uuid", "00000000-0000-4000-8000-000000000000", pushPolicy.expoProjectId.toUpperCase()]) {
    const config = expoConfig();
    config.extra.eas.projectId = id;
    assert.throws(() => verifyPushConfig("missing-directory", config), /PUSH_EXPO_PROJECT_ID_MISMATCH/);
  }
  const config = expoConfig();
  config.android.package = "com.other.app";
  assert.throws(() => verifyPushConfig("missing-directory", config), /PUSH_ANDROID_PACKAGE_MISMATCH/);
});

test("real Expo getConfig retains static IDs/file with sanitized environment and no dotenv reads", () => {
  const environment = releaseEnvironment({
    PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
    EXPO_PROJECT_ID: "fake-invalid-override", GOOGLE_SERVICES_FILE: "./.data/private.json",
    EXPO_TOKEN: "fake", GOOGLE_APPLICATION_CREDENTIALS: "fake", NODE_OPTIONS: "fake",
    QUALITZER_BRAND_FILE: "fake", EXPO_PUBLIC_FAKE_SECRET: "fake", EXPO_NO_DOTENV: "0",
  });
  for (const key of ["EXPO_PROJECT_ID", "GOOGLE_SERVICES_FILE", "EXPO_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS", "NODE_OPTIONS", "QUALITZER_BRAND_FILE", "EXPO_PUBLIC_FAKE_SECRET"]) assert.equal(Object.hasOwn(environment, key), false);
  assert.equal(environment.EXPO_NO_DOTENV, "1");
  const before = fs.readFileSync(path.join(root, "app.config.ts"));
  const originalRead = fs.readFileSync;
  fs.readFileSync = function (filename, ...args) {
    if (typeof filename === "string" && /(?:^|[\\/])(?:\.env(?:\.|$)|\.data[\\/])/.test(filename)) throw new Error("TEST_PRIVATE_READ_FORBIDDEN");
    return originalRead.call(fs, filename, ...args);
  };
  let config;
  try { config = resolveReleaseConfig(root, environment); }
  finally { fs.readFileSync = originalRead; }
  assert.equal(config.extra.eas.projectId, pushPolicy.expoProjectId);
  assert.equal(config.android.googleServicesFile, pushPolicy.googleServicesFile);
  assert.equal(config.extra.gateway.standalone, true);
  const verified = verifyPushConfig(root, config);
  assert.equal(verified.firebaseAppId, pushPolicy.firebaseAppId);
  assert.equal(JSON.stringify(verified).includes(verified.resources.google_api_key), false);
  assert.equal(fs.readFileSync(path.join(root, "app.config.ts")).equals(before), true);
});

test("resource verification compares all five values in memory and accepts equal locale variants", () => {
  const expected = parseFixture(fixture());
  verifyPushResources(resourceDump(expected) + resourceDump(expected, "en"), expected);
  for (const name of Object.keys(expected.resources)) {
    const dump = resourceDump(expected);
    const bad = dump.replace(`"${expected.resources[name]}"`, '"fake-mismatch"');
    assert.throws(() => verifyPushResources(bad, expected), { message: "PUSH_APK_FIREBASE_RESOURCE_MISMATCH" });
    assert.throws(() => verifyPushResources(dump + bad.replace("(default)", "fr"), expected), /PUSH_APK_FIREBASE_RESOURCE_MISMATCH/);
  }
});

test("rejects missing, foreign-package, spec-only, non-string and non-default resources", () => {
  const expected = parseFixture(fixture());
  for (const dump of ["", resourceDump(expected, "en"), resourceDump(expected).replaceAll("com.qualitzer.field:", "com.other.app:"), resourceDump(expected).replaceAll("resource ", "spec resource ")]) {
    assert.throws(() => verifyPushResources(dump, expected), /PUSH_APK_FIREBASE_RESOURCES_MISSING/);
  }
  assert.throws(() => verifyPushResources(resourceDump(expected).replaceAll("(string8)", "(reference)"), expected), /PUSH_APK_FIREBASE_RESOURCE_MISMATCH/);
});

test("resource capture errors discard stdout/stderr rather than exposing values", () => {
  assert.throws(() => readApkResources("missing-aapt-executable", "missing.apk", releaseEnvironment({})), { message: "PUSH_APK_RESOURCE_DUMP_FAILED" });
});

for (const compressed of [false, true]) test(`compiled APK reads actual ${compressed ? "deflated" : "stored"} app.config and reports CLIENT_ONLY`, t => {
  const expected = parseFixture(fixture());
  const apk = apkFixture(temporary(t), encode(expoConfig()), "assets/app.config", compressed);
  const report = verifyCompiledPush(apk, expected, resourceDump(expected), manifest);
  assert.equal(report.pushConfigured, true);
  assert.equal(report.clientConfigured, true);
  assert.equal(report.remotePending, true);
  assert.equal(report.scope, "CLIENT_ONLY");
  assert.equal(Object.hasOwn(report, "remotePushEnabled"), false);
  assert.equal(JSON.stringify(report).includes(fakeApiKey), false);
});

test("compiled verification rejects missing/wrong Expo ID despite correct source/resources", t => {
  const directory = temporary(t);
  const expected = parseFixture(fixture());
  for (const id of [undefined, "00000000-0000-4000-8000-000000000000"]) {
    const config = expoConfig();
    config.extra.eas.projectId = id;
    config.unrelated = pushPolicy.expoProjectId;
    assert.throws(() => verifyCompiledPush(apkFixture(directory, encode(config)), expected, resourceDump(expected), manifest), /PUSH_EXPO_PROJECT_ID_MISMATCH/);
  }
});

test("compiled verification rejects absent/malformed/oversized embedded config and missing provider", t => {
  const directory = temporary(t);
  const expected = parseFixture(fixture());
  for (const [content, name] of [[Buffer.from("{"), "assets/app.config"], [encode(expoConfig()), "assets/not-app.config"], [Buffer.alloc(MAX_CONFIG_BYTES + 1), "assets/app.config"]]) {
    assert.throws(() => verifyCompiledPush(apkFixture(directory, content, name), expected, resourceDump(expected), manifest), /PUSH_APK_EXPO_CONFIG_INVALID/);
  }
  assert.throws(() => verifyCompiledPush(apkFixture(directory), expected, resourceDump(expected), ""), /PUSH_APK_FIREBASE_PROVIDER_MISSING/);
});

test("embedded config decompression is bounded before JSON parsing", t => {
  const expected = parseFixture(fixture());
  const oversized = encode({ padding: "a".repeat(MAX_CONFIG_BYTES * 4) });
  const apk = apkFixture(temporary(t), oversized, "assets/app.config", true);
  assert.throws(() => verifyCompiledPush(apk, expected, resourceDump(expected), manifest), /PUSH_APK_EXPO_CONFIG_INVALID/);
});

test("build checks source before prebuild and APK before diagnostic return/publication without logging resource dump", () => {
  const source = fs.readFileSync(path.join(root, "scripts/android/build-standalone.cjs"), "utf8");
  assert.ok(source.indexOf("const pushConfig = verifyPushConfig") < source.indexOf('await run("prebuild"'));
  assert.ok(source.indexOf("const push = verifyCompiledPush") < source.indexOf('if (args.includes("--diagnostic-only"))'));
  assert.ok(source.indexOf('if (args.includes("--diagnostic-only"))') < source.indexOf("fs.copyFileSync(sourceApk"));
  assert.ok(source.includes("finalPushConfig.firebaseConfigSha256 !== pushConfig.firebaseConfigSha256"));
  assert.equal(/run\([^\n]*["']resources["']/.test(source), false);
  assert.ok(source.includes("releaseEnvironment(process.env)"));
});