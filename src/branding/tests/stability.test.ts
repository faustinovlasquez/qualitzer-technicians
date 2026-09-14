import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";
import { CompanyBrandingController } from "../CompanyBrandingController";
import { companyLogoHttpsUrl, prepareCompanyBranding } from "../companyBranding";
import type { CompanyBrandingInput, CompanyBrandingPayload, CompanyBrandingPort, CompanyBrandingStatus, CompanyBrandingUi, CompanyPinResult } from "../contracts";

const digest = async (text: string) => createHash("sha256").update(text).digest("hex");
const input: CompanyBrandingInput = {
  session: { mode: "live", tenant: { id: "tenant-1", name: "Empresa", logo: null, portalOrigin: "https://company.example.com", environment: "production" } },
  gatewayUrl: "https://gateway.example.com/mobile", branchName: "Central", verified: true,
};
const clone = (): CompanyBrandingInput => ({ ...input, session: input.session && { ...input.session, tenant: { ...input.session.tenant } } });

class Native implements CompanyBrandingPort {
  revision = 0;
  calls: (CompanyBrandingPayload | null)[] = [];
  pins = 0;
  automaticCalls = 0;
  asked = new Set<string>();
  existingPins = new Set<string>();
  failSync = false;
  failSubscription = false;
  invalidate(): number { return ++this.revision; }
  async synchronize(_revision: number, payload: CompanyBrandingPayload | null): Promise<CompanyBrandingStatus> {
    this.calls.push(payload);
    if (this.failSync) throw new Error("OEM_SYNCHRONIZE_EXCEPTION");
    return { ready: payload !== null, pinSupported: true, logoUsed: "qualitzer" };
  }
  async requestPin(): Promise<CompanyPinResult> { this.pins++; return "pending"; }
  async requestAutomaticPin(): Promise<CompanyPinResult> {
    this.automaticCalls++;
    const id = this.calls.at(-1)?.shortcutId;
    if (!id) return "stale";
    if (this.existingPins.has(id)) { this.asked.add(id); return "updated"; }
    if (this.asked.has(id)) return "skipped";
    this.asked.add(id);
    return this.requestPin();
  }
  addListener(): { remove(): void } {
    if (this.failSubscription) throw new Error("OEM_SUBSCRIBE_EXCEPTION");
    return { remove() { throw new Error("MODULE_ALREADY_DESTROYED"); } };
  }
}

test("100 fresh me objects coalesce pending and completed synchronization without resets or pin requests", async () => {
  const native = new Native();
  const controller = new CompanyBrandingController(native, digest);
  await Promise.all(Array.from({ length: 100 }, () => controller.synchronize(clone())));
  for (let index = 0; index < 100; index++) await controller.synchronize(clone());
  assert.equal(native.revision, 1);
  assert.equal(native.calls.length, 2);
  assert.equal(native.calls[0], null);
  assert.equal(native.pins, 0);
});

test("same identity branch name/logo refresh updates once without disabling all pins", async () => {
  const native = new Native();
  const controller = new CompanyBrandingController(native, digest);
  await controller.synchronize(input);
  const next = clone();
  next.branchName = "Sur";
  next.session!.tenant.name = "Empresa Sur";
  next.session!.tenant.logo = "https://logos.example.com/branch.png?X-Amz-Signature=synthetic";
  await controller.synchronize(next);
  await controller.synchronize({ ...next, session: { ...next.session!, tenant: { ...next.session!.tenant } } });
  assert.equal(native.calls.length, 3);
  assert.equal(native.calls[2]?.shortcutId, native.calls[1]?.shortcutId);
  assert.equal(native.calls[2]?.branchName, "Sur");
  assert.equal(native.calls[2]?.logoHttpsUrl, next.session!.tenant.logo);
  assert.equal(native.calls.filter((item) => item === null).length, 1);
});

test("verification revoke, logout and real identity switch reset; same tenant metadata does not", async () => {
  for (const changed of [{ ...input, verified: false }, { ...input, session: null }, { ...input, gatewayUrl: "https://other.example.com/mobile" }]) {
    const native = new Native();
    const controller = new CompanyBrandingController(native, digest);
    await controller.synchronize(input);
    await controller.synchronize(changed);
    assert.equal(native.calls[2], null);
    assert.equal(native.pins, 0);
  }
});

