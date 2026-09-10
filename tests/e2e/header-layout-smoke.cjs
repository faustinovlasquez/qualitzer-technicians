const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const playwright = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const metro = "http://localhost:8081";
const gateway = "http://localhost:8788";
const controlOrigin = "http://127.0.0.1:8788";
const artifacts = mkdtempSync(path.join(tmpdir(), "qualitzer-header-layout-"));
const results = [];
const accessibilityFindings = new Set();
const statusNames = /^(Conectado a Qualitzer|Sin red|Sin acceso a Qualitzer|Verificar sesión|Servidor requiere actualización|Configuración del servidor incompatible|Servidor no disponible|Verificando conexión con Qualitzer|Recuperando estado local|No se pudo sincronizar)/;
const button = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" });
const statusButton = (page) => button(page, statusNames);

async function fixtureState() {
  const response = await fetch(`${controlOrigin}/__offline_test__/state`, { redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.fixture, "isolated-offline-smoke-v1");
  return state;
}

async function control(offline) {
  const response = await fetch(`${controlOrigin}/__offline_test__/control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offline }),
    redirect: "error", signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
}

async function startFixture() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", () => reject(new Error("Port 8788 occupied; refusing to reuse or stop another fixture")));
    probe.listen(8788, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href,
    "scripts/testing/offline-smoke-server.ts", "--isolated-offline-fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stderr.resume();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Own fixture did not become ready")), 20000);
      let output = "";
      child.once("error", () => { clearTimeout(timer); reject(new Error("Cannot launch own fixture")); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Own fixture exited (${code})`)); });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("OFFLINE FIXTURE ONLY")) { clearTimeout(timer); resolve(); }
      });
    });
    return child;
  } catch (error) { await stopFixture(child); throw error; }
}

async function stopFixture(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function capture(page, label) {
  await page.screenshot({ path: path.join(artifacts, `${label}.png`), animations: "disabled" });
}

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), "No horizontal page overflow");
}

async function statusAccess(page) {
  await button(page, /^Conectado a Qualitzer · 0 pendientes$/).waitFor();
  await compactStatus(page);
  assert.equal(await statusButton(page).count(), 1, "Exactly one connection status button");
  const bounds = await statusButton(page).boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height < page.viewportSize().height / 2, "Connection remains accessible at top, not below tabs");
  assert.equal(await button(page, "Sincronizar ahora").count(), 1);
  assert.ok(await button(page, "Sincronizar ahora").isVisible());
  await noOverflow(page);
}

