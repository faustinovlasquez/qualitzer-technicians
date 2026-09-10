import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { RELEASE_GATEWAY_URL, standaloneGatewayUrl } from "../config/gatewayPolicy";
import { probeGatewayConnection, requireConfiguredGateway, resolveGatewayConfiguration, storedGatewayMismatch, validGatewayUrl } from "../src/infrastructure/gatewayConnection";
import { tenantStorageNamespace } from "../src/domain/tenantSession";
import { user } from "../src/offline/tests/fakes";

const root = resolve(__dirname, "..");
const base = RELEASE_GATEWAY_URL;
const standalone = { standaloneFlag: "true", configuredUrl: base, nativeRelease: true, developmentUrl: (): never => { throw new Error("MUST_NOT_DISCOVER_LOCAL_GATEWAY"); } };
const invalid = [
  "", "http://api.example.com/mobile", "https://localhost/mobile", "https://localhost./mobile", "https://127.1/mobile", "https://0x7f000001/mobile",
  "https://2130706433/mobile", "https://192.168.1.105:8787/mobile", "https://10.1.2.3/mobile", "https://172.16.0.1/mobile", "https://169.254.1.1/mobile",
  "https://8.8.8.8/mobile", "https://[::1]/mobile", "https://[fd12::1]/mobile", "https://[2001:4860:4860::8888]/mobile", "https://printer/mobile",
  "https://gateway.local/mobile", "https://gateway.internal/mobile", "https://gateway.home.arpa/mobile", ` ${base}`, `${base} `,
  `${base}?`, `${base}#`, `${base}?token=secret`, `${base}/../other`, `${base}/./other`, `${base}/%2e%2e/other`, `${base}/%252e%252e/other`,
  `${base}/%2Fother`, `${base}/%5cother`, `${base}//other`, `${base}//`, `${base}\\other`, `${base}\n`, `${base}\t`, "https://user:secret@api.example.com/mobile",
];

test("standalone rejects local, IP, non-HTTPS and ambiguous bases without local discovery", () => {
  for (const value of invalid) {
    assert.throws(() => standaloneGatewayUrl(value), value);
    const config = resolveGatewayConfiguration({ ...standalone, configuredUrl: value });
    assert.equal(config.locked, true, value);
    assert.equal(config.url, "", value);
    assert.ok(config.error, value);
    assert.throws(() => requireConfiguredGateway(config, base));
  }
});

test("standalone accepts canonical full HTTPS base; embedded config and env cannot disagree", () => {
  const config = resolveGatewayConfiguration(standalone);
  assert.deepEqual(config, { locked: true, url: base, error: null });
  assert.equal(standaloneGatewayUrl(`${base}/`), base);
  assert.equal(requireConfiguredGateway(config, `${base}/`), base);
  for (const value of ["https://api.example.com/mobile", base.replace("/mobile", "/other"), new URL(base).origin, "http://localhost:8787"]) assert.throws(() => requireConfiguredGateway(config, value));
  assert.equal(resolveGatewayConfiguration({ ...standalone, configuredUrl: undefined, extra: { standalone: true, url: base } }).url, base);
  assert.ok(resolveGatewayConfiguration({ ...standalone, extra: { standalone: true, url: `${base}/other` } }).error);
  assert.ok(resolveGatewayConfiguration({ ...standalone, standaloneFlag: "false", extra: { standalone: true, url: base } }).error);
  assert.ok(resolveGatewayConfiguration({ ...standalone, standaloneFlag: "TRUE" }).error);
  assert.ok(resolveGatewayConfiguration({ ...standalone, standaloneFlag: undefined, configuredUrl: undefined }).error);
  assert.ok(resolveGatewayConfiguration({ ...standalone, standaloneFlag: undefined, configuredUrl: "http://localhost:8787" }).error);
});

test("development retains configured, embedded and local discovery choices and editable endpoints", () => {
  const dev = { nativeRelease: false, developmentUrl: () => "http://192.168.1.105:8787" };
  assert.deepEqual(resolveGatewayConfiguration(dev), { locked: false, url: dev.developmentUrl(), error: null });
  const config = resolveGatewayConfiguration({ ...dev, configuredUrl: "http://localhost:8787" });
  assert.equal(config.url, "http://localhost:8787");
  assert.equal(requireConfiguredGateway(config, base), base);
  assert.equal(storedGatewayMismatch(config, base), null);
  assert.equal(resolveGatewayConfiguration({ ...dev, extra: { standalone: false, url: base } }).url, base);
});

