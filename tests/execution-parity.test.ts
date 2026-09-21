import assert from "node:assert/strict";
import { test } from "node:test";
import { request, type Request } from "express";
import type { Assignments, AssignmentWork, ChecklistStep, StatusInput } from "../src/domain/models";
import { automaticExecutionTiming, availableExecutionDates, canTransitionExecution, executionDatesAllowed, executionDuration, executionElapsedSeconds, executionIntervalCovered } from "../src/domain/workExecution";
import { hasChecklistStepAnswer, isChecklistStepSatisfied } from "../src/domain/checklistProgress";
import { answerError, changedAnswer, completionReasons, manualCompletion, readOnlyWork } from "../src/screens/workDetail/detailRules";
import { AssignmentAuthorization, type OwnedWork } from "../server/assignments/authorization";
import { validateAnswer, validateStatus } from "../server/assignments/rules";
import { resolveConfig } from "../server/config";
import { statusInputSchema } from "../server/validation";
import { Upstream } from "../server/upstream";
import { assignments, group, step, TOKEN, user, work } from "../server/tests/fixtures";
import { assignmentCalls, errorCode, harness, jsonRequest, writeCalls, type MockState } from "../server/tests/mock-upstream";

const day = "2026-09-08";
const range = { startDate: day, endDate: day };
const query = new URLSearchParams({ ...range, companyBranchId: "1" }).toString();
const path = (suffix = "/status", groupId = "direct-11") => `/api/assignments/${groupId}/works/11${suffix}?${query}`;
const delivery: StatusInput = { status: "delivered", executionDates: [day] };
const manual: StatusInput = { ...delivery, executionStartTime: "08:00", executionEndTime: "09:00", endDateOffset: 0, isManual: true };

