const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const outputRoot = path.join(root, "artifacts/logs/compact-overview-ui");
const runtimeFiles = ["src/screens/LoginScreen.tsx", "src/screens/DashboardScreen.tsx"];
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
if (process.argv.includes("--capture-baseline")) {
  const sources = Object.fromEntries(runtimeFiles.map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
  const baseline = { capturedAt: new Date().toISOString(), compactIdsAlreadyPresent: Object.values(sources).some(text => /testID="(?:login-hero|day-summary|day-kpis)"/.test(text)), sources, hashes: Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, hash(text)])) };
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "baseline-sources.json"), JSON.stringify(baseline, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ capturedAt: baseline.capturedAt, compactIdsAlreadyPresent: baseline.compactIdsAlreadyPresent, hashes: baseline.hashes }));
}

const assert = require("node:assert/strict");
const http = require("node:http");
const { build } = require(require.resolve("esbuild", { paths: [root] }));
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, "-"));
const report = { passed: false, scope: "Actual LoginScreen and DashboardScreen with actual RN Web components and domain helpers. Fake OS storage, upload boundary and locked gateway configuration only. No App shell, account, session storage, API or native APK.",
  textScaling: "200% CSS font-size/line-height on text nodes; not native Dynamic Type. Compact height budgets apply to mobile normal text only.",
  tests: [], measurements: [], screenshots: [], errors: [], blockedRequests: [], cleanup: { browserClosed: false, serverClosed: false } };

