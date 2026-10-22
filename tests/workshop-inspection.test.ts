import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeInspectionAnswer, encodeInspectionAnswer, inspectionPending, isInspectionStepCompleted, isValidInspectionResponse, type InspectionStep } from "../src/domain/workshopInspection";

const step = (value: Partial<InspectionStep>): InspectionStep => ({ checklistStepId: 1, order: 1, title: "P", description: null, type: "validation", options: [],
  isRequired: true, isFilesRequired: false, answer: null, ...value });
const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

test("las respuestas se guardan con el mismo formato de la web y se leen de vuelta", () => {
  assert.equal(encodeInspectionAnswer({ type: "validation", value: "false" }), "false");
  assert.equal(encodeInspectionAnswer({ type: "multiselect", value: [options[0]!] }), JSON.stringify([{ value: "a", label: "A" }]));
  assert.equal(encodeInspectionAnswer({ type: "multiselect", value: [] }), null);
  assert.equal(encodeInspectionAnswer({ type: "text", value: "  " }), null);
  assert.deepEqual(decodeInspectionAnswer(step({ type: "multiselect", options }), JSON.stringify([{ value: "b", label: "B" }])), { type: "multiselect", value: [{ value: "b", label: "B" }] });
  assert.deepEqual(decodeInspectionAnswer(step({ type: "validation" }), "true"), { type: "validation", value: "true" });
  assert.deepEqual(decodeInspectionAnswer(step({ type: "multiselect", options }), "no es json"), { type: "multiselect", value: [] });
});

test("solo se aceptan respuestas que corresponden a la pregunta", () => {
  assert.equal(isValidInspectionResponse(step({ type: "validation" }), "not_applicable"), true);
  assert.equal(isValidInspectionResponse(step({ type: "validation" }), "quizás"), false);
  assert.equal(isValidInspectionResponse(step({ type: "select", options }), "b"), true);
  assert.equal(isValidInspectionResponse(step({ type: "select", options }), "c"), false);
  assert.equal(isValidInspectionResponse(step({ type: "approval" }), "approved"), true);
  assert.equal(isValidInspectionResponse(step({ type: "number" }), "12,5"), true);
  assert.equal(isValidInspectionResponse(step({ type: "number" }), "doce"), false);
  assert.equal(isValidInspectionResponse(step({ type: "multiselect", options }), JSON.stringify([{ value: "z", label: "Z" }])), false);
  assert.equal(isValidInspectionResponse(step({ type: "text" }), null), true);
});

test("una pregunta respondida queda completa salvo que le falte la foto obligatoria (también un 'No')", () => {
  assert.equal(isInspectionStepCompleted(step({}), "false", 0), true);
  assert.equal(isInspectionStepCompleted(step({}), null, 0), false);
  assert.equal(isInspectionStepCompleted(step({ isFilesRequired: true }), "true", 0), false);
  assert.equal(isInspectionStepCompleted(step({ isFilesRequired: true }), "true", 1), true);
  assert.equal(isInspectionStepCompleted(step({ isRequired: false }), null, 0), true);
});

test("lo pendiente depende de lo que exige la sucursal y las preguntas opcionales no bloquean", () => {
  const slots = [{ key: "front", name: "Frente", isRequired: true, photo: null }, { key: "top", name: "Techo", isRequired: false, photo: null }];
  const checklists = [{ checklistId: 1, name: "L", isRequired: true, locked: true, steps: [
    step({ checklistStepId: 1, answer: { stepId: 9, responseValue: "true", comment: null, isCompleted: true, files: [] } }),
    step({ checklistStepId: 2, isRequired: false })
  ] }];
  assert.deepEqual(inspectionPending({ requirement: "none", slots, checklists }), []);
  assert.deepEqual(inspectionPending({ requirement: "photos", slots, checklists }), ["Faltan fotos: Frente"]);
  assert.deepEqual(inspectionPending({ requirement: "checklist", slots, checklists }), []);
  assert.deepEqual(inspectionPending({ requirement: "full", slots: [], checklists: [] }), ["Al menos una foto del equipo", "Elige al menos una lista de revisión"]);
});
