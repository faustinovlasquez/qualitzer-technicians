import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { companyBrandingNamespace, companyLogoDataUri, MAX_COMPANY_LOGO_BYTES, prepareCompanyBranding } from "../src/branding/companyBranding";
import { CompanyBrandingController } from "../src/branding/CompanyBrandingController";
import type { CompanyBrandingInput, CompanyBrandingPayload, CompanyBrandingPort, CompanyBrandingStatus, CompanyPinResult } from "../src/branding/contracts";

const digest = async (value: string) => createHash("sha256").update(value).digest("hex");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=";
const input: CompanyBrandingInput = {
  session: { mode: "live", tenant: { id: "tenant-1", name: "Empresa Uno", portalOrigin: "https://empresa.example", environment: "production", logo: png } },
  verified: true, gatewayUrl: "https://api.example/mobile", branchName: "Central",
};

class FakeNative implements CompanyBrandingPort {
  revision = 0;
  pins = 0;
  calls: { revision: number; payload: CompanyBrandingPayload | null }[] = [];
  pin: () => Promise<CompanyPinResult> = async () => "pending";
  invalidate(): number { return ++this.revision; }
  async synchronize(revision: number, payload: CompanyBrandingPayload | null): Promise<CompanyBrandingStatus> {
    this.calls.push({ revision, payload });
    return { ready: payload !== null, pinSupported: true, logoUsed: payload?.logoDataUri ? "company" : "qualitzer" };
  }
  async requestPin(): Promise<CompanyPinResult> { this.pins += 1; return this.pin(); }
  addListener(): { remove(): void } { return { remove() {} }; }
}

test("no branding or pin before verified live session, including demo", async () => {
  for (const candidate of [{ ...input, verified: false }, { ...input, session: null }, { ...input, session: input.session && { ...input.session, mode: "demo" as const } }]) {
    assert.equal(await prepareCompanyBranding(candidate, digest), null);
    const native = new FakeNative();
    const controller = new CompanyBrandingController(native, digest);
    await controller.synchronize(candidate);
    assert.equal(await controller.requestPin(), "unavailable");
    assert.equal(native.pins, 0);
    assert.deepEqual(native.calls.map((call) => call.payload), [null]);
  }
});

test("full gateway path and tenant identity isolate pins; user, branch and name do not", async () => {
  const payload = await prepareCompanyBranding(input, digest);
  assert.match(payload!.shortcutId, /^qz-company-[a-f0-9]{64}$/);
  for (const gatewayUrl of ["https://api.example", "https://api.example/other", "https://other.example/mobile"]) {
    assert.notEqual((await prepareCompanyBranding({ ...input, gatewayUrl }, digest))!.shortcutId, payload!.shortcutId);
  }
  const tenant = input.session!.tenant;
  for (const changed of [{ ...tenant, id: "tenant-2" }, { ...tenant, portalOrigin: "https://other.example" }, { ...tenant, environment: "development" as const }]) {
    assert.notEqual((await prepareCompanyBranding({ ...input, session: { mode: "live", tenant: changed } }, digest))!.shortcutId, payload!.shortcutId);
  }
  const injected = { mode: "live" as const, tenant: { ...tenant, name: "Nuevo nombre" }, userId: 123, token: "secret-token", user: { password: "secret-password" } };
  const next = await prepareCompanyBranding({ ...input, session: injected, branchName: "Sur" }, digest);
  assert.equal(next!.shortcutId, payload!.shortcutId);
  assert.deepEqual(Object.keys(next!), ["shortcutId", "displayName", "branchName", "logoDataUri"]);
  assert.doesNotMatch(JSON.stringify(next), /secret|https:|userId|123/);
});

test("bad gateway, tenant, labels and digest fail closed", async () => {
  for (const gatewayUrl of ["https://user:pass@api.example/mobile", "https://api.example/mobile?token=x", "file:///private", "https://api.example/a/../b"]) {
    assert.equal(companyBrandingNamespace({ ...input, gatewayUrl }), null);
  }
  assert.equal(companyBrandingNamespace({ ...input, session: { mode: "live", tenant: { ...input.session!.tenant, id: "bad id" } } }), null);
  assert.equal(await prepareCompanyBranding({ ...input, session: { mode: "live", tenant: { ...input.session!.tenant, name: "\u202e\u0000" } } }, digest), null);
  await assert.rejects(prepareCompanyBranding(input, async () => "not-a-hash"));
});