async function bundle(sources) {
  return build({ absWorkingDir: root, entryPoints: ["tests/e2e/compact-overview-fixture.tsx"], bundle: true, write: false, metafile: true,
    platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl", ".ttf": "dataurl", ".js": "jsx" },
    resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
    plugins: [{ name: "isolated-os-boundaries-and-source-snapshot", setup(builder) {
      builder.onLoad({ filter: /(?:LoginScreen|DashboardScreen)\.tsx$/ }, args => {
        const relative = path.relative(root, args.path).replace(/\\/g, "/");
        if (sources[relative]) return { loader: "tsx", contents: sources[relative], resolveDir: path.dirname(args.path) };
      });
      builder.onResolve({ filter: /^@expo\/vector-icons$/ }, () => ({ path: "icons", namespace: "fixture" }));
      builder.onResolve({ filter: /^expo-font$/ }, () => ({ path: "font", namespace: "fixture" }));
      builder.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: "storage", namespace: "fixture" }));
      builder.onResolve({ filter: /\/infrastructure\/(photos|gatewayConfig)$/ }, args => ({ path: args.path.endsWith("photos") ? "upload" : "config", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: root, contents: {
        icons: 'export {default as Ionicons} from "@expo/vector-icons/build/Ionicons";',
        font: 'const loaded = new Set(); export const isLoaded = name => loaded.has(name); export async function loadAsync(fonts) { for (const [name, source] of Object.entries(fonts)) { if (loaded.has(name)) continue; const face = new FontFace(name, `url(${source})`); await face.load(); document.fonts.add(face); loaded.add(name); } }',
        storage: 'const values = new Map(); export default { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } };',
        upload: 'export const uploadFetch = async () => { throw new Error("FIXTURE_FORBIDS_NETWORK"); };',
        config: 'export const gatewayConfiguration = { locked: true, url: "https://fixture.example.invalid/mobile", error: null };',
      }[args.path] }));
    } }],
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let browser;
  let server;
  let page;
  const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  try {
    assert.equal(Number(process.versions.node.split(".")[0]), 22, "Use the project Node 22 binary");
    const captured = path.join(outputRoot, "baseline-sources.json");
    const baseline = fs.existsSync(captured) ? JSON.parse(fs.readFileSync(captured, "utf8")) : null;
    report.baseline = baseline ? { capturedAt: baseline.capturedAt, hashes: baseline.hashes, compactIdsAlreadyPresent: baseline.compactIdsAlreadyPresent,
      comparable: !baseline.compactIdsAlreadyPresent } : { comparable: false, reason: "No pre-edit source captured; do not invent a baseline" };
    const current = Object.fromEntries(runtimeFiles.map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
    report.sourceHashes = Object.fromEntries(Object.entries(current).map(([file, text]) => [file, hash(text)]));
    report.testSourceHashes = Object.fromEntries(["tests/e2e/compact-overview-fixture.tsx", "tests/e2e/compact-overview-smoke.cjs"].map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
    const bundles = { after: await bundle(current) };
    if (report.baseline.comparable) bundles.before = await bundle(baseline.sources);
    report.bundleInputs = Object.keys(bundles.after.metafile.inputs);
    for (const file of runtimeFiles) assert.ok(report.bundleInputs.includes(file), `Missing real screen: ${file}`);
    assert.ok(!report.bundleInputs.some(file => /(^|\/)App\.tsx$|HttpTechnicianRepository|sessionStorage|expo-secure-store|(?:^|\/)\.env$/.test(file)), "Forbidden runtime imported");
    const html = phase => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/${phase}.js"></script></body></html>`;
    server = http.createServer((request, response) => {
      const phase = request.url?.includes("before") ? "before" : "after";
      if (request.method !== "GET" || !bundles[phase] || ![`/${phase}`, `/${phase}.js`].includes(request.url)) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'");
      response.setHeader("Content-Type", request.url.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8");
      response.end(request.url.endsWith(".js") ? bundles[phase].outputFiles[0].text : html(phase));
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.origin = origin;
    browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking"] });
    const context = await browser.newContext({ serviceWorkers: "block", locale: "es-CL", timezoneId: "UTC" });
    await context.route("**/*", route => {
      if (route.request().method() === "GET" && ["/before", "/after", "/before.js", "/after.js"].some(suffix => route.request().url() === origin + suffix)) return route.continue();
      report.blockedRequests.push({ method: route.request().method(), type: route.request().resourceType() });
      return route.abort();
    });
    await context.routeWebSocket("**/*", socket => { report.blockedRequests.push({ type: "websocket" }); socket.close(); });
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => report.errors.push(error.message));
    async function settle() {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => document.fonts.ready);
    }
    async function fresh(screen, scenario = "full", busy = false) {
      await page.evaluate(({ screen, scenario, busy }) => window.compactOverviewFixture.render(screen, scenario, busy), { screen, scenario, busy });
      await (screen === "login" ? page.getByRole("heading", { name: "Entra a tu jornada" }) : page.getByRole("heading", { name: "Mi jornada", exact: true })).waitFor();
      await settle();
    }
    async function shot(name) {
      const file = name.replace(/[^a-zA-Z0-9-]/g, "-") + ".png";
      await page.screenshot({ path: path.join(output, file), animations: "disabled" });
      report.screenshots.push(file);
    }
    async function check(name, run) {
      try { await run(); report.tests.push({ name, passed: true }); }
      catch (error) { report.tests.push({ name, passed: false, error: error.stack }); await shot(name + "-failure").catch(() => {}); }
      save();
    }
    async function overview(screen) {
      return page.evaluate(screen => {
        const text = value => [...document.querySelectorAll("body *")].find(element => element.textContent === value && ![...element.children].some(child => child.textContent === value));
        const rect = element => { if (!element) throw new Error("OVERVIEW_ELEMENT_MISSING"); const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom }; };
        const form = text("Entra a tu jornada");
        if (screen === "login") {
          const title = document.querySelector('[aria-label="Tu trabajo. En tus manos."]');
          const hero = document.querySelector('[data-testid="login-hero"]') ?? title?.parentElement?.parentElement;
          const submit = [...document.querySelectorAll('button,[role="button"]')].find(element => element.textContent.includes("Iniciar sesión"));
          return { hero: rect(hero), formHeading: rect(form), submit: rect(submit), heroText: hero.textContent };
        }
        const heading = document.querySelector('[data-testid="day-overview-heading"]') ?? text("Mi jornada")?.parentElement;
        const hero = document.querySelector('[data-testid="day-summary"]') ?? heading?.nextElementSibling;
        const kpis = document.querySelector('[data-testid="day-kpis"]') ?? hero?.nextElementSibling;
        return { heading: rect(heading), hero: rect(hero), kpis: rect(kpis), combined: rect(kpis).bottom - rect(heading).y,
          cards: [...kpis.children].map(element => ({ ...rect(element), text: element.textContent })), heroText: hero.textContent };
      }, screen);
    }
    async function readable(screen) {
      const result = await page.evaluate(screen => {
        const rootRect = document.getElementById("root").getBoundingClientRect();
        const exactText = value => [...document.querySelectorAll("body *")].find(element => element.textContent === value && ![...element.children].some(child => child.textContent === value));
        const heading = document.querySelector('[data-testid="day-overview-heading"]') ?? exactText("Mi jornada")?.parentElement;
        const summary = document.querySelector('[data-testid="day-summary"]') ?? heading?.nextElementSibling;
        const kpis = document.querySelector('[data-testid="day-kpis"]') ?? summary?.nextElementSibling;
        const login = document.querySelector('[data-testid="login-hero"]') ?? document.querySelector('[aria-label="Tu trabajo. En tus manos."]')?.parentElement?.parentElement;
        const areas = screen === "login" ? [login] : [heading, summary, kpis];
        const issues = [];
        for (const area of areas) {
          if (!area) throw new Error("READABILITY_AREA_MISSING");
          for (const element of area.querySelectorAll("*")) {
            const style = getComputedStyle(element);
            const nodes = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (!nodes.length || style.fontFamily.toLowerCase().includes("ionicons")) continue;
            const box = element.getBoundingClientRect();
            if (!box.width || !box.height) { issues.push({ text: element.textContent, kind: "hidden text" }); continue; }
            const lineHeight = parseFloat(style.lineHeight);
            if (element.scrollWidth > element.clientWidth + 1 || (Number.isFinite(lineHeight) && box.height + 1 < lineHeight)) issues.push({ text: element.textContent, kind: "text layout overflow", width: box.width, scrollWidth: element.scrollWidth, height: box.height, lineHeight });
            if (style.webkitLineClamp !== "none" && style.webkitLineClamp !== "0" && style.webkitLineClamp !== "") issues.push({ text: element.textContent, kind: "line-clamped text" });
            for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
              const parentStyle = getComputedStyle(parent);
              if (parentStyle.overflowY === "scroll" || parentStyle.overflowY === "auto") break;
              const bounds = parent.getBoundingClientRect();
              if (parentStyle.overflow === "hidden" && (box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1)) issues.push({ text: element.textContent, kind: "clipped by ancestor" });
            }
          }
        }
        const viewportOverflow = [...document.querySelectorAll("body *")].filter(element => {
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight || (box.left >= -1 && box.right <= innerWidth + 1)) return false;
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (["scroll", "auto", "hidden"].includes(style.overflowX) && parent.getBoundingClientRect().right <= innerWidth + 1) return false;
          }
          return true;
        }).map(element => element.textContent.slice(0, 80));
        return { root: { width: rootRect.width, height: rootRect.height }, viewportOverflow, issues, scrollWidth: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight };
      }, screen);
      assert.equal(result.root.width, result.width); assert.equal(result.root.height, result.height);
      assert.ok(result.scrollWidth <= result.width); assert.deepEqual(result.viewportOverflow, []);
      assert.deepEqual(result.issues, [], JSON.stringify(result.issues));
    }
    async function reachable(locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, JSON.stringify(box));
      assert.ok(box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1 && box.y >= -1 && box.y + box.height <= page.viewportSize().height + 1, JSON.stringify(box));
    }
    async function scaleText(factor) {
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
        new MutationObserver(apply).observe(document.body, { childList: true, subtree: true }); apply();
      }, factor);
    }
    for (const phase of Object.keys(bundles).sort().reverse()) {
      for (const [width, height] of [[320, 740], [360, 740], [390, 740], [1024, 800]]) for (const scale of phase === "before" ? [1] : [1, 2]) {
        const label = `${phase}-${width}x${height}-text${scale * 100}`;
        await page.setViewportSize({ width, height });
        await page.goto(`${origin}/${phase}`);
        await page.waitForFunction(() => Boolean(window.compactOverviewFixture));
        await scaleText(scale);
        for (const screen of ["login", "dashboard"]) {
          await check(`${label}-${screen}`, async () => {
            await fresh(screen);
            const measured = await overview(screen);
            report.measurements.push({ phase, width, height, scale, screen, scenario: "full", ...measured });
            await shot(`${label}-${screen}`);
            if (phase === "before") return;
            await readable(screen);
            if (screen === "login") {
              assert.match(measured.heroText, /Tu trabajo/); assert.match(measured.heroText, /En tus manos/);
              if (width < 600 && scale === 1) { assert.ok(measured.hero.height <= 110, `Login hero ${measured.hero.height}px > 110`); assert.ok(measured.formHeading.y < 190, `Form heading ${measured.formHeading.y}px >= 190`); }
              if (width === 390 && scale === 1) assert.ok(measured.submit.bottom <= height, `Primary CTA below initial viewport: ${measured.submit.bottom}`);
              await reachable(page.getByRole("button", { name: "Iniciar sesión", exact: true }));
              await reachable(page.getByRole("button", { name: "Mostrar contraseña", exact: true }));
              await reachable(page.getByRole("button", { name: "Explorar demostración", exact: true }));
            } else {
              assert.match(measured.heroText, /3 tareas por completar/); assert.match(measured.heroText, /1 de 4/); assert.match(measured.heroText, /6 h 45 min/);
              assert.equal(measured.cards.length, 3);
              for (const [index, expected] of [2, 1, 1].entries()) assert.match(measured.cards[index].text, new RegExp(`(^|\\D)${expected}(\\D|$)`));
              if (width < 600 && scale === 1) {
                assert.ok(measured.combined <= 300, `Heading + hero + KPIs ${measured.combined}px > 300`);
                assert.ok(measured.cards.every(card => card.height <= 95), "KPI card taller than 95px");
                assert.ok(measured.cards.every(card => Math.abs(card.y - measured.cards[0].y) < 1), "KPIs not in one row");
              }
              await reachable(page.getByRole("button", { name: "Semana anterior", exact: true }));
              await reachable(page.getByRole("button", { name: "Semana siguiente", exact: true }));
              await reachable(page.getByRole("button", { name: "Pendientes", exact: true }));
            }
          });
        }
        if (phase === "before") continue;
        for (const scenario of ["supplemental", "partial", "partial-empty", "null-coverage", "no-data"]) {
          await check(`${label}-${scenario}`, async () => {
            await fresh("dashboard", scenario);
            const measured = await overview("dashboard");
            report.measurements.push({ phase, width, height, scale, screen: "dashboard", scenario, ...measured });
            await shot(`${label}-${scenario}`); await readable("dashboard");
            if (width < 600 && scale === 1) assert.ok(measured.combined <= 300, `${scenario}: heading + hero + KPIs ${measured.combined}px > 300`);
            if (scenario === "supplemental") {
              assert.match(measured.cards[1].text, /1 en pausa/); assert.match(measured.cards[2].text, /1 entregadas/);
            } else if (["partial-empty", "null-coverage", "no-data"].includes(scenario)) {
              for (const card of measured.cards) { assert.match(card.text, /—/); assert.doesNotMatch(card.text, /(^|\D)0(\D|$)/); }
              assert.doesNotMatch(measured.heroText, /Todo completado|No hay tareas asignadas|0.*planificadas/);
            }
            if (scenario.startsWith("partial")) {
              assert.match(measured.heroText, /cobertura parcial/i);
              await page.getByText(/días no descargados · no es carga cero/).waitFor();
              for (const card of measured.cards) assert.match(card.text, /parcial/i);
            }
            if (scenario === "partial" || scenario === "null-coverage") {
              const executionButtons = page.getByRole("button", { name: /^(Iniciar|Pausar|Entregar)$/ });
              assert.ok(await executionButtons.count() > 0);
              for (const button of await executionButtons.all()) assert.equal(await button.isDisabled(), true);
              assert.equal((await page.evaluate(() => window.compactOverviewFixture.metrics())).statusCalls, 0);
            }
          });
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 740 }); await page.goto(`${origin}/after`);
    await page.waitForFunction(() => Boolean(window.compactOverviewFixture));
    await check("login-credentials-visibility-validation-and-busy-guards", async () => {
      await fresh("login");
      const username = page.getByRole("textbox", { name: "Correo o usuario", exact: true });
      const password = page.getByLabel("Contraseña", { exact: true });
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      assert.equal((await page.evaluate(() => window.compactOverviewFixture.metrics())).loginCalls.length, 0);
      await page.getByText("Ingresa tu correo o usuario.", { exact: true }).waitFor();
      await username.fill("  alex.fixture  "); await password.fill("Fixture password only");
      assert.equal(await password.getAttribute("type"), "password");
      await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).click();
      assert.equal(await password.evaluate(element => element.type), "text");
      assert.equal(await password.inputValue(), "Fixture password only");
      await page.getByRole("button", { name: "Ocultar contraseña", exact: true }).click();
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      await page.getByRole("button", { name: "Iniciando sesión…", exact: true }).waitFor();
      assert.equal(await username.isEditable(), false); assert.equal(await password.isEditable(), false);
      for (const name of ["Iniciando sesión…", "Mostrar contraseña", "Explorar demostración"]) assert.equal(await page.getByRole("button", { name, exact: true }).isDisabled(), true);
      await password.press("Enter");
      assert.deepEqual((await page.evaluate(() => window.compactOverviewFixture.metrics())).loginCalls, [{ username: "alex.fixture", passwordMatches: true }]);
      await page.evaluate(() => window.compactOverviewFixture.releaseLogin()); await settle();
      assert.equal(await password.inputValue(), ""); assert.equal(await username.inputValue(), "  alex.fixture  ");
      await fresh("login", "full", true);
      assert.equal(await username.isEditable(), false); assert.equal(await password.isEditable(), false);
      assert.equal((await page.evaluate(() => window.compactOverviewFixture.metrics())).gatewayChanges, 0);
    });
    report.reductions = report.measurements.filter(item => item.phase === "after" && item.scale === 1 && item.scenario === "full").map(after => {
      const before = report.measurements.find(item => item.phase === "before" && item.width === after.width && item.screen === after.screen);
      if (!before) return { width: after.width, screen: after.screen, baselineUnavailable: true };
      const previous = after.screen === "login" ? before.hero.height : before.combined;
      const currentHeight = after.screen === "login" ? after.hero.height : after.combined;
      return { width: after.width, screen: after.screen, before: previous, after: currentHeight, reduction: previous - currentHeight, percent: Math.round((previous - currentHeight) / previous * 100) };
    });
    report.sourcesUnchangedDuringRun = runtimeFiles.every(file => hash(fs.readFileSync(path.join(root, file))) === report.sourceHashes[file]);
    report.passed = report.tests.every(test => test.passed) && report.errors.length === 0 && report.blockedRequests.length === 0 && report.sourcesUnchangedDuringRun;
  } catch (error) { report.fatal = error.stack; }
  finally {
    if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
    if (server) { await new Promise(resolve => server.close(resolve)); report.cleanup.serverClosed = true; }
    save();
    console.log(JSON.stringify({ output, passed: report.passed, tests: report.tests.length, failures: report.tests.filter(test => !test.passed).map(test => ({ name: test.name, error: test.error.split("\n")[0] })), reductions: report.reductions, fatal: report.fatal, cleanup: report.cleanup }, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
}
if (!process.argv.includes("--capture-baseline")) void main();