test("worked days allow nonconsecutive dates without changing the execution scope", () => {
  const workedDates = ["2026-09-01", "2026-09-04", "2026-09-08"];
  const parsed = statusInputSchema.parse({ ...manual, workedDates });
  assert.deepEqual(parsed.workedDates, workedDates);
  assert.deepEqual(parsed.executionDates, [day]);
  assert.equal(executionDuration(parsed), 60);
  for (const dates of [[], [day, day], ["2026-02-30"], Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`)]) {
    assert.equal(statusInputSchema.safeParse({ ...manual, workedDates: dates }).success, false);
  }
  for (const status of ["in_progress", "paused"]) assert.equal(statusInputSchema.safeParse({ status, workedDates }).success, false);
  assert.equal(statusInputSchema.safeParse({ ...manual, workedDates, executionDates: [day, "2026-09-09"] }).success, false);
});

function owned(overrides: Partial<AssignmentWork> = {}, allowEditExecutionTime = false, maintenance = false): OwnedWork {
  const assignedWork = work({ scheduledDate: day, plannedDates: [day], ...overrides });
  const assignedGroup = group({ status: "completed", works: [assignedWork], ...(maintenance ? { id: "maintenance-50", type: "internal_maintenance" } : {}) });
  return { token: TOKEN, user: user(), range: { ...range, companyBranchId: 1 }, group: assignedGroup, work: assignedWork, workId: 11, maintenanceId: maintenance ? 50 : null, allowEditExecutionTime, generatedAt: "2026-09-08T10:00:00Z" };
}

function withRequiredSteps(steps: ChecklistStep[]): AssignmentWork["checklists"] {
  return [{ checklistId: 10, name: "Control", code: "CHK-10", required: true, steps }];
}

test("nonconsecutive worked dates forward once with a single authorized anchor and unchanged timer", async context => {
  const { baseUrl, state } = await harness(context);
  const workedDates = ["2026-09-01", "2026-09-04", day];
  for (const maintenance of [false, true]) {
    const groupId = maintenance ? "maintenance-50" : "direct-11";
    state.assignments = assignments([group({ id: groupId, type: maintenance ? "internal_maintenance" : "direct_assignment", works: [work({ scheduledDate: day, plannedDates: [day], elapsedSeconds: 1200 })] })]);
    state.assignments.technician.allowEditExecutionTime = false;
    state.calls.length = 0;
    const response = await jsonRequest(baseUrl, path("/status", groupId), "POST", { ...delivery, workedDates: [...workedDates].reverse(), isManual: false });
    assert.equal(response.response.status, 200);
    const writes = writeCalls(state);
    assert.equal(writes.length, 1);
    const expected = validateStatus(owned({ elapsedSeconds: 1200 }, false, maintenance), { ...delivery, workedDates, isManual: false });
    assert.deepEqual(writes[0]?.json, { ...expected, workId: 11, sourceType: maintenance ? "maintenance" : "work", ...(maintenance ? { maintenanceWorkId: 11 } : {}) });
    assert.ok(assignmentCalls(state).every(call => call.query.get("startDate") === day));
    assert.equal(executionDuration(validateStatus(owned({}, true, maintenance), { ...manual, workedDates })), 60);
  }
});

function plannedSnapshots(state: MockState, dates: string[], customize?: (snapshot: Assignments, date: string, afterFiles: boolean) => void): void {
  let afterFiles = false;
  state.beforeResponse = async (call) => {
    if (call.path === "/api/work_files/11") afterFiles = true;
    if (call.path !== "/api/technician-dashboard/assignments") return;
    const date = call.query.get("startDate")!;
    const snapshot = assignments([group({ works: [work({ scheduledDate: date, plannedDates: dates, status: "paused", elapsedSeconds: date === dates[0] ? 1200 : 0 })] })]);
    snapshot.technician.allowEditExecutionTime = false;
    customize?.(snapshot, date, afterFiles);
    state.assignments = snapshot;
  };
}

test("pending, running and paused children can be delivered despite a finalized parent", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const type of ["direct_assignment", "external_ot", "internal_maintenance"] as const) {
    const groupId = type === "internal_maintenance" ? "maintenance-50" : type === "external_ot" ? "external-300" : "direct-11";
    for (const status of ["pending", "in_progress", "paused"] as const) {
      const assignedWork = work({ status, scheduledDate: day, plannedDates: [day] });
      const assignedGroup = group({ id: groupId, type, status: "completed", works: [assignedWork] });
      state.assignments = assignments([assignedGroup]);
      state.assignments.technician.allowEditExecutionTime = false;
      state.calls.length = 0;
      assert.equal(readOnlyWork(assignedGroup, assignedWork), false);
      assert.equal(canTransitionExecution(assignedWork, "delivered"), true);
      assert.deepEqual(completionReasons(assignedGroup, assignedWork, [], null), []);
      const result = await jsonRequest(baseUrl, path("/status", groupId), "POST", delivery);
      assert.equal(result.response.status, 200);
      assert.deepEqual(writeCalls(state).map((call) => call.json), [type === "internal_maintenance" ? {
        workId: 11, sourceType: "maintenance", maintenanceWorkId: 11, status: "delivered", executionDates: [day], isManual: false,
      } : {
        workId: 11, sourceType: "work", status: "delivered", executionDates: [day],
        executionStartTime: "08:00", executionEndTime: "08:20", endDateOffset: 0, isManual: false,
      }]);
    }
  }
});

test("a delivered parent allows child answers; completed and delivered children remain locked", async (t) => {
  const { baseUrl, state } = await harness(t);
  const answer = { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: null };
  state.assignments = assignments([group({ status: "delivered", works: [work({ status: "pending" })] })]);
  assert.equal((await jsonRequest(baseUrl, path("/steps/101"), "PATCH", answer)).response.status, 200);
  for (const status of ["completed", "delivered"] as const) {
    state.assignments.groups[0]!.works[0]!.status = status;
    state.calls.length = 0;
    for (const [suffix, method, body] of [["/status", "POST", delivery], ["/steps/101", "PATCH", answer]] as const) {
      const result = await jsonRequest(baseUrl, path(suffix), method, body);
      assert.equal(result.response.status, 409);
      assert.equal(errorCode(result.data), "WORK_READ_ONLY");
    }
    assert.equal(writeCalls(state).length, 0);
  }
});

test("resource authorization can bypass the child status lock but retains canonical membership", async (t) => {
  const { backendUrl, state } = await harness(t);
  state.assignments = assignments([group({ status: "delivered", works: [work({ status: "delivered" })] })]);
  state.assignments.technician.allowEditExecutionTime = false;
  const authorization = new AssignmentAuthorization(new Upstream(resolveConfig({ backendUrl })));
  const req: Request = Object.create(request, {
    headers: { value: { authorization: TOKEN }, enumerable: true },
    params: { value: { groupId: "direct-11", workId: "11" }, enumerable: true },
    query: { value: Object.fromEntries(new URLSearchParams(query)), enumerable: true },
  });
  const scope = await authorization.work(req, false);
  assert.equal(scope.work.status, "delivered");
  assert.equal(scope.allowEditExecutionTime, false);
  assert.equal(scope.generatedAt, state.assignments.generatedAt);
  await assert.rejects(authorization.work(req, true), { code: "WORK_READ_ONLY" });
  state.assignments.groups[0]!.works = [];
  await assert.rejects(authorization.work(req, false), { code: "ASSIGNMENT_NOT_FOUND" });
});

test("canExecute denies every execution mutation, including delivery from pending", () => {
  for (const status of ["pending", "in_progress", "paused"] as const) {
    const scope = owned({ status, canExecute: false }, true);
    for (const target of ["in_progress", "paused", "completed", "delivered"] as const) {
      assert.equal(canTransitionExecution(scope.work, target), false);
      assert.throws(() => validateStatus(scope, { ...manual, status: target }), { code: "WORK_CANNOT_EXECUTE" });
    }
  }
});

test("standard auto delivery uses the latest paused elapsed time, not schedule length or client clock", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ works: [work({ scheduledDate: day, scheduledEndTime: "20:00" })] })]);
  state.assignments.technician.allowEditExecutionTime = false;
  state.assignments.generatedAt = "2000-01-01T00:00:00Z";
  state.beforeResponse = async (call) => {
    if (call.path === "/api/work_files/11") {
      state.assignments.groups[0]!.works[0]!.status = "paused";
      state.assignments.groups[0]!.works[0]!.elapsedSeconds = 1800;
    }
  };
  const result = await jsonRequest(baseUrl, path(), "POST", { ...delivery, isManual: false });
  assert.equal(result.response.status, 200);
  assert.deepEqual(writeCalls(state)[0]?.json, {
    workId: 11, sourceType: "work", status: "delivered", executionDates: [day],
    executionStartTime: "08:00", executionEndTime: "08:30", endDateOffset: 0, isManual: false,
  });
  assert.ok(assignmentCalls(state).length >= 3);
});

test("automatic timing shares desktop rounding, excludes paused gaps and keeps branch HH:mm", () => {
  const paused = work({ status: "paused", elapsedSeconds: 5400, firstInProgressTime: "23:30", scheduledStartTime: "08:00" });
  const generatedAt = "2026-09-09T02:00:00Z";
  assert.equal(executionElapsedSeconds(paused, generatedAt, Date.parse("2026-09-10T12:00:00Z")), 5400);
  assert.deepEqual(automaticExecutionTiming(paused), { executionStartTime: "23:30", executionEndTime: "01:00", endDateOffset: 1, minutes: 90 });
  assert.equal(executionElapsedSeconds({ ...paused, status: "in_progress" }, generatedAt, Date.parse(generatedAt) + 60000), 5460);
  assert.equal(executionElapsedSeconds({ ...paused, status: "in_progress" }, generatedAt, Date.parse(generatedAt) - 60000), 5400);
  assert.equal(automaticExecutionTiming(paused, 89)?.minutes, 1);
  assert.equal(automaticExecutionTiming(paused, 90)?.minutes, 2);
  assert.equal(automaticExecutionTiming(paused, 29)?.minutes, 0);
  assert.equal(automaticExecutionTiming(paused, 30)?.minutes, 1);
  assert.deepEqual(automaticExecutionTiming(work({ firstInProgressTime: null, scheduledStartTime: "07:15", elapsedSeconds: 1200 })), {
    executionStartTime: "07:15", executionEndTime: "07:35", endDateOffset: 0, minutes: 20,
  });
  assert.equal(automaticExecutionTiming(work({ firstInProgressTime: null, scheduledStartTime: "", elapsedSeconds: 1200 })), null);
});

test("pending standard work cannot invent duration from its schedule; maintenance may deliver zero", () => {
  const empty = { status: "pending", elapsedSeconds: 0, executedMinutes: 0, firstInProgressTime: null } as const;
  assert.equal(automaticExecutionTiming(work(empty)), null);
  assert.throws(() => validateStatus(owned(empty), delivery), { code: "EXECUTION_TIMER_REQUIRED" });
  assert.throws(() => validateStatus(owned({ elapsedSeconds: 29 }), delivery), { code: "INVALID_EXECUTION_DURATION" });
  assert.deepEqual(validateStatus(owned(empty, false, true), delivery), { ...delivery, isManual: false });
  assert.deepEqual(validateStatus(owned(empty, true), manual), manual);
});

test("manual hours require the fresh branch permission; unmarked legacy hours remain compatible", () => {
  for (const maintenance of [false, true]) {
    const denied = owned({}, false, maintenance);
    assert.throws(() => validateStatus(denied, manual), { status: 403, code: "MANUAL_EXECUTION_TIME_FORBIDDEN" });
    const { isManual: _isManual, ...legacy } = manual;
    assert.throws(() => validateStatus(denied, legacy), { code: "MANUAL_EXECUTION_TIME_FORBIDDEN" });
    assert.throws(() => validateStatus(denied, { ...manual, isManual: false }), { code: "MANUAL_EXECUTION_TIME_FORBIDDEN" });
    assert.deepEqual(validateStatus(owned({}, true, maintenance), legacy), manual);
    assert.deepEqual(validateStatus(owned({}, true, maintenance), manual), manual);
    const derived = validateStatus(denied, { ...legacy, executionEndTime: "08:20" });
    assert.equal(derived.isManual, false);
    assert.equal(derived.executionEndTime, maintenance ? undefined : "08:20");
  }
});

test("maintenance auto preserves backend accumulated time, manual explicitly overrides with permission", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ status: "paused", elapsedSeconds: 7200 })] })]);
  const automatic = await jsonRequest(baseUrl, path("/status", "maintenance-50"), "POST", delivery);
  assert.equal(automatic.response.status, 200);
  assert.deepEqual(writeCalls(state)[0]?.json, { ...delivery, isManual: false, workId: 11, maintenanceWorkId: 11, sourceType: "maintenance" });
  state.calls.length = 0;
  assert.equal((await jsonRequest(baseUrl, path("/status", "maintenance-50"), "POST", manual)).response.status, 200);
  assert.deepEqual(writeCalls(state)[0]?.json, { ...manual, workId: 11, maintenanceWorkId: 11, sourceType: "maintenance" });
});

test("permission revocation and child completion during file checks prevent final delivery", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const change of ["permission", "completed", "assignment"] as const) {
    state.assignments = assignments();
    state.calls.length = 0;
    state.beforeResponse = async (call) => {
      if (call.path !== "/api/work_files/11") return;
      if (change === "permission") state.assignments.technician.allowEditExecutionTime = false;
      if (change === "completed") state.assignments.groups[0]!.works[0]!.status = "completed";
      if (change === "assignment") state.assignments.groups[0]!.works = [];
    };
    const result = await jsonRequest(baseUrl, path(), "POST", manual);
    assert.equal(errorCode(result.data), change === "permission" ? "MANUAL_EXECUTION_TIME_FORBIDDEN" : change === "completed" ? "WORK_READ_ONLY" : "ASSIGNMENT_NOT_FOUND");
    assert.equal(writeCalls(state).length, 0);
  }
});

test("daily queries allow cross-midnight duration and up to 30 days without broadening selected dates", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ works: [work({ status: "paused", firstInProgressTime: "23:30", elapsedSeconds: 5400 })] })]);
  state.assignments.technician.allowEditExecutionTime = false;
  assert.equal((await jsonRequest(baseUrl, path(), "POST", delivery)).response.status, 200);
  assert.deepEqual(writeCalls(state)[0]?.json, {
    ...delivery, workId: 11, sourceType: "work", executionStartTime: "23:30", executionEndTime: "01:00", endDateOffset: 1, isManual: false,
  });
  const overnight = manualCompletion(day, "23:30", "01:00", true, range);
  assert.equal(overnight.minutes, 90);
  assert.deepEqual(overnight.input, { ...delivery, executionStartTime: "23:30", executionEndTime: "01:00", endDateOffset: 1, isManual: true });
  assert.equal(manualCompletion(day, "08:00", "08:00", 30, range).minutes, 43200);
  assert.equal(manualCompletion(day, "08:00", "08:00", 31, range).input, null);
  assert.equal(executionDuration({ executionStartTime: "08:00", executionEndTime: "08:00", endDateOffset: 0 }), null);
});

test("start and pause use the query day even for an overdue original schedule", async (t) => {
  const { baseUrl, state } = await harness(t);
  for (const [previous, target] of [["pending", "in_progress"], ["in_progress", "paused"], ["paused", "in_progress"]] as const) {
    state.assignments = assignments([group({ works: [work({ status: previous, scheduledDate: "2026-09-01", plannedDates: ["2026-09-01"] })] })]);
    state.calls.length = 0;
    assert.equal((await jsonRequest(baseUrl, path(), "POST", { status: target, executionDates: [day] })).response.status, 200);
    assert.deepEqual(writeCalls(state)[0]?.json, { status: target, executionDates: [day], workId: 11, sourceType: "work" });
    state.calls.length = 0;
    const old = await jsonRequest(baseUrl, path(), "POST", { status: target, executionDates: ["2026-09-01"] });
    assert.equal(errorCode(old.data), "EXECUTION_DATES_OUTSIDE_RANGE");
    assert.equal(writeCalls(state).length, 0);
  }
});

test("a selected planned date outside today's query requires fresh canonical membership on that date", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ works: [work({ plannedDates: ["2026-09-01", day] })] })]);
  const selected = { ...manual, executionDates: ["2026-09-01"] };
  assert.equal((await jsonRequest(baseUrl, path(), "POST", selected)).response.status, 200);
  const historical = assignmentCalls(state).filter((call) => call.query.get("startDate") === "2026-09-01");
  assert.equal(historical.length, 2);
  assert.ok(historical.every((call) => call.query.get("endDate") === "2026-09-01"));
  assert.deepEqual(writeCalls(state)[0]?.json, { ...selected, workId: 11, sourceType: "work" });
  state.calls.length = 0;
  state.beforeResponse = async (call) => {
    if (call.path === "/api/technician-dashboard/assignments" && call.query.get("startDate") === "2026-09-01") state.assignments = assignments([]);
  };
  assert.equal((await jsonRequest(baseUrl, path(), "POST", selected)).response.status, 404);
  assert.equal(writeCalls(state).length, 0);
});

test("unproven dates, malformed times and unsafe bulk flags cannot reach status writes", () => {
  const scope = owned({}, true);
  assert.throws(() => validateStatus(scope, { ...manual, executionDates: ["2026-08-01"] }), { code: "EXECUTION_DATES_OUTSIDE_RANGE" });
  assert.throws(() => validateStatus(scope, { ...manual, executionDates: [day, "2026-09-09"] }), { code: "EXECUTION_DATES_OUTSIDE_RANGE" });
  assert.throws(() => validateStatus(scope, { status: "paused", executionStartTime: "08:00" }), { code: "EXECUTION_TIMES_ONLY_ON_COMPLETION" });
  assert.throws(() => validateStatus(scope, { status: "delivered", isManual: true }), { code: "EXECUTION_TIMES_AND_DATES_REQUIRED" });
  for (const extra of [{ finalizeAll: true }, { finalizeAllDays: true }, { workId: 99 }, { workerId: 99 }, { sourceType: "maintenance" }, { endDateOffset: 31 }, { endDateOffset: -1 }, { endDateOffset: 0.5 }, { executionStartTime: "24:00" }, { executionDates: ["2026-02-30"] }, { executionDates: [day, day] }]) {
    assert.equal(statusInputSchema.safeParse({ ...manual, ...extra }).success, false);
  }
  assert.equal(statusInputSchema.safeParse({ ...manual, status: "completed" }).success, true);
  assert.equal(statusInputSchema.safeParse({ ...manual, status: "delivered" }).success, true);
  assert.equal(availableExecutionDates(work({ plannedDates: Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`) }), range).length, 32);
  assert.deepEqual(availableExecutionDates(work({ plannedDates: [day, "2026-02-30", day] }), range), [day]);
});

