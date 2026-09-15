import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkActivity, workActivityInputSchema, workActivitySchema } from "../src/domain/workActivities";
import { assignments, group, work } from "../server/tests/fixtures";
import { harness, jsonRequest, writeCalls, errorCode, form, uploadRequest } from "../server/tests/mock-upstream";
import type { WorkActivityActions } from "../src/screens/workDetail/WorkActivities";
import type { WorkspaceFileDraft } from "../src/screens/workDetail/files/WorkspaceDraftStore";
import { action, durableReactFixture, settle, uiModule } from "./helpers/durable-ui";

const path = (suffix: string) => `/api/assignments/direct-11/works/11${suffix}?companyBranchId=1&startDate=2026-09-01&endDate=2026-09-01`;
test("checklist markers survive transport and are excluded from activities", () => {
  const activity = { id: 71, activity: "Ruedas y torque pernos", executionTime: 0, isStarted: false, isCompleted: true, technicalDocuments: [] };
  assert.equal(isWorkActivity(workActivitySchema.parse({ ...activity, isChecklist: true })), false);
  assert.equal(isWorkActivity(workActivitySchema.parse({ ...activity, checklistId: 12 })), false);
  assert.equal(isWorkActivity({ ...activity, activity: "__WORK_CHECKLIST__:Revision" }), false);
  assert.equal(isWorkActivity(activity), true);
});
test("delete activity forwards only the exact authorized resource", async context => {
  const { baseUrl, state } = await harness(context);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71"), "DELETE")).response.status, 200);
  const calls = writeCalls(state);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].path, "/api/technician-dashboard/panel/direct-11/works/11/activities/71");
  assert.equal(calls[0].query.get("companyBranchId"), "1");
  state.assignments = assignments([group({ works: [work({ status: "delivered" })] })]);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71"), "DELETE")).response.status, 409);
  state.assignments = assignments([]);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71"), "DELETE")).response.status, 404);
  assert.equal(writeCalls(state).length, 1);
});
test("activities validate names and explicit minute totals without accepting checklist placeholders", () => {
  assert.deepEqual(workActivityInputSchema.parse({ activity: " Revisar puerta ", executionTime: 90 }), { activity: "Revisar puerta", executionTime: 90 });
  for (const input of [{ activity: "", executionTime: 1 }, { activity: "__WORK_CHECKLIST__:Control", executionTime: 0 }, { activity: "Revisar", executionTime: -1 }, { activity: "Revisar", executionTime: 1.5 }, { activity: "Revisar", executionTime: 1, isCompleted: true }]) assert.equal(workActivityInputSchema.safeParse(input).success, false);
});
test("activity list preserves supervisor documents and create/complete use the exact scoped endpoints", async context => {
  const { baseUrl, state } = await harness(context);
  state.activities = [{ id: 71, activity: "Revisar puerta", executionTime: 60, isStarted: false, isCompleted: false, technicalDocuments: [{ id: 8, documentName: "Manual", notes: null, file: { id: 3, name: "manual.pdf", url: "https://files.invalid/manual.pdf" } }] }];
  const listed = await jsonRequest(baseUrl, path("/activities")); assert.equal(listed.response.status, 200);
  assert.ok(Array.isArray(listed.data)); assert.equal(listed.data[0].technicalDocuments[0].file.name, "manual.pdf");
  const created = await jsonRequest(baseUrl, path("/activities"), "POST", { activity: "Limpiar", executionTime: 15 });
  assert.deepEqual(created.data, { id: 71 });
  assert.equal((await jsonRequest(baseUrl, path("/activities/71/complete"), "POST", {})).response.status, 200);
  const calls = writeCalls(state); assert.equal(calls.length, 2);
  assert.equal(calls[0].query.get("groupType"), "direct_assignment"); assert.equal(calls[0].query.get("companyBranchId"), "1");
  assert.equal(calls[1].path, "/api/technician-dashboard/panel/direct-11/works/11/activities/71/complete");
});
for (const status of ["pending", "in_progress", "paused", "completed"] as const) test(`reopen rejects ${status} without writing upstream`, async context => {
  const { baseUrl, state } = await harness(context);
  state.assignments = assignments([group({ works: [work({ status })] })]);
  const result = await jsonRequest(baseUrl, path("/reopen"), "POST", {});
  assert.equal(result.response.status, 409); assert.equal(errorCode(result.data), "WORK_REOPEN_REQUIRES_DELIVERED"); assert.equal(writeCalls(state).length, 0);
});
test("reopen delivered preserves explicit scope and never sends a timer or delivery duration", async context => {
  const { baseUrl, state } = await harness(context);
  state.assignments = assignments([group({ works: [work({ status: "delivered" })] })]);
  assert.equal((await jsonRequest(baseUrl, path("/reopen"), "POST", {})).response.status, 200);
  const calls = writeCalls(state); assert.equal(calls.length, 1); assert.ok(calls[0].path.endsWith("/reopen")); assert.deepEqual(calls[0].json, {});
});
test("delivered activity mutations and reassigned work are refused before writes", async context => {
  const { baseUrl, state } = await harness(context);
  state.assignments = assignments([group({ works: [work({ status: "delivered" })] })]);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71/complete"), "POST", {})).response.status, 409);
  assert.equal((await jsonRequest(baseUrl, path("/activities"), "POST", { activity: "Nueva", executionTime: 10 })).response.status, 409);
  state.assignments = assignments([]);
  assert.equal((await jsonRequest(baseUrl, path("/activities"))).response.status, 404);
  assert.equal((await jsonRequest(baseUrl, path("/reopen"), "POST", {})).response.status, 404);
  assert.equal(writeCalls(state).length, 0);
});
test("activity files use verified document bytes and stay scoped to the activity", async context => {
  const { baseUrl, state } = await harness(context);
  assert.equal((await uploadRequest(baseUrl, path("/activities/71/files"), form())).response.status, 201);
  const calls = writeCalls(state); assert.equal(calls.length, 1); assert.ok(calls[0].path.endsWith("/activities/71/files"));
  assert.equal(calls[0].files[0].mime, "image/png");
});

