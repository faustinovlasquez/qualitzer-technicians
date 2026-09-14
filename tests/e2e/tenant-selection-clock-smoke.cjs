const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const metro = process.env.TENANT_CLOCK_METRO_URL ?? "http://localhost:8081";
const gateway = "https://tenant-clock.example.com/mobile";
const output = mkdtempSync(path.join(tmpdir(), "qualitzer-tenant-clock-e2e-"));
const report = { startedAt: new Date().toISOString(), output, results: [], physicalPhoneTested: false };
const tenants = Array.from({ length: 10 }, (_, index) => ({ id: `clock-fixture-${index + 1}`, name: `Empresa ficticia ${index + 1}`, portalOrigin: `https://clock-${index + 1}.example.test`, environment: "production" }));
const challenge = `qzc_${"c".repeat(43)}`;
const button = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" });
const persist = () => writeFileSync(path.join(output, "summary.json"), JSON.stringify(report, null, 2));

async function scenario(browser, width, kind, offset) {
  const result = { width, kind, offsetHours: offset / 3600000, passed: false, starts: 0, selectedTenantIds: [], writes: [], blocked: [], pageErrors: [], consoleErrors: [] };
  report.results.push(result);
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 844 }, deviceScaleFactor: 1, serviceWorkers: "block", timezoneId: offset > 0 ? "Pacific/Kiritimati" : "America/Los_Angeles" });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") result.consoleErrors.push(message.text()); });
  await context.addInitScript(({ offset, advance }) => {
    const NativeDate = Date;
    const nativeNow = performance.now.bind(performance);
    const anchorMono = nativeNow();
    const anchorWall = NativeDate.now();
    class PhoneDate extends NativeDate {
      constructor(...args) { if (args.length) super(...args); else super(PhoneDate.now()); }
      static now() { return anchorWall + offset + nativeNow() - anchorMono; }
    }
    globalThis.Date = PhoneDate;
    let elapsed = 0;
    if (advance) Object.defineProperty(performance, "now", { configurable: true, value: () => nativeNow() + elapsed });
    globalThis.__clockSmoke = {
      responses: [],
      advance: (ms) => { if (!advance || ms < 0) throw new Error("INVALID_TEST_ADVANCE"); elapsed += ms; },
      read: () => ({ wall: Date.now(), constructed: new Date().getTime(), realWall: NativeDate.now(), mono: performance.now(), nativeMono: nativeNow(), offset }),
    };
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.url.startsWith("https://tenant-clock.example.com/mobile/")) globalThis.__clockSmoke.responses.push({ path: new URL(response.url).pathname.replace(/^\/mobile/, ""), date: response.headers.get("Date"), type: response.type, status: response.status });
      return response;
    };
  }, { offset, advance: kind === "elapsed" });
  await context.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    if (url.origin === metro.replace(/^http/, "ws")) socket.connectToServer();
    else { result.blocked.push({ method: "WS", origin: url.origin, path: url.pathname }); socket.close(); }
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace(/^\/mobile(?=\/)/, "");
    const method = request.method();
    if (url.origin === metro && ["GET", "HEAD"].includes(method)) return route.continue();
    if (!request.url().startsWith(`${gateway}/`)) {
      result.blocked.push({ method, origin: url.origin, path: url.pathname });
      return route.abort("blockedbyclient");
    }
    const headers = { "content-type": "application/json", "access-control-allow-origin": metro, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type, X-Qualitzer-Session, X-Qualitzer-Tenant", "cache-control": "no-store" };
    if (kind !== "unexposed") headers["access-control-expose-headers"] = "Date";
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers, body: "" });
    if (!["GET", "HEAD"].includes(method)) result.writes.push({ origin: url.origin, path: url.pathname, method });
    if (method === "POST" && apiPath === "/api/auth/login/start") {
      const body = request.postDataJSON();
      assert.deepEqual(body, { username: "clock-fixture", password: "fictional-clock-only", remember: true });
      assert.equal(request.headers().authorization, undefined);
      assert.equal(request.headers().cookie, undefined);
      result.starts++;
      const serverTime = Date.now() - (kind === "expired" ? 86400000 : 0);
      result.serverDate = new Date(serverTime).toUTCString();
      result.expiresAt = new Date(serverTime + (kind === "expired" ? -5000 : 120000)).toISOString();
      if (kind !== "missing") headers.Date = result.serverDate;
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ nextStep: "SELECT_TENANT", challenge, expiresAt: result.expiresAt, tenants }) });
    }
    if (method === "POST" && apiPath === "/api/auth/login/complete") {
      const body = request.postDataJSON();
      assert.deepEqual(body, { challenge, tenantId: tenants[0].id });
      assert.equal(request.headers().authorization, undefined);
      assert.equal(request.headers().cookie, undefined);
      result.selectedTenantIds.push(body.tenantId);
      return route.fulfill({ status: 401, headers, body: JSON.stringify({ error: "INVALID_LOGIN_CHALLENGE" }) });
    }
    if (method === "GET" && apiPath === "/api/development/connection") return route.fulfill({ status: 200, headers, body: JSON.stringify({ available: false }) });
    if (method === "GET" && apiPath === "/health") return route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true, backendReachable: true }) });
    result.blocked.push({ method, origin: url.origin, path: url.pathname });
    return route.abort("blockedbyclient");
  });
  try {
    await page.goto(metro, { waitUntil: "domcontentloaded", timeout: 120000 });
    assert.equal(await page.getByRole("textbox", { name: "URL de la pasarela", exact: true }).count(), 0, "Standalone connection must not be editable");
    await page.getByRole("textbox", { name: "Correo o usuario", exact: true }).fill("clock-fixture");
    await page.getByRole("textbox", { name: "Contraseña", exact: true }).fill("fictional-clock-only");
    await button(page, "Iniciar sesión").click();
    await page.getByRole("heading", { name: "Elige la empresa para esta sesión", exact: true }).waitFor();
    result.clock = await page.evaluate(() => globalThis.__clockSmoke.read());
    assert.ok(Math.abs(result.clock.wall - result.clock.realWall - offset) < 100, "Anchored wall clock has the requested skew");
    assert.ok(Math.abs(result.clock.constructed - result.clock.wall) < 10, "new Date and Date.now agree");
    assert.ok(Math.abs(result.clock.mono - result.clock.nativeMono) < 10, "Monotonic time is initially unaffected");
    result.headers = await page.evaluate(() => globalThis.__clockSmoke.responses);
    const startHeaders = result.headers.find((item) => item.path === "/api/auth/login/start");
    assert.ok(startHeaders, "Actual browser fetch observed login start response");
    assert.equal(startHeaders.type, "cors");
    assert.equal(startHeaders.date, ["missing", "unexposed"].includes(kind) ? null : result.serverDate, "Date availability is verified from browser JS, not Playwright's bypass headers");
    const options = button(page, /^Entrar a Empresa ficticia /);
    const back = button(page, "Volver al acceso");
    await back.waitFor();
    if (kind === "expired") {
      await page.getByText("La selección de empresa venció. Vuelve al acceso para iniciar sesión de nuevo.", { exact: true }).waitFor();
      assert.equal(await options.count(), 0);
    } else {
      assert.equal(await options.count(), 10);
      assert.equal(await options.first().isEnabled(), true);
      result.selectionText = await page.locator("body").innerText();
      assert.doesNotMatch(result.selectionText, /selección de empresa venció|No se pudo validar el tiempo|Se agotó el tiempo local/);
      assert.match(result.selectionText, ["missing", "unexposed"].includes(kind) ? /El servidor validará la vigencia al elegir la empresa/ : /Tiempo estimado para elegir: \d+ segundos/);
      const backBox = await back.boundingBox();
      const optionBox = await options.first().boundingBox();
      assert.ok(backBox && optionBox && backBox.y + backBox.height <= optionBox.y, "Back action precedes tenant options");
    }
    if (kind === "elapsed") {
      await page.evaluate(() => globalThis.__clockSmoke.advance(121000));
      await page.getByText("La selección de empresa venció. Vuelve al acceso para iniciar sesión de nuevo.", { exact: true }).waitFor();
      assert.equal(await options.count(), 0);
    }
    await back.scrollIntoViewIfNeeded();
    const box = await back.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= page.viewportSize().height && box.height >= 44);
    result.selectionScreenshot = path.join(output, `${width}-${kind}-selection.png`);
    await page.screenshot({ path: result.selectionScreenshot });
    result.finalSelectionText = await page.locator("body").innerText();
    if (["expired", "elapsed"].includes(kind)) {
      assert.deepEqual(result.selectedTenantIds, []);
      await back.click();
    } else {
      await options.first().click();
      await page.getByText(/La selección de empresa no es válida o ya fue utilizada/).waitFor();
      assert.deepEqual(result.selectedTenantIds, [tenants[0].id]);
    }
    await button(page, "Iniciar sesión").waitFor();
    result.returnText = await page.locator("body").innerText();
    if (!["expired", "elapsed"].includes(kind)) {
      assert.match(result.returnText, /Vuelve al acceso con tu usuario y contraseña; esta selección no se reutilizará/);
      assert.doesNotMatch(result.returnText, /selección de empresa venció|Se agotó el tiempo local/);
    }
    assert.equal(await options.count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "Contraseña", exact: true }).inputValue(), "");
    result.storageKeys = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    assert.ok(![...result.storageKeys.local, ...result.storageKeys.session].some((key) => /qualitzer\.mobile\.session/.test(key)));
    assert.deepEqual(await context.cookies(), []);
    assert.equal(result.starts, 1);
    assert.equal(result.writes.length, ["expired", "elapsed"].includes(kind) ? 1 : 2);
    assert.ok(result.writes.every((item) => item.origin === new URL(gateway).origin && /^\/mobile\/api\/auth\/login\/(start|complete)$/.test(item.path)));
    assert.deepEqual(result.pageErrors, []);
    assert.ok(!result.blocked.some((item) => !["GET", "HEAD", "WS"].includes(item.method)), "No real network writes even attempted");
    result.passed = true;
  } catch (error) {
    result.error = error.stack;
    result.failureText = await page.locator("body").innerText().catch(() => "Unavailable");
    await page.screenshot({ path: path.join(output, `${width}-${kind}-failure.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); persist(); }
}

(async () => {
  console.log(`REPORT_DIR=${output}`);
  const probe = await fetch(`${metro}/status`, { redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.equal(probe.status, 200, "Existing Metro must already be running; never restart it");
  assert.match(await probe.text(), /packager-status:running/);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    report.browser = browser.version();
    for (const width of [320, 390]) for (const [kind, hours] of [["ahead", 24], ["behind", -24], ["expired", -24], ["missing", 24], ["unexposed", 24], ["elapsed", 24]]) {
      await scenario(browser, width, kind, hours * 3600000);
      console.log(`PASS ${width} ${kind}`);
    }
    report.passed = report.results.filter((item) => item.passed).length;
    report.completedAt = new Date().toISOString();
  } finally { await browser.close(); persist(); }
  console.log(`TENANT_CLOCK_SMOKE_PASS ${report.passed}/12 ${path.join(output, "summary.json")}`);
})().catch((error) => { report.error = error.stack; persist(); console.error(error); process.exitCode = 1; });