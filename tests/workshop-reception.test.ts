import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldMoveToStatus, workshopReceptionInputSchema } from "../src/domain/workshopReception";

test("al firmar la recepción el estado solo avanza a En proceso, igual que la web", () => {
  assert.equal(shouldMoveToStatus(null, "IN_PROGRESS"), true);
  assert.equal(shouldMoveToStatus("PENDING", "IN_PROGRESS"), true);
  assert.equal(shouldMoveToStatus("DIAGNOSIS", "IN_PROGRESS"), true);
  assert.equal(shouldMoveToStatus("IN_PROGRESS", "IN_PROGRESS"), false);
  assert.equal(shouldMoveToStatus("UNDER_REVIEW", "IN_PROGRESS"), false);
  // Un estado propio de la empresa no se toca.
  assert.equal(shouldMoveToStatus("ESPERANDO_REPUESTO", "IN_PROGRESS"), false);
});

test("la firma de recepción exige quién recibe y una firma guardada o dibujada en PNG", () => {
  const base = { companyBranchId: 1, requestId: "7f14191f-e73a-4d92-91b9-bf3fa38a2df1", workerId: 5, name: "Ana", email: null, phone: null, observation: null };
  assert.equal(workshopReceptionInputSchema.safeParse({ ...base, signature: { source: "USER_SIGNATURE", userSignatureId: 3 } }).success, true);
  assert.equal(workshopReceptionInputSchema.safeParse({ ...base, signature: { source: "MANUAL", image: "data:image/png;base64,iVBORw0KGgo=" } }).success, true);
  assert.equal(workshopReceptionInputSchema.safeParse({ ...base, signature: { source: "MANUAL", image: "https://otra.web/firma.png" } }).success, false);
  assert.equal(workshopReceptionInputSchema.safeParse({ ...base, name: " ", signature: { source: "USER_SIGNATURE", userSignatureId: 3 } }).success, false);
  assert.equal(workshopReceptionInputSchema.safeParse({ ...base, observation: "x".repeat(501), signature: { source: "USER_SIGNATURE", userSignatureId: 3 } }).success, false);
});
