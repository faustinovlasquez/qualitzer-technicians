import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checklistAnswerError, checklistFillProgress, checklistStepOptions, hasChecklistStepAnswer,
  isChecklistStepProgressRelevant, isChecklistStepSatisfied, normalizeChecklistAnswer,
} from "../src/domain/checklistProgress";
import type { ChecklistStep, StepAnswer } from "../src/domain/models";
import { validateAnswer } from "../server/assignments/rules";
import { step } from "../server/tests/fixtures";

const blankAnswer: StepAnswer = { responseValue: null, isCompleted: false, executionStatus: null, comment: null };
const evidence = { id: 1, name: "Evidencia.png", url: "https://files.example.invalid/evidence.png" };
const stepTypes: ChecklistStep["type"][] = ["validation", "text", "number", "select", "multiselect", "approval"];

test("canonical validation false is answered and satisfies a required step without becoming a pass", () => {
  const unanswered = step({ type: "validation", isRequired: true });
  assert.equal(hasChecklistStepAnswer(unanswered), false);
  assert.equal(isChecklistStepSatisfied(unanswered), false);
  for (const value of [false, true]) {
    const validation = step({ type: "validation", isRequired: true, isCompleted: value, executionStatus: value ? "completed" : "not_completed" });
    assert.equal(hasChecklistStepAnswer(validation), true);
    assert.equal(isChecklistStepSatisfied(validation), true);
    assert.deepEqual(checklistFillProgress([validation]), { total: 1, completed: 1, remaining: 0, percentage: 100 });
    assert.equal(validation.isCompleted, value);
  }
});

test("negative validation normalization preserves false and rejects contradictory completion claims", () => {
  const validation = step({ type: "validation" });
  const normalized = normalizeChecklistAnswer(validation, { ...blankAnswer, responseValue: false, isCompleted: true, executionStatus: "completed" });
  assert.deepEqual(normalized, { ...blankAnswer, responseValue: false, executionStatus: "not_completed" });
  assert.equal(checklistAnswerError(validation, normalized), null);
  assert.deepEqual(validateAnswer(validation, normalized), normalized);
  for (const invalid of [{ ...normalized, isCompleted: true }, { ...normalized, executionStatus: "completed" as const }]) {
    assert.notEqual(checklistAnswerError(validation, invalid), null);
    assert.throws(() => validateAnswer(validation, invalid), { code: "INVALID_STEP_ANSWER" });
  }
});

test("validation N/A satisfies fill progress but normalizes to false with no execution status", () => {
  const validation = step({ type: "validation", isCompleted: null, selectValue: "not_applicable" });
  assert.equal(hasChecklistStepAnswer(validation), true);
  assert.equal(isChecklistStepSatisfied(validation), true);
  assert.deepEqual(checklistFillProgress([validation]), { total: 1, completed: 1, remaining: 0, percentage: 100 });
  const normalized = normalizeChecklistAnswer(validation, { ...blankAnswer, responseValue: "not_applicable", isCompleted: true, executionStatus: "completed" });
  assert.deepEqual(normalized, { ...blankAnswer, responseValue: "not_applicable" });
  assert.equal(checklistAnswerError(validation, normalized), null);
  assert.deepEqual(validateAnswer(validation, normalized), normalized);
  for (const invalid of [{ ...normalized, isCompleted: true }, { ...normalized, executionStatus: "completed" as const }]) {
    assert.throws(() => validateAnswer(validation, invalid), { code: "INVALID_STEP_ANSWER" });
  }
  assert.equal(validation.isCompleted, null);
});

