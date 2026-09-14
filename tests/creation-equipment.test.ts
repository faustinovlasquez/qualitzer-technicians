import assert from "node:assert/strict";
import { test } from "node:test";
import { creationOptionsQuerySchema, type CreationOptions } from "../src/domain/creation";
import { OfflineUnavailableError } from "../src/domain/offline";
import { ApiError, NetworkError } from "../src/infrastructure/errors";
import { demoCreationOptions } from "../src/infrastructure/creationDemo";
import { exactEquipmentMatches, lookupEquipment, type EquipmentOption } from "../src/screens/creation/equipmentLookup";
import { creationPayload, emptyCreationForm, readCreationDraft } from "../src/screens/creation/creationForm";
import type { CreationCatalogCache } from "../src/screens/creation/CreationCatalogSelector";

const first = { id: 71, label: "N.º interno EQ-001 · PLACA-9 · Excavadora", internalNumber: "EQ-001", identifier: "PLACA-9", equipmentType: "Excavadora" };
const second = { ...first, id: 99, identifier: "PLACA-10", label: "N.º interno EQ-001 · PLACA-10 · Excavadora" };
function options(items: EquipmentOption[], page = 0, hasMore = false): CreationOptions {
  return { ...demoCreationOptions({ companyBranchId: 1 }), equipment: { items, page, pageSize: 25, hasMore } };
}
const context = { companyBranchId: 1, userId: options([]).userId, workerId: options([]).workerId };

test("exact query normalizes trim/case but never coerces numbers or accepts raw filters", () => {
  assert.deepEqual(creationOptionsQuerySchema.parse({ companyBranchId: 1, kind: "equipment", internalNumber: " EQ-001_% " }), { companyBranchId: 1, kind: "equipment", internalNumber: "eq-001_%" });
  for (const internalNumber of [15, "", " ", "x".repeat(101), "eq\n1", ["1"], { eq: "1" }]) {
    assert.equal(creationOptionsQuerySchema.safeParse({ companyBranchId: 1, kind: "equipment", internalNumber }).success, false);
  }
  for (const extra of [{ kind: "specialties" }, { kind: undefined }, { search: "EQ" }, { filters: "{}" }]) {
    assert.equal(creationOptionsQuerySchema.safeParse({ companyBranchId: 1, kind: "equipment", internalNumber: "15", ...extra }).success, false);
  }
});

test("exact matching uses only persisted internalNumber, retains duplicates by ID, and never guesses", () => {
  const items = [first, second, first, { id: 15, label: "EQ-001", identifier: "EQ-001" }, { ...first, id: 16, internalNumber: "EQ-0010" }];
  assert.deepEqual(exactEquipmentMatches(items, " eq-001 ").map((item) => item.id), [71, 99]);
  for (const query of ["", "001", "71", "PLACA-9", "EQ-01", "EQ-00", "%"]) assert.deepEqual(exactEquipmentMatches(items, query), []);
});

test("exact lookup verifies identity and number, preserves pagination and rejects legacy broad responses", async () => {
  const cache: CreationCatalogCache = new Map();
  const result = await lookupEquipment(context, " EQ-001 ", 1, cache, async (query) => {
    assert.deepEqual(query, { companyBranchId: 1, kind: "equipment", internalNumber: "eq-001", page: 1 });
    return options([first, second], 1, true);
  });
  assert.deepEqual(result, { items: [first, second], page: 1, hasMore: true, cachedOnly: false });
  assert.ok(cache.has(JSON.stringify(["equipment", "internalNumber", "eq-001", 1])));
  for (const invalid of [options([{ id: 71, label: "EQ-001" }]), options([{ ...first, internalNumber: "EQ-0010" }]), options([first], 2), { ...options([first]), workerId: 999 }, { ...options([first]), companyBranchId: 2 }]) {
    await assert.rejects(lookupEquipment(context, "eq-001", 0, cache, async () => invalid));
  }
});

test("offline exact fallback only uses cached equipment pages and explains absence without inventing an ID", async () => {
  const cache: CreationCatalogCache = new Map([
    [JSON.stringify(["equipment", "", 0]), options([first]).equipment!],
    [JSON.stringify(["equipment", "excavadora", 1]), options([second]).equipment!],
    [JSON.stringify(["specialties", "", 0]), options([{ ...first, id: 500 }]).equipment!],
  ]);
  for (const error of [new NetworkError("network"), new OfflineUnavailableError("OFFLINE_CACHE_MISS")]) {
    const found = await lookupEquipment(context, "EQ-001", 0, cache, async () => { throw error; });
    assert.equal(found.cachedOnly, true);
    assert.deepEqual(found.items.map((item) => item.id), [71, 99]);
    assert.equal(found.hasMore, false);
    assert.deepEqual((await lookupEquipment(context, "unknown", 0, cache, async () => { throw error; })).items, []);
  }
  for (const error of [new ApiError(401, "UNAUTHORIZED", "Unauthorized"), new ApiError(403, "FORBIDDEN", "Forbidden"), new SyntaxError("bad JSON"), new OfflineUnavailableError("OFFLINE_CACHE_IDENTITY_MISMATCH")]) {
    await assert.rejects(lookupEquipment(context, "EQ-001", 0, cache, async () => { throw error; }), (caught) => caught === error);
  }
});

test("demo distinguishes exact internal number from broad identifier/type search", () => {
  assert.equal(demoCreationOptions({ companyBranchId: 1, kind: "equipment", internalNumber: " 15 " }).equipment?.items[0]?.id, 15);
  assert.equal(demoCreationOptions({ companyBranchId: 1, kind: "equipment", internalNumber: "EQ-15" }).equipment?.items.length, 0);
  assert.equal(demoCreationOptions({ companyBranchId: 1, kind: "equipment", search: "Excavadora" }).equipment?.items[0]?.id, 15);
});

test("selection maps only the chosen ID; old pending empty selection and queued known selection stay unchanged", () => {
  const form = { ...emptyCreationForm("2026-09-10"), title: "Trabajo", summary: "Resumen", motive: "Reparación", startTime: "09:00", endTime: "10:00" };
  const uuid = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
  const empty = creationPayload("work", form, 1, uuid);
  const restored = readCreationDraft(JSON.stringify({ version: 1, kind: "work", phase: "pending", form, input: empty }), "work", 1);
  assert.ok(restored && restored.phase === "pending");
  assert.deepEqual(restored.input, empty);
  assert.equal(restored.form.equipment, null);
  assert.ok(empty.kind === "work" && !("rentalEquipmentId" in empty.work));
  const selected = { ...form, equipment: { id: first.id, label: first.label } };
  const input = creationPayload("work", selected, 1, uuid);
  assert.ok(input.kind === "work" && input.work.rentalEquipmentId === 71);
  const maintenance = creationPayload("maintenance", selected, 1, uuid);
  assert.ok(maintenance.kind === "maintenance" && maintenance.maintenance.equipmentId === 71);
  const saved = { version: 1, kind: "work", phase: "queued", form: selected, input,
    outcome: { operationId: uuid, operationIds: [uuid], kind: "create", date: form.date, ownsFiles: false, localGroupId: `local-${uuid}`, localWorkId: `local-${uuid}` } };
  const queued = readCreationDraft(JSON.stringify(saved), "work", 1);
  assert.ok(queued && queued.phase === "queued");
  assert.deepEqual(queued.input, input);
  assert.equal(queued.form.equipment?.id, 71);
  assert.equal(readCreationDraft(JSON.stringify({ ...saved, form: { ...selected, equipment: { id: 99, label: second.label } } }), "work", 1), null);
});