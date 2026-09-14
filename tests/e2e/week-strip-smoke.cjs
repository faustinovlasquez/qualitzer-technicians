const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const { build } = require(require.resolve("esbuild", { paths: [root] }));
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const files = ["src/screens/DashboardScreen.tsx", "src/screens/schedule/MobileAgenda.tsx"];
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const base = path.join(os.tmpdir(), "qualitzer-week-strip");
const output = path.join(base, new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const current = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
const baselinePath = path.join(base, "baseline.json");
if (process.argv.includes("--capture-baseline")) fs.writeFileSync(baselinePath, JSON.stringify({ capturedAt: new Date().toISOString(), sources: current }), { flag: "wx" });
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : null;
const baselineOnly = process.argv.includes("--capture-baseline");
const report = { passed: false, output, scope: "Real RN Web DashboardScreen, WeeklySchedule and MobileAgenda; isolated OS boundaries, no API/session/native APK", textScale: "CSS text font-size/line-height, not native Dynamic Type",
  capturedAt: baseline?.capturedAt ?? null, hashes: Object.fromEntries(files.map(file => [file, hash(current[file])])), measurements: [], tests: [], errors: [], blocked: [] };
async function bundle(sources) {
  return build({ absWorkingDir: root, entryPoints: ["tests/e2e/week-strip-fixture.tsx"], bundle: true, write: false, metafile: true,
    platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }, alias: { "react-native": "react-native-web" },
    loader: { ".png": "dataurl", ".ttf": "dataurl", ".js": "jsx" }, resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
    plugins: [{ name: "isolated-boundaries", setup(builder) {
      builder.onLoad({ filter: /(?:DashboardScreen|MobileAgenda)\.tsx$/ }, args => {
        const relative = path.relative(root, args.path).replace(/\\/g, "/");
        return { loader: "tsx", contents: sources[relative], resolveDir: path.dirname(args.path) };
      });
      builder.onResolve({ filter: /^@expo\/vector-icons$/ }, () => ({ path: "icons", namespace: "fixture" }));
      builder.onResolve({ filter: /^expo-font$/ }, () => ({ path: "font", namespace: "fixture" }));
      builder.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: "storage", namespace: "fixture" }));
      builder.onResolve({ filter: /\/infrastructure\/photos$/ }, () => ({ path: "upload", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: root, contents: {
        icons: 'export {default as Ionicons} from "@expo/vector-icons/build/Ionicons";',
        font: 'const loaded = new Set(); export const isLoaded = name => loaded.has(name); export async function loadAsync(fonts) { for (const [name, source] of Object.entries(fonts)) { if (loaded.has(name)) continue; const face = new FontFace(name, `url(${source})`); await face.load(); document.fonts.add(face); loaded.add(name); } }',
        storage: 'export default { getItem: async () => null, setItem: async () => {} };',
        upload: 'export const uploadFetch = async () => { throw new Error("FIXTURE_FORBIDS_NETWORK"); };',
      }[args.path] }));
    } }],
  });
}
async function main() {
  let server, browser, page;
  const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  try {
    process.chdir(root);
    const ts = require("typescript");
    const ownedFiles = [...files, "tests/e2e/week-strip-fixture.tsx"].map(file => path.join(root, file));
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const program = ts.createProgram(ownedFiles, parsed.options);
    const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => !diagnostic.file || ownedFiles.includes(path.normalize(diagnostic.file.fileName)));
    report.types = ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => "\n" });
    assert.equal(diagnostics.length, 0, report.types);
    const bundles = { ...(baseline ? { before: await bundle(baseline.sources) } : {}), ...(!baselineOnly ? { after: await bundle(current) } : {}) };
    for (const compiled of Object.values(bundles)) {
      for (const file of files) assert.ok(compiled.metafile.inputs[file], file);
      assert.ok(!Object.keys(compiled.metafile.inputs).some(file => /(^|\/)App\.tsx$|HttpTechnicianRepository|sessionStorage|expo-secure-store/.test(file)));
    }
    server = http.createServer((request, response) => {
      const phase = request.url?.includes("before") ? "before" : "after";
      if (request.method !== "GET" || !bundles[phase] || ![`/${phase}`, `/${phase}.js`].includes(request.url)) return response.writeHead(404).end();
      response.setHeader("Content-Type", request.url.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8");
      response.end(request.url.endsWith(".js") ? bundles[phase].outputFiles[0].text : `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/${phase}.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", timezoneId: "UTC", locale: "es-CL" });
    await context.route("**/*", route => {
      if (route.request().method() === "GET" && ["/before", "/before.js", "/after", "/after.js"].some(suffix => route.request().url() === origin + suffix)) return route.continue();
      report.blocked.push(route.request().url()); return route.abort();
    });
    await context.routeWebSocket("**/*", socket => { report.blocked.push("websocket"); socket.close(); });
    page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.clock.install({ fixedTime: new Date("2026-09-12T12:00:00Z") });
    const settle = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.evaluate(() => document.fonts.ready); };
    async function fresh(phase, screen, scenario = "full", scale = 1, date = "2026-09-12") {
      await page.goto(`${origin}/${phase}`); await page.waitForFunction(() => Boolean(window.weekStripFixture));
      await page.evaluate(({ screen, scenario, date }) => window.weekStripFixture.render(screen, scenario, date), { screen, scenario, date });
      if (screen === "list") await page.getByRole("button", { name: "Filtros y OTs de agenda", exact: true }).click();
      await settle();
      if (scale === 2) await page.evaluate(() => {
        for (const element of document.querySelectorAll("body *")) {
          if (![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
          const style = getComputedStyle(element);
          if (style.fontFamily.toLowerCase().includes("ionicons")) continue;
          element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
          if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
        }
      });
      await settle();
    }
    const selector = screen => screen === "agenda" ? page.getByTestId("agenda-day-strip") : page.getByTestId("week-selector");
    async function measure(screen) {
      if (screen === "agenda") await page.getByTestId("agenda-day-strip").scrollIntoViewIfNeeded();
      else await page.getByRole("button", { name: "Semana anterior", exact: true }).scrollIntoViewIfNeeded();
      return page.evaluate(screen => {
        const nav = document.querySelector('[aria-label="Semana anterior"]');
        const area = screen === "agenda" ? document.querySelector('[data-testid="agenda-day-strip"]') : document.querySelector('[data-testid="week-selector"]') ?? nav.parentElement.parentElement;
        const box = area.getBoundingClientRect();
        const buttons = [...area.querySelectorAll('[role="button"]')].map(button => { const rect = button.getBoundingClientRect(); return { label: button.getAttribute("aria-label"), width: rect.width, height: rect.height }; });
        const issues = [];
        for (const element of area.querySelectorAll("*")) {
          const bounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if ([...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) && !style.fontFamily.toLowerCase().includes("ionicons")) {
            if (element.scrollWidth > element.clientWidth + 1) issues.push({ kind: "text overflow", text: element.textContent });
            const parentBounds = element.parentElement.getBoundingClientRect();
            if (bounds.left < parentBounds.left - 1 || bounds.right > parentBounds.right + 1) issues.push({ kind: "text outside its control", text: element.textContent });
            if (style.webkitLineClamp && style.webkitLineClamp !== "none" && style.webkitLineClamp !== "0") issues.push({ kind: "clamped", text: element.textContent });
          }
          if (bounds.left < -1 || bounds.right > innerWidth + 1) {
            let inScroll = false;
            for (let parent = element.parentElement; parent && parent !== area.parentElement; parent = parent.parentElement) {
              if (["scroll", "auto"].includes(getComputedStyle(parent).overflowX)) { inScroll = true; break; }
            }
            if (!inScroll) issues.push({ kind: "outside horizontal ScrollView", text: element.textContent });
          }
        }
        const subtitle = [...document.querySelectorAll("body *")].filter(element => element.childNodes.length === 1 && element.firstChild.nodeType === Node.TEXT_NODE && /y pendientes anteriores|Tareas de toda la semana y pendientes anteriores/.test(element.textContent)).map(element => element.textContent);
        return { width: box.width, height: box.height, buttons, issues, subtitle, text: area.textContent, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
      }, screen);
    }
    async function check(name, fn) { try { await fn(); report.tests.push({ name, passed: true }); } catch (error) { report.tests.push({ name, passed: false, error: error.stack }); } save(); }
    for (const phase of Object.keys(bundles)) for (const width of [320, 360, 390]) for (const scale of [1, 2]) for (const screen of ["today", "list", "agenda"]) {
      await page.setViewportSize({ width, height: 900 });
      await check(`${phase}-${screen}-${width}-${scale}`, async () => {
        await fresh(phase, screen, "full", scale);
        const measured = await measure(screen);
        report.measurements.push({ phase, screen, viewport: width, scale, ...measured });
        await page.screenshot({ path: path.join(output, `${phase}-${screen}-${width}-${scale}.png`) });
        if (phase === "before") return;
        assert.deepEqual(measured.issues, []); assert.deepEqual(measured.subtitle, []); assert.equal(measured.pageWidth, width);
        assert.ok(measured.buttons.every(button => button.width >= 44 && button.height >= 44), JSON.stringify(measured.buttons));
        const before = report.measurements.find(item => item.phase === "before" && item.screen === screen && item.viewport === width && item.scale === scale);
        if (scale === 1) {
          if (before) assert.ok(measured.height < before.height, `${before.height} -> ${measured.height}`);
          assert.ok(measured.height <= (screen === "agenda" ? 52 : 118), "Normal text must keep the week card to two rows");
        }
        assert.equal(await selector(screen).getByRole("button", { name: /(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i }).count(), 7);
        const lastDay = selector(screen).getByRole("button", { name: /domingo.*13/i });
        await lastDay.scrollIntoViewIfNeeded();
        const lastBox = await lastDay.boundingBox();
        assert.ok(lastBox.x >= 0 && lastBox.x + lastBox.width <= width, JSON.stringify(lastBox));
        await lastDay.click(); await settle();
        if (screen === "today") assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).ranges.at(-1), { startDate: "2026-09-13", endDate: "2026-09-13" });
        else assert.equal((await page.evaluate(() => window.weekStripFixture.metrics())).focus.at(-1), "2026-09-13");
      });
    }
    if (!baselineOnly) {
      await page.setViewportSize({ width: 360, height: 900 });
      await check("today-scope-week-navigation-and-hoy", async () => {
        await fresh("after", "today");
        await page.getByRole("button", { name: "Semana siguiente", exact: true }).click();
        assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).ranges, []);
        await selector("today").getByRole("button", { name: /lunes.*14/i }).click();
        assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).ranges, [{ startDate: "2026-09-14", endDate: "2026-09-14" }]);
        await page.getByRole("button", { name: "Ir a hoy", exact: true }).click();
        assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).ranges.at(-1), { startDate: "2026-09-12", endDate: "2026-09-12" });
      });
      await check("list-day-toggle-all-week-and-week-range", async () => {
        await fresh("after", "list");
        await selector("list").getByRole("button", { name: /lunes.*7/i }).click();
        assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).focus, ["2026-09-07"]);
        await page.getByText("1 trabajos · 1 OT/asignaciones", { exact: true }).waitFor();
        await selector("list").getByRole("button", { name: /lunes.*7/i }).click();
        await page.getByText("2 trabajos · 1 OT/asignaciones", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Mostrar todas las tareas de la semana", exact: true }).click();
        await page.getByRole("button", { name: "Semana anterior", exact: true }).click();
        assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).ranges.at(-1), { startDate: "2026-08-31", endDate: "2026-09-06" });
      });
      await check("agenda-day-week-open-scopes", async () => {
        await fresh("after", "agenda");
        await selector("agenda").getByRole("button", { name: /lunes.*7/i }).click();
        assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).focus, ["2026-09-07"]);
        await page.getByRole("button", { name: /^Trabajo 1\./ }).click();
        assert.deepEqual((await page.evaluate(() => window.weekStripFixture.metrics())).opened, ["1:2026-09-07"]);
        await page.getByRole("tab", { name: "Agenda de la semana", exact: true }).click();
        assert.equal(await page.locator('[data-testid^="agenda-day-2026"]').count(), 7);
      });
      for (const screen of ["today", "list", "agenda"]) for (const scenario of ["missing", "local"]) for (const scale of [1, 2]) await check(`${screen}-${scenario}-${scale}`, async () => {
        await page.setViewportSize({ width: 320, height: 900 }); await fresh("after", screen, scenario, scale);
        const measured = await measure(screen); report.measurements.push({ phase: "after", screen, scenario, scale, ...measured });
        assert.deepEqual(measured.issues, []); assert.ok(measured.buttons.every(button => button.width >= 44 && button.height >= 44));
        assert.match(measured.text, /Sin copia|solo local/i);
        if (screen !== "agenda") {
          const monday = selector(screen).getByRole("button", { name: /lunes.*7/i });
          assert.equal(await monday.isDisabled(), scenario === "missing");
          if (scenario === "local") {
            await monday.click();
            const execution = page.getByRole("button", { name: /^(Iniciar|Pausar|Entregar)$/ });
            for (const button of await execution.all()) assert.equal(await button.isDisabled(), true);
          }
        } else if (scenario === "missing") {
          await selector(screen).getByRole("button", { name: /lunes.*7/i }).click();
          await page.getByText("Sin planificación completa", { exact: true }).waitFor();
          assert.doesNotMatch(await page.getByTestId("agenda-day-2026-09-07").innerText(), /0 trabajos|0 min planificadas/);
        }
        assert.equal((await page.evaluate(() => window.weekStripFixture.metrics())).status, 0);
        await page.screenshot({ path: path.join(output, `${screen}-${scenario}-${scale}.png`) });
      });
      for (const screen of ["today", "list", "agenda"]) for (const scenario of ["busy", "loading"]) await check(`${screen}-${scenario}-guards`, async () => {
        await fresh("after", screen);
        await page.evaluate(scenario => window.weekStripFixture.scenario(scenario), scenario);
        await settle();
        for (const button of await selector(screen).getByRole("button").all()) {
          assert.equal(await button.isDisabled(), true);
          await button.dispatchEvent("click");
        }
        for (const label of ["Semana anterior", "Semana siguiente"]) assert.equal(await page.getByRole("button", { name: label, exact: true }).isDisabled(), true);
        assert.deepEqual(await page.evaluate(() => window.weekStripFixture.metrics()), { ranges: [], focus: [], opened: [], status: 0 });
      });
      await check("cross-year-context", async () => {
        await fresh("after", "today", "full", 1, "2026-12-31");
        const measured = await measure("today");
        assert.match(measured.text, /dic.*2026.*ene.*2027/s);
      });
    }
    report.reductions = report.measurements.filter(item => item.phase === "after" && !item.scenario).map(after => {
      const before = report.measurements.find(item => item.phase === "before" && item.screen === after.screen && item.viewport === after.viewport && item.scale === after.scale);
      return { screen: after.screen, width: after.viewport, scale: after.scale, before: before?.height ?? null, after: after.height, saved: before ? before.height - after.height : null };
    });
    report.sourcesUnchanged = files.every(file => hash(fs.readFileSync(path.join(root, file))) === report.hashes[file]);
    report.passed = report.tests.every(test => test.passed) && !report.errors.length && !report.blocked.length && report.sourcesUnchanged;
  } catch (error) { report.fatal = error.stack; }
  finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); save(); }
  console.log(JSON.stringify({ passed: report.passed, output, tests: report.tests.length, failures: report.tests.filter(test => !test.passed), fatal: report.fatal }, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
main();