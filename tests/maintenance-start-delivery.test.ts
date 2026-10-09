import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceStartNotice } from "../src/domain/assignmentCodes";
import { makeDemoData } from "../src/infrastructure/demoData";
import { deliveryDraftErrors, technicianDeliveryInput, type DeliveryDraft } from "../src/screens/orders/lifecycle/lifecycleRules";

const maintenance = () => {
  const group = makeDemoData().groups.find(item => item.type === "internal_maintenance");
  assert.ok(group);
  return group;
};
const signature = "data:image/png;base64,AAAA";
const draft = (patch: Partial<DeliveryDraft> = {}): DeliveryDraft => ({
  note: "", hours: "1", minutes: "15", faultType: null, receivedByName: "", technicianStrokes: [[{ x: 10, y: 40 }, { x: 40, y: 10 }, { x: 70, y: 40 }]], clientStrokes: [], ...patch,
});

test("iniciar un trabajo de un mantenimiento pendiente avisa que también se inició el mantenimiento", () => {
  const group = { ...maintenance(), status: "pending" as const };
  assert.match(maintenanceStartNotice(group, "in_progress") ?? "", /Se inició el trabajo y también el mantenimiento OT-[A-Z]{3}-\d{4}/);
});

test("no avisa si el mantenimiento ya estaba iniciado, si se pausa o si no es un mantenimiento", () => {
  assert.equal(maintenanceStartNotice({ ...maintenance(), status: "in_progress" }, "in_progress"), null);
  assert.equal(maintenanceStartNotice({ ...maintenance(), status: "pending" }, "paused"), null);
  const order = makeDemoData().groups.find(item => item.type !== "internal_maintenance");
  assert.ok(order);
  assert.equal(maintenanceStartNotice({ ...order, status: "pending" }, "in_progress"), null);
});

test("la entrega del técnico exige y envía el tipo de falla solo si el servidor lo admite", () => {
  assert.equal(deliveryDraftErrors(draft(), false, true).faultType, "Selecciona el tipo de falla.");
  assert.equal(deliveryDraftErrors(draft({ faultType: "wear" }), false, true).faultType, undefined);
  assert.equal(deliveryDraftErrors(draft(), false).faultType, undefined, "un servidor anterior no pide tipo de falla");
  const supported = technicianDeliveryInput(draft({ faultType: "operative" }), signature, true);
  assert.equal(supported.faultType, "operative");
  assert.equal(supported.acknowledgeDelivery, true);
  assert.equal(supported.durationMinutes, 75, "la duración se envía sola desde los cronómetros, sin pedirla");
  assert.equal(supported.receivedByName, null);
  assert.equal(technicianDeliveryInput(draft({ faultType: "operative" }), signature).faultType, null, "con un servidor anterior no se envía");
});