test("root namespaces remain byte-identical and mounted gateways have isolated complete-path identities", () => {
  assert.ok(user.tenant);
  const session = { mode: "live" as const, tenant: user.tenant, user };
  for (const value of ["http://localhost:8787", "http://192.168.1.105:8787/", "https://EXAMPLE.com:443/", "http://[::1]:8787/"]) {
    const old = JSON.stringify(["tenant-v2", session.mode, new URL(value).origin, session.tenant.id, session.tenant.portalOrigin, session.tenant.environment, session.user.id, 1]);
    assert.equal(tenantStorageNamespace(session, value, 1), old);
  }
  const key = tenantStorageNamespace(session, base, 1);
  assert.equal(tenantStorageNamespace(session, `${base}/`, 1), key);
  for (const other of [new URL(base).origin, base.replace("/mobile", "/other"), base.replace("/mobile", "/Mobile"), `${base}/child`]) assert.notEqual(tenantStorageNamespace(session, other, 1), key);
  assert.equal(validGatewayUrl(" https://EXAMPLE.com:443/mobile/ "), "https://example.com/mobile");
});

test("stored endpoint mismatch includes base path and never modifies the supplied session", () => {
  const config = resolveGatewayConfiguration(standalone);
  for (const gatewayUrl of ["http://localhost:8787", new URL(base).origin, base.replace("/mobile", "/other"), `${base}/../mobile`]) {
    const stored = Object.freeze({ gatewayUrl, token: "untouched", queue: "old-data" });
    assert.match(storedGatewayMismatch(config, stored.gatewayUrl) ?? "", /Se conservan/);
    assert.deepEqual(stored, { gatewayUrl, token: "untouched", queue: "old-data" });
  }
  assert.equal(storedGatewayMismatch(config, `${base}/`), null);
});

test("health uses the mounted whole base and pending deployment responses never appear ready", async () => {
  for (const status of [404, 503, 200]) {
    const result = await probeGatewayConnection(base, async (url, options) => {
      assert.equal(url, `${base}/health`);
      assert.equal(options.credentials, "omit");
      return { ok: status === 200, headers: { get: () => "application/json" }, json: async () => ({ ok: true, backendReachable: false }) };
    });
    assert.equal(result.status, status === 200 ? "backend_unavailable" : "http_error");
    if (status !== 200) assert.ok(result.message.includes(`${base}/health`));
  }
});

interface ReleaseEnvironment {
  EXPO_PUBLIC_STANDALONE?: string;
  EXPO_PUBLIC_GATEWAY_URL?: string;
  EAS_BUILD_PROFILE?: string;
}

function evaluatedConfig(env: ReleaseEnvironment) {
  const inherited = { ...process.env };
  for (const key of ["EXPO_PUBLIC_GATEWAY_URL", "EXPO_PUBLIC_STANDALONE", "EAS_BUILD_PROFILE", "QUALITZER_BRAND_FILE", "EXPO_PROJECT_ID", "GOOGLE_SERVICES_FILE"]) delete inherited[key];
  return spawnSync(process.execPath, ["-e", "const {getConfig}=require('@expo/config'); const {exp}=getConfig(process.cwd(), {skipPlugins:true}); process.stdout.write(JSON.stringify({gateway:exp.extra.gateway,updates:exp.updates}));"], {
    cwd: root, env: { ...inherited, EXPO_NO_DOTENV: "1", ...env }, encoding: "utf8",
  });
}

test("Expo evaluates actual standalone app config and APK profile without prebuild or network", () => {
  const eas = JSON.parse(readFileSync(resolve(root, "eas.json"), "utf8")) as { build: { "standalone-apk": { distribution: string; developmentClient: boolean; android: { buildType: string }; env: ReleaseEnvironment }; preview: { extends: string } } };
  const profile = eas.build["standalone-apk"];
  assert.equal(profile.distribution, "internal");
  assert.equal(profile.developmentClient, false);
  assert.equal(profile.android.buildType, "apk");
  assert.equal(profile.env.EXPO_PUBLIC_GATEWAY_URL, base);
  assert.equal(profile.env.EXPO_PUBLIC_STANDALONE, "true");
  assert.equal(eas.build.preview.extends, "standalone-apk");
  const result = evaluatedConfig({ ...profile.env, EAS_BUILD_PROFILE: "standalone-apk" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { gateway: { standalone: true, url: base }, updates: { enabled: false, useEmbeddedUpdate: true } });
});

test("Expo config fails build-time with missing/private/ambiguous release URL or missing flag", () => {
  for (const value of [undefined, "http://localhost:8787", "https://192.168.1.105/mobile", `${base}/../other`, `${base}?`, ` ${base}`]) {
    const result = evaluatedConfig({ EXPO_PUBLIC_STANDALONE: "true", EXPO_PUBLIC_GATEWAY_URL: value });
    assert.notEqual(result.status, 0, String(value));
  }
  assert.notEqual(evaluatedConfig({ EAS_BUILD_PROFILE: "standalone-apk", EXPO_PUBLIC_GATEWAY_URL: base }).status, 0);
  const dev = evaluatedConfig({ EXPO_PUBLIC_GATEWAY_URL: "http://localhost:8787" });
  assert.equal(dev.status, 0, dev.stderr);
  assert.deepEqual(JSON.parse(dev.stdout), { gateway: { standalone: false, url: "http://localhost:8787" } });
});