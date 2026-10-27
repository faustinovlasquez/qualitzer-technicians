import assert from "node:assert/strict";
import { test } from "node:test";
import { threadActiveMentions, threadDate, threadDayLabel, threadMentionQuery, threadPlainText, threadRoute } from "../src/domain/threads";

test("cada conversación apunta a su ruta del intermediario", () => {
  assert.equal(threadRoute({ kind: "entry", companyBranchId: 1, entryId: 12 }).path, "/api/workshop/threads/entries/12");
  assert.equal(threadRoute({ kind: "order", companyBranchId: 1, entryId: 0, orderId: 82 }).path, "/api/workshop/threads/entries/0/orders/82");
  const work = threadRoute({ kind: "assignment", groupId: "maintenance-50", workId: "11", range: { startDate: "2026-10-26", endDate: "2026-10-26", companyBranchId: 1 } });
  assert.equal(work.path, "/api/assignments/maintenance-50/works/11/thread");
  assert.equal(threadRoute({ kind: "assignment", groupId: "external-300", range: { startDate: "2026-10-26", endDate: "2026-10-26", companyBranchId: 1 } }).path, "/api/assignments/external-300/thread");
});

test("las fechas de la sucursal o ISO se entienden y los días se nombran como en un chat", () => {
  const local = threadDate("26-10-2026 14:05");
  assert.equal(local?.getFullYear(), 2026); assert.equal(local?.getMonth(), 9); assert.equal(local?.getDate(), 26); assert.equal(local?.getHours(), 14);
  assert.ok(threadDate("2026-10-26T14:05:00.000Z"));
  assert.equal(threadDate("ayer"), null);
  const now = new Date(2026, 9, 26, 18, 0);
  assert.equal(threadDayLabel(new Date(2026, 9, 26, 8, 0), now), "Hoy");
  assert.equal(threadDayLabel(new Date(2026, 9, 25, 8, 0), now), "Ayer");
  assert.equal(threadDayLabel(new Date(2026, 9, 21, 8, 0), now), "mié 21 oct");
  assert.equal(threadDayLabel(new Date(2025, 11, 31, 8, 0), now), "mié 31 dic 2025");
});

test("las menciones y el texto escapado de la web se muestran limpios", () => {
  assert.equal(threadPlainText("Hola [[{\"value\":\"Ana Pérez\",\"prefix\":\"@\"}]] revisa &lt;esto&gt; &amp; aquello"), "Hola @Ana Pérez revisa <esto> & aquello");
  assert.equal(threadPlainText("OT [[{\"value\":\"OT-00012\",\"prefix\":\"#\"}]]<br>listo"), "OT #OT-00012\nlisto");
  assert.equal(threadPlainText("[[no es json]]"), "[[no es json]]");
});

test("las menciones activas son las que siguen escritas y la @ final sugiere personas", () => {
  const mentions = [{ id: "4", name: "Ana Pérez" }, { id: "7", name: "Luis Soto" }, { id: "4", name: "Ana Pérez" }];
  assert.deepEqual(threadActiveMentions("Hola @Ana Pérez, revisa", mentions), [{ id: "4", name: "Ana Pérez" }]);
  assert.equal(threadMentionQuery("Hola @an"), "an");
  assert.equal(threadMentionQuery("Hola @"), "");
  assert.equal(threadMentionQuery("correo ana@x"), null);
  assert.equal(threadMentionQuery("Hola"), null);
});
