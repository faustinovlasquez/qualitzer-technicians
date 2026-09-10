const assert = require("node:assert/strict");
const path = require("node:path");
const { writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");

const root = path.resolve(__dirname, "../..");
const playwright = require(process.env.OFFLINE_SMOKE_PLAYWRIGHT || require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const gateway = "http://localhost:8788";
const trace = [];
const resultPath = path.join(tmpdir(), "qualitzer-checklist-equipment-smoke-result.json");
function report(label, value) { trace.push({ label, value }); console.log(label, JSON.stringify(value ?? {})); }
async function metrics() {
  const response = await fetch(`${gateway}/__offline_test__/state`);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.fixture, "isolated-offline-smoke-v1");
  assert.equal(state.offline, false);
  return state;
}
async function snapshot(page, label) {
  const roles = await page.locator("body").ariaSnapshot();
  assert.doesNotMatch(roles, /localhost:3000/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390px viewport has no horizontal overflow");
  report(label, { viewport: page.viewportSize(), roles });
}
async function associate(page, label) {
  await page.getByRole("tab", { name: "Checklist", exact: true }).click();
  await page.getByRole("button", { name: "Agregar checklist", exact: true }).click();
  const option = page.getByRole("radio", { name: /Inspección hidráulica/ });
  await option.click();
  await page.getByRole("button", { name: "Confirmar asociación", exact: true }).click();
  await page.getByText("Checklist asociado", { exact: true }).waitFor();
  const open = page.getByRole("button", { name: "Abrir CHK-HID-01: Inspección hidráulica", exact: true });
  await open.waitFor();
  assert.equal(await open.count(), 1);
  await page.getByRole("button", { name: "Agregar checklist", exact: true }).click();
  await page.getByText("Ya asociado", { exact: true }).waitFor();
  assert.equal(await option.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Confirmar asociación", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await open.click();
  assert.equal(await page.getByRole("radio", { name: "Sí", exact: true }).isChecked(), false);
  assert.equal(await page.getByRole("radio", { name: "No", exact: true }).isChecked(), false);
  assert.equal(await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).inputValue(), "");
  report(label, { master: 1, newAnswerBlank: true, duplicateDisabled: true });
}
async function equipmentCreation(page, mode) {
  const title = `UI SMOKE ${mode} equipo 15`;
  await page.getByRole("button", { name: "Crear trabajo, mantenimiento o tiempo no productivo", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo trabajo", exact: true }).click();
  await page.getByRole("textbox", { name: "Título *", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Resumen del trabajo *", exact: true }).fill("Prueba aislada de equipo por número interno exacto.");
  const number = page.getByRole("textbox", { name: "Número interno del equipo", exact: true });
  await number.fill("1");
  await page.getByRole("button", { name: "Buscar equipo", exact: true }).click();
  await page.getByText(/Esta consulta no contiene coincidencias exactas/).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Seleccionar:/ }).count(), 0);
  await number.fill("15");
  await page.getByRole("button", { name: "Buscar equipo", exact: true }).click();
  const selected = page.getByRole("button", { name: /^Seleccionar: .*EQ-15.*ID 15$/ });
  await selected.waitFor();
  assert.equal(await page.getByText(/^Equipo seleccionado:/).count(), 0, "typing and lookup do not auto-select");
  await selected.click();
  await number.fill("16");
  await page.getByRole("button", { name: "Buscar equipo", exact: true }).click();
  await page.getByRole("button", { name: /^Seleccionar: .*EQ-16.*ID 16$/ }).waitFor();
  await page.getByText(/^Equipo seleccionado: .*EQ-15.*ID 15$/).waitFor();
  await page.getByRole("button", { name: "Volver conservando borrador", exact: true }).click();
  await page.getByRole("button", { name: "Guardar borrador y volver", exact: true }).click();
  await page.getByRole("button", { name: "Crear trabajo, mantenimiento o tiempo no productivo", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo trabajo", exact: true }).click();
  await page.getByText(/^Equipo seleccionado: .*EQ-15.*ID 15$/).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Título *", exact: true }).inputValue(), title);
  await page.getByRole("button", { name: "Continuar a horario", exact: true }).click();
  await page.getByRole("textbox", { name: "Hora de inicio *", exact: true }).fill("18:00");
  await page.getByRole("textbox", { name: "Hora de fin *", exact: true }).fill("19:00");
  await page.getByRole("button", { name: "Revisar solicitud", exact: true }).click();
  await page.getByText(/^Equipo: .*EQ-15.*ID 15$/).waitFor();
  await snapshot(page, `${mode}_EQUIPMENT_PREVIEW`);
  await page.getByRole("button", { name: mode === "demo" ? "Simular creación" : "Confirmar y crear", exact: true }).click();
  await page.getByRole("button", { name: "Ver en mi agenda", exact: true }).waitFor();
  const drafts = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes(":creation:v1:")).map(([, value]) => JSON.parse(value)));
  const draft = drafts.find((item) => item.form?.title === title);
  assert.equal(draft.phase, "confirmed");
  assert.equal(draft.form.equipment.id, 15);
  assert.equal(draft.input.work.rentalEquipmentId, 15);
  await page.getByRole("button", { name: "Ver en mi agenda", exact: true }).click();
  await page.getByText(title, { exact: true }).last().click();
  await page.getByRole("tab", { name: "Equipo", exact: true }).click();
  await page.getByText(/EQ-15/).first().waitFor();
  report(`${mode}_EQUIPMENT_CREATION_PASS`, { workId: draft.result.workId, selectedId: draft.input.work.rentalEquipmentId, restoredDraft: true });
  return draft;
}
async function main() {
  const before = await metrics();
  const browser = await playwright.chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const mode of ["demo", "live"]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-CL", serviceWorkers: "block" });
      const errors = [];
      const blocked = new Set();
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (["blob:", "data:"].includes(url.protocol) || ["http://localhost:8081", gateway].includes(url.origin)) return route.continue();
        blocked.add(url.origin);
        return route.abort("blockedbyclient");
      });
      await context.routeWebSocket("**/*", (socket) => {
        if (new URL(socket.url()).origin === "ws://localhost:8081") socket.connectToServer();
        else { blocked.add(new URL(socket.url()).origin); socket.close(); }
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto("http://localhost:8081");
        if (mode === "demo") await page.getByRole("button", { name: "Explorar demostración", exact: true }).click();
        else {
          await page.getByRole("button", { name: "Conexión avanzada. Configurar pasarela móvil" }).click();
          await page.getByRole("textbox", { name: "URL de la pasarela" }).fill(gateway);
          await page.getByRole("textbox", { name: "Correo o usuario", exact: true }).fill("offline-fixture");
          await page.getByRole("textbox", { name: "Contraseña", exact: true }).fill("fictional-offline-only");
          await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
        }
        await page.getByText("Inspección del sistema hidráulico", { exact: true }).first().waitFor();
        for (const workTitle of ["Inspección del sistema hidráulico", "Cambio de filtros y lubricación", "Diagnóstico del sistema de arranque", "Verificación previa a la entrega"]) {
          assert.equal(await page.getByRole("button", { name: new RegExp(`^TR-.*${workTitle}`) }).count(), 1, `single work card: ${workTitle}`);
        }
        await snapshot(page, `${mode}_MOBILE_HEADER`);
        await page.getByText("Cambio de filtros y lubricación", { exact: true }).last().click();
        await associate(page, `${mode}_EXISTING_WORK_CHECKLIST_PASS`);
        await page.getByRole("button", { name: "Volver conservando el borrador", exact: true }).click();
        const draft = await equipmentCreation(page, mode);
        if (mode === "live") {
          await page.reload();
          await page.getByText(draft.form.title, { exact: true }).last().click();
          await page.getByRole("tab", { name: "Equipo", exact: true }).click();
          await page.getByText(/EQ-15/).first().waitFor();
          report("LIVE_EQUIPMENT_DISPLAY_AFTER_RELOAD_PASS", { id: 15 });
        }
        assert.deepEqual(errors, []);
        report(`${mode}_ISOLATED_UI_PASS`, { blockedOrigins: [...blocked], browser: browser.version() });
      } catch (error) {
        report(`${mode}_UI_FAIL`, { error: error.stack, roles: await page.locator("body").ariaSnapshot(), browserErrors: errors });
        throw error;
      } finally { await context.close(); }
    }
    const after = await metrics();
    assert.equal(after.effects.creations, before.effects.creations + 1);
    assert.equal(after.checklistAttachments.length, before.checklistAttachments.length + 1);
    assert.deepEqual(after.checklistAttachments.at(-1), { groupId: "maintenance-101", workId: "1002", checklistId: 1, alreadyAssigned: false });
    assert.equal(after.creationInputs.at(-1).work.rentalEquipmentId, 15);
    assert.equal(after.effects.comments, before.effects.comments);
    assert.equal(after.effects.answers, before.effects.answers);
    assert.equal(after.effects.documents, before.effects.documents);
    report("CHECKLIST_EQUIPMENT_SMOKE_PASS", { effects: after.effects, association: after.checklistAttachments.at(-1), input: after.creationInputs.at(-1) });
  } finally {
    writeFileSync(resultPath, JSON.stringify(trace, null, 2));
    console.log("RESULT_FILE", resultPath);
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });