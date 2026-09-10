const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { makeDemoData } = require("../../src/infrastructure/demoData.ts");
const { dateKey, weekRange } = require("../../src/domain/format.ts");
const { scheduleDateOffset } = require("../../src/domain/weeklySchedule.ts");

const root = path.resolve(__dirname, "../..");
const playwright = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const metro = "http://localhost:8081";
const gateway = "http://localhost:8788";
const artifacts = mkdtempSync(path.join(tmpdir(), "qualitzer-agenda-layout-"));
const results = [];
const week = weekRange(dateKey());
const monday = week.startDate;
const tuesday = scheduleDateOffset(monday, 1);
const sunday = week.endDate;
const title = "Inspección hidráulica con descripción larga para comprobar lectura completa en teléfonos";
const data = makeDemoData();
const baseGroup = data.groups[0];
const baseWork = baseGroup.works[0];
const task = (id, day, name, start, end, extra = {}) => ({ ...structuredClone(baseWork), id, title: name, scheduledDate: day, plannedDates: [day], schedules: undefined, scheduledStartTime: start, scheduledEndTime: end, plannedMinutes: 60, isOverdue: false, status: "pending", elapsedSeconds: 0, ...extra });
baseGroup.works = [
  task("91001", monday, title, "08:00", "09:00"),
  task("91002", monday, "Cruce de planificación", "08:30", "09:30"),
  task("91003", tuesday, "Trabajo del martes", "14:00", "15:00", { canExecute: false }),
  task("91004", monday, "Sin hora confirmada", "", ""),
  task("91005", scheduleDateOffset(monday, -3), "Pendiente anterior único", "08:00", "09:00", { isOverdue: true }),
  task("91006", tuesday, "Turno nocturno", "23:00", "01:00", { plannedMinutes: 120 }),
];
baseGroup.works.push(structuredClone(baseGroup.works[0]));
data.groups = [baseGroup];
const button = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" });