test("failed native synchronization rejects once, does not loop on unchanged input, clear permits next session", async () => {
  const native = new Native(); native.failSync = true;
  const controller = new CompanyBrandingController(native, digest);
  await assert.rejects(controller.synchronize(input), /OEM_SYNCHRONIZE_EXCEPTION/);
  await assert.rejects(controller.synchronize(clone()), /OEM_SYNCHRONIZE_EXCEPTION/);
  assert.equal(native.calls.length, 1);
  native.failSync = false;
  await controller.clear();
  await controller.synchronize(input);
  assert.equal(await controller.requestPin(), "pending");
});

test("late old-logo result and confirmation cannot overwrite logout or a newer branch", async () => {
  const native = new Native();
  let finish: (hash: string) => void = () => {};
  let count = 0;
  const controller = new CompanyBrandingController(native, (value) => ++count === 1 ? new Promise((done) => { finish = done; }) : digest(value));
  const old = controller.synchronize(input);
  await new Promise<void>((done) => setImmediate(done));
  await controller.synchronize({ ...input, branchName: "Sur" });
  finish("a".repeat(64));
  assert.equal(await old, null);
  assert.equal(native.calls.at(-1)?.branchName, "Sur");
  assert.equal(controller.isCurrentConfirmation("qz-company-" + "a".repeat(64), 1), false);
  await controller.clear();
  assert.equal(await controller.requestPin(), "unavailable");
});

test("HTTPS logo permits signed public DNS URLs only, preserving query without persisting credentials", async () => {
  const url = "https://bucket.s3.us-east-1.amazonaws.com/company.png?X-Amz-Signature=synthetic%2Fvalue";
  assert.equal(companyLogoHttpsUrl(url), url);
  const next = clone(); next.session!.tenant.logo = url;
  assert.equal((await prepareCompanyBranding(next, digest))?.logoHttpsUrl, url);
  assert.equal(await prepareCompanyBranding({ ...next, verified: false }, digest), null);
  for (const invalid of ["http://logos.example.com/a", "https://user:password@logos.example.com/a", "https://127.0.0.1/a", "https://2130706433/a", "https://0x7f000001/a", "https://[::1]/a", "https://host.local/a", "https://host.internal/a", "https://localhost/a", "https://logos.example.com:444/a", "https://logos.example.com/a#fragment", "https://logos.example.com./a", "https://logos.example.com/\na", " https://logos.example.com/a", "https://logos.example.com\\@localhost/a", "https://logos.example.com/" + "x".repeat(8192)]) assert.equal(companyLogoHttpsUrl(invalid), null, invalid);
});

function hookHarness(native: Native) {
  const values: unknown[] = [];
  const dependencies: (readonly unknown[] | undefined)[] = [];
  const cleanups: (undefined | (() => void))[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let foregroundSubscriptions = 0;
  function changed(index: number, next: readonly unknown[]): boolean {
    const old = dependencies[index];
    dependencies[index] = next;
    return !old || next.length !== old.length || next.some((value, key) => !Object.is(value, old[key]));
  }
  const react = {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((old: T) => T)) => void] {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [values[index] as T, (next) => { values[index] = typeof next === "function" ? (next as (old: T) => T)(values[index] as T) : next; }];
    },
    useRef<T>(value: T): { current: T } { const index = cursor++; return (values[index] ??= { current: value }) as { current: T }; },
    useMemo<T>(factory: () => T, next: readonly unknown[]): T { const index = cursor++; if (changed(index, next)) values[index] = factory(); return values[index] as T; },
    useEffect(effect: () => void | (() => void), next: readonly unknown[]): void {
      const index = cursor++;
      if (changed(index, next)) effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() ?? undefined; });
    },
  };
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../useCompanyBranding.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { useCompanyBranding?: (value: CompanyBrandingInput, disabled: boolean, automatic: boolean) => CompanyBrandingUi } = {};
  const dependenciesByName = new Map<string, unknown>([
    ["react", react], ["react-native", { Platform: { OS: "android" }, AppState: { addEventListener() { foregroundSubscriptions++; return { remove() {} }; } } }],
    ["expo-crypto", { CryptoDigestAlgorithm: { SHA256: "sha256" }, digestStringAsync: (_algorithm: string, value: string) => digest(value) }],
    ["../../modules/company-branding", { __esModule: true, default: native }], ["./CompanyBrandingController", { CompanyBrandingController }],
  ]);
  compileFunction(code, ["require", "exports"])((name: string) => { assert.ok(dependenciesByName.has(name), name); return dependenciesByName.get(name); }, exports);
  return {
    render(value = clone(), automatic = false, disabled = false) { cursor = 0; effects = []; const ui = exports.useCompanyBranding!(value, disabled, automatic); effects.forEach((effect) => effect()); return ui; },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); },
    foregroundSubscriptions: () => foregroundSubscriptions,
  };
}