test("editing and reversing completion preserve activity identity and reject closed work", async context => {
  const { baseUrl, state } = await harness(context);
  const input = { activity: "Reparacion ajustada", executionTime: 45 };
  assert.equal((await jsonRequest(baseUrl, path("/activities/71"), "PATCH", input)).response.status, 200);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71/complete"), "POST", { isCompleted: false })).response.status, 200);
  assert.deepEqual(writeCalls(state).map(call => call.json), [input, { isCompleted: false }]);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71/complete"), "POST", { isCompleted: "false" })).response.status, 400);
  state.assignments = assignments([group({ works: [work({ status: "delivered" })] })]);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71"), "PATCH", input)).response.status, 409);
  assert.equal((await jsonRequest(baseUrl, path("/activities/71/complete"), "POST", { isCompleted: false })).response.status, 409);
  assert.equal(writeCalls(state).length, 2);
});

test("activity creation continues its own upload despite parent busy and retries only the remaining file", async () => {
  const hooks = durableReactFixture();
  const snapshot = { text: JSON.stringify({ activity: "Revision", minutes: "45" }), files: [1, 2].map(index => ({ id: `file-${index}`, name: `${index}.txt`, uri: `fixture:${index}`, mimeType: "text/plain", size: 1, uploaded: false })), hydrated: true, saving: false, fileBusy: false, closed: false, error: null };
  const sent: string[] = [];
  let creates = 0;
  let failSecond = true;
  const store = {
    getSnapshot: () => snapshot,
    setText: async (text: string) => { snapshot.text = text; },
    flush: async () => {}, beginFiles: () => Symbol(), endFiles: () => {},
    validateFile: (_file: WorkspaceFileDraft) => {},
    confirmFile: async (id: string) => { snapshot.files = snapshot.files.filter(file => file.id !== id); },
  };
  const actions: WorkActivityActions = {
    load: async () => [],
    create: async () => { creates++; props.disabled = true; render(); return { id: 71 }; },
    complete: async () => {}, files: async () => [],
    upload: async (_id, files) => { sent.push(files[0].id); if (files[0].id === "file-2" && failSecond) throw new Error("UPLOAD_INTERRUPTED"); },
  };
  const props = { scopeKey: "activity-upload", mode: "demo" as const, activities: [], actions, disabled: false, readOnly: false, canContinueWrite: () => true };
  const module = uiModule<typeof import("../src/screens/workDetail/WorkActivities")>("screens/workDetail/WorkActivities.tsx", hooks, {
    "./files/WorkspaceDraftStore": { useWorkspaceDraft: () => ({ ...snapshot, store }) },
    "./FileWorkspace": { FileWorkspace: "FileWorkspace" },
    "./files/filePicker": { pickWorkspaceFiles: async () => [] },
    "./files/WorkspaceFileList": { PendingFileList: "PendingFileList" },
  });
  function render() { return hooks.render(() => module.WorkActivities(props)); }
  try {
    action(render(), "Agregar actividad").onPress(); await settle();
    action(render(), "Guardar actividad").onPress(); await settle();
    assert.equal(creates, 1);
    assert.deepEqual(sent, ["file-1", "file-2"]);
    assert.deepEqual(snapshot.files.map(file => file.id), ["file-2"]);
    assert.equal(JSON.parse(snapshot.text).createdId, 71);
    props.disabled = false; failSecond = false;
    action(render(), "Guardar archivos pendientes").onPress(); await settle();
    assert.equal(creates, 1);
    assert.deepEqual(sent, ["file-1", "file-2", "file-2"]);
    assert.equal(snapshot.files.length, 0);
  } finally { hooks.unmount(); }
});