test("required checklist parity accepts false, NA, zero and optional text without asserting a pass", () => {
  const values = [
    step({ type: "validation", isCompleted: false, executionStatus: "not_completed" }),
    step({ type: "validation", isCompleted: null, selectValue: "not_applicable" }),
    step({ type: "number", responseValue: "0" }),
    step({ type: "select", selectValue: "rejected" }),
    step({ type: "approval", options: [], selectValue: "not_applicable" }),
    step({ type: "text", responseValue: "", isRequired: true }),
    step({ type: "number", responseValue: "", isRequired: false }),
  ];
  const scope = owned({ checklists: withRequiredSteps(values) });
  assert.ok(values.every(isChecklistStepSatisfied));
  assert.equal(hasChecklistStepAnswer(values[0]!), true);
  assert.equal(values[0]?.isCompleted, false);
  assert.equal(validateStatus(scope, delivery).status, "delivered");
  assert.deepEqual(completionReasons(scope.group, scope.work, [], null), []);
  const missing = owned({ checklists: withRequiredSteps([step({ type: "number", responseValue: "" })]) });
  assert.throws(() => validateStatus(missing, delivery), { code: "REQUIRED_CHECKLISTS_INCOMPLETE" });
});

test("answer validation shares approval defaults, normalizes false and rejects false completion claims", () => {
  const validation = step({ type: "validation" });
  const blank = { responseValue: null, isCompleted: false, executionStatus: null, comment: null };
  const negative = changedAnswer(validation, blank, false);
  assert.deepEqual(negative, { ...blank, responseValue: false, executionStatus: "not_completed" });
  assert.equal(answerError(validation, negative), null);
  assert.deepEqual(validateAnswer(validation, negative), negative);
  assert.throws(() => validateAnswer(validation, { ...negative, executionStatus: "completed" }), { code: "INVALID_STEP_ANSWER" });
  const na = changedAnswer(validation, blank, "not_applicable");
  assert.deepEqual(validateAnswer(validation, na), { ...blank, responseValue: "not_applicable" });
  const approval = step({ type: "approval", options: [] });
  for (const value of ["approved", "rejected", "not_applicable"]) {
    const answer = changedAnswer(approval, blank, value);
    assert.equal(answerError(approval, answer), null);
    assert.deepEqual(validateAnswer(approval, answer), answer);
  }
  assert.throws(() => validateAnswer(approval, { ...blank, responseValue: "made_up" }), { code: "INVALID_STEP_ANSWER" });
  assert.deepEqual(validateAnswer(step({ type: "text" }), blank), blank);
  const evidenceRequired = step({ isFilesRequired: true });
  assert.throws(() => validateAnswer(evidenceRequired, { ...blank, responseValue: "approved" }), { code: "STEP_FILES_REQUIRED" });
  const selection = step({ type: "multiselect" });
  const checked = changedAnswer(selection, blank, [{ value: "approved", label: "untrusted label" }]);
  assert.deepEqual(validateAnswer(selection, checked).responseValue, [{ value: "approved", label: "Aprobado" }]);
});

