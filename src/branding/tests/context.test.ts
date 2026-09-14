import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { companyBrandingContext } from "../companyBrandingContext";

type Context = Parameters<typeof companyBrandingContext>[0];
const fixture = (): Context => ({
  session: {
    mode: "live", branchId: 1,
    tenant: { id: "tenant-1", name: "Empresa Central", logo: null, portalOrigin: "https://company.example.com", environment: "production" },
    user: { accessBranchs: [{ id: 1, name: "Central", main: true }] },
  },
  gatewayUrl: "https://gateway.example.com/mobile",
  restoring: false, finalizingSession: false, forcePassword: false,
  offline: { online: true, authBlocked: false, connection: { status: "ready", foreground: true, networkConnected: true, checkedAt: 100 } },
  offlineController: {}, offlineVerifiedAt: 100,
});

test("online verified scoped session is eligible with company logo or declared fallback", () => {
  assert.equal(companyBrandingContext(fixture()).automaticPinEligible, true);
  const app = fixture(); app.session!.tenant.logo = "https://logos.example.com/branch.png";
  assert.equal(companyBrandingContext(app).input.session?.tenant.logo, app.session!.tenant.logo);
  assert.equal(companyBrandingContext(app).automaticPinEligible, true);
  app.offlineController = null; app.offline = null;
  assert.equal(companyBrandingContext(app).automaticPinEligible, true);
  app.offlineVerifiedAt = null;
  assert.equal(companyBrandingContext(app).automaticPinEligible, false);
});

test("restore, setup, password, demo, logout and revoked sessions never automatically request a pin", () => {
  const candidates: Context[] = [
    { ...fixture(), restoring: true }, { ...fixture(), finalizingSession: true }, { ...fixture(), forcePassword: true },
    { ...fixture(), session: null }, { ...fixture(), session: { ...fixture().session!, mode: "demo" } },
    { ...fixture(), offline: { ...fixture().offline!, authBlocked: true } },
  ];
  for (const app of candidates) assert.equal(companyBrandingContext(app).automaticPinEligible, false);
});

test("cached offline restore is not current server verification, including checking or missing snapshot", () => {
  for (const status of ["checking", "offline", "unreachable", "service_error", "auth_required"] as const) {
    const app = fixture(); app.offline = { ...app.offline!, online: false, connection: { ...app.offline!.connection!, status } };
    assert.equal(companyBrandingContext(app).automaticPinEligible, false);
    assert.equal(companyBrandingContext(app).input.verified, true, "existing offline session visuals are not auth changes");
  }
  const app = fixture(); app.offline = null;
  assert.equal(companyBrandingContext(app).automaticPinEligible, false);
  app.offline = { ...fixture().offline!, connection: undefined };
  assert.equal(companyBrandingContext(app).automaticPinEligible, false);
  app.offline = { ...fixture().offline!, connection: { ...fixture().offline!.connection!, foreground: false } };
  assert.equal(companyBrandingContext(app).automaticPinEligible, false);
});

test("branch brand readiness requires the selected enabled branch, not any membership", () => {
  for (const branchId of [null, 2]) {
    const app = fixture(); app.session!.branchId = branchId;
    assert.equal(companyBrandingContext(app).automaticPinEligible, false);
  }
  for (const change of [{ isEnabled: false }, { isDeleted: true }, { name: "  " }]) {
    const app = fixture(); Object.assign(app.session!.user.accessBranchs[0], change);
    assert.equal(companyBrandingContext(app).automaticPinEligible, false);
  }
});

test("App wires branding eligibility without changing auth or forwarding token to branding", () => {
  const source = readFileSync(resolve(__dirname, "../../../App.tsx"), "utf8");
  assert.match(source, /companyBrandingContext\(app\)/);
  assert.match(source, /useCompanyBranding\(brandingContext\.input, app\.busy \|\| security\.blocked, allowAutomaticPin && brandingContext\.automaticPinEligible && !security\.blocked\)/);
  const session = { ...fixture().session!, token: "synthetic-not-forwarded" };
  const result = companyBrandingContext({ ...fixture(), session });
  assert.doesNotMatch(JSON.stringify(result), /synthetic-not-forwarded|"token"|"user"/);
});