async function compactStatus(page) {
  const bar = page.getByTestId("connection-status-bar");
  assert.equal(await bar.count(), 1);
  const bounds = await bar.boundingBox();
  assert.ok(bounds && bounds.height <= 50, `Connection strip <=50px, actual ${bounds?.height}`);
  const lines = [];
  for (const id of ["connection-status-title", "connection-status-detail"]) {
    const line = page.getByTestId(id);
    const style = await line.evaluate((element) => {
      const css = getComputedStyle(element);
      return { font: css.fontSize, height: css.lineHeight, wrap: css.whiteSpace, overflow: css.textOverflow };
    });
    assert.deepEqual(style, { font: "12px", height: "17px", wrap: "nowrap", overflow: "ellipsis" });
    const box = await line.boundingBox();
    assert.ok(box && Math.abs(box.height - 17) <= 1, "Each text occupies exactly one 17px line");
    lines.push(box);
  }
  assert.ok(Math.abs(lines[1].y - lines[0].y - 17) <= 1, "Title and counts are separate adjacent lines");
  for (const target of [statusButton(page), button(page, "Sincronizar ahora")]) {
    const box = await target.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, "Status and sync targets >=44x44");
  }
  const description = await statusButton(page).evaluate((element) => element.getAttribute("aria-description") ?? (element.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
  if (description) {
    assert.match(description, /Agenda disponible offline|Sin agenda disponible offline/);
    assert.match(description, /Abre el centro offline: cobertura, pendientes y detalles de sincronización/);
  } else accessibilityFindings.add("React Native Web does not expose accessibilityHint as an accessible DOM description; native hint not tested");
  await noOverflow(page);
}

async function pendingReview(page, label) {
  await page.goto(`${metro}/__header_fixture_seed`);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("qualitzer-offline-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("states", "readwrite");
        const store = tx.objectStore("states");
        let seeded = 0;
        tx.oncomplete = () => seeded === 1 ? resolve() : reject(new Error("Expected exactly one fixture work namespace"));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error("Isolated seed refused"));
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          const state = JSON.parse(item.value);
          const entry = state.cache.find((cache) => cache.coverage && JSON.parse(cache.json).groups?.some((group) => group.works.length));
          if (entry && !seeded) {
            if (state.operations.length || !state.passports.every((passport) => passport.user.tenant?.id === "offline-smoke")) { tx.abort(); return; }
            const group = JSON.parse(entry.json).groups.find((group) => group.works.length);
            state.operations.push({ id: crypto.randomUUID(), kind: "comment", status: "needs_review", createdAt: Date.now(), attempts: 1, nextAttemptAt: 0,
              lastError: "OFFLINE_SYNC_UNEXPECTED_RESPONSE", text: "HEADER FIXTURE ONLY - retained review",
              scope: { groupId: group.id, workId: group.works[0].id, companyBranchId: 1, startDate: entry.coverage.date, endDate: entry.coverage.date } });
            state.revision++; state.lease = null; item.update(JSON.stringify(state)); seeded++;
          }
          item.continue();
        };
      });
    } finally { db.close(); }
  });
  await page.goto(metro);
  await button(page, "Conectado a Qualitzer · 1 pendientes · 1 por revisar").waitFor();
  assert.equal(await page.getByTestId("connection-status-title").innerText(), "Conectado a Qualitzer");
  assert.equal(await page.getByTestId("connection-status-detail").innerText(), "1 pendiente · 1 por revisar");
  await compactStatus(page);
  await capture(page, `${label}-pending-review`);
  await statusButton(page).click();
  await button(page, "Preparar este período").waitFor();
  await page.getByText("HEADER FIXTURE ONLY - retained review", { exact: true }).waitFor();
  await button(page, "Volver").click();
  await button(page, "Preparar este período").waitFor({ state: "hidden" });
  await compactStatus(page);
  await button(page, "Cerrar sesión").click();
  await button(page, "Seguir trabajando").click();
  await button(page, "Comprobar pendientes y cerrar sesión").waitFor({ state: "hidden" });
  await button(page, "Sincronizar ahora").click();
  await button(page, "Conectado a Qualitzer · 1 pendientes · 1 por revisar").waitFor();
}

