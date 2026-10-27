import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode, harness, jsonRequest, uploadRequest } from "./mock-upstream";
import { PNG } from "./fixtures";

type State = Awaited<ReturnType<typeof harness>>["state"];
const base = "/api/workshop/threads/entries/12";

/** Ingreso 12 con dos comentarios: uno del técnico de la sesión (usuario 9) y otro de otra persona. */
function setBackend(state: State) {
  state.failures.set("/api/workshops/select", { status: 200, body: [{ value: 7, label: "Taller central" }] });
  state.failures.set("/api/operation_area/dashboard", { status: 200, body: [{ id: 3, title: "Patio", entries: [{ id: 12 }] }] });
  state.failures.set("/api/operation_area_entries/12", { status: 200, body: { id: 12, operationAreaId: 3, operationArea: { id: 3, title: "Patio" }, isInternalEntry: false, customerId: 40,
    customerEquipment: { manufacturer: { name: "CLARKE" } }, deliveredAt: null } });
  state.failures.set("/api/negotiations", { status: 200, body: { data: [{ id: 82, workOrderNumber: 12, createdAsODT: true, sentToCommercialAt: null, title: "OT de taller" }] } });
  state.failures.set("/api/works", { status: 200, body: { data: [] } });
  state.failures.set("/api/operation_area_entries/comments/12", { status: 200, body: { total: 2, data: [
    { id: "31", userId: 9, user: { name: "Técnico Prueba", avatar: "https://files.example.com/a.jpg" }, comment: "Llegó con fuga &lt;aceite&gt; [[{\"value\":\"Ana\",\"prefix\":\"@\",\"id\":4}]]",
      images: [{ originalUrl: "https://files.example.com/f.jpg", thumbnailUrl: "https://files.example.com/t.jpg" }], files: [{ name: "informe.pdf", url: "https://files.example.com/i.pdf", type: "application/pdf" }],
      createdAt: "26-10-2026 10:00", editedAt: null },
    { id: "30", userId: 4, user: { name: "Ana" }, comment: "Recibido", images: [], files: [], createdAt: "26-10-2026 09:00", editedAt: null }
  ] } });
}

test("los comentarios del ingreso salen como chat: propios marcados, texto limpio y adjuntos", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const listed = await jsonRequest(baseUrl, `${base}?companyBranchId=1`);
  assert.equal(listed.response.status, 200);
  const page = listed.data as { messages: Array<{ id: string; mine: boolean; text: string; attachments: unknown[] }>; tabs: unknown[]; totalPages: number };
  assert.deepEqual(page.messages.map((message) => [message.id, message.mine]), [["31", true], ["30", false]]);
  assert.equal(page.messages[0]?.text, "Llegó con fuga <aceite> @Ana");
  assert.equal(page.messages[0]?.attachments.length, 2);
  assert.deepEqual(page.tabs, []);
  assert.equal(page.totalPages, 1);
});

test("si la sucursal no permite comentar desde la app, el chat queda solo para leer", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/branches/1/mobileAppConfig", { status: 200, body: { mobileAppConfig: { commentsWrite: false } } });
  const listed = await jsonRequest(baseUrl, `${base}?companyBranchId=1`);
  assert.deepEqual((listed.data as { capabilities: unknown }).capabilities, { attachments: false, edit: false, write: false });
  const sent = await jsonRequest(baseUrl, `${base}?companyBranchId=1`, "POST", { text: "Hola" });
  const edited = await jsonRequest(baseUrl, `${base}/messages/31?companyBranchId=1`, "PATCH", { text: "Cambio" });
  assert.deepEqual([sent, edited].map((attempt) => [attempt.response.status, errorCode(attempt.data)]), [[403, "BRANCH_APP_ACTION_DISABLED"], [403, "BRANCH_APP_ACTION_DISABLED"]]);
  assert.equal(state.calls.some((call) => call.method !== "GET"), false);
});

test("comentar envía el texto escapado y los adjuntos al ingreso; sin texto ni archivos no se envía", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const empty = await jsonRequest(baseUrl, `${base}?companyBranchId=1`, "POST", { text: "   " });
  assert.equal(errorCode(empty.data), "COMMENT_REQUIRED");
  const form = new FormData();
  form.set("text", "Revisar <válvula>");
  form.append("files", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "foto.png");
  const sent = await uploadRequest(baseUrl, `${base}?companyBranchId=1`, form);
  assert.equal(sent.response.status, 201);
  const call = state.calls.find((item) => item.method === "POST" && item.path === "/api/operation_area_entries/comments/12");
  assert.deepEqual({ ...(call?.json as object) }, { comment: "Revisar &lt;válvula&gt;", companyBranchId: "1" });
  assert.equal(call?.files[0]?.field, "attachments");
  assert.equal(call?.files[0]?.mime, "image/png");
});

