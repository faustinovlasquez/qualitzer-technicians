const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const { build } = require(require.resolve("esbuild", { paths: [root] }));
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = path.join(root, "artifacts/logs/device-security-ui", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { passed: false, scope: "Actual DeviceLockScreen, DeviceSecurityCard, context and DeviceLockController on React/RN Web; memory OS adapter and simulated auth dialog only. Not native biometrics, ScreenCapture or production Provider lifecycle verification.", tests: [], screenshots: [], pageErrors: [], blockedRequests: [], serverRequests: [], sourceHashes: {}, cleanup: { browserClosed: false, serverClosed: false } };
const sourceFiles = ["src/security/DeviceLockScreen.tsx", "src/security/DeviceSecurityCard.tsx", "src/security/DeviceLockController.ts", "src/security/DeviceSecurityContext.tsx", "src/security/contracts.ts", "src/ui/components.tsx", "tests/e2e/device-security-fixture.tsx"];
function hashes() { return Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")])); }

async function main() {
  let browser;
  let server;
  let page;
  try {
    report.sourceHashes = hashes();
    const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/e2e/device-security-fixture.tsx"], bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }, alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl", ".ttf": "dataurl", ".js": "jsx" },
      resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
      plugins: [{ name: "os-font-boundary", setup(builder) {
        builder.onResolve({ filter: /^@expo\/vector-icons$/ }, () => ({ path: "icons", namespace: "fixture" }));
        builder.onResolve({ filter: /^expo-font$/ }, () => ({ path: "font", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: root, contents: args.path === "icons"
          ? 'export {default as Ionicons} from "@expo/vector-icons/build/Ionicons";'
          : 'const loaded = new Set(); export const isLoaded = name => loaded.has(name); export async function loadAsync(fonts) { for (const [name, source] of Object.entries(fonts)) { if (loaded.has(name)) continue; const face = new FontFace(name, `url(${source})`); await face.load(); document.fonts.add(face); loaded.add(name); } }' }));
      } }],
    });
    const inputs = Object.keys(bundle.metafile.inputs);
    assert.ok(inputs.some(file => file.endsWith("src/security/DeviceLockController.ts")));
    assert.ok(inputs.some(file => file.endsWith("src/security/DeviceLockScreen.tsx")));
    assert.ok(inputs.some(file => file.endsWith("src/security/DeviceSecurityCard.tsx")));
    assert.ok(!inputs.some(file => /deviceSecurityAdapter|sessionStorage|HttpTechnicianRepository|\.env|expo-secure-store/.test(file)));
    report.bundleInputs = inputs;
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}body{font-family:Arial,sans-serif}button{font:inherit}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
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
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => {
      const request = route.request();
      if (request.method() === "GET" && [origin + "/", origin + "/fixture.js"].includes(request.url())) return route.continue();
      report.blockedRequests.push({ type: request.resourceType(), method: request.method() });
      return route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => report.pageErrors.push(error.message));
    const button = name => page.getByRole("button", { name, exact: true });
    const heading = name => page.getByRole("heading", { name, exact: true });
    const metrics = () => page.evaluate(() => window.deviceSecurityFixture.metrics());
    async function check(name, run) {
      try { await run(); report.tests.push({ name, passed: true }); }
      catch (error) { report.tests.push({ name, passed: false, error: error.message }); throw error; }
    }
    async function fresh(scenario) {
      await page.evaluate(value => window.deviceSecurityFixture.render(value), scenario);
      await page.waitForFunction(value => {
        const state = window.deviceSecurityFixture.metrics();
        if (value === "loading") return !state.ready && state.busy;
        if (value === "readError") return !state.ready && !state.busy;
        return state.ready && !state.busy && (value !== "offer" || state.offered);
      }, scenario);
    }
    async function screenshot(name) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(output, name + ".png"), animations: "disabled" });
      report.screenshots.push(name + ".png");
    }
    async function layout(name) {
      const data = await page.evaluate(() => {
        const rootBox = document.getElementById("root").getBoundingClientRect();
        const overflowing = [...document.querySelectorAll("#root *")].filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
        }).map(element => element.tagName + ":" + element.getAttribute("role"));
        return { rootWidth: rootBox.width, rootHeight: rootBox.height, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, overflowing };
      });
      assert.equal(data.rootWidth, data.width, name);
      assert.equal(data.rootHeight, data.height, name);
      assert.ok(data.scrollWidth <= data.width, name);
      assert.deepEqual(data.overflowing, [], name);
      return data;
    }
    async function reachable(locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(box && box.width >= 44 && box.height >= 44, JSON.stringify(box));
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));
    }
    async function confirm() { await button("Confirmar simulación").click(); await page.getByRole("dialog").waitFor({ state: "detached" }); await page.waitForFunction(() => !window.deviceSecurityFixture.metrics().busy); }
    for (const viewport of [{ width: 360, height: 640 }, { width: 320, height: 568 }]) {
      for (const scale of [1, 2]) {
        const label = `${viewport.width}x${viewport.height}-font${scale}`;
        await page.setViewportSize(viewport);
        await page.goto(origin);
        await page.waitForFunction(() => Boolean(window.deviceSecurityFixture));
        await page.evaluate(factor => {
          // Text-only browser stress, not an emulation of native Dynamic Type.
          const scaled = new WeakSet();
          const apply = () => {
            for (const element of document.querySelectorAll("#root *")) {
              if (scaled.has(element) || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
              const style = getComputedStyle(element);
              if (style.fontFamily.includes("ionicons")) continue;
              scaled.add(element);
              element.style.fontSize = `${parseFloat(style.fontSize) * factor}px`;
              if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * factor}px`;
            }
          };
          new MutationObserver(apply).observe(document.getElementById("root"), { childList: true, subtree: true });
          apply();
        }, scale);
        await check(`${label}: offer header/body, scrolling and 44px actions`, async () => {
          await fresh("offer");
          await heading("¿Vincular con la seguridad del teléfono?").scrollIntoViewIfNeeded();
          await layout(label);
          await screenshot(label + "-offer-top");
          await page.getByText(/Es opcional\. Qualitzer no recibe ni guarda/).waitFor();
          const fontSize = await page.getByText(/Es opcional\. Qualitzer no recibe ni guarda/).evaluate(element => parseFloat(getComputedStyle(element).fontSize));
          assert.ok(fontSize >= 14 * scale);
          await reachable(button("Vincular y verificar"));
          await reachable(button("Ahora no"));
          await screenshot(label + "-offer-bottom");
          await button("Ahora no").click();
          await heading("Seguridad del teléfono").waitFor();
          assert.deepEqual((await metrics()).writes, ["declined"]);
          assert.equal((await metrics()).authentications, 0);
        });
        await check(`${label}: activate opens fake dialog, cancel remains offered, retry activates`, async () => {
          await fresh("offer");
          await button("Vincular y verificar").click();
          await page.getByRole("dialog").waitFor();
          assert.equal((await metrics()).busy, true);
          await reachable(button("Cancelar simulación"));
          await layout(label);
          await screenshot(label + "-fake-dialog");
          await button("Cancelar simulación").click();
          await page.getByRole("alert").filter({ hasText: "Autenticación cancelada" }).waitFor();
          assert.equal((await metrics()).enabled, false);
          assert.equal((await metrics()).offered, true);
          assert.deepEqual((await metrics()).writes, []);
          await reachable(button("Ahora no"));
          await layout(label);
          await screenshot(label + "-cancel-error");
          await button("Vincular y verificar").click();
          await confirm();
          await page.getByText("Vinculada a este teléfono", { exact: true }).waitFor();
          assert.deepEqual((await metrics()).writes, ["enabled"]);
        });
        await check(`${label}: locked cancel preserves lock and explicit retry unlocks`, async () => {
          await fresh("locked");
          await heading("Tu espacio está protegido").scrollIntoViewIfNeeded();
          await layout(label);
          await screenshot(label + "-locked-top");
          await reachable(button("Desbloquear"));
          await button("Desbloquear").click();
          await button("Cancelar simulación").click();
          await page.waitForFunction(() => !window.deviceSecurityFixture.metrics().busy);
          await reachable(button("Reintentar desbloqueo"));
          assert.equal((await metrics()).locked, true);
          assert.equal(await heading("Perfil de prueba aislada").count(), 0);
          await layout(label);
          await screenshot(label + "-locked-retry");
          await button("Reintentar desbloqueo").click();
          await confirm();
          await heading("Seguridad del teléfono").waitFor();
          assert.equal((await metrics()).locked, false);
          assert.equal((await metrics()).authentications, 2);
          await page.evaluate(() => window.deviceSecurityFixture.backgroundAndReturn());
          await button("Desbloquear").waitFor();
          assert.equal((await metrics()).locked, true);
        });
        await check(`${label}: real card activate, cancel, enable, disable`, async () => {
          await fresh("card");
          await heading("Seguridad del teléfono").scrollIntoViewIfNeeded();
          await layout(label);
          await screenshot(label + "-card-top");
          await reachable(button("Vincular seguridad del teléfono"));
          await screenshot(label + "-card-bottom");
          await button("Vincular seguridad del teléfono").click();
          await button("Cancelar simulación").click();
          await page.getByRole("alert").waitFor();
          assert.deepEqual((await metrics()).writes, []);
          await button("Vincular seguridad del teléfono").click();
          await confirm();
          await reachable(button("Desvincular seguridad del teléfono"));
          await layout(label);
          await screenshot(label + "-card-enabled");
          await button("Desvincular seguridad del teléfono").click();
          await confirm();
          await button("Vincular seguridad del teléfono").waitFor();
          assert.deepEqual((await metrics()).writes, ["enabled", "declined"]);
        });
        await check(`${label}: loading and secure-read error`, async () => {
          await fresh("loading");
          await page.getByLabel("Verificando seguridad del teléfono", { exact: true }).waitFor();
          assert.equal(await page.getByRole("button").count(), 0);
          await layout(label);
          await screenshot(label + "-loading");
          await page.evaluate(() => window.deviceSecurityFixture.releaseRead());
          await heading("Seguridad del teléfono").waitFor();
          await fresh("readError");
          await page.getByRole("alert").waitFor();
          await reachable(button("Reintentar lectura segura"));
          await layout(label);
          await screenshot(label + "-read-error");
          await button("Reintentar lectura segura").click();
          await page.getByRole("alert").waitFor();
          assert.equal((await metrics()).ready, false);
        });
      }
    }
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.blockedRequests, []);
    assert.deepEqual(hashes(), report.sourceHashes, "Source changed during smoke; rerun on stable inputs");
    report.passed = true;
  } catch (error) {
    report.failure = error.message;
    if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
    if (server?.listening) { await new Promise(resolve => server.close(resolve)); report.cleanup.serverClosed = true; }
    report.counts = { passed: report.tests.filter(test => test.passed).length, failed: report.tests.filter(test => !test.passed).length, screenshots: report.screenshots.length };
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, counts: report.counts, failure: report.failure, cleanup: report.cleanup }));
  }
}
main().catch(() => { process.exitCode = 1; });