test("mandatory step evidence blocks delivery even for false, NA, optional lists and text", () => {
  for (const entry of [step({ type: "validation", isCompleted: false }), step({ type: "validation", selectValue: "not_applicable" }), step({ type: "text" })]) {
    const scope = owned({ checklists: [{ checklistId: 10, name: "Control", code: "CHK-10", required: false, steps: [{ ...entry, isFilesRequired: true }] }] });
    assert.throws(() => validateStatus(scope, delivery), { code: "STEP_FILES_REQUIRED" });
    assert.ok(completionReasons(scope.group, scope.work, [], null).some((reason) => reason.includes("evidencia")));
  }
  const scope = owned({ checklists: withRequiredSteps([step({ selectValue: "approved", isFilesRequired: true, attachments: [{ id: 1, name: "Foto", url: "https://example.invalid/photo.png" }] })]) });
  assert.equal(validateStatus(scope, delivery).status, "delivered");
});

test("required work evidence uses confirmed file totals rather than stale snapshot counts", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ works: [work({ filesCount: 99, isFilesRequired: true })] })]);
  state.files = { data: [], totalRows: 0, totalPages: 0 };
  const result = await jsonRequest(baseUrl, path(), "POST", delivery);
  assert.equal(errorCode(result.data), "WORK_FILES_REQUIRED");
  assert.equal(writeCalls(state).length, 0);
  state.assignments.groups[0]!.works[0]!.filesCount = 0;
  state.files = { data: [{ id: 1, name: "Foto", url: "https://example.invalid/photo.png" }], totalRows: 1, totalPages: 1 };
  assert.equal((await jsonRequest(baseUrl, path(), "POST", delivery)).response.status, 200);
});

test("completed stays compatible while delivery remains the default manual UI action", () => {
  const completed = validateStatus(owned({}, true), { ...manual, status: "completed" });
  assert.equal(completed.status, "completed");
  assert.equal(manualCompletion(day, "08:00", "09:00", false, range).input?.status, "delivered");
  assert.equal(manualCompletion(day, "08:00", "09:00", false, range, "completed").input?.status, "completed");
});

test("explicit planned days use one canonical timer and one write, not a timer per date", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = [day, "2026-09-09", "2026-09-10"];
  plannedSnapshots(state, dates, (snapshot, date, afterFiles) => {
    if (afterFiles && date === day) snapshot.groups[0]!.works[0]!.elapsedSeconds = 1800;
  });
  const result = await jsonRequest(baseUrl, path(), "POST", { ...delivery, executionDates: [...dates].reverse(), isManual: false });
  assert.equal(result.response.status, 200);
  assert.deepEqual(writeCalls(state).map((call) => call.json), [{
    status: "delivered", executionDates: dates, executionStartTime: "08:00", executionEndTime: "08:30", endDateOffset: 0, isManual: false, workId: 11, sourceType: "work",
  }]);
  for (const date of dates) {
    const calls = assignmentCalls(state).filter((call) => call.query.get("startDate") === date);
    assert.ok(calls.length >= 2);
    assert.ok(calls.every((call) => call.query.get("endDate") === date && call.query.get("companyBranchId") === "1" && call.headers.authorization === TOKEN && call.headers.origin === "http://localhost:3000"));
  }
});