test("rejected select and approval choices are valid filled answers rather than missing responses", () => {
  for (const type of ["select", "approval"] as const) {
    const rejected = step({ type, selectValue: "rejected", isCompleted: false, executionStatus: "not_completed" });
    assert.equal(hasChecklistStepAnswer(rejected), true);
    assert.equal(isChecklistStepSatisfied(rejected), true);
    const normalized = normalizeChecklistAnswer(rejected, { ...blankAnswer, responseValue: "rejected" });
    assert.deepEqual(normalized, { ...blankAnswer, responseValue: "rejected", isCompleted: true, executionStatus: "completed" });
    assert.equal(checklistAnswerError(rejected, normalized), null);
    assert.deepEqual(validateAnswer(rejected, normalized), normalized);
    assert.notEqual(checklistAnswerError(rejected, { ...normalized, responseValue: "invented" }), null);
    assert.throws(() => validateAnswer(rejected, { ...normalized, responseValue: "invented" }), { code: "INVALID_STEP_ANSWER" });
  }
});

test("empty approval options use the canonical approved, rejected and N/A defaults", () => {
  const approval = step({ type: "approval", options: [] });
  assert.deepEqual(checklistStepOptions(approval), [
    { value: "approved", label: "Aprobado" },
    { value: "rejected", label: "Rechazado" },
    { value: "not_applicable", label: "No aplica" },
  ]);
  for (const responseValue of ["approved", "rejected", "not_applicable"]) {
    const normalized = normalizeChecklistAnswer(approval, { ...blankAnswer, responseValue });
    assert.deepEqual(normalized, { ...blankAnswer, responseValue, isCompleted: true, executionStatus: "completed" });
    assert.equal(checklistAnswerError(approval, normalized), null);
    assert.deepEqual(validateAnswer(approval, normalized), normalized);
    assert.equal(isChecklistStepSatisfied({ ...approval, selectValue: responseValue }), true);
  }
  assert.deepEqual(approval.options, []);
});

test("configured approval options remain authoritative and other choice types have no fallback", () => {
  const options = [{ value: "reviewed", label: "Revisado" }];
  const approval = step({ type: "approval", options });
  assert.deepEqual(checklistStepOptions(approval), options);
  const accepted = normalizeChecklistAnswer(approval, { ...blankAnswer, responseValue: "reviewed" });
  assert.equal(checklistAnswerError(approval, accepted), null);
  assert.deepEqual(validateAnswer(approval, accepted), accepted);
  for (const responseValue of ["approved", "rejected", "not_applicable"]) {
    const invalid = { ...accepted, responseValue };
    assert.notEqual(checklistAnswerError(approval, invalid), null);
    assert.throws(() => validateAnswer(approval, invalid), { code: "INVALID_STEP_ANSWER" });
  }
  for (const type of ["select", "multiselect"] as const) {
    const selection = step({ type, options: [] });
    assert.deepEqual(checklistStepOptions(selection), []);
    const responseValue = type === "select" ? "approved" : [{ value: "approved", label: "Aprobado" }];
    assert.notEqual(checklistAnswerError(selection, normalizeChecklistAnswer(selection, { ...blankAnswer, responseValue })), null);
  }
});

test("multiselect needs a nonempty selection and rejects duplicate or unknown option values", () => {
  const selection = step({ type: "multiselect" });
  assert.equal(hasChecklistStepAnswer(selection), false);
  assert.equal(isChecklistStepSatisfied(selection), false);
  const choices = [{ value: "rejected", label: "Rechazado" }];
  const filled = { ...selection, optionsSelectValue: choices };
  assert.equal(hasChecklistStepAnswer(filled), true);
  assert.equal(isChecklistStepSatisfied(filled), true);
  const valid = normalizeChecklistAnswer(selection, { ...blankAnswer, responseValue: choices });
  assert.equal(checklistAnswerError(selection, valid), null);
  assert.deepEqual(validateAnswer(selection, valid), valid);
  for (const responseValue of [[...choices, ...choices], [{ value: "unknown", label: "Otro" }], "rejected"]) {
    const invalid = { ...valid, responseValue };
    assert.notEqual(checklistAnswerError(selection, invalid), null);
    assert.throws(() => validateAnswer(selection, invalid), { code: "INVALID_STEP_ANSWER" });
  }
});

test("numeric zero and signed decimals are answers while blank and malformed values remain invalid", () => {
  const numeric = step({ type: "number" });
  assert.equal(hasChecklistStepAnswer(numeric), false);
  assert.equal(isChecklistStepSatisfied(numeric), false);
  for (const responseValue of ["0", "-12.5", "+1", ".5"]) {
    const filled = { ...numeric, responseValue };
    const answer = normalizeChecklistAnswer(numeric, { ...blankAnswer, responseValue });
    assert.equal(hasChecklistStepAnswer(filled), true);
    assert.equal(isChecklistStepSatisfied(filled), true);
    assert.equal(checklistAnswerError(numeric, answer), null);
    assert.deepEqual(validateAnswer(numeric, answer), answer);
  }
  for (const responseValue of ["", " ", "NaN", "Infinity", "1,5", "1e3", true]) {
    assert.notEqual(checklistAnswerError(numeric, normalizeChecklistAnswer(numeric, { ...blankAnswer, responseValue })), null);
  }
});

test("text is always excluded from fill progress even when marked required", () => {
  for (const responseValue of ["", " ", "Observación técnica"]) {
    const text = step({ type: "text", isRequired: true, isFilesRequired: true, responseValue });
    assert.equal(hasChecklistStepAnswer(text), responseValue.trim() !== "");
    assert.equal(isChecklistStepProgressRelevant(text), false);
    assert.equal(isChecklistStepSatisfied(text), true);
    assert.equal(checklistAnswerError(text, normalizeChecklistAnswer(text, { ...blankAnswer, responseValue })), null);
    assert.deepEqual(checklistFillProgress([text]), { total: 0, completed: 0, remaining: 0, percentage: 0 });
  }
});

test("unanswered optional steps are satisfied but their answered state still requires configured evidence", () => {
  const optional = step({ isRequired: false, isFilesRequired: true });
  assert.equal(hasChecklistStepAnswer(optional), false);
  assert.equal(isChecklistStepSatisfied(optional), true);
  assert.equal(checklistAnswerError(optional, blankAnswer), null);
  const filled = { ...optional, selectValue: "rejected" };
  const answer = normalizeChecklistAnswer(filled, { ...blankAnswer, responseValue: "rejected" });
  assert.equal(hasChecklistStepAnswer(filled), true);
  assert.equal(isChecklistStepSatisfied(filled), false);
  assert.notEqual(checklistAnswerError(filled, answer), null);
  assert.throws(() => validateAnswer(filled, { ...blankAnswer, responseValue: "rejected" }), { code: "STEP_FILES_REQUIRED" });
  const confirmed = { ...filled, attachments: [evidence] };
  assert.equal(isChecklistStepSatisfied(confirmed), true);
  assert.equal(checklistAnswerError(confirmed, answer), null);
  assert.deepEqual(validateAnswer(confirmed, answer), answer);
  for (const candidate of [optional, filled, confirmed]) {
    assert.equal(isChecklistStepProgressRelevant(candidate), false);
    assert.deepEqual(checklistFillProgress([candidate]), { total: 0, completed: 0, remaining: 0, percentage: 0 });
  }
});

test("negative and N/A validations require confirmed evidence to satisfy a required step", () => {
  for (const value of [false, "not_applicable"] as const) {
    const validation = step({
      type: "validation", isFilesRequired: true,
      isCompleted: value === false ? false : null, selectValue: value === "not_applicable" ? value : "",
    });
    const answer = normalizeChecklistAnswer(validation, { ...blankAnswer, responseValue: value });
    assert.equal(hasChecklistStepAnswer(validation), true);
    assert.equal(isChecklistStepSatisfied(validation), false);
    assert.notEqual(checklistAnswerError(validation, answer), null);
    assert.deepEqual(checklistFillProgress([validation]), { total: 1, completed: 0, remaining: 1, percentage: 0 });
    const confirmed = { ...validation, attachments: [evidence] };
    assert.equal(isChecklistStepSatisfied(confirmed), true);
    assert.equal(checklistAnswerError(confirmed, answer), null);
    assert.deepEqual(checklistFillProgress([confirmed]), { total: 1, completed: 1, remaining: 0, percentage: 100 });
  }
});

