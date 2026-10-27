import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode, form, harness, jsonRequest, uploadRequest } from "./mock-upstream";

type State = Awaited<ReturnType<typeof harness>>["state"];
const base = "/api/workshop/drive/entries/12";

/** Ingreso 12 con una carpeta propia «Fotos» (vacía) y una automática del servidor. */
function setBackend(state: State, folders: unknown[] = [
  { id: 3, name: "Fotos", fileCount: 0, entityType: "operation_area_entry", entityId: 12 },
  { id: "work_7_photos", name: "Fotos del trabajo", fileCount: 1, parentId: null, readOnly: true }
]) {
  state.failures.set("/api/workshops/select", { status: 200, body: [{ value: 7, label: "Taller central" }] });
  state.failures.set("/api/operation_area/dashboard", { status: 200, body: [{ id: 3, title: "Patio", entries: [{ id: 12 }] }] });
  state.failures.set("/api/operation_area_entries/12", { status: 200, body: { id: 12, operationAreaId: 3, operationArea: { id: 3, title: "Patio" }, isInternalEntry: false, customerId: 40,
    customerEquipment: { manufacturer: { name: "CLARKE" } }, deliveredAt: null } });
  state.failures.set("/api/negotiations", { status: 200, body: { data: [{ id: 82, workOrderNumber: 12, createdAsODT: true, sentToCommercialAt: null, title: "OT de taller" }] } });
  state.failures.set("/api/works", { status: 200, body: { data: [] } });
  state.failures.set("/api/operation_area_entries/files/folders/12", { status: 200, body: { data: folders } });
  state.failures.set("/api/operation_area_entries/files/12", { status: 200, body: {
    data: [{ id: 5, name: "placa.jpg", url: "https://files.example.com/placa.jpg", thumbnailUrl: "https://files.example.com/t.jpg", type: "image/jpeg", createdAt: "26-10-2026", responsible: { id: 9, name: "Alexis" } }],
    totalRows: 1, totalPages: 1 } });
}

test("el ingreso lista sus carpetas (las automáticas en solo lectura) y los archivos de la carpeta", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const listed = await jsonRequest(baseUrl, `${base}?companyBranchId=1`);
  assert.equal(listed.response.status, 200);
  const data = listed.data as { folders: Array<{ id: unknown; readOnly: boolean }>; files: Array<{ id: string; responsibleName: string }>; capabilities: { folders: boolean; upload: boolean } };
  assert.deepEqual(data.folders.map((folder) => [folder.id, folder.readOnly]), [[3, false], ["work_7_photos", true]]);
  assert.deepEqual(data.files.map((file) => [file.id, file.responsibleName]), [["5", "Alexis"]]);
  assert.deepEqual(data.capabilities, { folders: true, upload: true, remove: true });
  const inFolder = await jsonRequest(baseUrl, `${base}?companyBranchId=1&folderId=3`);
  assert.equal(inFolder.response.status, 200);
  const query = state.calls.filter((call) => call.path === "/api/operation_area_entries/files/12").at(-1)?.query;
  assert.equal(JSON.parse(query?.get("filters") ?? "{}").folderId, 3);
});

test("una carpeta que no es del ingreso no se abre ni recibe archivos", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const foreign = await jsonRequest(baseUrl, `${base}?companyBranchId=1&folderId=99`);
  assert.equal(foreign.response.status, 404);
  assert.equal(errorCode(foreign.data), "FOLDER_NOT_FOUND");
  const upload = await uploadRequest(baseUrl, `${base}?companyBranchId=1&folderId=99`, form(1, undefined, "foto.png", "image/png"));
  assert.equal(upload.response.status, 404);
  assert.equal(state.calls.some((call) => call.path === "/api/operation_area_entries/files/12" && call.method === "POST"), false);
});

test("subir a una carpeta del ingreso envía la carpeta; en una automática no se puede", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.delete("/api/operation_area_entries/files/12");
  state.beforeResponse = async (call) => {
    if (call.method === "GET" && call.path === "/api/operation_area_entries/files/12") state.failures.set(call.path, { status: 200, body: { data: [], totalRows: 0, totalPages: 0 } });
  };
  const uploaded = await uploadRequest(baseUrl, `${base}?companyBranchId=1&folderId=3`, form(1, undefined, "foto.png", "image/png"));
  assert.equal(uploaded.response.status, 201);
  const sent = state.calls.find((call) => call.path === "/api/operation_area_entries/files/12" && call.method === "POST");
  assert.equal((sent?.json as Record<string, string>).folderId, "3");
  assert.equal(sent?.files[0]?.field, "attachments");
  const locked = await uploadRequest(baseUrl, `${base}?companyBranchId=1&folderId=work_7_photos`, form(1, undefined, "foto.png", "image/png"));
  assert.equal(locked.response.status, 409);
  assert.equal(errorCode(locked.data), "FOLDER_READ_ONLY");
});