async function mainHeader(page, company) {
  await page.getByRole("heading", { name: "Mi jornada", exact: true }).waitFor();
  await statusAccess(page);
  const brand = page.getByText(company, { exact: true });
  assert.equal(await brand.count(), 1, "Company appears once in main, without duplicate brand");
  const brandBox = await brand.boundingBox();
  assert.ok(brandBox && Math.abs(brandBox.height - 30) <= 1, "Main company name is one 30px line");
  const logout = button(page, "Cerrar sesión");
  assert.equal(await logout.count(), 1);
  const logoutBox = await logout.boundingBox();
  assert.ok(logoutBox && logoutBox.width >= 44 && logoutBox.height >= 44, "Logout touch target >=44x44");
  assert.doesNotMatch(await logout.innerText(), /Cerrar|sesión/i, "Logout is icon-only, retaining its accessible name");
  const header = logout.locator("..").locator("..");
  assert.equal(await header.getByText(company, { exact: true }).count(), 1, "Brand belongs to top header");
  assert.equal(await button(page, "Actualizar asignaciones").count(), 1, "Exactly one assignments refresh");
  assert.equal(await button(header, "Actualizar asignaciones").count(), 1, "Refresh belongs to the main header");
  const actionBoxes = [];
  for (const label of ["Actualizar asignaciones", "Ver mi perfil y sucursal", "Cerrar sesión"]) {
    const action = button(header, label);
    const box = await action.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, `${label} target >=44x44`);
    assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width, "Header action fits viewport");
    actionBoxes.push(box);
  }
  assert.ok(brandBox.x + brandBox.width <= actionBoxes[0].x, "Company does not overlap refresh");
  for (let index = 1; index < actionBoxes.length; index++) {
    assert.ok(actionBoxes[index - 1].x + actionBoxes[index - 1].width <= actionBoxes[index].x, "Header actions never overlap");
    assert.equal(actionBoxes[index].y + actionBoxes[index].height / 2, actionBoxes[0].y + actionBoxes[0].height / 2, "Header actions stay centered on one row");
  }
  assert.equal(await button(page, "Actualizar horario").count(), 0);
  assert.doesNotMatch(await page.locator("body").innerText(), /Hoy y pendientes anteriores|Día seleccionado y pendientes anteriores|Agenda semanal y pendientes anteriores/);
  assert.equal(await page.getByText("Heavytech SpA", { exact: true }).count(), 0, "Branch does not occupy a visual row below the header");
  const headerBox = await header.boundingBox();
  const barBox = await page.getByTestId("connection-status-bar").boundingBox();
  assert.ok(barBox.y - (headerBox.y + headerBox.height) <= 4, "Only compact padding separates header and connection strip");
  assert.doesNotMatch(await page.locator("body").innerText(), /\bFIELD\b|Entorno local/);
  assert.ok(brandBox.x >= 0 && brandBox.x + brandBox.width <= logoutBox.x, "Brand never overlaps logout");
  if (company !== "Heavytech") assert.ok(await brand.evaluate((element) => element.scrollWidth > element.clientWidth && getComputedStyle(element).textOverflow === "ellipsis"), "Long company truncates with ellipsis");
  const connection = await statusButton(page).boundingBox();
  const heading = await page.getByRole("heading", { name: "Mi jornada", exact: true }).boundingBox();
  const tabs = await page.getByRole("tab", { name: "Mi jornada", exact: true }).boundingBox();
  assert.ok(connection.y + connection.height <= heading.y && connection.y + connection.height < tabs.y, "Connection is above dashboard heading and bottom navigation");
}

async function refreshKeepsState(page, pausedRequests) {
  const query = page.getByRole("textbox", { name: "Buscar tareas", exact: true });
  await query.fill("hidráulico");
  await button(page, "Pendientes").click();
  const filterBackground = await button(page, "Pendientes").evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(filterBackground, await button(page, "Todos").evaluate((element) => getComputedStyle(element).backgroundColor), "Pending filter is selected");
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  for (const [pathname, trigger, reason] of [
    ["/api/assignments", "Actualizar asignaciones", "loading"],
    ["/api/auth/me", "Sincronizar ahora", "busy"],
  ]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    pausedRequests.pathname = pathname;
    pausedRequests.gate = gate;
    try {
      await page.waitForFunction(() => document.querySelector('[aria-label="Actualizar asignaciones"]')?.getAttribute("aria-disabled") !== "true");
      const incoming = page.waitForRequest((request) => new URL(request.url()).origin === gateway && new URL(request.url()).pathname === pathname);
      await button(page, trigger).click();
      await incoming;
      await page.waitForFunction(() => document.querySelector('[aria-label="Actualizar asignaciones"]')?.getAttribute("aria-disabled") === "true");
      assert.equal(await button(page, "Actualizar asignaciones").isDisabled(), true, `Refresh disabled while ${reason}`);
    } finally {
      pausedRequests.pathname = null;
      release();
    }
    await page.waitForFunction(() => document.querySelector('[aria-label="Actualizar asignaciones"]')?.getAttribute("aria-disabled") !== "true");
    assert.equal(await query.inputValue(), "hidráulico", "Refresh preserves search");
    assert.equal(await button(page, "Pendientes").evaluate((element) => getComputedStyle(element).backgroundColor), filterBackground, "Refresh preserves status filter");
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, "Refresh does not reload the web document");
  }
  await query.fill("");
  await button(page, "Todos").click();
}

async function offlineReturn(page, label) {
  await statusAccess(page);
  await statusButton(page).click();
  await button(page, "Preparar este período").waitFor();
  await button(page, "Volver").click();
  await button(page, "Preparar este período").waitFor({ state: "hidden" });
  await statusAccess(page);
  await capture(page, label);
}

