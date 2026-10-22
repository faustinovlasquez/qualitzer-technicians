import assert from "node:assert/strict";
import { test } from "node:test";
import type { InspectionChecklist, InspectionStep } from "../src/domain/workshopInspection";
import { answerFromStep } from "../src/domain/format";
import { checklistAnswerError } from "../src/domain/checklistProgress";
import { inspectionChecklists, inspectionResponse, inspectionStepOf } from "../src/workshop/inspection/inspectionChecklistAdapter";

const step = (value: Partial<InspectionStep> & Pick<InspectionStep, "checklistStepId" | "type">): InspectionStep => ({
  order: 1, title: "Pregunta", description: null, options: [], isRequired: true, isFilesRequired: false, answer: null, ...value
});
const answered = (responseValue: string | null, files = 0): InspectionStep["answer"] => ({
  stepId: 900, responseValue, comment: "ok", isCompleted: true, files: Array.from({ length: files }, (_, index) => ({ fileId: index + 1, url: `t${index}.jpg`, fullUrl: `f${index}.jpg` }))
});
const options = [{ value: "bueno", label: "Bueno" }, { value: "malo", label: "Malo" }];
const checklist: InspectionChecklist = { checklistId: 8, name: "Recepción", isRequired: true, locked: true, steps: [
  step({ checklistStepId: 1, type: "validation", answer: answered("false") }),
  step({ checklistStepId: 2, type: "validation", answer: answered("not_applicable") }),
  step({ checklistStepId: 3, type: "select", options, answer: answered("malo", 1) }),
  step({ checklistStepId: 4, type: "multiselect", options, answer: answered(JSON.stringify([{ value: "bueno", label: "Bueno" }])) }),
  step({ checklistStepId: 5, type: "number", answer: answered("12,5") }),
  step({ checklistStepId: 6, type: "approval", answer: null })
] };

test("cada respuesta de la inspección se muestra en la pantalla de checklist de los trabajos y vuelve igual al guardarse", () => {
  const [mapped] = inspectionChecklists([checklist]);
  assert.equal(mapped?.required, true);
  for (const original of checklist.steps) {
    const shown = mapped!.steps.find((item) => item.stepId === original.checklistStepId)!;
    assert.equal(inspectionResponse(original, answerFromStep(shown)), original.answer?.responseValue ?? null, `paso ${original.checklistStepId}`);
  }
  const photo = mapped!.steps.find((item) => item.stepId === 3)!;
  assert.deepEqual(photo.attachments.map((file) => [file.url, file.thumbnailUrl]), [["f0.jpg", "t0.jpg"]]);
  assert.equal(inspectionStepOf([checklist], "4")?.checklist.checklistId, 8);
});

test("los números se guardan en el formato de la web y los inválidos se explican", () => {
  const number = step({ checklistStepId: 9, type: "number" });
  assert.equal(inspectionResponse(number, { responseValue: "+15", isCompleted: true, executionStatus: "completed", comment: null }), "15");
  assert.throws(() => inspectionResponse(number, { responseValue: "12.", isCompleted: true, executionStatus: "completed", comment: null }), /número válido/);
});

test("en la inspección se puede guardar la respuesta aunque falte la foto obligatoria (en los trabajos no)", () => {
  const [mapped] = inspectionChecklists([{ ...checklist, steps: [step({ checklistStepId: 7, type: "validation", isFilesRequired: true })] }]);
  const shown = mapped!.steps[0]!;
  const yes = { responseValue: true, isCompleted: true, executionStatus: "completed" as const, comment: null };
  assert.match(checklistAnswerError(shown, yes) ?? "", /evidencia/);
  assert.equal(checklistAnswerError(shown, yes, { allowMissingFiles: true }), null);
});