test("non-text steps count by default and only an explicit optional flag excludes them", () => {
  for (const type of stepTypes) {
    assert.equal(isChecklistStepProgressRelevant(step({ type })), type !== "text");
    assert.equal(isChecklistStepProgressRelevant(step({ type, isRequired: true })), type !== "text");
    assert.equal(isChecklistStepProgressRelevant(step({ type, isRequired: false })), false);
  }
});

test("fill progress counts required answers, rounds percentages and leaves canonical snapshots unchanged", () => {
  const steps = [
    step({ type: "validation", isCompleted: false }),
    step({ type: "validation", selectValue: "not_applicable" }),
    step({ type: "select", selectValue: "rejected" }),
    step({ type: "number", responseValue: "0" }),
    step({ type: "multiselect" }),
    step({ type: "approval", selectValue: "approved", isFilesRequired: true }),
    step({ type: "text" }),
    step({ type: "text", responseValue: "Observación" }),
    step({ type: "number", isRequired: false }),
    step({ type: "select", isRequired: false, selectValue: "approved", isFilesRequired: true }),
  ];
  const snapshot = structuredClone(steps);
  assert.deepEqual(checklistFillProgress(steps), { total: 6, completed: 4, remaining: 2, percentage: 67 });
  const withEvidence = steps.map((candidate) => candidate.type === "approval" ? { ...candidate, attachments: [evidence] } : candidate);
  assert.deepEqual(checklistFillProgress(withEvidence), { total: 6, completed: 5, remaining: 1, percentage: 83 });
  const completed = withEvidence.map((candidate) => candidate.type === "multiselect" ? { ...candidate, optionsSelectValue: [{ value: "approved", label: "Aprobado" }] } : candidate);
  assert.deepEqual(checklistFillProgress(completed), { total: 6, completed: 6, remaining: 0, percentage: 100 });
  assert.deepEqual(steps, snapshot);
});

test("an empty or entirely excluded checklist has zero progress rather than a fabricated completion", () => {
  const empty = { total: 0, completed: 0, remaining: 0, percentage: 0 };
  assert.deepEqual(checklistFillProgress([]), empty);
  assert.deepEqual(checklistFillProgress([step({ type: "text" }), step({ isRequired: false, selectValue: "approved" })]), empty);
});

test("null responses and nullable comments can be saved without inventing completion", () => {
  for (const type of stepTypes) {
    const unanswered = step({ type });
    for (const comment of [null, "Observación sin respuesta"]) {
      const answer = { ...blankAnswer, comment };
      assert.deepEqual(normalizeChecklistAnswer(unanswered, answer), answer);
      assert.deepEqual(validateAnswer(unanswered, answer), answer);
      assert.equal(hasChecklistStepAnswer({ ...unanswered, comment: comment ?? "" }), false);
      assert.equal(isChecklistStepSatisfied(unanswered), type === "text");
      assert.equal(checklistAnswerError({ ...unanswered, isRequired: false }, answer), null);
      assert.throws(() => validateAnswer(unanswered, { ...answer, isCompleted: true, executionStatus: "completed" }), { code: "INVALID_STEP_ANSWER" });
    }
  }
});

test("normalizing cleared answers resets execution flags while preserving comments and the input", () => {
  const optional = step({ isRequired: false });
  const emptyValues: StepAnswer["responseValue"][] = [null, "", " \t\n ", []];
  for (const responseValue of emptyValues) {
    const answer: StepAnswer = { responseValue, isCompleted: true, executionStatus: "completed", comment: "Conservar observación" };
    const original = structuredClone(answer);
    const normalized = normalizeChecklistAnswer(optional, answer);
    assert.deepEqual(normalized, { ...blankAnswer, comment: "Conservar observación" });
    assert.equal(checklistAnswerError(optional, normalized), null);
    assert.deepEqual(normalizeChecklistAnswer(optional, normalized), normalized);
    assert.deepEqual(answer, original);
  }
});