test("multi-date automatic time comes from the first selected day, not the open detail day", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = ["2026-09-01", day];
  plannedSnapshots(state, dates);
  const result = await jsonRequest(baseUrl, path(), "POST", { ...delivery, executionDates: [...dates].reverse() });
  assert.equal(result.response.status, 200);
  assert.deepEqual(writeCalls(state).map((call) => call.json), [{
    status: "delivered", executionDates: dates, executionStartTime: "08:00", executionEndTime: "08:20", endDateOffset: 0, isManual: false, workId: 11, sourceType: "work",
  }]);
});

test("explicit overnight dates preserve one 90-minute interval for productive and nonproductive work", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = [day, "2026-09-09"];
  for (const [groupId, type, workType] of [
    ["direct-11", "direct_assignment", "productive"],
    ["direct-np-11", "direct_assignment", "non_productive"],
    ["external-300", "external_ot", "productive"],
  ] as const) {
    state.calls.length = 0;
    plannedSnapshots(state, dates, (snapshot, date) => {
      const parent = snapshot.groups[0]!;
      parent.id = groupId;
      parent.type = type;
      parent.status = "delivered";
      parent.works[0]!.workType = workType;
      if (date === day) {
        parent.works[0]!.firstInProgressTime = "23:30";
        parent.works[0]!.elapsedSeconds = 5400;
      }
    });
    const result = await jsonRequest(baseUrl, path("/status", groupId), "POST", { status: "completed", executionDates: dates, isManual: false });
    assert.equal(result.response.status, 200);
    const expected = { status: "completed", executionDates: dates, executionStartTime: "23:30", executionEndTime: "01:00", endDateOffset: 1, isManual: false, workId: 11, sourceType: "work" };
    assert.deepEqual(writeCalls(state).map((call) => call.json), [expected]);
    assert.equal(executionDuration(expected), 90);
  }
});