test("crear, renombrar y borrar carpetas: sin repetir nombres, solo las propias y solo vacías", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.beforeResponse = async (call) => {
    if (call.method === "POST" && call.path === "/api/operation_area_entries/files/folders/12") {
      setBackend(state, [{ id: 3, name: "Fotos", fileCount: 0 }, { id: 4, name: "Informes", fileCount: 0 }]);
    }
  };
  const repeated = await jsonRequest(baseUrl, `${base}/folders?companyBranchId=1`, "POST", { name: "fotos" });
  assert.equal(repeated.response.status, 409);
  assert.equal(errorCode(repeated.data), "FOLDER_EXISTS");
  const created = await jsonRequest(baseUrl, `${base}/folders?companyBranchId=1`, "POST", { name: "Informes" });
  assert.equal(created.response.status, 201);
  assert.deepEqual(created.data, { id: 4, name: "Informes", fileCount: 0, parentId: null, readOnly: false });

  setBackend(state);
  state.beforeResponse = undefined;
  const lockedRename = await jsonRequest(baseUrl, `${base}/folders/work_7_photos?companyBranchId=1`, "PATCH", { name: "Otro" });
  assert.equal(errorCode(lockedRename.data), "FOLDER_READ_ONLY");
  const foreignRename = await jsonRequest(baseUrl, `${base}/folders/99?companyBranchId=1`, "PATCH", { name: "Otro" });
  assert.equal(errorCode(foreignRename.data), "FOLDER_NOT_FOUND");
  assert.equal(state.calls.some((call) => call.path === "/api/operation_area_entries/files/folders/99"), false);
  const renamed = await jsonRequest(baseUrl, `${base}/folders/3?companyBranchId=1`, "PATCH", { name: "Fotos ingreso" });
  assert.equal(renamed.response.status, 200);
  assert.deepEqual(state.calls.find((call) => call.method === "PATCH" && call.path === "/api/operation_area_entries/files/folders/3")?.json, { name: "Fotos ingreso" });

  setBackend(state, [{ id: 3, name: "Fotos", fileCount: 2 }]);
  const notEmpty = await jsonRequest(baseUrl, `${base}/folders/3?companyBranchId=1`, "DELETE");
  assert.equal(errorCode(notEmpty.data), "FOLDER_NOT_EMPTY");
  setBackend(state);
  state.failures.set("/api/operation_area_entries/files/folders/3", { status: 204, body: "" });
  const removed = await jsonRequest(baseUrl, `${base}/folders/3?companyBranchId=1`, "DELETE");
  assert.equal(removed.response.status, 200);
});

test("mover y borrar exigen que el archivo esté en la carpeta indicada del ingreso", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/files/5/folder", { status: 200, body: { success: true } });
  const missing = await jsonRequest(baseUrl, `${base}/files/6/folder?companyBranchId=1`, "PATCH", { folderId: 3 });
  assert.equal(errorCode(missing.data), "FILE_NOT_FOUND");
  const intoLocked = await jsonRequest(baseUrl, `${base}/files/5/folder?companyBranchId=1`, "PATCH", { folderId: "work_7_photos" });
  assert.equal(errorCode(intoLocked.data), "FOLDER_READ_ONLY");
  const moved = await jsonRequest(baseUrl, `${base}/files/5/folder?companyBranchId=1`, "PATCH", { folderId: 3 });
  assert.equal(moved.response.status, 200);
  assert.deepEqual(state.calls.find((call) => call.path === "/api/files/5/folder")?.json, { folderId: 3 });

  const foreign = await jsonRequest(baseUrl, `${base}/files/6?companyBranchId=1`, "DELETE");
  assert.equal(errorCode(foreign.data), "FILE_NOT_FOUND");
  state.failures.set("/api/operation_area_entries/files/12/5", { status: 204, body: "" });
  const removed = await jsonRequest(baseUrl, `${base}/files/5?companyBranchId=1`, "DELETE");
  assert.equal(removed.response.status, 200);
  assert.ok(state.calls.some((call) => call.method === "DELETE" && call.path === "/api/operation_area_entries/files/12/5"));
});

test("la sucursal puede quitar subir, organizar o borrar archivos desde la app", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/branches/1/mobileAppConfig", { status: 200, body: { mobileAppConfig: { filesUpload: false, filesFolders: false, filesDelete: false } } });
  const listed = await jsonRequest(baseUrl, `${base}?companyBranchId=1`);
  assert.equal(listed.response.status, 200);
  assert.deepEqual((listed.data as { capabilities: unknown }).capabilities, { folders: false, upload: false, remove: false });
  const attempts = [
    await uploadRequest(baseUrl, `${base}?companyBranchId=1`, form(1, undefined, "foto.png", "image/png")),
    await jsonRequest(baseUrl, `${base}/folders?companyBranchId=1`, "POST", { name: "Informes" }),
    await jsonRequest(baseUrl, `${base}/folders/3?companyBranchId=1`, "PATCH", { name: "Otro" }),
    await jsonRequest(baseUrl, `${base}/folders/3?companyBranchId=1`, "DELETE"),
    await jsonRequest(baseUrl, `${base}/files/5/folder?companyBranchId=1`, "PATCH", { folderId: 3 }),
    await jsonRequest(baseUrl, `${base}/files/5?companyBranchId=1`, "DELETE")
  ];
  assert.deepEqual(attempts.map((attempt) => [attempt.response.status, errorCode(attempt.data)]), Array(6).fill([403, "BRANCH_APP_ACTION_DISABLED"]));
  assert.equal(state.calls.some((call) => call.method !== "GET"), false);
});

test("la OT del ingreso usa los archivos de la negociación y una OT ajena no se abre", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/negotiation_files/folders/82", { status: 200, body: { data: [] } });
  state.failures.set("/api/negotiation_files/82", { status: 200, body: { data: [], totalRows: 0, totalPages: 0 } });
  const own = await jsonRequest(baseUrl, `${base}/orders/82?companyBranchId=1`);
  assert.equal(own.response.status, 200);
  const foreign = await jsonRequest(baseUrl, `${base}/orders/99?companyBranchId=1`);
  assert.equal(foreign.response.status, 404);
  assert.equal(state.calls.some((call) => call.path === "/api/negotiation_files/99"), false);
});