test("solo se edita un comentario propio de la conversación", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/comments/31", { status: 200, body: { id: 31 } });
  const foreign = await jsonRequest(baseUrl, `${base}/messages/30?companyBranchId=1`, "PATCH", { text: "Cambio" });
  assert.equal(errorCode(foreign.data), "COMMENT_EDIT_NOT_ALLOWED");
  const missing = await jsonRequest(baseUrl, `${base}/messages/99?companyBranchId=1`, "PATCH", { text: "Cambio" });
  assert.equal(errorCode(missing.data), "COMMENT_NOT_FOUND");
  const own = await jsonRequest(baseUrl, `${base}/messages/31?companyBranchId=1`, "PATCH", { text: "Llegó con fuga" });
  assert.equal(own.response.status, 200);
  assert.deepEqual(state.calls.find((item) => item.method === "PUT" && item.path === "/api/comments/31")?.json,
    { comment: "Llegó con fuga", tags: [], companyBranchId: 1, moduleName: "operation_area_entries", childrenId: 12 });
});

test("la OT del ingreso usa los comentarios de la negociación con su módulo, y una OT ajena no se abre", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/negotiations/comments/82", { status: 200, body: { total: 0, data: [] } });
  const own = await jsonRequest(baseUrl, `${base}/orders/82?companyBranchId=1`);
  assert.equal(own.response.status, 200);
  assert.equal(state.calls.find((call) => call.path === "/api/negotiations/comments/82")?.query.get("isCommercial"), "false");
  await jsonRequest(baseUrl, `${base}/orders/82?companyBranchId=1`, "POST", { text: "Listo para cotizar" });
  const created = state.calls.find((call) => call.method === "POST" && call.path === "/api/negotiations/comments/82");
  assert.equal(created?.query.get("module"), "work_orders");
  const foreign = await jsonRequest(baseUrl, `${base}/orders/99?companyBranchId=1`);
  assert.equal(foreign.response.status, 404);
  assert.equal(state.calls.some((call) => call.path === "/api/negotiations/comments/99"), false);
});

test("las menciones válidas se guardan con el formato de la web y su aviso; las inventadas quedan como texto", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  state.failures.set("/api/users/comment/whitelist", { status: 200, body: [{ id: "4", value: "Ana Pérez", avatarThumbnail: null }, { id: "7", value: "Luis Soto" }] });
  const people = await jsonRequest(baseUrl, `${base}/people?companyBranchId=1`);
  assert.deepEqual((people.data as { people: Array<{ id: string; name: string }> }).people.map((person) => [person.id, person.name]), [["4", "Ana Pérez"], ["7", "Luis Soto"]]);
  const sent = await jsonRequest(baseUrl, `${base}?companyBranchId=1`, "POST", { text: "@Ana Pérez revisa <esto> y @Pedro", mentions: [{ id: "4", name: "Ana Pérez" }, { id: "99", name: "Pedro" }] });
  assert.equal(sent.response.status, 201);
  const call = state.calls.find((item) => item.method === "POST" && item.path === "/api/operation_area_entries/comments/12");
  const body = { ...(call?.json as Record<string, unknown>) };
  assert.equal(body.comment, "[[{\"id\":\"4\",\"value\":\"Ana Pérez\",\"prefix\":\"@\"}]] revisa &lt;esto&gt; y @Pedro");
  assert.deepEqual(body.tags, ["{\"id\":\"4\",\"value\":\"Ana Pérez\",\"prefix\":\"@\"}"]);
});

test("sin conexión en vivo configurada, la app recibe live false y sigue actualizando por consultas", async (context) => {
  const { state, baseUrl } = await harness(context);
  setBackend(state);
  const live = await jsonRequest(baseUrl, `${base}/live?companyBranchId=1&version=0`);
  assert.equal(live.response.status, 200);
  assert.deepEqual(live.data, { live: false, version: 0, typing: [] });
  const typing = await jsonRequest(baseUrl, `${base}/typing?companyBranchId=1`, "POST", { typing: true });
  assert.deepEqual(typing.data, { live: false });
});
