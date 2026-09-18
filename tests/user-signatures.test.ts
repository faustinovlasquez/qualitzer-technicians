import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultUserSignature, ownSignatureOptions } from "../src/domain/userSignatures";
import { agendaFixture, frozenNow } from "./helpers/agenda-load-lifecycle";

const signature = {
  id: 7, value: "7", label: "Tecnico", signatureName: "Tecnico", signatureEmail: "tecnico@example.invalid",
  signaturePhone: null, signatureImage: "https://files.example.invalid/signature.png", isDefaultForBranch: true,
  branches: [{ value: "2", label: "Taller" }],
};
const options = { userId: 11, companyBranchId: 2, defaultSignatureId: 7, selectedSignatureId: 7, options: [signature] };

test("profile signatures preserve the backend catalog and choose the default for the active branch", () => {
  const parsed = ownSignatureOptions(options, 11, 2);
  assert.deepEqual(defaultUserSignature(parsed), signature);
  assert.equal(defaultUserSignature(ownSignatureOptions({ ...options, defaultSignatureId: null, selectedSignatureId: null, options: [] }, 11, 2)), null);
});

test("signature catalogs cannot cross user or branch boundaries or select unknown records", () => {
  assert.throws(() => ownSignatureOptions(options, 12, 2), /IDENTITY_MISMATCH/);
  assert.throws(() => ownSignatureOptions(options, 11, 3), /IDENTITY_MISMATCH/);
  assert.throws(() => ownSignatureOptions({ ...options, options: [signature, signature] }, 11, 2), /IDENTITY_MISMATCH/);
  assert.throws(() => ownSignatureOptions({ ...options, selectedSignatureId: 99 }, 11, 2), /BRANCH_MISMATCH/);
  assert.throws(() => ownSignatureOptions({ ...options, options: [{ ...signature, branches: [{ value: "3", label: "Otra" }] }] }, 11, 2), /BRANCH_MISMATCH/);
});

test("actual app hook binds profile signature operations to the current user and rejects results after access is blocked", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: frozenNow });
  const fixture = agendaFixture({ online: true });
  context.after(() => fixture.unmount());
  const app = await fixture.loadDay();
  assert.ok(app.session);
  assert.ok(app.signatureAccess);
  const catalog = { userId: app.session.user.id, companyBranchId: 1, options: [], defaultSignatureId: null, selectedSignatureId: null };
  let reads = 0;
  let saveCalls = 0;
  let resolve!: (value: typeof catalog) => void;
  const pending = new Promise<typeof catalog>(done => { resolve = done; });
  Object.assign(fixture.wrappers[0]!, {
    userSignatures: async () => { reads += 1; return pending; },
    saveUserSignature: async () => { saveCalls += 1; return catalog; },
    deleteUserSignature: async () => catalog,
  });
  const access = app.signatureAccess;
  assert.equal((await access.actions.save({ signatureName: "Test", signatureEmail: null, signaturePhone: null, branchIds: [1] })).userId, catalog.userId);
  assert.equal(saveCalls, 1);
  const request = access.actions.load();
  fixture.access.allowed = false;
  resolve(catalog);
  await assert.rejects(request, /sesion de firmas cambio/);
  await assert.rejects(access.actions.load(), /sesion de firmas cambio/);
  assert.equal(reads, 1);
});