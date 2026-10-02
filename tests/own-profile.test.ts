import assert from "node:assert/strict";
import { test } from "node:test";
import { ownProfileFor, ownProfileInputSchema, profileAge, profileDisplayName, profileInitials } from "../src/domain/ownProfile";

const profile = {
  userId: 7, workerId: 3, email: "tecnico@example.invalid", firstNames: "Faustino", lastNames: "Velásquez", secondLastName: null, preferredName: null,
  birthdate: "1990-05-12", gender: "M", nationality: "VE", maritalStatus: null, bloodType: "O+",
  identification: { type: "DNI", number: "4444444" }, avatarUrl: "https://files.example.invalid/a.jpg", avatarThumbnailUrl: null, avatarColor: "#2f7d6b", updatedAt: null,
};

test("own profile responses must belong to the session user", () => {
  assert.equal(ownProfileFor(profile, 7).firstNames, "Faustino");
  assert.throws(() => ownProfileFor(profile, 8), /OWN_PROFILE_IDENTITY_MISMATCH/);
  assert.throws(() => ownProfileFor({ ...profile, avatarUrl: "javascript:alert(1)" }, 7));
});

test("unknown catalog values from the server degrade to unspecified instead of failing", () => {
  const parsed = ownProfileFor({ ...profile, gender: "", maritalStatus: "LEGACY", nationality: "XX" }, 7);
  assert.equal(parsed.gender, null);
  assert.equal(parsed.maritalStatus, null);
  assert.equal(parsed.nationality, null);
});

test("profile input is strict and validates dates and catalogs", () => {
  const input = { firstNames: "A", lastNames: "B", secondLastName: null, preferredName: null, birthdate: "1990-05-12", gender: "O", nationality: "CL", maritalStatus: "CIVIL_UNION", bloodType: "AB-" };
  assert.ok(ownProfileInputSchema.safeParse(input).success);
  assert.equal(ownProfileInputSchema.safeParse({ ...input, userId: 1 }).success, false);
  assert.equal(ownProfileInputSchema.safeParse({ ...input, birthdate: "1990-02-30" }).success, false);
  assert.equal(ownProfileInputSchema.safeParse({ ...input, birthdate: "2999-01-01" }).success, false);
  assert.equal(ownProfileInputSchema.safeParse({ ...input, bloodType: "C+" }).success, false);
  assert.equal(ownProfileInputSchema.safeParse({ ...input, firstNames: "x".repeat(51) }).success, false);
});

test("display helpers prefer the social name and compute age", () => {
  assert.equal(profileDisplayName({ firstNames: "Faustino", lastNames: "Velásquez", secondLastName: "Rojas", preferredName: null }), "Faustino Velásquez Rojas");
  assert.equal(profileDisplayName({ firstNames: "Faustino", lastNames: "Velásquez", secondLastName: null, preferredName: "Tino" }), "Tino");
  assert.equal(profileInitials("faustino", "velásquez"), "FV");
  assert.equal(profileAge("1990-05-12", new Date(2026, 4, 11)), 35);
  assert.equal(profileAge("1990-05-12", new Date(2026, 4, 12)), 36);
  assert.equal(profileAge(null), null);
});
