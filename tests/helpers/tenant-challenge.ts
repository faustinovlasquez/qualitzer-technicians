import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { TenantLoginChallenge } from "../../src/domain/models";

export const serverDate = "Thu, 10 Sep 2026 12:00:00 GMT";
export const tenant = { id: "tenant-1", name: "Empresa 1", portalOrigin: "https://one.example.test", environment: "production" as const };
export function challenge(): TenantLoginChallenge {
  return { nextStep: "SELECT_TENANT", challenge: `qzc_${"a".repeat(43)}`, expiresAt: "2026-09-10T12:02:00.000Z",
    tenants: Array.from({ length: 10 }, (_, index) => ({ ...tenant, id: `tenant-${index + 1}`, name: `Empresa ${index + 1}` })) };
}
export const loginResult = { nextStep: "DONE", token: `qzm_${"b".repeat(43)}`, username: "fixture", email: "fixture@example.test", tenant };

export function loadSource<T>(relative: string, imports: (id: string) => unknown, globals: object = {}): T {
  const filename = resolve(__dirname, "../../src", relative);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require: imports, Error, Date, AbortController, setTimeout, clearTimeout, ...globals });
  return module.exports as T;
}

export function httpFixture(options: { date?: string | null; body?: object; requestMs?: number; bodyMs?: number; os?: "android" | "web"; completeStatus?: number } = {}) {
  const time = { mono: 1000, wall: Date.parse("2030-01-01T12:00:00Z") };
  class PhoneDate extends Date { static now() { return time.wall; } }
  const clock = loadSource<typeof import("../../src/infrastructure/tenantChallengeClock")>("infrastructure/tenantChallengeClock.ts", () => { throw new Error("UNEXPECTED_IMPORT"); }, {
    Date: PhoneDate, performance: { now: () => time.mono },
  });
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const localRequire = createRequire(resolve(__dirname, "../../src/infrastructure/HttpTechnicianRepository.ts"));
  const http = loadSource<typeof import("../../src/infrastructure/HttpTechnicianRepository")>("infrastructure/HttpTechnicianRepository.ts", (id) => {
    if (id === "react-native") return { Platform: { OS: options.os ?? "android" } };
    if (id === "./tenantChallengeClock") return clock;
    if (id === "./photos") return {
      uploadFetch: async (url: string, init: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        const start = url.endsWith("/auth/login/start");
        if (!start && !url.endsWith("/auth/login/complete")) throw new Error("NETWORK_FORBIDDEN");
        time.mono += start ? options.requestMs ?? 400 : 20;
        const status = start ? 200 : options.completeStatus ?? 200;
        const date = options.date === undefined ? serverDate : options.date;
        const response = new Response(null, { status, headers: date === null ? {} : { Date: date } });
        response.text = async () => {
          time.mono += start ? options.bodyMs ?? 100 : 10;
          return JSON.stringify(start ? options.body ?? challenge() : status === 401 ? { error: "LOGIN_CHALLENGE_EXPIRED" } : loginResult);
        };
        return response;
      },
    };
    return localRequire(id);
  }, { AbortController, FormData, URLSearchParams });
  return { clock, time, calls, HttpRepository: http.HttpTechnicianRepository, repo: new http.HttpTechnicianRepository("https://gateway.example.test/mobile"), PhoneDate };
}

export function reactFixture() {
  const slots: unknown[] = [];
  let cursor = 0;
  const effects: Array<{ dependencies: readonly unknown[]; run: () => void | (() => void); cleanup?: () => void }> = [];
  const pending = new Set<number>();
  const react = {
    useState: <T>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slots[index], (next: T | ((value: T) => T)) => { slots[index] = typeof next === "function" ? (next as (value: T) => T)(slots[index] as T) : next; }];
    },
    useRef: <T>(initial: T) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: <T>(callback: T) => callback,
    useMemo: <T>(factory: () => T) => factory(),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (run: () => void | (() => void), dependencies: readonly unknown[]) => {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        effects[index] = { dependencies, run, cleanup: previous?.cleanup };
        pending.add(index);
      }
    },
  };
  return {
    react,
    render: <T>(render: () => T): T => { cursor = 0; return render(); },
    flush: () => { for (const index of pending) { const effect = effects[index]; effect.cleanup?.(); effect.cleanup = effect.run() ?? undefined; } pending.clear(); },
    unmount: () => {
      for (const effect of effects) effect?.cleanup?.();
      slots.length = 0; effects.length = 0; pending.clear();
    },
    restore: () => { const first = effects.find((effect) => effect !== undefined); if (!first) throw new Error("NO_RESTORE_EFFECT"); first.run(); },
  };
}