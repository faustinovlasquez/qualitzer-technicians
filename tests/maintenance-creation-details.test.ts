import assert from "node:assert/strict";
import { test } from "node:test";
import { creationInputSchema, maintenanceDisplayTitle } from "../src/domain/creation";
import { emptyMaintenanceDetails, instantFromParts, maintenanceCreationDetails, type MaintenanceDetailsDraft } from "../src/domain/maintenanceInfo";
import { creationPayload, emptyCreationForm, validateCreationForm, type CreationForm } from "../src/screens/creation/creationForm";

const requestId = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
const full: MaintenanceDetailsDraft = {
  ...emptyMaintenanceDetails(), instructions: " Usar guantes ", requestedBy: " Jefe de faena ",
  reportedDate: "2026-11-20", reportedTime: "08:30", downtimeDate: "2026-11-20", downtimeTime: "07:45",
  system: { id: 3, label: "Motor" }, failureCause: { id: 4, label: "Desgaste" }, detectionMethod: { id: 5, label: "Inspección" },
  causedDamageType: { id: 6, label: "Daño leve" }, failureSeverity: "high",
  affectsOtherAssets: true, interruptionMinutes: "45", affectedAssets: [{ id: 9, label: "Camión 9" }, { id: 9, label: "Camión 9" }],
};
const form = (type: CreationForm["maintenanceType"], details: MaintenanceDetailsDraft): CreationForm => ({
  ...emptyCreationForm("2026-11-24"), title: "Reparar", motive: "Falla", maintenanceType: type, equipment: { id: 113, label: "EQ" }, maintenanceDetails: details,
});

test("detención envía todo: fechas, solicitante, análisis de falla y activos sin repetir", () => {
  const { details, error } = maintenanceCreationDetails("detencion", full);
  assert.equal(error, null);
  assert.deepEqual(details, {
    instructions: "Usar guantes", reportedAt: instantFromParts("2026-11-20", "08:30"), requestedBy: "Jefe de faena",
    systemId: 3, failureCauseId: 4, detectionMethodId: 5, failureSeverity: "high", causedDamageTypeId: 6,
    downtimeStartedAt: instantFromParts("2026-11-20", "07:45"), affectsOtherAssets: true, interruptionMinutes: 45, affectedAssetIds: [9],
  });
  const input = creationPayload("maintenance", form("detencion", full), 1, requestId);
  assert.equal(input.kind === "maintenance" && input.maintenance.details?.interruptionMinutes, 45);
  assert.equal(creationInputSchema.safeParse(input).success, true);
});

test("correctivo no envía 'detenido desde' ni activos; preventivo solo instrucciones; vacío no envía nada", () => {
  const corrective = maintenanceCreationDetails("correctivo", full).details;
  assert.equal(corrective?.downtimeStartedAt, undefined); assert.equal(corrective?.affectedAssetIds, undefined); assert.equal(corrective?.systemId, 3);
  assert.deepEqual(maintenanceCreationDetails("preventivo", full).details, { instructions: "Usar guantes" });
  const empty = creationPayload("maintenance", form("detencion", emptyMaintenanceDetails()), 1, requestId);
  assert.equal(empty.kind === "maintenance" && "details" in empty.maintenance, false);
});

test("fechas incompletas o en el futuro se marcan al validar; el envío es igual al recalcularlo desde el borrador", () => {
  const partial = { ...emptyMaintenanceDetails(), reportedDate: "2026-11-20" };
  assert.match(validateCreationForm("maintenance", form("correctivo", partial)).maintenanceDetails ?? "", /Fecha de reporte/);
  const future = { ...emptyMaintenanceDetails(), downtimeDate: "2099-01-01", downtimeTime: "10:00" };
  assert.match(validateCreationForm("maintenance", form("detencion", future)).maintenanceDetails ?? "", /futuro/);
  assert.equal(validateCreationForm("maintenance", form("detencion", full)).maintenanceDetails, undefined);
  const first = creationPayload("maintenance", form("detencion", full), 1, requestId);
  assert.deepEqual(creationPayload("maintenance", form("detencion", full), 1, requestId), first);
});

test("título y motivo del mantenimiento son opcionales; el trabajo sí exige título", () => {
  const blank = { ...form("detencion", emptyMaintenanceDetails()), title: "", motive: "" };
  const errors = validateCreationForm("maintenance", blank);
  assert.equal(errors.title, undefined); assert.equal(errors.motive, undefined);
  const input = creationPayload("maintenance", blank, 1, requestId);
  assert.equal(input.kind === "maintenance" && input.maintenance.title, "");
  assert.equal(maintenanceDisplayTitle({ title: "", type: "detencion" }), "Mantenimiento por detención");
  assert.equal(maintenanceDisplayTitle({ title: "Cambio de filtro", type: "preventivo" }), "Cambio de filtro");
  assert.match(validateCreationForm("work", { ...blank, title: "" }).title ?? "", /obligatorio/);
});

test("al crear no se envían instrucciones (no se piden en el formulario)", () => {
  const input = creationPayload("maintenance", form("preventivo", { ...emptyMaintenanceDetails(), instructions: "De un borrador antiguo" }), 1, requestId);
  assert.equal(input.kind === "maintenance" && "details" in input.maintenance, false);
  const stop = creationPayload("maintenance", form("detencion", full), 1, requestId);
  assert.equal(stop.kind === "maintenance" && stop.maintenance.details?.instructions, undefined);
});

test("el envío rechaza claves desconocidas y minutos no válidos dentro de details", () => {
  const input = creationPayload("maintenance", form("detencion", full), 1, requestId);
  if (input.kind !== "maintenance") throw new Error("kind");
  assert.equal(creationInputSchema.safeParse({ ...input, maintenance: { ...input.maintenance, details: { ...input.maintenance.details, title: "x" } } }).success, false);
  assert.equal(creationInputSchema.safeParse({ ...input, maintenance: { ...input.maintenance, details: { interruptionMinutes: -1 } } }).success, false);
});