async function cancelLogout(page) {
  const before = (await fixtureState()).logoutCalls;
  await button(page, "Cerrar sesión").click();
  await button(page, "Comprobar pendientes y cerrar sesión").waitFor();
  await button(page, "Seguir trabajando").click();
  await button(page, "Comprobar pendientes y cerrar sesión").waitFor({ state: "hidden" });
  await statusAccess(page);
  assert.equal((await fixtureState()).logoutCalls, before, "Cancelling never logs out");
}

async function routes(page, label) {
  await button(page, /^TR-.*Inspección del sistema hidráulico/).click();
  await page.getByRole("tab", { name: "Checklist", exact: true }).waitFor();
  assert.equal(await button(page, "Actualizar asignaciones").count(), 0, "No main-header refresh in work detail");
  await offlineReturn(page, `${label}-work-return`);
  await button(page, "Volver conservando el borrador").click();
  await page.getByRole("tab", { name: /^OTs,/ }).click();
  await button(page, /^Ver trabajos \(/).first().click();
  await button(page, "Volver a mis asignaciones").waitFor();
  assert.equal(await button(page, "Actualizar asignaciones").count(), 0, "No main-header refresh in order detail");
  await offlineReturn(page, `${label}-order-return`);
  await button(page, "Volver a mis asignaciones").click();
  await button(page, "Crear trabajo, mantenimiento o tiempo no productivo").click();
  await button(page, "Nuevo trabajo").click();
  await page.getByRole("textbox", { name: "Título *", exact: true }).waitFor();
  assert.equal(await button(page, "Actualizar asignaciones").count(), 0, "No assignments refresh in creation");
  await offlineReturn(page, `${label}-creation-return`);
  await button(page, "Volver conservando borrador").click();
  const saveDraft = button(page, "Guardar borrador y volver");
  if (await saveDraft.isVisible()) await saveDraft.click();
  await button(page, "Ver mi perfil y sucursal").click();
  await page.getByText("Tu espacio de trabajo en terreno", { exact: true }).waitFor();
  assert.equal(await button(page, "Actualizar asignaciones").count(), 0, "No assignments refresh in profile");
  await offlineReturn(page, `${label}-profile-return`);
  await page.getByRole("tab", { name: "Avisos", exact: true }).click();
  assert.equal(await button(page, "Actualizar asignaciones").count(), 0, "No assignments refresh in notifications");
  await page.getByRole("tab", { name: "Mi jornada", exact: true }).click();
  await mainHeader(page, "Heavytech");
  await capture(page, `${label}-dashboard-return`);
}

async function unreachable(page, label) {
  await control(true);
  try {
    assert.equal(await page.evaluate(() => navigator.onLine), true, "Browser link stays online");
    await button(page, "Sincronizar ahora").click();
    await button(page, /^Sin acceso a Qualitzer · 0 pendientes$/).waitFor();
    assert.equal(await button(page, /^Conectado a Qualitzer/).count(), 0, "Failed fixture never claims ready");
    assert.equal(await button(page, /^Sin red/).count(), 0, "Unreachable service is not falsely called no network");
    await statusButton(page).click();
    await button(page, "Preparar este período").waitFor();
    await button(page, "Volver").click();
    await button(page, "Preparar este período").waitFor({ state: "hidden" });
    await noOverflow(page);
    await capture(page, `${label}-unreachable`);
  } finally { await control(false); }
  await button(page, "Sincronizar ahora").click();
  await statusAccess(page);
  await capture(page, `${label}-reconnected`);
}

async function scenario(browser, width, company = "Heavytech") {
  const label = `${width}${company === "Heavytech" ? "" : "-long-name"}`;
  const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 900 : 800 }, locale: "es-CL", serviceWorkers: "block" });
  const violations = [];
  let blocked = 0;
  const errors = [];
  const pausedRequests = { pathname: null, gate: Promise.resolve() };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (![metro, gateway].includes(url.origin)) { blocked++; return route.abort("blockedbyclient"); }
    if (url.origin === metro && url.pathname === "/__header_fixture_seed") return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Isolated header fixture seed</title>" });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !(url.origin === gateway && url.pathname === "/api/auth/login/start" && request.method() === "POST")) {
      violations.push("Unexpected write blocked"); return route.abort("blockedbyclient");
    }
    if (url.origin !== gateway) return route.continue();
    if (url.pathname === pausedRequests.pathname) await pausedRequests.gate;
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
      assert.ok(response.status() < 300 || response.status() >= 400, "Fixture redirects are forbidden");
      if (!(response.headers()["content-type"] ?? "").includes("application/json")) return route.fulfill({ response });
      const json = await response.json();
      if (json.tenant?.id === "offline-smoke") json.tenant.name = company;
      if (Array.isArray(json.accessBranchs)) json.accessBranchs = json.accessBranchs.map((branch) => ({ ...branch, name: "Heavytech SpA" }));
      return route.fulfill({ response, json });
    } catch { return route.abort("failed"); }
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (new URL(socket.url()).origin === "ws://localhost:8081") socket.connectToServer();
    else { blocked++; socket.close(); }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", () => errors.push("Browser pageerror"));
  try {
    await page.goto(metro);
    await button(page, "Conexión avanzada. Configurar pasarela móvil").click();
    await page.getByRole("textbox", { name: "URL de la pasarela", exact: true }).fill(gateway);
    await page.getByRole("textbox", { name: "Correo o usuario", exact: true }).fill("offline-fixture");
    await page.getByRole("textbox", { name: "Contraseña", exact: true }).fill("fictional-offline-only");
    await button(page, "Iniciar sesión").click();
    await button(page, /^Conectado a Qualitzer · 0 pendientes$/).waitFor();
    await button(page, /^TR-.*Inspección del sistema hidráulico/).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await capture(page, `${label}-ready`);
    await mainHeader(page, company);
    await refreshKeepsState(page, pausedRequests);
    await cancelLogout(page);
    await offlineReturn(page, `${label}-main-return`);
    if (company === "Heavytech") await routes(page, label);
    if (width === 360 && company === "Heavytech") await unreachable(page, label);
    await pendingReview(page, label);
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    results.push({ label, passed: true, blockedRequests: blocked });
    console.log(`PASS ${label}: header, status, cancellation and return paths`);
  } catch (error) {
    await capture(page, `${label}-failure`).catch(() => undefined);
    results.push({ label, passed: false, error: error.message.split("Call log:")[0], stack: error.stack, violations, pageErrors: errors.length });
    console.error(`FAIL ${label}: ${error.message.split("Call log:")[0]}`);
  } finally { await context.close(); }
}

