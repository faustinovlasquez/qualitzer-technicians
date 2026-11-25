import assert from "node:assert/strict";
import { test } from "node:test";
import { creationInputSchema, workEditDocumentSchema, workEditInputSchema } from "../src/domain/creation";
import { applyCatalogSelection, catalogSelection, creationPayload, emptyCreationForm, workEditForm, workEditPayload } from "../src/screens/creation/creationForm";

const base = {
  groupId: "maintenance-5", workId: 11, companyBranchId: 1, revision: "a".repeat(64),
  fields: { title: "Cambiar filtro", summary: "", priority: "medium", specialtyId: null, rentalEquipmentId: null, schedule: { date: "2026-11-24", startTime: "", endTime: "" } },
  equipment: null, specialty: null, equipmentInherited: true, scheduleEditable: true,
};
const system = { systemId: 3, componentId: null, system: { id: 3, label: "Motor" }, component: null, editable: true };

test("clasificación: el documento la precarga y el envío manda tipo, acción, motivo y minutos", () => {
  const document = workEditDocumentSchema.parse({ ...base, workSystem: { ...system, workType: { id: 4, label: "Mecánico" }, action: null,
    interventionReason: { id: 8, label: "Falla" }, assignedMinutes: 60, assignedMinutesEditable: true } });
  const form = workEditForm(document);
  assert.deepEqual(form.workType, { id: 4, label: "Mecánico" }); assert.equal(form.action, null); assert.equal(form.assignedMinutes, 60);
  const chosen = applyCatalogSelection(form, "actions", { id: 6, label: "Reemplazar" });
  assert.deepEqual(catalogSelection(chosen, "actions"), { id: 6, label: "Reemplazar" });
  const input = workEditPayload(document, { ...chosen, interventionReason: null, assignedMinutes: 90 });
  assert.deepEqual(input.workSystem, { systemId: 3, componentId: null, workTypeId: 4, actionId: 6, interventionReasonId: null, assignedMinutes: 90 });
  assert.equal(workEditInputSchema.safeParse(input).success, true);
});

test("clasificación: con horario completo no se envían minutos; servidor antiguo no recibe campos nuevos", () => {
  const scheduled = workEditDocumentSchema.parse({ ...base, workSystem: { ...system, workType: null, action: null, interventionReason: null, assignedMinutes: 120, assignedMinutesEditable: false } });
  const input = workEditPayload(scheduled, { ...workEditForm(scheduled), assignedMinutes: 30 });
  assert.equal("assignedMinutes" in (input.workSystem ?? {}), false);
  assert.equal(input.workSystem?.workTypeId, null);
  const old = workEditDocumentSchema.parse({ ...base, workSystem: system });
  const oldInput = workEditPayload(old, { ...workEditForm(old), workType: { id: 4, label: "X" } });
  assert.deepEqual(oldInput.workSystem, { systemId: 3, componentId: null });
});

test("clasificación al agregar trabajo a un mantenimiento: se envía solo lo elegido y nunca fuera de un mantenimiento", () => {
  const form = { ...emptyCreationForm("2026-11-24"), title: "Revisar bomba", maintenanceId: 5, workType: { id: 4, label: "Mecánico" }, interventionReason: { id: 8, label: "Falla" } };
  const input = creationPayload("work", form, 1, "11111111-1111-4111-8111-111111111111");
  assert.equal(input.kind, "work");
  if (input.kind !== "work") return;
  assert.equal(input.work.workTypeId, 4); assert.equal(input.work.interventionReasonId, 8); assert.equal("actionId" in input.work, false);
  // Sin nada elegido no viajan las claves (servidores anteriores siguen aceptando el trabajo).
  const plain = creationPayload("work", { ...form, workType: null, interventionReason: null }, 1, "11111111-1111-4111-8111-111111111112");
  assert.equal(plain.kind === "work" && ["workTypeId", "actionId", "interventionReasonId"].some((key) => key in plain.work), false);
  // Un trabajo propio (sin mantenimiento) no lleva clasificación aunque el formulario la tenga.
  const own = creationPayload("work", { ...form, maintenanceId: undefined }, 1, "11111111-1111-4111-8111-111111111113");
  assert.equal(own.kind === "work" && "workTypeId" in own.work, false);
  assert.equal(creationInputSchema.safeParse({ ...own, work: { ...(own.kind === "work" ? own.work : {}), workTypeId: 4 } }).success, false);
});

test("clasificación: la entrada rechaza minutos negativos, decimales o enormes y claves desconocidas", () => {
  const ok = { expectedRevision: "a".repeat(64), fields: base.fields, workSystem: { systemId: null, componentId: null, assignedMinutes: 10 } };
  assert.equal(workEditInputSchema.safeParse(ok).success, true);
  for (const assignedMinutes of [-1, 1.5, 100001]) assert.equal(workEditInputSchema.safeParse({ ...ok, workSystem: { ...ok.workSystem, assignedMinutes } }).success, false);
  assert.equal(workEditInputSchema.safeParse({ ...ok, workSystem: { ...ok.workSystem, otro: 1 } }).success, false);
});
