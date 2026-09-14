const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const { build } = require(require.resolve("esbuild", { paths: [root] }));
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = path.join(root, "artifacts/logs/notification-ui", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = {
  passed: false, scope: "Real NotificationCenterScreen, NotificationSettingsScreen, NotificationStatusCard, ProfileScreen, presentation helpers, MobileNotificationClient and PrivateModal on RN Web. Memory NotificationApi and OS adapter only; no account, HTTP API, Expo delivery, native permissions or App integration.",
  textScaling: "Browser text-only font/line-height stress at 100% and 200%, including modal portals; not native Dynamic Type.",
  tests: [], screenshots: [], pageErrors: [], blockedRequests: [], serverRequests: [], visualObservations: [],
  cleanup: { browserClosed: false, serverClosed: false },
};
const sources = ["src/screens/notifications/NotificationCenterScreen.tsx", "src/screens/notifications/NotificationSettingsScreen.tsx", "src/screens/notifications/NotificationStatusCard.tsx",
  "src/screens/notifications/notificationPresentation.ts", "src/screens/ProfileScreen.tsx", "src/notifications/MobileNotificationClient.ts", "src/security/DeviceSecurityContext.tsx",
  "tests/e2e/notification-center-fixture.tsx", "tests/e2e/notification-center-smoke.cjs"];
const hashes = () => Object.fromEntries(sources.map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));