async function main() {
  assert.equal(Number(process.versions.node.split(".")[0]), 22, "Use project-local Node 22");
  const fixture = await startFixture();
  let browser;
  try {
    assert.equal((await fixtureState()).logoutCalls, 0);
    browser = await playwright.chromium.launch({ channel: "msedge", headless: true });
    for (const width of [360, 320, 390, 1280]) await scenario(browser, width);
    await scenario(browser, 320, "Heavytech Servicios Industriales y Mantenimiento de Equipos de Larga Duración");
    const state = await fixtureState();
    assert.deepEqual(state.effects, { creations: 0, comments: 0, answers: 0, documents: 0 });
    assert.equal(state.logoutCalls, 0);
    assert.deepEqual(state.requests.filter((request) => !["GET", "HEAD", "OPTIONS"].includes(request.method) && request.path !== "/api/auth/login/start"), [], "Only fictional login may write");
    results.push({ label: "fixture-no-business-writes-or-logout", passed: true });
    assert.ok(results.every((result) => result.passed), "Header layout scenarios failed; runtime left unchanged");
  } finally {
    try { if (browser) await browser.close(); }
    finally {
      await stopFixture(fixture);
      writeFileSync(path.join(artifacts, "results.json"), JSON.stringify(results, null, 2));
      writeFileSync(path.join(artifacts, "accessibility-findings.json"), JSON.stringify([...accessibilityFindings], null, 2));
      console.log(`ARTIFACTS ${artifacts}`);
      console.log("CLEANUP own fixture stopped; Metro 8081 and gateway 8787 untouched");
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });