import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistResumeTarget } from "../src/domain/checklistResume";
import { workChecklistProgress } from "../src/domain/assignmentChecklistProgress";
import type { Attachment, Checklist, ChecklistStep } from "../src/domain/models";
import { step } from "../server/tests/fixtures";

function checklist(confirmed = 20): Checklist {
  return { checklistId: 501, name: "47 pasos", code: "RESUME", required: false,
    steps: Array.from({ length: 47 }, (_, index) => step({ stepId: index + 1, order: index + 1,
      isRequired: true, selectValue: index < confirmed ? "approved" : "" })) };
}

test("20/47 confirmed opens 21 without mutating order, progress or responses", () => {
  const list = checklist();
  list.steps.reverse();
  const before = structuredClone(list);
  assert.deepEqual(checklistResumeTarget(list), { stepId: "21", reason: "answer" });
  assert.deepEqual(workChecklistProgress({ checklists: [list] }), { completed: 20, total: 47, remaining: 27, percentage: 43 });
  assert.deepEqual(list, before);
});

test("the first hole takes priority over later confirmed answers", () => {
  const list = checklist(30);
  list.steps[4].selectValue = "";
  assert.deepEqual(checklistResumeTarget(list), { stepId: "5", reason: "answer" });
});

test("all confirmed opens review rather than step one", () => {
  assert.deepEqual(checklistResumeTarget(checklist(47)), { reason: "review" });
});

test("false, zero, NC, N/A and rejection remain answered, not necessarily approved", () => {
  const answers: Partial<ChecklistStep>[] = [
    { type: "validation", isCompleted: false, selectValue: "", executionStatus: "not_completed" },
    { type: "number", responseValue: "0", selectValue: "" },
    { type: "select", selectValue: "NC", options: [{ value: "NC", label: "No cumple" }] },
    { type: "validation", isCompleted: null, selectValue: "not_applicable" },
    { type: "approval", selectValue: "rejected" },
    { type: "multiselect", selectValue: "", optionsSelectValue: [{ value: "approved", label: "Aprobado" }] },
  ];
  const list = checklist(0);
  answers.forEach((answer, index) => { Object.assign(list.steps[index], answer); });
  assert.equal(checklistResumeTarget(list).stepId, "7");
  assert.equal(workChecklistProgress({ checklists: [list] }).completed, 6);
});

test("answered step without required evidence is resumed and explicitly marked evidence", () => {
  const list = checklist();
  list.steps[3].isFilesRequired = true;
  assert.deepEqual(checklistResumeTarget(list), { stepId: "4", reason: "evidence" });
  list.steps[3].attachments = [{ id: 40, name: "confirmed.png", url: "https://example.com/confirmed.png" }];
  assert.equal(checklistResumeTarget(list).stepId, "21");
});

test("local and unconfirmed evidence never satisfy the canonical resume gate", () => {
  const list = checklist();
  const file: Attachment = { id: "local-file", name: "pending.png", url: "" };
  list.steps[3].isFilesRequired = true;
  for (const attachment of [file, { ...file, id: 40, offline: { confirmed: false } }]) {
    list.steps[3].attachments = [attachment];
    assert.deepEqual(checklistResumeTarget(list), { stepId: "4", reason: "evidence" });
    assert.equal(workChecklistProgress({ checklists: [list] }).completed, 19);
  }
  list.steps[3].attachments = [{ ...file, id: 40 }];
  assert.equal(checklistResumeTarget(list).stepId, "21");
});

test("unanswered mandatory step with files still needs an answer", () => {
  const list = checklist();
  list.steps[20].isFilesRequired = true;
  list.steps[20].attachments = [{ id: 40, name: "photo.png", url: "https://example.com/photo.png" }];
  assert.deepEqual(checklistResumeTarget(list), { stepId: "21", reason: "answer" });
});

test("optional and informational steps do not displace the first relevant pending step", () => {
  const list = checklist(0);
  list.steps[0].type = "text";
  list.steps[1].isRequired = false;
  assert.equal(checklistResumeTarget(list).stepId, "3");
  assert.equal(list.steps.length, 47);
  list.steps = list.steps.slice(0, 2);
  assert.deepEqual(checklistResumeTarget(list), { reason: "review" });
});

test("empty checklists open review without inventing completion", () => {
  const list = { ...checklist(), steps: [] };
  assert.deepEqual(checklistResumeTarget(list), { reason: "review" });
  assert.equal(workChecklistProgress({ checklists: [list] }).percentage, 0);
});