test("manual multi-date interval is total time once and requires current permission on every date", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = [day, "2026-09-09"];
  plannedSnapshots(state, dates, (snapshot) => { snapshot.technician.allowEditExecutionTime = true; });
  const input = { ...manual, executionDates: dates };
  assert.equal((await jsonRequest(baseUrl, path(), "POST", input)).response.status, 200);
  assert.deepEqual(writeCalls(state).map((call) => call.json), [{ ...input, workId: 11, sourceType: "work" }]);
  assert.equal(executionDuration(input), 60);
  const result = manualCompletion([...dates].reverse(), "08:00", "09:00", 0, range, "delivered", work({ plannedDates: dates }));
  assert.equal(result.minutes, 60);
  assert.deepEqual(result.input, input);
  state.calls.length = 0;
  plannedSnapshots(state, dates, (snapshot, date, afterFiles) => { snapshot.technician.allowEditExecutionTime = !(afterFiles && date === dates[1]); });
  assert.equal(errorCode((await jsonRequest(baseUrl, path(), "POST", input)).data), "MANUAL_EXECUTION_TIME_FORBIDDEN");
  assert.equal(writeCalls(state).length, 0);
});

test("every selected day is freshly owned and validated after evidence checks", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = [day, "2026-09-09"];
  const cases = ["missing", "overdue", "unplanned", "completed", "permission", "checklist", "step-files", "work-files", "worker"] as const;
  const codes = ["ASSIGNMENT_NOT_FOUND", "EXECUTION_DATE_NOT_ASSIGNED", "EXECUTION_DATE_NOT_ASSIGNED", "WORK_READ_ONLY", "WORK_CANNOT_EXECUTE", "REQUIRED_CHECKLISTS_INCOMPLETE", "STEP_FILES_REQUIRED", "WORK_FILES_REQUIRED", "WORKER_MISMATCH"];
  for (const [index, change] of cases.entries()) {
    state.calls.length = 0;
    state.files = { data: [], totalRows: 0, totalPages: 0 };
    plannedSnapshots(state, dates, (snapshot, date, afterFiles) => {
      if (!afterFiles || date !== dates[1]) return;
      const item = snapshot.groups[0]!.works[0]!;
      if (change === "missing") snapshot.groups = [];
      if (change === "overdue") item.scheduledDate = day;
      if (change === "unplanned") item.plannedDates = [day];
      if (change === "completed") item.status = "completed";
      if (change === "permission") item.canExecute = false;
      if (change === "checklist") item.checklists = withRequiredSteps([step()]);
      if (change === "step-files") item.checklists[0]!.steps[0]!.isFilesRequired = true;
      if (change === "work-files") item.isFilesRequired = true;
      if (change === "worker") snapshot.technician.id = 84;
    });
    const response = await jsonRequest(baseUrl, path(), "POST", { ...delivery, executionDates: dates });
    assert.equal(errorCode(response.data), codes[index], change);
    assert.equal(writeCalls(state).length, 0, change);
  }
});