async function startFixture() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", () => reject(new Error("8788 occupied: refusing another agent's fixture"))); probe.listen(8788, "127.0.0.1", resolve); });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href, "scripts/testing/offline-smoke-server.ts", "--isolated-offline-fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stderr.resume();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture readiness timeout")), 20000);
      let output = "";
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}`)); });
      child.stdout.on("data", (chunk) => { output += chunk.toString(); if (output.includes("OFFLINE FIXTURE ONLY")) { clearTimeout(timer); resolve(); } });
    });
    return child;
  } catch (error) { await stopFixture(child); throw error; }
}

async function stopFixture(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit"); child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), animations: "disabled" });
  writeFileSync(path.join(artifacts, `${name}.txt`), await page.locator("body").ariaSnapshot());
}

async function selectDay(page, date) {
  await page.getByTestId("agenda-day-strip").getByRole("button").nth(Math.round((Date.parse(date) - Date.parse(monday)) / 86400000)).click();
}

async function refreshHeader(page) {
  const refresh = button(page, "Actualizar asignaciones");
  assert.equal(await refresh.count(), 1, "One refresh across header and agenda toolbar");
  const header = button(page, "Cerrar sesión").locator("..").locator("..");
  assert.equal(await button(header, "Actualizar asignaciones").count(), 1, "Refresh belongs to main header");
  assert.equal(await button(page, "Actualizar horario").count(), 0, "No duplicate toolbar refresh");
  assert.doesNotMatch(await page.locator("body").innerText(), /Hoy y pendientes anteriores|Día seleccionado y pendientes anteriores|Agenda semanal y pendientes anteriores/);
  const box = await refresh.boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= page.viewportSize().width);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.waitForFunction(() => document.querySelector('[aria-label="Actualizar asignaciones"]')?.getAttribute("aria-disabled") !== "true");
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/assignments" && response.request().method() === "GET");
  await refresh.click();
  await response;
  await page.waitForFunction(() => document.querySelector('[aria-label="Actualizar asignaciones"]')?.getAttribute("aria-disabled") !== "true");
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Agenda refresh never reloads the page");
}

async function scenario(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, locale: "es-CL", serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const writes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30000);
  await context.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (![metro, gateway].includes(url.origin)) return route.abort("blockedbyclient");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !(url.origin === gateway && url.pathname === "/api/auth/login/start")) { writes.push(url.pathname); return route.abort("blockedbyclient"); }
    if (url.origin === gateway && url.pathname === "/api/assignments") {
      const response = structuredClone(data);
      response.generatedAt = new Date().toISOString();
      response.groups = response.groups.map((group) => ({ ...group, works: group.works.filter((work) => work.isOverdue || work.scheduledDate >= url.searchParams.get("startDate") && work.scheduledDate <= url.searchParams.get("endDate")) })).filter((group) => group.works.length);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
    }
    return route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => { if (new URL(socket.url()).origin === "ws://localhost:8081") socket.connectToServer(); else socket.close(); });
  try {
    await page.goto(metro);
    await button(page, "Conexión avanzada. Configurar pasarela móvil").click();
    await page.getByRole("textbox", { name: "URL de la pasarela", exact: true }).fill(gateway);
    await page.getByRole("textbox", { name: "Correo o usuario", exact: true }).fill("offline-fixture");
    await page.getByRole("textbox", { name: "Contraseña", exact: true }).fill("fictional-offline-only");
    await button(page, "Iniciar sesión").click();
    await button(page, /^Conectado a Qualitzer · 0 pendientes$/).waitFor();
    await page.getByRole("tab", { name: "Agenda", exact: true }).click();
    await refreshHeader(page);
    if (width >= 600) {
      await page.getByRole("heading", { name: "Horario de trabajo", exact: true }).waitFor();
      await button(page, /^Inspección hidráulica con/).waitFor();
      assert.equal(await page.getByTestId("mobile-agenda").count(), 0);
      await capture(page, `${width}-grid`);
    } else {
      await page.getByTestId("mobile-agenda").waitFor();
      await selectDay(page, monday);
      const work = button(page, /^Inspección hidráulica con/);
      await work.waitFor();
      assert.equal(await work.count(), 1, "Repeated snapshots produce one card");
      await page.evaluate(() => document.fonts.ready);
      await capture(page, `${width}-day`);
      const strip = page.getByTestId("agenda-day-strip");
      const targets = await strip.getByRole("button").all();
      assert.equal(targets.length, 7);
      const fab = await button(page, "Crear trabajo, mantenimiento o tiempo no productivo").boundingBox();
      const qr = await button(page, "Mostrar QR e instrucciones para Expo Go").boundingBox();
      if (qr) assert.ok(fab.x + fab.width <= qr.x || qr.x + qr.width <= fab.x || fab.y + fab.height <= qr.y || qr.y + qr.height <= fab.y, "FAB and development QR never cover each other");
      for (const target of targets) {
        const box = await target.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, "All seven days fit without horizontal scrolling");
        assert.ok(box.height >= 44);
        assert.ok(fab.y >= box.y + box.height || fab.x >= box.x + box.width || fab.x + fab.width <= box.x, "FAB does not cover day controls");
      }
      const workBox = await work.boundingBox();
      assert.ok(workBox.width >= width - 40, "Cards use phone width rather than tiny columns");
      assert.ok(workBox.y < 560, "Useful work content appears without scrolling");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No page overflow");
      await page.getByText(/con horarios solapados/).waitFor();
      await button(page, /1 atrasado · 1 sin horario/).click();
      assert.equal(await button(page, /^Pendiente anterior único\./).count(), 1);
      await button(page, /^Sin hora confirmada\./).waitFor();
      await button(page, /1 atrasado · 1 sin horario/).click();
      await selectDay(page, tuesday);
      await refreshHeader(page);
      assert.match(await strip.getByRole("button").nth(1).getAttribute("aria-label"), /Seleccionado$/, "Refresh preserves selected agenda day");
      await button(page, /^Trabajo del martes\./).click();
      await page.getByRole("tab", { name: "Checklist", exact: true }).waitFor();
      await button(page, "Volver conservando el borrador").click();
      await page.getByTestId(`agenda-day-${tuesday}`).waitFor();
      assert.match(await strip.getByRole("button").nth(1).getAttribute("aria-label"), /Seleccionado$/);
      await selectDay(page, sunday);
      await page.getByText("Sin bloques con horario", { exact: true }).waitFor();
      await capture(page, `${width}-empty`);
      await page.getByRole("tab", { name: "Agenda de la semana", exact: true }).click();
      assert.equal(await page.getByTestId("mobile-agenda").getByTestId(/^agenda-day-\d/).count(), 7);
      assert.equal(await button(page, /^Turno nocturno\./).count(), 2, "Night shift retains both date fragments");
      await capture(page, `${width}-week`);
      await button(page, "Filtros y OTs de agenda").click();
      await page.getByRole("tab", { name: /^OTs,/ }).waitFor();
      await refreshHeader(page);
      assert.equal(await page.getByRole("heading", { name: "Mi agenda", exact: true }).count(), 1, "Refresh preserves list layout");
      assert.equal(await page.getByTestId("mobile-agenda").count(), 0, "Refresh does not switch back to schedule");
      await page.getByRole("tab", { name: "Agenda cronológica", exact: true }).click();
      await button(page, "Crear trabajo, mantenimiento o tiempo no productivo").click();
      for (const action of ["Nuevo trabajo", "Nuevo mantenimiento", "Tiempo no productivo"]) await button(page, action).waitFor();
      await button(page, "Cerrar menú de creación").last().click();
    }
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    results.push({ width, passed: true }); console.log(`PASS agenda ${width}`);
  } catch (error) {
    await capture(page, `${width}-failure`).catch(() => undefined);
    results.push({ width, passed: false, error: error.stack, errors, writes }); throw error;
  } finally { await context.close(); }
}

async function main() {
  assert.equal(Number(process.versions.node.split(".")[0]), 22);
  const fixture = await startFixture(); let browser;
  try {
    browser = await playwright.chromium.launch({ channel: "msedge", headless: true });
    for (const width of [360, 320, 390, 1280]) await scenario(browser, width);
  } finally {
    if (browser) await browser.close();
    await stopFixture(fixture);
    writeFileSync(path.join(artifacts, "results.json"), JSON.stringify(results, null, 2));
    console.log(`ARTIFACTS ${artifacts}`);
    console.log("CLEANUP own browser and 8788 stopped; 8081/8787 unchanged");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });