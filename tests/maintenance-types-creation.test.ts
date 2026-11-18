import assert from "node:assert/strict";
import { test } from "node:test";
import { creationInputSchema } from "../src/domain/creation";
import { pautaAddInputSchema, pautaGroupLabel, pautaGroups, pautaSchema } from "../src/domain/maintenancePauta";
import { applyCatalogSelection, catalogSelection, creationPayload, emptyCreationForm, readCreationDraft, validateCreationForm } from "../src/screens/creation/creationForm";

const uuid = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
const ready = { ...emptyCreationForm("2028-02-29"), title: "Mantención", motive: "Motivo", startTime: "09:00", endTime: "10:00",
  equipment: { id: 15, label: "EQ-15" } };

test("rutinario y preventivo se crean con los mismos datos que un correctivo, sin listas", () => {
  for (const maintenanceType of ["preventivo", "rutinario"] as const) {
    const form = { ...ready, maintenanceType };
    assert.deepEqual(validateCreationForm("maintenance", form), {});
    const input = creationPayload("maintenance", form, 1, uuid);
    assert.equal(input.kind, "maintenance");
    if (input.kind !== "maintenance") return;
    assert.equal(input.maintenance.type, maintenanceType);
    assert.equal("checklistIds" in input.maintenance, false);
    assert.equal("checklistCategory" in input.maintenance, false);
  }
});

test("checklist exige al menos una lista, no repite listas y envía la categoría elegida", () => {
  const form = { ...ready, maintenanceType: "checklist" as const };
  assert.equal(validateCreationForm("maintenance", form).checklists, "Agrega al menos una lista de chequeo.");
  let withLists = applyCatalogSelection(form, "checklists", { id: 41, label: "CHK-01 · Diaria" });
  withLists = applyCatalogSelection(withLists, "checklists", { id: 41, label: "CHK-01 · Diaria" });
  withLists = applyCatalogSelection(withLists, "checklists", { id: 42, label: "CHK-02 · Despacho" });
  assert.deepEqual(withLists.checklists.map((item) => item.id), [41, 42]);
  assert.equal(catalogSelection(withLists, "checklists"), null);
  assert.deepEqual(validateCreationForm("maintenance", withLists), {});
  const input = creationPayload("maintenance", { ...withLists, checklistCategory: "dispatch" }, 1, uuid);
  assert.ok(input.kind === "maintenance");
  if (input.kind !== "maintenance") return;
  assert.deepEqual(input.maintenance.checklistIds, [41, 42]);
  assert.equal(input.maintenance.checklistCategory, "dispatch");
  const noCategory = creationPayload("maintenance", withLists, 1, uuid);
  assert.ok(noCategory.kind === "maintenance" && !("checklistCategory" in noCategory.maintenance));
});

test("las reglas compartidas con el gateway rechazan listas fuera del tipo checklist o checklist sin listas", () => {
  const base = { kind: "maintenance", companyBranchId: 1, clientRequestId: uuid, schedule: { date: "2028-02-29", startTime: "09:00", endTime: "10:00" } };
  const maintenance = { title: "Mantención", motive: "Motivo", equipmentId: 15 };
  assert.equal(creationInputSchema.safeParse({ ...base, maintenance: { ...maintenance, type: "checklist" } }).success, false);
  assert.equal(creationInputSchema.safeParse({ ...base, maintenance: { ...maintenance, type: "checklist", checklistIds: [] } }).success, false);
  assert.equal(creationInputSchema.safeParse({ ...base, maintenance: { ...maintenance, type: "checklist", checklistIds: [4, 4] } }).success, false);
  assert.equal(creationInputSchema.safeParse({ ...base, maintenance: { ...maintenance, type: "checklist", checklistIds: [4], checklistCategory: "routine" } }).success, true);
  assert.equal(creationInputSchema.safeParse({ ...base, maintenance: { ...maintenance, type: "preventivo", checklistIds: [4] } }).success, false);
  assert.equal(creationInputSchema.safeParse({ ...base, maintenance: { ...maintenance, type: "rutinario", checklistCategory: "routine" } }).success, false);
  assert.equal(creationInputSchema.safeParse({ ...base, maintenance: { ...maintenance, type: "rutinario" } }).success, true);
});

test("un borrador guardado antes de esta versión (sin listas) sigue abriéndose", () => {
  const { checklists: _lists, checklistCategory: _category, ...legacyForm } = ready;
  const raw = JSON.stringify({ version: 1, kind: "maintenance", phase: "editing", form: legacyForm });
  const draft = readCreationDraft(raw, "maintenance", 1);
  assert.ok(draft);
  assert.deepEqual(draft?.form.checklists, []);
  assert.equal(draft?.form.checklistCategory, "");
});

test("la pauta se agrupa por valor en orden y valida lo que llega y lo que se envía", () => {
  const item = (id: number, pautaValue: number, linked = false) => ({ id, pautaValue, title: `Ítem ${id}`, system: null, component: null, action: null, product: null, quantity: 1, linked });
  const pauta = pautaSchema.parse({ maintenanceId: 7, planName: "Pauta CAT", measurementType: "hourmeter", canEdit: true, items: [item(3, 500), item(1, 250), item(2, 250, true)] });
  assert.deepEqual(pautaGroups(pauta.items).map((group) => [group.value, group.items.map((entry) => entry.id)]), [[250, [1, 2]], [500, [3]]]);
  assert.match(pautaGroupLabel(250, "hourmeter"), /^Pauta 250 horas$/);
  assert.equal(pautaSchema.safeParse({ ...pauta, items: [item(1, 250), item(1, 500)] }).success, false);
  assert.equal(pautaAddInputSchema.safeParse({ itemIds: [] }).success, false);
  assert.equal(pautaAddInputSchema.safeParse({ itemIds: [1, 1] }).success, false);
  assert.equal(pautaAddInputSchema.safeParse({ itemIds: [1, 2] }).success, true);
});
