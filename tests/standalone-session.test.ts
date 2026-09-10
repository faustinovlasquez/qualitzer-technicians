import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as connection from "../src/infrastructure/gatewayConnection";
import * as errors from "../src/infrastructure/errors";
import * as tenantSession from "../src/domain/tenantSession";
import type { StoredSession } from "../src/infrastructure/sessionStorage";
import { RELEASE_GATEWAY_URL } from "../config/gatewayPolicy";
import { user } from "../src/offline/tests/fakes";

type App = ReturnType<typeof import("../src/application/useTechnicianApp").useTechnicianApp>;
function fixture(configuration: connection.GatewayConfiguration, stored: StoredSession | null) {
  const slots: unknown[] = [];
  const effects: Array<() => void> = [];
  let cursor = 0;
  let mounted = false;
  const calls: string[] = [];
  class OfflineRepository {}
  class HttpRepository {
    constructor(readonly baseUrl: string) { calls.push(`repository:${baseUrl}`); }
    async startLogin(): Promise<never> { calls.push(`login:${this.baseUrl}`); throw new errors.NetworkError("network"); }
  }
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/application/useTechnicianApp.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as { useTechnicianApp: () => App } };
  runInNewContext(code, {
    module, exports: module.exports, __DEV__: false, Error,
    require: (id: string): unknown => {
      if (id === "react") return {
        useState: <T>(initial: T | (() => T)) => {
          const index = cursor++;
          if (!mounted) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
          return [slots[index], (next: T | ((current: T) => T)) => { slots[index] = typeof next === "function" ? (next as (current: T) => T)(slots[index] as T) : next; }];
        },
        useRef: <T>(initial: T) => {
          const index = cursor++;
          if (!mounted) slots[index] = { current: initial };
          return slots[index];
        },
        useCallback: <T>(callback: T) => callback,
        useMemo: <T>(factory: () => T) => factory(),
        useEffect: (effect: () => void) => { if (!mounted) effects.push(effect); },
        useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
      };
      if (id === "react-native") return { Platform: { OS: "android" } };
      if (id === "expo-constants") return { expoConfig: { hostUri: "192.168.1.105:8081" } };
      if (id === "../infrastructure/gatewayConfig") return { gatewayConfiguration: configuration };
      if (id === "../infrastructure/gatewayConnection") return connection;
      if (id === "../infrastructure/errors") return errors;
      if (id === "../domain/tenantSession") return tenantSession;
      if (id === "../domain/format") return { dateKey: () => "2026-09-10" };
      if (id === "../domain/assignmentSchedule") return { dailyRange: (day: string) => ({ startDate: day, endDate: day }) };
      if (id === "../notifications") return { useMobileNotifications: () => ({ client: null }) };
      if (id === "../offline") return { OfflineTechnicianRepository: OfflineRepository, restoreOfflineSession: () => { calls.push("restoreOfflineSession"); throw new Error("FORBIDDEN"); } };
      if (id === "../infrastructure/HttpTechnicianRepository") return { HttpTechnicianRepository: HttpRepository };
      if (id === "../infrastructure/sessionStorage") return {
        loadSession: async () => { calls.push("loadSession"); return stored; },
        loadGateway: async () => { calls.push("loadGateway"); return "http://localhost:8787"; },
        saveSession: async () => { calls.push("saveSession"); },
        removeSession: async () => { calls.push("removeSession"); },
        saveGateway: async () => { calls.push("saveGateway"); },
      };
      return {};
    },
  });
  function render(): App { cursor = 0; const app = module.exports.useTechnicianApp(); mounted = true; return app; }
  return {
    calls, render,
    restore: async () => {
      render(); effects[0]();
      await new Promise<void>((resolve) => setImmediate(resolve));
      return render();
    },
  };
}
const configuration = connection.resolveGatewayConfiguration({ nativeRelease: true, standaloneFlag: "true", configuredUrl: RELEASE_GATEWAY_URL, developmentUrl: () => { throw new Error("NO_LOCAL_FALLBACK"); } });

test("actual app hook preserves mismatched stored session and never creates a repo, restores offline or sends credentials", async () => {
  assert.ok(user.tenant);
  for (const gatewayUrl of ["http://localhost:8787", new URL(RELEASE_GATEWAY_URL).origin, RELEASE_GATEWAY_URL.replace("/mobile", "/other")]) {
    const stored: StoredSession = { token: `qzm_${"a".repeat(43)}`, gatewayUrl, branchId: 1, tenant: user.tenant };
    const before: string = JSON.stringify(stored);
    const f = fixture(configuration, stored);
    let app = await f.restore();
    assert.equal(app.restoring, false);
    assert.equal(app.session, null);
    assert.equal(app.gatewayUrl, RELEASE_GATEWAY_URL);
    assert.match(app.error ?? "", /Se conservan/);
    assert.equal(app.suggestedGatewayUrl, undefined);
    app.setGatewayUrl(gatewayUrl);
    app = f.render();
    assert.equal(app.gatewayUrl, RELEASE_GATEWAY_URL);
    await app.login("test-only", "test-only");
    await f.render().demo();
    await f.render().logout();
    assert.deepEqual(f.calls, ["loadSession"]);
    assert.equal(JSON.stringify(stored), before);
  }
});

test("actual app hook rejects invalid standalone config before reading sessions or attempting login", async () => {
  const invalid = connection.resolveGatewayConfiguration({ nativeRelease: true, standaloneFlag: "true", configuredUrl: "http://localhost:8787", developmentUrl: () => { throw new Error("NO_LOCAL_FALLBACK"); } });
  const f = fixture(invalid, null);
  const app = await f.restore();
  assert.ok(app.error);
  assert.equal(app.gatewayUrl, "");
  await app.login("test-only", "test-only");
  await f.render().demo();
  assert.deepEqual(f.calls, []);
});

test("actual app hook ignores saved local gateway in a new standalone session and uses only pinned whole base", async () => {
  const f = fixture(configuration, null);
  const app = await f.restore();
  app.setGatewayUrl("http://localhost:8787");
  await f.render().login("test-only", "test-only");
  assert.deepEqual(f.calls, ["loadSession", `repository:${RELEASE_GATEWAY_URL}`, `login:${RELEASE_GATEWAY_URL}`]);
  assert.equal(f.render().gatewayUrl, RELEASE_GATEWAY_URL);
  assert.ok(f.render().error?.includes(RELEASE_GATEWAY_URL));
});