test("multi-date authorization remains bound to the original user and current branch", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = [day, "2026-09-09"];
  for (const change of ["user", "branch"] as const) {
    state.user = user();
    state.calls.length = 0;
    plannedSnapshots(state, dates);
    const respond = state.beforeResponse!;
    state.beforeResponse = async (call) => {
      await respond(call);
      if (call.path === "/api/work_files/11") {
        if (change === "user") state.user.id = 18;
        else state.user.accessBranchs = [];
      }
    };
    const result = await jsonRequest(baseUrl, path(), "POST", { ...delivery, executionDates: dates });
    assert.equal(errorCode(result.data), change === "user" ? "EXECUTION_SCOPE_CHANGED" : "BRANCH_FORBIDDEN");
    assert.equal(writeCalls(state).length, 0);
  }
});

test("independent timers, zero anchor time and implicit overnight dates fail closed", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = [day, "2026-09-10"];
  for (const problem of ["independent", "zero", "rounding", "overnight"] as const) {
    state.calls.length = 0;
    plannedSnapshots(state, dates, (snapshot, date) => {
      const item = snapshot.groups[0]!.works[0]!;
      if (problem === "independent" && date === dates[1]) item.elapsedSeconds = 1200;
      if (date !== day) return;
      if (problem === "zero") item.elapsedSeconds = 0;
      if (problem === "rounding") item.elapsedSeconds = 29;
      if (problem === "overnight") { item.firstInProgressTime = "23:30"; item.elapsedSeconds = 5400; }
    });
    const result = await jsonRequest(baseUrl, path(), "POST", { ...delivery, executionDates: dates });
    assert.equal(errorCode(result.data), problem === "independent" ? "MULTI_DATE_TIMERS_REQUIRE_SEPARATE_DELIVERY" : problem === "zero" ? "EXECUTION_TIMER_REQUIRED" : problem === "rounding" ? "INVALID_EXECUTION_DURATION" : "EXECUTION_INTERVAL_DATES_REQUIRED");
    assert.equal(writeCalls(state).length, 0);
  }
  assert.equal(executionIntervalCovered([day, "2026-09-09"], 1), true);
  assert.equal(executionIntervalCovered(dates, 1), false);
  assert.equal(manualCompletion(dates, "23:30", "01:00", 1, range, "delivered", work({ plannedDates: dates })).input, null);
});

test("maintenance, start and pause stay singleton; explicit dates never enable bulk flags", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = [day, "2026-09-09"];
  state.assignments = assignments([group({ id: "maintenance-50", type: "internal_maintenance", works: [work({ scheduledDate: day, plannedDates: dates })] })]);
  assert.equal(errorCode((await jsonRequest(baseUrl, path("/status", "maintenance-50"), "POST", { ...delivery, executionDates: dates })).data), "SINGLE_EXECUTION_DATE_REQUIRED");
  plannedSnapshots(state, dates);
  for (const flag of ["finalizeAll", "finalizeAllDays"]) {
    assert.equal((await jsonRequest(baseUrl, path(), "POST", { ...manual, executionDates: dates, [flag]: true })).response.status, 400);
  }
  for (const status of ["in_progress", "paused"] as const) {
    const scope = owned({ status: status === "in_progress" ? "pending" : "in_progress", plannedDates: dates });
    assert.throws(() => validateStatus(scope, { status, executionDates: dates }), { code: "SINGLE_EXECUTION_DATE_REQUIRED" });
  }
  assert.equal(writeCalls(state).length, 0);
  assert.equal(executionDatesAllowed(work({ plannedDates: dates }), range, dates, true), false);
});

test("select-all is explicit and bounded to 30 dates without silently truncating the plan", async (t) => {
  const { baseUrl, state } = await harness(t);
  const dates = Array.from({ length: 31 }, (_, index) => new Date(Date.parse(`${day}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
  const input = { ...delivery, executionDates: dates };
  assert.equal(statusInputSchema.safeParse(input).success, false);
  assert.equal(executionDatesAllowed(work({ plannedDates: dates }), range, dates), false);
  assert.deepEqual(availableExecutionDates(work({ plannedDates: dates }), range), dates);
  assert.equal((await jsonRequest(baseUrl, path(), "POST", input)).response.status, 400);
  assert.equal(writeCalls(state).length, 0);
  const bounded = dates.slice(0, 30);
  plannedSnapshots(state, bounded);
  assert.equal((await jsonRequest(baseUrl, path(), "POST", { ...input, executionDates: bounded })).response.status, 200);
  assert.equal(writeCalls(state).length, 1);
  assert.deepEqual(statusInputSchema.parse({ ...delivery, executionDates: bounded }).executionDates, bounded);
});