test("actual hook ignores focus and fresh tenant objects but updates changed scalar logo", async () => {
  const native = new Native(); const hook = hookHarness(native);
  hook.render();
  await new Promise<void>((done) => setImmediate(done));
  for (let index = 0; index < 100; index++) assert.equal(hook.render().canPin, true);
  assert.equal(hook.foregroundSubscriptions(), 0);
  assert.equal(native.calls.length, 2);
  const next = clone(); next.session!.tenant.logo = "https://logos.example.com/branch.png";
  hook.render(next);
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(native.calls.length, 3);
  assert.doesNotThrow(() => hook.unmount());
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(native.calls.at(-1), null);
});

test("actual hook handles subscription and synchronize exceptions without unhandled rejection", async () => {
  const native = new Native(); native.failSync = true; native.failSubscription = true;
  const hook = hookHarness(native);
  assert.doesNotThrow(() => hook.render());
  await new Promise<void>((done) => setImmediate(done));
  const ui = hook.render();
  assert.equal(ui.canPin, false);
  assert.match(ui.message, /no pudo actualizar/);
  assert.doesNotThrow(() => hook.unmount());
  await new Promise<void>((done) => setImmediate(done));
});

test("native sources protect every owned launch and keep recents asynchronous and URL out of prepared state", () => {
  const directory = resolve(__dirname, "../../../modules/company-branding/android/src/main/java/expo/modules/companybranding");
  for (const file of ["CompanyPinReceiver", "CompanyBrandingPackage", "CompanyBrandingModule"]) {
    const source = readFileSync(resolve(directory, file + ".kt"), "utf8");
    assert.doesNotMatch(source, /runCatching|scope\.launch\s*\{/);
    assert.match(source, /launchBranding/);
  }
  const state = readFileSync(resolve(directory, "CompanyBrandingState.kt"), "utf8");
  assert.match(state, /scope\.launchBranding \{ updateTask/);
  assert.match(state, /current\(revision\) === company/);
  assert.match(state, /val payload: CompanyBrandingLabel/);
  assert.match(state, /@Field val logoHttpsUrl: String\? = null/);
  assert.ok(state.indexOf("CompanyBrandingImages.resolve") < state.indexOf("    mutex.withLock"), "Network/decode must not hold the pin/receiver mutex");
  assert.match(state, /private val imageMutex = Mutex\(\)/);
  assert.doesNotMatch(state, /getInstalled|setComponentEnabledSetting|SharedPreferences/);
});

test("actual hook automatically asks after brand readiness and busy ends, not on focus or identical renders", async () => {
  const native = new Native(); const hook = hookHarness(native);
  hook.render(clone(), true, true);
  await new Promise<void>((done) => setImmediate(done));
  hook.render(clone(), true, true);
  assert.equal(native.pins, 0);
  hook.render(clone(), true);
  await new Promise<void>((done) => setImmediate(done));
  for (let index = 0; index < 100; index++) hook.render(clone(), true);
  assert.equal(native.pins, 1);
  assert.equal(native.automaticCalls, 1);
  assert.equal(hook.foregroundSubscriptions(), 0);
  assert.match(hook.render(clone(), true).message, /Confirma en Android/);
  hook.unmount();
});

test("cancel without callback survives hook restart, logout and same-company metadata changes; manual retry remains", async () => {
  const native = new Native(); let hook = hookHarness(native);
  const settle = () => new Promise<void>((done) => setImmediate(done));
  hook.render(clone(), true); await settle(); hook.render(clone(), true); await settle();
  assert.equal(native.pins, 1);
  hook.render({ ...clone(), session: null }, false); await settle();
  hook.unmount(); await settle();
  hook = hookHarness(native);
  const next = clone(); next.branchName = "Sur"; next.session!.tenant.name = "Empresa renombrada";
  hook.render(next, true); await settle(); hook.render(next, true); await settle();
  assert.equal(native.pins, 1);
  hook.render(next, true).onPin(); await settle();
  assert.equal(native.pins, 2);
  hook.unmount();
});

test("existing Android pin is reused automatically; another company is eligible once", async () => {
  const native = new Native(); const hook = hookHarness(native);
  native.existingPins.add((await prepareCompanyBranding(input, digest))!.shortcutId);
  const settle = () => new Promise<void>((done) => setImmediate(done));
  hook.render(clone(), true); await settle(); hook.render(clone(), true); await settle();
  assert.equal(native.pins, 0);
  assert.match(hook.render(clone(), true).message, /Ya existe/);
  const next = { ...clone(), gatewayUrl: "https://other.example.com/mobile" };
  hook.render(next, true); await settle(); hook.render(next, true); await settle();
  assert.equal(native.pins, 1);
  hook.unmount();
});

test("automatic request excludes demo, unverified and missing branch; old APK module degrades without manual fallback", async () => {
  for (const candidate of [{ ...input, verified: false }, { ...input, branchName: null }, { ...input, session: { ...input.session!, mode: "demo" as const } }]) {
    const native = new Native(); const controller = new CompanyBrandingController(native, digest);
    await controller.synchronize(candidate);
    assert.equal(await controller.requestPin(true), "unavailable");
    assert.equal(native.pins, 0);
  }
  const native = new Native();
  Object.defineProperty(native, "requestAutomaticPin", { value: undefined });
  const controller = new CompanyBrandingController(native, digest);
  await controller.synchronize(input);
  assert.equal(await controller.requestPin(true), "unavailable");
  assert.equal(native.pins, 0);
  assert.equal(await controller.requestPin(), "pending");
});

test("automatic/manual overlap deduplicates and logout makes a late result stale", async () => {
  const native = new Native(); let finish!: (result: CompanyPinResult) => void;
  native.requestAutomaticPin = () => new Promise((resolve) => { native.automaticCalls++; finish = resolve; });
  const controller = new CompanyBrandingController(native, digest);
  await controller.synchronize(input);
  const pending = controller.requestPin(true);
  assert.equal(await controller.requestPin(), "unavailable");
  assert.equal(await controller.requestPin(true), "unavailable");
  await controller.clear(); finish("pending");
  assert.equal(await pending, "stale");
  assert.equal(native.automaticCalls, 1);
  assert.equal(controller.isCurrentConfirmation((await prepareCompanyBranding(input, digest))!.shortcutId, native.revision - 1), false);
});

test("automatic native exception is contained and does not nag; manual remains usable", async () => {
  const native = new Native(); const hook = hookHarness(native);
  native.requestAutomaticPin = async () => { native.automaticCalls++; throw new Error("OEM_PIN_EXCEPTION"); };
  const settle = () => new Promise<void>((done) => setImmediate(done));
  hook.render(clone(), true); await settle(); hook.render(clone(), true); await settle();
  assert.match(hook.render(clone(), true).message, /no pudo solicitar/);
  hook.render({ ...clone(), branchName: "Sur" }, true); await settle();
  hook.render({ ...clone(), branchName: "Sur" }, true); await settle();
  assert.equal(native.automaticCalls, 1);
  hook.render({ ...clone(), branchName: "Sur" }, true).onPin(); await settle();
  assert.equal(native.pins, 1);
  hook.unmount();
});