test("logos allow bounded canonical PNG/JPEG/WebP only and never fetch", () => {
  assert.equal(companyLogoDataUri(png), png);
  const data = (mime: string, bytes: number[]) => `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  for (const candidate of [data("jpeg", [255, 216, 255, 224]), data("webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])]) assert.equal(companyLogoDataUri(candidate), candidate);
  for (const value of [null, undefined, "https://company.example/logo.png", "http://127.0.0.1/logo", "file:///logo", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,AAAA", png.replace("png", "jpeg"), png + "\n", "data:image/png;base64," + "A".repeat(Math.ceil((MAX_COMPANY_LOGO_BYTES + 1) / 3) * 4)]) {
    assert.equal(companyLogoDataUri(value), null);
  }
});

test("synchronize only prepares branding; pin requests remain a separate gated operation", async () => {
  const native = new FakeNative();
  const controller = new CompanyBrandingController(native, digest);
  await controller.synchronize(input);
  assert.equal(native.calls[0].payload, null);
  assert.equal(native.calls[1].payload?.displayName, "Empresa Uno");
  assert.equal(native.pins, 0);
  assert.equal(await controller.requestPin(), "pending");
  assert.equal(native.pins, 1);
  assert.equal(controller.isCurrentConfirmation(native.calls[1].payload!.shortcutId, native.revision), true);
  await controller.clear();
  assert.equal(controller.isCurrentConfirmation(native.calls[1].payload!.shortcutId, native.revision - 1), false);
  assert.equal(await controller.requestPin(), "unavailable");
  assert.equal(native.calls.at(-1)!.payload, null);
});

test("logout during hash cannot restore stale company", async () => {
  let finish!: (value: string) => void;
  const wait = new Promise<string>((resolve) => { finish = resolve; });
  const native = new FakeNative();
  const controller = new CompanyBrandingController(native, () => wait);
  const old = controller.synchronize(input);
  await Promise.resolve();
  await controller.clear();
  finish("a".repeat(64));
  assert.equal(await old, null);
  assert.equal(native.calls.some((call) => call.payload !== null), false);
  assert.equal(await controller.requestPin(), "unavailable");
});

test("double press and company change while pin pending do not report success", async () => {
  const native = new FakeNative();
  let finish!: (value: CompanyPinResult) => void;
  native.pin = () => new Promise((resolve) => { finish = resolve; });
  const controller = new CompanyBrandingController(native, digest);
  await controller.synchronize(input);
  const old = controller.requestPin();
  assert.equal(await controller.requestPin(), "unavailable");
  await controller.synchronize({ ...input, gatewayUrl: "https://other.example/mobile" });
  finish("pending");
  assert.equal(await old, "stale");
  assert.equal(native.pins, 1);
});

test("native manifest and sources retain supported API guards and no launcher aliases/network/secrets", () => {
  const source = (name: string) => readFileSync(new URL(`../modules/company-branding/android/src/main/java/expo/modules/companybranding/${name}.kt`, import.meta.url), "utf8");
  const state = source("CompanyBrandingState");
  const activity = source("CompanyShortcutActivity");
  const images = source("CompanyBrandingImages");
  const manifest = readFileSync(new URL("../modules/company-branding/android/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  assert.doesNotMatch(manifest, /activity-alias|uses-permission|intent-filter/);
  assert.match(manifest, /CompanyPinReceiver"\s+android:exported="false"/);
  assert.match(state, /Build.VERSION.SDK_INT < 26/);
  assert.match(state, /FLAG_IMMUTABLE/);
  assert.match(state, /addCategory\("com\.qualitzer\.field\.PIN\.\$\{UUID\.randomUUID\(\)\}"\)/);
  assert.match(state, /if \(accepted\) "pending"/);
  assert.match(state, /disableShortcuts/);
  assert.match(images, /inJustDecodeBounds = true/);
  assert.match(images, /1\.\.2048/);
  assert.doesNotMatch(activity, /AlertDialog|CompanyBrandingState\.matches|setPositiveButton/);
  assert.match(activity, /openApplication\(\)/);
  assert.doesNotMatch(activity.slice(activity.indexOf("private fun openApplication")), /putExtra|setData|token|tenant/);
  assert.doesNotMatch(state + images + activity, /SharedPreferences|HttpURLConnection|URL\(|Authorization|userId|password/);
});

test("branding snapshot cannot change while its namespace hash is in flight", async () => {
  let finish!: (value: string) => void;
  const mutable = { ...input, session: { mode: "live" as const, tenant: { ...input.session!.tenant } } };
  const result = prepareCompanyBranding(mutable, () => new Promise((resolve) => { finish = resolve; }));
  mutable.session.tenant.name = "Otra empresa";
  mutable.session.tenant.logo = "https://other.example/logo";
  mutable.branchName = "Otra sucursal";
  finish("a".repeat(64));
  const payload = await result;
  assert.equal(payload!.displayName, "Empresa Uno");
  assert.equal(payload!.logoDataUri, png);
  assert.equal(payload!.branchName, "Central");
});

test("native failure releases press lock and never claims confirmation", async () => {
  const native = new FakeNative();
  const controller = new CompanyBrandingController(native, digest);
  await controller.synchronize(input);
  native.pin = async () => { throw new Error("native unavailable"); };
  await assert.rejects(controller.requestPin(), /native unavailable/);
  native.pin = async () => "unsupported";
  assert.equal(await controller.requestPin(), "unsupported");
  assert.equal(native.pins, 2);
});