async function main() {
  let browser;
  let server;
  let page;
  try {
    report.sourceHashes = hashes();
    process.chdir(root);
    const ts = require(require.resolve("typescript", { paths: [root] }));
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const program = ts.createProgram([path.join(root, "tests/e2e/notification-center-fixture.tsx"), ...parsed.fileNames.filter(file => file.endsWith(".d.ts"))], { ...parsed.options, noEmit: true, incremental: false });
    report.scopedTypeDiagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => ({
      file: diagnostic.file ? path.relative(root, diagnostic.file.fileName).replace(/\\/g, "/") : null,
      code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
    assert.deepEqual(report.scopedTypeDiagnostics, [], "Fixture and its imported graph must typecheck without any casts to generic objects");
    const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/e2e/notification-center-fixture.tsx"], bundle: true, write: false, metafile: true,
      platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
      alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl", ".ttf": "dataurl", ".js": "jsx" },
      resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
      plugins: [{ name: "local-icon-font-only", setup(builder) {
        builder.onResolve({ filter: /^@expo\/vector-icons$/ }, () => ({ path: "icons", namespace: "fixture" }));
        builder.onResolve({ filter: /^expo-font$/ }, () => ({ path: "font", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: root, contents: args.path === "icons"
          ? 'export {default as Ionicons} from "@expo/vector-icons/build/Ionicons";'
          : 'const loaded = new Set(); export const isLoaded = name => loaded.has(name); export async function loadAsync(fonts) { for (const [name, source] of Object.entries(fonts)) { if (loaded.has(name)) continue; const face = new FontFace(name, `url(${source})`); await face.load(); document.fonts.add(face); loaded.add(name); } }' }));
      } }],
    });
    report.bundleInputs = Object.keys(bundle.metafile.inputs);
    for (const file of sources.slice(0, 7)) assert.ok(report.bundleInputs.includes(file), `Real source absent: ${file}`);
    assert.ok(!report.bundleInputs.some(file => /(^|\/)App\.tsx$|notificationAdapter|deviceSecurityAdapter|HttpTechnicianRepository|sessionStorage|expo-notifications|expo-secure-store|\.env$/.test(file)), "Forbidden runtime boundary in fixture");
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
    server = http.createServer((request, response) => {
      report.serverRequests.push({ method: request.method, path: request.url });
      if (request.method !== "GET" || !["/", "/fixture.js"].includes(request.url)) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'");
      response.setHeader("Content-Type", request.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
      response.end(request.url === "/" ? html : bundle.outputFiles[0].text);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking"] });
    report.browserVersion = browser.version();
    const context = await browser.newContext({ serviceWorkers: "block", locale: "es-CL", timezoneId: "UTC" });
    await context.route("**/*", route => {
      const request = route.request();
      if (request.method() === "GET" && [origin + "/", origin + "/fixture.js"].includes(request.url())) return route.continue();
      report.blockedRequests.push({ type: request.resourceType(), method: request.method() });
      return route.abort();
    });
    await context.routeWebSocket("**/*", socket => { report.blockedRequests.push({ type: "websocket" }); socket.close(); });
    page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on("pageerror", error => report.pageErrors.push(error.message));
    const button = name => page.getByRole("button", { name, exact: true });
    const heading = name => page.getByRole("heading", { name, exact: true });
    const toggle = name => page.getByRole("switch", { name, exact: true });
    const metrics = () => page.evaluate(() => window.notificationCenterFixture.metrics());
    const settle = async (inboxOnly = false) => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(inboxOnly => {
        const state = window.notificationCenterFixture.metrics().state;
        return state.ready && !state.inboxBusy && (inboxOnly || !state.busy);
      }, inboxOnly);
    };
    const configure = value => page.evaluate(value => window.notificationCenterFixture.configure(value), value);
    const fresh = async (scenario = "populated", screen = "center") => {
      await page.evaluate(({ scenario, screen }) => window.notificationCenterFixture.render(scenario, screen), { scenario, screen });
      if (scenario === "loading") await page.getByLabel("Cargando notificaciones", { exact: true }).waitFor();
      else await settle(scenario === "token-pending");
    };
    async function screenshot(name) {
      await page.evaluate(() => document.fonts.ready);
      const filename = name.replace(/[^a-zA-Z0-9-]/g, "-") + ".png";
      await page.screenshot({ path: path.join(output, filename), animations: "disabled" });
      report.screenshots.push(filename);
    }
    async function check(name, run) {
      try { await run(); assert.equal((await metrics()).testCalls, 0, "Must never simulate sending a test notification"); report.tests.push({ name, passed: true }); }
      catch (error) { report.tests.push({ name, passed: false, error: error.message }); await screenshot(name + "-failure").catch(() => {}); }
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    }
    async function layout() {
      const result = await page.evaluate(() => {
        const rect = document.getElementById("root").getBoundingClientRect();
        const overflow = [...document.querySelectorAll("body *")].filter(element => {
          const box = element.getBoundingClientRect();
          if (element.closest('[aria-hidden="true"]') || !box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight) return false;
          return box.left < -1 || box.right > innerWidth + 1;
        }).map(element => ({ tag: element.tagName, role: element.getAttribute("role"), label: element.getAttribute("aria-label"), text: element.textContent.slice(0, 60) }));
        return { width: innerWidth, height: innerHeight, root: { width: rect.width, height: rect.height }, scrollWidth: document.documentElement.scrollWidth, overflow };
      });
      assert.equal(result.root.width, result.width);
      assert.equal(result.root.height, result.height);
      assert.ok(result.scrollWidth <= result.width);
      assert.deepEqual(result.overflow, [], JSON.stringify(result));
    }
    async function reachable(locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, JSON.stringify(box));
      assert.ok(box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1 && box.y >= -1 && box.y + box.height <= 641, JSON.stringify(box));
    }
    async function counts(unread, total) {
      await settle();
      await page.getByText(`${unread == null ? "…" : unread} sin leer · ${total == null ? "…" : total} en total`, { exact: true }).waitFor();
      const observed = await metrics();
      assert.equal(observed.state.unreadCount, unread);
      assert.equal(observed.state.total, total);
      if (unread !== null) assert.equal(observed.badges.at(-1), unread);
      else assert.deepEqual(observed.badges, [], "Unknown counts must never become a native badge from a loaded subset");
    }
    for (const width of [320, 360, 390]) for (const scale of [1, 2]) {
      const label = `${width}x640-text${scale * 100}`;
      await page.setViewportSize({ width, height: 640 });
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.notificationCenterFixture));
      await page.evaluate(factor => {
        const scaled = new WeakSet();
        const apply = () => {
          for (const element of document.querySelectorAll("body *")) {
            if (scaled.has(element) || element.matches("script,style") || (!element.matches("input,textarea") && ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))) continue;
            const style = getComputedStyle(element);
            if (style.fontFamily.toLowerCase().includes("ionicons")) continue;
            scaled.add(element);
            element.style.fontSize = `${parseFloat(style.fontSize) * factor}px`;
            if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * factor}px`;
          }
        };
        new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
        apply();
      }, scale);

      await check(`${label}-pagination-global-badge-85`, async () => {
        await fresh(); await counts(60, 85);
        assert.equal((await metrics()).state.inbox.length, 25);
        const titleLayout = await heading("Avisos").evaluate(element => {
          const style = getComputedStyle(element);
          const range = document.createRange();
          range.selectNodeContents(element);
          return { fontSize: parseFloat(style.fontSize), lines: range.getClientRects().length };
        });
        assert.ok(titleLayout.fontSize >= 26 * scale);
        assert.equal(titleLayout.lines, 1, "Avisos must stay on one line without reducing text scaling");
        await layout(); await screenshot(label + "-center-top");
        const kindColors = [];
        for (const [title, iconColor, iconBackground] of [
          ["Nueva asignación", "rgb(0, 126, 128)", "rgb(230, 244, 242)"],
          ["Cronómetro activo", "rgb(161, 92, 7)", "rgb(255, 243, 217)"],
          ["Notificación de prueba", "rgb(49, 93, 155)", "rgb(234, 240, 250)"],
        ]) {
          const row = page.getByRole("button", { name: new RegExp(`^${title}\\. Sin leer\\.`) }).first();
          const visual = await row.evaluate(element => ({
            background: getComputedStyle(element.parentElement).backgroundColor,
            iconColor: getComputedStyle(element.firstElementChild.firstElementChild).color,
            iconBackground: getComputedStyle(element.firstElementChild).backgroundColor,
            dots: [...element.querySelectorAll("div")].filter(child => { const box = child.getBoundingClientRect(); return box.width === 8 && box.height === 8 && getComputedStyle(child).borderRadius === "4px"; }).length,
          }));
          assert.equal(visual.dots, 1, `${title} needs one unread dot`);
          assert.notEqual(visual.iconColor, "rgb(255, 255, 255)");
          assert.notEqual(visual.iconColor, "rgba(0, 0, 0, 0)");
          assert.equal(visual.iconColor, iconColor);
          assert.equal(visual.iconBackground, iconBackground);
          kindColors.push({ title, ...visual });
        }
        assert.equal(new Set(kindColors.map(kind => kind.iconColor)).size, 3);
        report.visualObservations.push({ viewport: label, kindColors, distinctKindColors: new Set(kindColors.map(kind => kind.iconColor)).size });
        for (const expected of [50, 75, 85]) {
          await reachable(button("Cargar más notificaciones"));
          await button("Cargar más notificaciones").click(); await settle();
          assert.equal((await metrics()).state.inbox.length, expected); await counts(60, 85);
        }
        assert.equal(await button("Cargar más notificaciones").count(), 0);
        assert.deepEqual((await metrics()).inboxCalls.filter(call => call.page > 1).map(call => call.page), [2, 3, 4]);
        assert.equal(new Set((await metrics()).state.inbox.map(item => item.id)).size, 85);
        const readCard = page.getByRole("button", { name: /^Nueva asignación\. Leída\./ }).first();
        await readCard.scrollIntoViewIfNeeded();
        const colors = await readCard.evaluate(element => ({ card: getComputedStyle(element.parentElement).backgroundColor,
          icon: getComputedStyle(element.firstElementChild).backgroundColor,
          dots: [...element.querySelectorAll("div")].filter(child => { const box = child.getBoundingClientRect(); return box.width === 8 && box.height === 8 && getComputedStyle(child).borderRadius === "4px"; }).length }));
        assert.equal(colors.card, "rgb(255, 255, 255)");
        assert.notEqual(colors.icon, colors.card);
        assert.equal(colors.dots, 0, "Read cards must not retain an unread dot");
        report.visualObservations.push({ viewport: label, readCard: colors });
        await layout(); await screenshot(label + "-read-white-card");
      });
      await check(`${label}-server-filter-read-open-and-delivery-detail`, async () => {
        await fresh();
        await page.getByRole("tab", { name: "No leídas", exact: true }).click(); await counts(60, 60);
        assert.equal((await metrics()).inboxCalls.at(-1).unreadOnly, true);
        assert.equal(await page.getByRole("tab", { name: "No leídas", exact: true }).getAttribute("aria-selected"), "true");
        await button("Marcar como leída: Nueva asignación").first().click(); await counts(59, 59);
        assert.equal((await metrics()).reads.length, 1);
        await page.getByRole("tab", { name: "Todas", exact: true }).click(); await counts(59, 85);
        assert.equal((await metrics()).inboxCalls.at(-1).unreadOnly, false);
        await button("Detalles de Cronómetro activo").first().click();
        await page.getByText("Aceptado por el servicio de envío", { exact: true }).waitFor();
        await page.getByText("Este estado no confirma que el teléfono haya mostrado el aviso ni que lo hayas leído.", { exact: true }).scrollIntoViewIfNeeded();
        await layout(); await screenshot(label + "-delivery-not-read");
        await page.getByRole("button", { name: /^Cronómetro activo\. Sin leer\./ }).first().click(); await counts(58, 85);
        assert.equal((await metrics()).opened.length, 1);
        assert.equal((await metrics()).reads.length, 2);
      });
      await check(`${label}-read-failure-keeps-unread-row`, async () => {
        await fresh(); await configure({ failRead: true });
        await button("Marcar como leída: Nueva asignación").first().click(); await settle();
        assert.equal((await metrics()).state.inbox[0].readAt, null); await counts(60, 85);
        assert.equal((await metrics()).state.error, null);
        assert.equal((await metrics()).state.inboxError, "MOBILE_PUSH_FIXTURE_READ_FAILED");
        await page.getByRole("alert").waitFor(); await screenshot(label + "-read-failed");
      });
      await check(`${label}-delete-cancel-failure-busy-confirm-private-lock`, async () => {
        await fresh();
        const firstId = (await metrics()).state.inbox[0].id;
        await button("Eliminar: Nueva asignación").first().click();
        await heading("¿Eliminar esta notificación?").waitFor();
        await reachable(button("Cancelar")); await button("Cancelar").click();
        await heading("¿Eliminar esta notificación?").waitFor({ state: "hidden" });
        assert.equal((await metrics()).deletes.length, 0);
        await button("Eliminar: Nueva asignación").first().click(); await configure({ failDelete: true });
        await button("Eliminar notificación").click(); await settle();
        assert.equal((await metrics()).state.inbox[0].id, firstId); assert.equal((await metrics()).rows, 85);
        await heading("¿Eliminar esta notificación?").waitFor();
        await layout(); await screenshot(label + "-delete-failure-keeps-row");
        await page.evaluate(() => window.notificationCenterFixture.lock(true));
        await heading("Fixture bloqueada").waitFor();
        await heading("¿Eliminar esta notificación?").waitFor({ state: "hidden" });
        assert.equal(await button("Eliminar notificación").count(), 0);
        await screenshot(label + "-private-modal-locked");
        assert.equal((await metrics()).deletes.length, 1);
        await page.evaluate(() => window.notificationCenterFixture.lock(false));
        await button("Cancelar").click(); await heading("¿Eliminar esta notificación?").waitFor({ state: "hidden" });
        await configure({ failDelete: false, holdDelete: true });
        await button("Eliminar: Nueva asignación").first().click(); await button("Eliminar notificación").click();
        await page.waitForFunction(() => window.notificationCenterFixture.metrics().deletes.length === 2);
        assert.equal((await metrics()).rows, 85);
        assert.equal(await button("Cancelar").isDisabled(), true);
        await page.evaluate(() => window.notificationCenterFixture.release("delete")); await settle();
        await heading("¿Eliminar esta notificación?").waitFor({ state: "hidden" }); await counts(59, 84);
        assert.ok(!(await metrics()).state.inbox.some(item => item.id === firstId));
      });
      await check(`${label}-loading-empty-error-old-api-no-false-zero`, async () => {
        await fresh("loading"); await layout(); await screenshot(label + "-loading");
        assert.equal(await page.getByText("Tu bandeja está al día", { exact: true }).count(), 0);
        await fresh("empty"); await page.getByText("Tu bandeja está al día", { exact: true }).waitFor(); await counts(0, 0);
        await screenshot(label + "-empty");
        await fresh("error"); await page.getByText("No pudimos actualizar la bandeja", { exact: true }).waitFor();
        assert.equal((await metrics()).state.total, null); await screenshot(label + "-inbox-error");
        await fresh("legacy"); await counts(null, null);
        assert.equal(await page.getByRole("button", { name: /^Eliminar:/ }).count(), 0);
        const calls = (await metrics()).inboxCalls.length;
        const unreadFilter = page.getByRole("tab", { name: "No leídas", exact: true });
        assert.equal(await unreadFilter.isDisabled(), false);
        assert.notEqual(await unreadFilter.getAttribute("aria-disabled"), "true");
        assert.equal(await page.getByRole("tab", { name: "Todas", exact: true }).isDisabled(), false);
        await unreadFilter.click(); await settle();
        assert.equal((await metrics()).state.unreadOnly, true);
        assert.equal((await metrics()).inboxCalls.length, calls);
        assert.equal((await metrics()).state.error, null);
        assert.equal((await metrics()).state.inboxError, null);
        await page.getByText("Para eliminar notificaciones, el servicio necesita una actualización.", { exact: true }).scrollIntoViewIfNeeded();
        await layout(); await screenshot(label + "-legacy-fallback");
      });
      await check(`${label}-legacy-87-raw-pages-local-subset-not-global`, async () => {
        await fresh("legacy");
        assert.equal((await metrics()).rows, 87);
        const firstIds = (await metrics()).state.inbox.map(item => item.id);
        assert.equal(firstIds.length, 25);
        await page.getByRole("tab", { name: "No leídas", exact: true }).click(); await counts(null, null);
        let observed = await metrics();
        assert.equal(observed.state.filterLocal, true);
        assert.equal(observed.state.canDelete, false);
        assert.equal(observed.state.page, 1);
        assert.equal(observed.state.hasMore, true);
        assert.deepEqual(observed.state.inbox, []);
        assert.deepEqual(observed.inboxCalls, [{ page: 1, unreadOnly: false }]);
        await page.getByText("No hay avisos sin leer entre los cargados", { exact: true }).waitFor();
        await page.getByText("Este filtro no confirma que toda la bandeja esté leída.", { exact: true }).waitFor();
        await page.getByText("Filtro sobre avisos cargados. Carga más para buscar otros avisos sin leer; el total global no está disponible.", { exact: true }).waitFor();
        assert.equal(await page.getByText("No tienes avisos sin leer", { exact: true }).count(), 0);
        assert.equal(await page.getByText("Tu bandeja está al día", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: /\. Leída\./ }).count(), 0);
        await reachable(button("Cargar más notificaciones")); await layout(); await screenshot(label + "-legacy-empty-loaded-subset-load-more");
        for (const [pageNumber, unread] of [[2, 25], [3, 50], [4, 62]]) {
          await button("Cargar más notificaciones").click(); await counts(null, null);
          observed = await metrics();
          assert.equal(observed.state.page, pageNumber);
          assert.equal(observed.state.inbox.length, unread);
          assert.ok(observed.state.inbox.every(item => item.readAt === null));
          assert.equal(observed.state.hasMore, pageNumber < 4);
          assert.equal(await page.getByRole("button", { name: /\. Leída\./ }).count(), 0);
        }
        const unreadIds = observed.state.inbox.map(item => item.id);
        assert.equal(new Set(unreadIds).size, 62);
        assert.equal(await button("Cargar más notificaciones").count(), 0);
        await page.getByRole("tab", { name: "Todas", exact: true }).click(); await counts(null, null);
        assert.deepEqual((await metrics()).state.inbox.map(item => item.id), [...firstIds, ...unreadIds]);
        assert.equal((await metrics()).state.page, 4);
        await page.getByRole("tab", { name: "No leídas", exact: true }).click(); await counts(null, null);
        assert.deepEqual((await metrics()).state.inbox.map(item => item.id), unreadIds);
        assert.deepEqual((await metrics()).inboxCalls, [1, 2, 3, 4].map(page => ({ page, unreadOnly: false })));
        await heading("Avisos").scrollIntoViewIfNeeded(); await layout(); await screenshot(label + "-legacy-62-loaded-unread-unknown-global");
        assert.equal(await page.getByRole("button", { name: /^Eliminar:/ }).count(), 0);
        assert.equal(await page.evaluate(id => window.notificationCenterFixture.deleteNotification(id), unreadIds[0]), false);
        await settle();
        assert.deepEqual((await metrics()).deletes, []);
        assert.equal((await metrics()).rows, 87);
        assert.equal((await metrics()).state.error, null);
        assert.equal((await metrics()).state.inboxError, "MOBILE_PUSH_INBOX_UPDATE_REQUIRED");
      });
      await check(`${label}-legacy-read-first-short-last-page-15-unread`, async () => {
        await fresh("legacy-read-first");
        await page.getByRole("tab", { name: "No leídas", exact: true }).click(); await counts(null, null);
        assert.equal((await metrics()).state.inbox.length, 0);
        await reachable(button("Cargar más notificaciones"));
        await button("Cargar más notificaciones").click(); await counts(null, null);
        const observed = await metrics();
        assert.equal(observed.state.inbox.length, 15);
        assert.equal(observed.state.page, 2);
        assert.equal(observed.state.hasMore, false);
        assert.ok(observed.state.inbox.every(item => item.readAt === null));
        assert.equal(await button("Cargar más notificaciones").count(), 0);
        await page.getByRole("tab", { name: "Todas", exact: true }).click(); await counts(null, null);
        assert.equal((await metrics()).state.inbox.length, 40);
        await page.getByRole("tab", { name: "No leídas", exact: true }).click(); await counts(null, null);
        assert.deepEqual((await metrics()).state.inbox, observed.state.inbox);
        assert.deepEqual((await metrics()).inboxCalls, [{ page: 1, unreadOnly: false }, { page: 2, unreadOnly: false }]);
        await layout(); await screenshot(label + "-legacy-short-final-page");
      });
      await check(`${label}-native-token-unresolved-does-not-block-inbox-ui`, async () => {
        await fresh("token-pending");
        try {
          await page.waitForFunction(() => window.notificationCenterFixture.metrics().tokenPending);
          const started = Date.now();
          const assertTokenPending = async () => {
            const observed = await metrics();
            assert.equal(observed.tokenPending, true);
            assert.equal(observed.tokenCalls, 1);
            assert.equal(observed.state.busy, true);
            assert.equal(observed.state.inboxBusy, false);
            assert.equal(observed.state.inboxError, null);
            assert.equal(observed.state.error, null);
            assert.deepEqual(observed.registrations, []);
            assert.equal(await page.getByLabel("Cargando notificaciones", { exact: true }).count(), 0);
            assert.equal(await page.getByRole("alert").count(), 0);
          };
          await assertTokenPending();
          for (const filter of ["No leídas", "Todas", "No leídas"]) {
            const tab = page.getByRole("tab", { name: filter, exact: true });
            assert.equal(await tab.isDisabled(), false);
            await tab.click(); await settle(true);
            assert.equal(await tab.getAttribute("aria-selected"), "true");
            const observed = await metrics();
            assert.equal(observed.state.unreadOnly, filter === "No leídas");
            assert.equal(observed.inboxCalls.at(-1).unreadOnly, filter === "No leídas");
            assert.equal(observed.state.total, filter === "No leídas" ? 60 : 85);
            await assertTokenPending();
          }
          await button("Marcar como leída: Nueva asignación").first().click(); await settle(true);
          assert.equal((await metrics()).state.unreadCount, 59);
          assert.equal((await metrics()).reads.length, 1);
          await button("Actualizar notificaciones").click(); await settle(true);
          await assertTokenPending();
          assert.ok(Date.now() - started < 20_000, "UI must work before the native token timeout, not after it");
          await page.getByText("59 sin leer · 59 en total", { exact: true }).waitFor();
          await layout(); await screenshot(label + "-unread-while-native-token-unresolved");
          await assertTokenPending();
        } finally {
          await page.evaluate(() => window.notificationCenterFixture.release("token"));
          await settle();
        }
      });
      await check(`${label}-profile-settings-explicit-save-dirty-backguard`, async () => {
        await fresh("populated", "profile"); await button("Configurar notificaciones").click();
        await heading("Tus avisos").waitFor(); await layout(); await screenshot(label + "-settings-top");
        const baseline = (await metrics()).registrations.length;
        await toggle("Nuevas asignaciones").click();
        assert.equal(await toggle("Nuevas asignaciones").getAttribute("aria-checked"), "false");
        assert.equal((await metrics()).registrations.length, baseline);
        await button("Volver a mi perfil").click(); await heading("Tienes cambios sin guardar").waitFor();
        await reachable(button("Seguir editando")); await layout(); await screenshot(label + "-dirty-backguard");
        await page.evaluate(() => window.notificationCenterFixture.lock(true));
        await heading("Fixture bloqueada").waitFor(); await heading("Tienes cambios sin guardar").waitFor({ state: "hidden" });
        assert.equal(await button("Guardar y volver").count(), 0);
        await page.evaluate(() => window.notificationCenterFixture.lock(false));
        await button("Seguir editando").click(); await heading("Tienes cambios sin guardar").waitFor({ state: "hidden" });
        assert.equal(await toggle("Nuevas asignaciones").getAttribute("aria-checked"), "false");
        await reachable(button("Guardar preferencias")); await button("Guardar preferencias").click(); await settle();
        assert.equal((await metrics()).registrations.length, baseline + 1);
        assert.equal((await metrics()).state.preferences.assignments, false);
        assert.equal(await button("Guardar preferencias").isDisabled(), true);
        await button("Volver a mi perfil").click(); await heading("Mi perfil").waitFor();
        assert.equal((await metrics()).back, 1);
      });
      await check(`${label}-hours-invalid-toggle-off-preserves-draft`, async () => {
        await fresh("populated", "settings");
        const baseline = (await metrics()).registrations.length;
        const from = page.getByPlaceholder("22:00", { exact: true });
        const until = page.getByPlaceholder("07:00", { exact: true });
        await from.fill("25:99");
        await page.getByRole("alert").waitFor(); assert.equal(await button("Guardar preferencias").isDisabled(), true);
        await from.fill("21:15"); await until.fill("06:45");
        await toggle("Horario silencioso").click();
        assert.equal(await from.count(), 0); assert.equal((await metrics()).registrations.length, baseline);
        await toggle("Horario silencioso").click();
        assert.equal(await from.inputValue(), "21:15"); assert.equal(await until.inputValue(), "06:45");
        await from.scrollIntoViewIfNeeded(); await layout(); await screenshot(label + "-hours-restored");
        await toggle("Cronómetros activos").click();
        assert.equal(await page.getByRole("radio", { name: "60 min", exact: true }).isDisabled(), true);
        await toggle("Cronómetros activos").click();
        await page.getByRole("radio", { name: "60 min", exact: true }).click();
        await toggle("Horario silencioso").click(); await button("Guardar preferencias").click(); await settle();
        const saved = (await metrics()).registrations.at(-1);
        assert.equal(saved.quietHoursStart, "00:00"); assert.equal(saved.quietHoursEnd, "00:00"); assert.equal(saved.remindAfterMinutes, 60);
        assert.equal((await metrics()).registrations.length, baseline + 1);
      });
      await check(`${label}-save-failure-discard-and-save-return`, async () => {
        await fresh("populated", "settings"); await toggle("Nuevas asignaciones").click(); await configure({ failSave: true });
        await button("Guardar preferencias").click(); await settle(); await page.getByRole("alert").waitFor();
        assert.equal(await toggle("Nuevas asignaciones").getAttribute("aria-checked"), "false");
        await button("Volver a mi perfil").click(); await button("Salir sin guardar").click(); await heading("Mi perfil").waitFor();
        assert.equal((await metrics()).state.preferences.assignments, true);
        await button("Configurar notificaciones").click(); await toggle("Nuevas asignaciones").click(); await configure({ failSave: false });
        await button("Volver a mi perfil").click(); await reachable(button("Guardar y volver")); await button("Guardar y volver").click();
        await heading("Mi perfil").waitFor(); assert.equal((await metrics()).state.preferences.assignments, false);
      });
      await check(`${label}-disable-confirm-preserves-unsaved-preferences`, async () => {
        await fresh("populated", "settings"); await toggle("Nuevas asignaciones").click();
        const baseline = (await metrics()).registrations.length;
        await toggle("Recibir avisos").click(); await heading("¿Desactivar los avisos?").waitFor(); await button("Cancelar").click();
        await heading("¿Desactivar los avisos?").waitFor({ state: "hidden" }); assert.equal((await metrics()).unregistrations, 0);
        await toggle("Recibir avisos").click(); await reachable(button("Desactivar avisos")); await button("Desactivar avisos").click(); await settle();
        assert.equal((await metrics()).unregistrations, 1); assert.equal((await metrics()).registrations.length, baseline);
        assert.equal(await toggle("Nuevas asignaciones").getAttribute("aria-checked"), "false");
        assert.equal(await button("Guardar preferencias").isDisabled(), true);
        await toggle("Nuevas asignaciones").scrollIntoViewIfNeeded(); await layout(); await screenshot(label + "-disabled-retained-draft");
      });
      await check(`${label}-status-advanced-web-blocked-missing-no-delivery`, async () => {
        await fresh("populated", "status"); await page.getByText("Activados", { exact: true }).waitFor();
        await button("Opciones avanzadas").click(); await page.getByText("Permiso concedido", { exact: true }).waitFor();
        await reachable(button("Actualizar estado")); await button("Actualizar estado").click(); await settle();
        await heading("Avisos en este teléfono").scrollIntoViewIfNeeded(); await layout(); await screenshot(label + "-status-active");
        await fresh("web", "settings");
        await page.getByText("En el navegador puedes consultar tu bandeja. Los avisos del teléfono se configuran desde la app instalada.", { exact: true }).waitFor();
        assert.equal(await button("Enviar notificación de prueba").count(), 0); await layout(); await screenshot(label + "-web-no-push");
        await fresh("blocked", "settings"); await button("Opciones avanzadas").click();
        await page.getByText("Bloqueado en ajustes del sistema", { exact: true }).scrollIntoViewIfNeeded();
        assert.equal(await button("Enviar notificación de prueba").isDisabled(), true); await layout(); await screenshot(label + "-blocked-permission");
        await fresh("missing", "status"); await page.getByText("Conecta tu sesión y selecciona una sucursal para consultar el estado de los avisos.", { exact: true }).waitFor();
        await layout(); await screenshot(label + "-missing-session");
      });
    }
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.blockedRequests, []);
    report.finalSourceHashes = hashes();
    assert.deepEqual(report.finalSourceHashes, report.sourceHashes, "Sources changed concurrently; rerun this isolated smoke on stable sources");
    report.passed = report.tests.length === 78 && report.tests.every(test => test.passed);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    report.failure = error.stack;
    process.exitCode = 1;
    if (page) await page.screenshot({ path: path.join(output, "fatal.png") }).catch(() => {});
  } finally {
    if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); report.cleanup.serverClosed = true; }
    report.counts = { executed: report.tests.length, passed: report.tests.filter(test => test.passed).length, failed: report.tests.filter(test => !test.passed).length, screenshots: report.screenshots.length };
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, "SUMMARY.md"), `# Notification UI isolated smoke\n\n${report.scope}\n\nPassed: ${report.passed}\nBrowser cases executed: ${report.counts.executed}; passed: ${report.counts.passed}; failed: ${report.counts.failed}.\nScreenshots: ${report.counts.screenshots}.\n\n${report.textScaling}\n\nBrowser closed: ${report.cleanup.browserClosed}; server closed: ${report.cleanup.serverClosed}.\n\nNo real Expo test notification requested, delivered or claimed. Global suite/native builds not run. Profile navigation and adapter badge callbacks are covered; actual App tab badge is outside this fixture.\n`);
    console.log(JSON.stringify({ output, passed: report.passed, counts: report.counts, failure: report.failure, cleanup: report.cleanup }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });