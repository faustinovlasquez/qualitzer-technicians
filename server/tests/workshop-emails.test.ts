import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode, harness, jsonRequest } from "./mock-upstream";
import { htmlToParagraphs } from "../workshop/customerEmails";

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

test("la vista previa del correo pasa a párrafos de texto sin estilos ni etiquetas", () => {
  const html = "<!DOCTYPE html><html><head><style>p{color:red}</style></head><body><span class=\"status-pill\">Ingreso a taller</span>"
    + "<p>Estimado(a) Ana:</p><p>Su equipo <strong>BOMBA</strong> ingresó &amp; quedó<br/>recibido.</p><script>alert(1)</script></body></html>";
  assert.deepEqual(htmlToParagraphs(html), ["Ingreso a taller", "Estimado(a) Ana:", "Su equipo BOMBA ingresó & quedó", "recibido."]);
});

test("revisar el correo de un ingreso adapta la respuesta del backend y no reenvía campos desconocidos", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/operation_area_entries/12/emails/confirmation/eligibility", { status: 200, body: {
    mode: "manual", canSend: true, canAutoSend: false, shouldPrompt: true, alreadySent: false, receptionSigned: true, isInternalEntry: false,
    setting: { attachReport: true, ccEmails: ["jefe@taller.cl"], includeInternalEntries: false, secret: "x" },
    issues: [], warnings: [{ code: "CONTACTS_WITHOUT_EMAIL", message: "Sin correo: Pedro." }],
    recipients: [{ email: "ana@cliente.cl", name: "Ana", contactId: 4 }], contactsWithoutEmail: ["Pedro"],
    template: { id: 2, name: "Confirmación" }, sender: { provider: "SMTP", email: "contacto@qualitzer.cl", reason: null }, customerId: 9
  } });
  const result = await jsonRequest(baseUrl, "/api/workshop/entries/12/emails/eligibility?companyBranchId=1");
  assert.equal(result.response.status, 200);
  const data = record(result.data);
  assert.equal(data.mode, "manual");
  assert.deepEqual(data.recipients, [{ email: "ana@cliente.cl", name: "Ana", contactId: 4 }]);
  assert.deepEqual(data.ccEmails, ["jefe@taller.cl"]);
  assert.equal("customerId" in data, false);
  assert.equal(state.calls.find(call => call.path === "/api/operation_area_entries/12/emails/confirmation/eligibility")?.query.get("companyBranchId"), "1");
});

test("enviar la confirmación pasa el canal elegido y explica en simple si un canal falló", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/operation_area_entries/12/emails/confirmation", { status: 200, body: { results: [
    { email: "ana@cliente.cl", status: "failed", provider: null, senderEmail: null, error: "OFFICE365: OFFICE365_MICROSERVICE_URL_NOT_CONFIGURED" }
  ] } });
  const body = { templateId: 2, recipients: [{ email: "ana@cliente.cl", name: "Ana", contactId: 4 }], cc: [], attachReport: true, saveNewContacts: false, provider: "OFFICE365" };
  const sent = await jsonRequest(baseUrl, "/api/workshop/entries/12/emails?companyBranchId=1", "POST", body);
  assert.equal(sent.response.status, 200);
  assert.equal(record(state.calls.find(call => call.path === "/api/operation_area_entries/12/emails/confirmation")?.json).provider, "OFFICE365");
  const first = record((record(sent.data).results as unknown[])[0]);
  assert.equal(first.status, "failed");
  assert.equal(first.error, "No se pudo enviar: Microsoft 365 no está configurado en el servidor.");
  const invalid = await jsonRequest(baseUrl, "/api/workshop/entries/12/emails?companyBranchId=1", "POST", { ...body, recipients: [] });
  assert.equal(invalid.response.status, 400);
  assert.ok(errorCode(invalid.data) !== null);
});

test("el historial de envíos muestra lectura, canal y quién envió", async context => {
  const { state, baseUrl } = await harness(context);
  state.failures.set("/api/operation_area_entries/12/emails", { status: 200, body: {
    items: [{ id: 30, date: "2026-10-29T13:00:00.000Z", trigger: "automatic", status: "sent", provider: "SMTP", senderEmail: "contacto@qualitzer.cl",
      recipients: ["ana@cliente.cl"], subject: "Confirmación", templateName: "Confirmación", responsible: { name: "Alexis" }, read: true, readCount: 2,
      opens: [{ openedAt: "2026-10-29T13:05:00.000Z" }, { openedAt: "2026-10-29T14:00:00.000Z" }], errorDetail: null, content: "<p>no se reenvía</p>" }],
    summary: { sent: 1, failed: 0, recipients: 1, read: 1 }, trackingReachable: true
  } });
  const result = await jsonRequest(baseUrl, "/api/workshop/entries/12/emails?companyBranchId=1");
  assert.equal(result.response.status, 200);
  const item = record((record(result.data).items as unknown[])[0]);
  assert.equal(item.trigger, "automatic");
  assert.equal(item.readCount, 2);
  assert.equal(item.lastOpenedAt, "2026-10-29T14:00:00.000Z");
  assert.equal("content" in item, false);
});
