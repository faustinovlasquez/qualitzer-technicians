const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const strict = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
const { build } = require(require.resolve("esbuild", { paths: [root] }));
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = path.join(root, "artifacts/logs/picker-messages-ui", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { passed: false, node: process.version, output, assertionCount: 0, tests: [], screenshots: [], measurements: [], errors: [], blocked: [], requests: [], cleanup: {},
  scope: "Actual WorkDetailScreen, ChecklistTab, StepEditor, FileWorkspace, OfflineStatusBar, OfflineCenterScreen, DeviceSecurityProvider, DeviceLockController, React context/useContext, useTrustedNativePicker, pickWorkspaceFiles and draft stores on isolated RN Web. Synthetic immutable backend snapshots; mocked OS adapter/foreground/screen-capture and SDK picker boundaries only.",
  limitations: ["SDK camera result and OS lifecycle/authentication are simulated, not a real camera, photo, biometric sensor or native activity", "Text-only DOM 100/200% stress, not native Dynamic Type", "Before/after screenshots compare state transitions in current sources, not an unavailable historical build or an original user screenshot", "No real API, accounts, backend execution, SQLite, native persistence, uploads, queue engine or applied receipt provenance tested"] };
const assert = new Proxy(strict, { get(target, key) { const value = target[key]; return typeof value === "function" ? (...args) => { report.assertionCount++; return value(...args); } : value; } });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const forbidden = /Sin conexión verificada|En cola · tiempo pendiente|No se pudo verificar (?:la )?conexión|Estado recibido:|solicitado:|\b(?:MOBILE|OFFLINE|TRUSTED_NATIVE)_[A-Z0-9_]+\b/i;
const stubs = {
  "@expo/vector-icons": 'export {default as Ionicons} from "@expo/vector-icons/build/Ionicons";',
  "expo-font": 'const loaded=new Set(); export const isLoaded=name=>loaded.has(name); export async function loadAsync(fonts){for(const [name,source] of Object.entries(fonts)){if(loaded.has(name))continue; const face=new FontFace(name,`url(${source})`);await face.load();document.fonts.add(face);loaded.add(name);}}',
  "expo-linear-gradient": 'import React from "react"; import {View} from "react-native"; export function LinearGradient({colors,start,end,style,...props}){return <View {...props} style={[{backgroundImage:`linear-gradient(120deg,${colors.join(",")})`},style]}/>;}',
  "expo-file-system": 'export class File{constructor(){throw new Error("FIXTURE_FORBIDS_NATIVE_FILESYSTEM");}} export class Directory extends File{} export const Paths={};',
  "expo-image-picker": 'export const UIImagePickerPreferredAssetRepresentationMode={Current:"current"};export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=()=>window.pickerOs.launchCamera();export const launchImageLibraryAsync=()=>{throw new Error("UNEXPECTED_GALLERY");};',
  "expo-document-picker": 'export const getDocumentAsync=()=>{throw new Error("UNEXPECTED_DOCUMENT_PICKER");};',
  "expo-screen-capture": 'export const preventScreenCaptureAsync=async()=>{window.pickerOs.privacy.push("prevent");};export const allowScreenCaptureAsync=async()=>{window.pickerOs.privacy.push("allow");};export const enableAppSwitcherProtectionAsync=async()=>{};export const disableAppSwitcherProtectionAsync=async()=>{};',
  "os-adapter": 'export const createDeviceSecurityAdapter=()=>window.pickerOs.adapter;',
  "foreground": 'export const readForeground=()=>window.pickerOs.foreground;export const subscribeForeground=listener=>window.pickerOs.subscribe(listener);',
  "photos-network": 'export const uploadFetch=async()=>{throw new Error("FIXTURE_FORBIDS_NETWORK");};',
};

async function main() {
  let browser, context, page, server, cdp;
  try {
    assert.match(process.version, /^v22\./);
    const ts = require("typescript");
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const program = ts.createProgram([path.join(root, "tests/e2e/picker-messages-fixture.tsx")], { ...parsed.options, noEmit: true });
    report.types = ts.getPreEmitDiagnostics(program).map(item => ({ file: item.file ? path.relative(root, item.file.fileName).replace(/\\/g, "/") : null, code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, "\n") }));
    const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/e2e/picker-messages-fixture.tsx"], bundle: true, write: false, metafile: true, sourcemap: "external", outfile: path.join(output, "fixture.js"), platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }, alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl", ".ttf": "dataurl", ".js": "jsx" }, resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
      plugins: [{ name: "picker-messages-os-boundaries", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          const key = stubs[args.path] ? args.path : /(?:^|\/)deviceSecurityAdapter$/.test(args.path) ? "os-adapter" : /(?:^|\/)offline\/foreground$/.test(args.path) ? "foreground" : /\/infrastructure\/photos$/.test(args.path) ? "photos-network" : null;
          return key ? { path: key, namespace: "fixture" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "jsx", resolveDir: root }));
      } }],
    });
    const inputs = Object.keys(bundle.metafile.inputs);
    report.sources = Object.fromEntries(inputs.filter(file => file.startsWith("src/") || file === "tests/e2e/picker-messages-fixture.tsx").map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
    report.realComponents = ["src/screens/WorkDetailScreen.tsx", "src/screens/workDetail/ChecklistTab.tsx", "src/screens/workDetail/checklist/StepEditor.tsx", "src/screens/workDetail/FileWorkspace.tsx", "src/screens/offline/OfflineCenterScreen.tsx", "src/screens/offline/OfflineStatusBar.tsx", "src/security/DeviceSecurityProvider.tsx", "src/security/DeviceSecurityContext.tsx", "src/security/DeviceLockController.ts", "src/security/useTrustedNativePicker.ts", "src/security/trustedNativeInteraction.ts", "src/screens/workDetail/files/filePicker.ts", "src/screens/workDetail/useAttachmentFiles.ts"];
    for (const file of report.realComponents) assert.ok(inputs.includes(file), `Actual source required: ${file}`);
    assert.equal(inputs.some(file => /HttpTechnicianRepository|sessionStorage|expo-secure-store|(?:^|\/)server\//.test(file)), false);
    for (const file of bundle.outputFiles) fs.writeFileSync(file.path, file.contents);
    fs.writeFileSync(path.join(output, "metafile.json"), JSON.stringify(bundle.metafile, null, 2));
    const js = bundle.outputFiles.find(file => file.path.endsWith("fixture.js")).text;
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
    server = http.createServer((request, response) => {
      report.requests.push({ method: request.method, path: request.url });
      if (request.method !== "GET" || !["/", "/fixture.js"].includes(request.url)) return response.writeHead(404).end();
      response.setHeader("Content-Type", request.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src data:; img-src blob: data:; connect-src blob:; base-uri 'none'; form-action 'none'");
      response.end(request.url === "/" ? html : js);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`; report.origin = origin;
    browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
    context = await browser.newContext({ serviceWorkers: "block", locale: "es-CL", timezoneId: "UTC" });
    await context.route("**/*", route => {
      if (route.request().method() === "GET" && [origin + "/", origin + "/fixture.js"].includes(route.request().url())) return route.continue();
      report.blocked.push({ method: route.request().method(), type: route.request().resourceType() }); return route.abort();
    });
    await context.routeWebSocket("**/*", socket => { report.blocked.push({ type: "websocket" }); socket.close(); });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage(); page.setDefaultTimeout(7000);
    page.on("pageerror", error => report.errors.push(error.message));
    await page.clock.install({ fixedTime: new Date("2026-09-14T12:00:00Z") });
    cdp = await context.newCDPSession(page);
    const button = name => page.getByRole("button", { name, exact: true });
    const heading = name => page.getByRole("heading", { name, exact: true });
    const metrics = () => page.evaluate(() => window.pickerMessages.metrics());
    const os = () => page.evaluate(() => ({ prompts: window.pickerOs.prompts, cameraStarts: window.pickerOs.cameraStarts, cameraSettled: window.pickerOs.cameraSettled, privacy: window.pickerOs.privacy, events: window.pickerOs.events }));
    const settle = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.evaluate(() => document.fonts.ready); };
    async function screenshot(name) { await settle(); const file = path.join(output, `${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(path.relative(root, file).replace(/\\/g, "/")); }
    async function quiet(name) {
      assert.doesNotMatch(await page.locator("body").innerText(), forbidden, `${name}: visible text`);
      const attributes = await page.evaluate(() => [...document.querySelectorAll("*")].flatMap(element => [...element.attributes].filter(attribute => /^(?:aria-|title$|alt$)/.test(attribute.name)).map(attribute => attribute.value)).join("\n"));
      assert.doesNotMatch(attributes, forbidden, `${name}: all DOM accessibility attributes including hidden nodes`);
      const tree = await cdp.send("Accessibility.getFullAXTree");
      const text = tree.nodes.flatMap(node => [node.name?.value, node.description?.value, node.value?.value]).filter(value => typeof value === "string").join("\n");
      assert.doesNotMatch(text, forbidden, `${name}: full browser accessibility tree`);
      fs.writeFileSync(path.join(output, `${name}-accessibility.json`), JSON.stringify(tree, null, 2));
    }
    async function fresh(scenario, tab, scale) {
      await page.goto(origin);
      await page.waitForFunction(() => window.pickerOs?.prompts === 1);
      assert.equal((await os()).prompts, 1, "Exactly one initial fake OS auth prompt");
      await page.evaluate(() => window.pickerOs.confirm());
      await page.waitForFunction(() => { try { return window.pickerMessages.metrics().unlocked; } catch { return false; } });
      await page.evaluate(({ scenario, tab }) => window.pickerMessages.render(scenario, tab), { scenario, tab });
      await page.waitForFunction(() => window.pickerMessages.metrics().providerRunnerPresent);
      await page.evaluate(factor => {
        const scaled = new WeakSet();
        const apply = () => { for (const element of document.querySelectorAll("#root *")) {
          if (scaled.has(element) || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
          const style = getComputedStyle(element); if (style.fontFamily.includes("ionicons")) continue;
          scaled.add(element); element.style.fontSize = `${parseFloat(style.fontSize) * factor}px`;
          if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * factor}px`;
        } }; new MutationObserver(apply).observe(document.getElementById("root"), { childList: true, subtree: true }); apply();
      }, scale);
      await settle();
      assert.equal((await os()).prompts, 1, "Remounting synthetic work does not remount/bypass provider");
      assert.equal((await metrics()).providerRunnerPresent, true, "Real React context supplies the real provider picker runner");
    }
    async function openChecklist() { await page.getByRole("button", { name: /^Abrir EQUIPMENT_DISPATCH_CHECKLIST_1:/ }).click(); await page.getByTestId("checklist-step-dock").waitFor(); await settle(); }
    async function jump(number) { await button("Resumen de pasos").click(); await page.getByRole("textbox", { name: "Buscar paso", exact: true }).fill(String(number)); await page.getByRole("button", { name: new RegExp(`^Paso ${number}:`) }).click(); await settle(); }
    async function progress(completed, percentage) {
      await page.getByText(`${completed}/46 requisitos confirmados · ${percentage}%`, { exact: true }).waitFor();
      const bar = page.getByRole("progressbar", { name: "Requisitos confirmados", exact: true });
      assert.equal(await bar.count(), 1);
      const measurement = await bar.evaluate(element => ({ ariaNow: element.getAttribute("aria-valuenow"), ariaMax: element.getAttribute("aria-valuemax"), width: element.getBoundingClientRect().width, fill: element.firstElementChild?.getBoundingClientRect().width }));
      assert.ok(measurement.width > 0 && typeof measurement.fill === "number" && Math.abs(measurement.fill / measurement.width * 100 - percentage) < 0.1, "Actual progress fill matches the visible confirmed percentage");
      report.measurements.push({ name: "confirmed-progress", completed, total: 46, percentage, ...measurement });
      if (measurement.ariaNow === null && !report.limitations.includes("RN Web omits native accessibilityValue numeric aria-valuenow/max; visible counts and rendered fill are verified, numeric screen-reader semantics are not claimed")) report.limitations.push("RN Web omits native accessibilityValue numeric aria-valuenow/max; visible counts and rendered fill are verified, numeric screen-reader semantics are not claimed");
      const value = await metrics(); assert.equal(value.work.checklists[0].steps.length, 47); assert.equal(value.work.checklistDone, completed); assert.equal(value.progress.completed, completed); assert.equal(value.progress.percentage, percentage);
    }
    async function dock(name, id = "checklist-step-dock") {
      const box = await page.getByTestId(id).boundingBox(); const viewport = page.viewportSize();
      assert.ok(box && Math.abs(box.y + box.height - viewport.height) <= 1, `${name}: dock must occupy actual viewport bottom: ${JSON.stringify(box)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no page horizontal overflow`);
      report.measurements.push({ name, id, viewport, box });
      return box;
    }
    async function check(name, run) {
      const before = report.assertionCount;
      try { await run(); report.tests.push({ name, passed: true, assertions: report.assertionCount - before }); }
      catch (error) { report.tests.push({ name, passed: false, assertions: report.assertionCount - before, error: error.stack }); try { await screenshot(name + "-FAILED"); fs.writeFileSync(path.join(output, `${name}-body.txt`), await page.locator("body").innerText()); } catch {} }
      save();
    }
    async function pickerLabels(name, scale) {
      const bounds = [];
      for (const title of ["Cámara", "Galería", "Archivos"]) {
        const control = button(title);
        const box = await control.boundingBox();
        const label = await control.getByText(title, { exact: true }).evaluate(element => {
          const rect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });
          const glyphs = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) for (let index = 0; index < walker.currentNode.textContent.length; index++) {
            const range = document.createRange(); range.setStart(walker.currentNode, index); range.setEnd(walker.currentNode, index + 1);
            glyphs.push(...[...range.getClientRects()].map(rect));
          }
          const style = getComputedStyle(element);
          return { box: rect(element.getBoundingClientRect()), glyphs, fontSize: parseFloat(style.fontSize), overflow: style.overflow, textOverflow: style.textOverflow };
        });
        const icon = await control.evaluate(element => {
          const glyph = [...element.querySelectorAll("*")].find(child => getComputedStyle(child).fontFamily.includes("ionicons") && child.childElementCount === 0);
          if (!glyph) return null;
          const box = glyph.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        });
        assert.ok(box && box.width >= 44 && box.height >= 44, `${name}/${title}: minimum touch target`);
        assert.equal(label.fontSize, 15 * scale, `${name}/${title}: no font reduction`);
        assert.notEqual(label.textOverflow, "ellipsis");
        assert.notEqual(label.overflow, "hidden");
        const inside = child => child.x >= box.x - 1 && child.y >= box.y - 1 && child.x + child.width <= box.x + box.width + 1 && child.y + child.height <= box.y + box.height + 1;
        assert.ok(inside(label.box) && label.glyphs.length >= title.length && label.glyphs.every(inside), `${name}/${title}: every label glyph stays inside its button: ${JSON.stringify({ box, label })}`);
        assert.ok(icon && inside(icon) && label.glyphs.every(glyph => glyph.x >= icon.x + icon.width - 1 || glyph.y >= icon.y + icon.height - 1 || glyph.y + glyph.height <= icon.y + 1), `${name}/${title}: label never overlaps its icon`);
        if (scale === 1) assert.equal(box.height, 48, `${name}/${title}: compact normal height retained`);
        bounds.push({ title, box, label, icon });
      }
      for (let index = 1; index < bounds.length; index++) assert.ok(bounds[index - 1].box.x + bounds[index - 1].box.width <= bounds[index].box.x, `${name}: buttons do not overlap`);
      report.measurements.push({ name: name + "-picker-label-bounds", scale, bounds });
    }
    async function neutralPickerCover(name) {
      await page.getByText("Esperando selección…", { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(await page.getByLabel("Esperando selección", { exact: true }).isVisible(), true);
      assert.doesNotMatch(await page.locator("body").innerText(), /huella|desbloque|vincular|protegido/i);
      assert.equal(await page.getByRole("button").count(), 0, `${name}: no authentication or private buttons while pending`);
      const tree = await cdp.send("Accessibility.getFullAXTree");
      const visibleNames = tree.nodes.filter(node => !node.ignored).flatMap(node => [node.name?.value, node.description?.value]).filter(value => typeof value === "string").join("\n");
      assert.match(visibleNames, /Esperando selección/);
      assert.doesNotMatch(visibleNames, /huella|desbloque|finger.?print|vincular|protegido/i);
      fs.writeFileSync(path.join(output, `${name}-neutral-cover-accessibility.json`), JSON.stringify(tree, null, 2));
    }
    for (const width of [360, 390]) for (const scale of [1, 2]) {
      const label = `${width}x844-font${scale * 100}`; await page.setViewportSize({ width, height: 844 });
      await check(label + "-pending-timer-detail-gates", async () => {
        await fresh("percent22", "work", scale); await button("Pausar trabajo").waitFor();
        await quiet(label + "-detail-before"); await screenshot(label + "-detail-before");
        const before = await metrics();
        assert.equal(await button("Pausar trabajo").isEnabled(), true); assert.equal(await button("Entregar trabajo").isEnabled(), true);
        await button("Entregar trabajo").click();
        assert.equal(await button("Confirmar y entregar").isDisabled(), true);
        await button("Seguir trabajando").click();
        assert.equal(before.work.status, "pending"); assert.equal(before.work.elapsedSeconds, 1200); assert.equal(before.snapshot.operations[0].payload.status, "in_progress");
        const timerText = await page.getByText("Último tiempo recibido", { exact: true }).locator("..").innerText();
        await page.clock.runFor(3100); await settle();
        assert.equal(await page.getByText("Último tiempo recibido", { exact: true }).locator("..").innerText(), timerText, "Pending timer display remains frozen across actual interval callbacks");
        await button("Pausar trabajo").scrollIntoViewIfNeeded(); await screenshot(label + "-detail-controls");
        await page.evaluate(() => window.pickerMessages.setTimer("applied")); await settle();
        assert.equal(await button("Pausar trabajo").isDisabled(), true, "Applied receipt without causal snapshot retains action gate"); assert.equal(await button("Entregar trabajo").isEnabled(), true);
        await button("Entregar trabajo").click(); assert.equal(await button("Confirmar y entregar").isDisabled(), true); await button("Seguir trabajando").click();
        await quiet(label + "-detail-applied");
        await page.evaluate(() => window.pickerMessages.setTimer("conflict")); await settle();
        assert.equal(await button("Pausar trabajo").isDisabled(), true); assert.equal(await button("Entregar trabajo").isEnabled(), true);
        await button("Entregar trabajo").click(); assert.equal(await button("Confirmar y entregar").isDisabled(), true); await button("Seguir trabajando").click();
        await page.getByRole("alert").filter({ hasText: "Contacta a soporte" }).waitFor();
        for (const readiness of ["loading", "auth"]) { await page.evaluate(value => window.pickerMessages.setReadiness(value), readiness); await settle(); assert.equal(await button("Pausar trabajo").count() === 1 ? await button("Pausar trabajo").isDisabled() : await button("Iniciar trabajo").isDisabled(), true); assert.equal(await button("Entregar trabajo").isDisabled(), true); }
        await page.evaluate(() => window.pickerMessages.setReadiness("ready")); await settle();
        assert.equal(await button("Pausar trabajo").isEnabled(), true);
        assert.deepEqual((await metrics()).work, before.work); assert.deepEqual((await metrics()).calls, []);
        await quiet(label + "-detail-after"); await screenshot(label + "-detail-after");
      });
      for (const [scenario, count, percentage] of [["seven", 7, 15], ["percent22", 10, 22]]) await check(label + "-" + scenario + "-draft-navigation", async () => {
        await fresh(scenario, "checklist", scale); await quiet(label + "-" + scenario + "-catalog"); await screenshot(label + "-" + scenario + "-catalog-before");
        await openChecklist(); await heading("¿El equipo está limpio?").waitFor(); await progress(count, percentage); await dock(label + scenario);
        const fontSize = await heading("¿El equipo está limpio?").evaluate(element => parseFloat(getComputedStyle(element).fontSize));
        assert.equal(fontSize, 20 * scale); report.measurements.push({ name: label + scenario + "-question-font", fontSize });
        await screenshot(label + "-" + scenario + "-step-before");
        const before = await metrics();
        await page.getByRole("radio", { name: "Sí", exact: true }).click();
        await button("Añadir comentario del paso").click(); await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).fill("Borrador caso 7: conservar sin enviar");
        await button("Paso siguiente sin guardar").click(); await heading("Pregunta 8").waitFor(); await button("Paso anterior sin guardar").click();
        assert.equal(await page.getByRole("radio", { name: "Sí", exact: true }).getAttribute("aria-checked"), "true");
        assert.equal(await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).inputValue(), "Borrador caso 7: conservar sin enviar");
        await progress(count, percentage); await jump(47); await heading("Pregunta 47").waitFor(); assert.equal(await button("Paso siguiente sin guardar").isDisabled(), true);
        await jump(7); await progress(count, percentage);
        await page.setViewportSize({ width, height: 640 }); await settle();
        const scroll = page.getByTestId("checklist-question-scroll"); await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
        const scrollBefore = await scroll.evaluate(element => element.scrollTop); assert.ok(scrollBefore > 0, "Real inner scroll exercised, not a vacuous zero-scroll assertion");
        const beforeDock = await dock(label + scenario + "-scrolled"); await page.evaluate(() => window.pickerMessages.setTimer("pending")); await settle();
        assert.equal(await scroll.evaluate(element => element.scrollTop), scrollBefore, "Pending timer publication does not auto-scroll the question");
        assert.deepEqual(await dock(label + scenario + "-after-publication"), beforeDock);
        report.measurements.push({ name: label + scenario + "-no-auto-scroll", height: 640, scrollBefore, scrollAfter: await scroll.evaluate(element => element.scrollTop) });
        await screenshot(label + "-" + scenario + "-reduced-height-scroll");
        await page.setViewportSize({ width, height: 844 }); await settle();
        await quiet(label + "-" + scenario + "-draft"); await screenshot(label + "-" + scenario + "-draft-after");
        assert.deepEqual((await metrics()).work, before.work); assert.deepEqual((await metrics()).calls, []);
      });
      await check(label + "-zero47-boundaries", async () => {
        await fresh("zero47", "checklist", scale); await openChecklist(); await heading("Pregunta 1").waitFor(); await progress(0, 0);
        assert.equal(await button("Paso anterior sin guardar").isDisabled(), true); await jump(47); assert.equal(await button("Paso siguiente sin guardar").isDisabled(), true); await progress(0, 0); await dock(label + "-last-step"); await quiet(label + "-last-step"); await screenshot(label + "-47-last");
      });
      for (const order of ["result-active", "active-result"]) await check(label + "-camera-" + order, async () => {
        await fresh("percent22", "checklist", scale); await openChecklist(); await heading("¿El equipo está limpio?").waitFor();
        await page.getByRole("radio", { name: "Sí", exact: true }).click(); await button("Añadir comentario del paso").click(); await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).fill("Conservar tras cámara simulada");
        const before = await metrics(); await button("Adjuntar al paso").click(); await button("Cámara").waitFor(); await settle(); await quiet(label + order + "-camera-before"); await dock(label + order, "files-save-dock"); await screenshot(label + "-camera-" + order + "-before");
        await pickerLabels(label + order + "-before", scale);
        await button("Cámara").click(); await page.waitForFunction(() => window.pickerOs.cameraStarts === 1);
        assert.equal((await metrics()).security.nativeInteractionPending, true); assert.equal((await metrics()).unlocked, false); assert.equal((await os()).prompts, 1);
        await page.evaluate(() => window.pickerOs.lifecycle(false)); await settle();
        assert.equal(await button("Cámara").isVisible(), false); assert.equal((await metrics()).security.locked, true);
        await neutralPickerCover(label + order + "-background");
        await screenshot(label + "-camera-" + order + "-private-cover");
        if (order === "result-active") {
          await page.evaluate(() => window.pickerOs.cameraResult()); await settle(); assert.equal((await metrics()).unlocked, false); assert.equal((await os()).prompts, 1);
          await page.evaluate(() => window.pickerOs.lifecycle(true));
        } else {
          await page.evaluate(() => window.pickerOs.lifecycle(true)); await settle(); assert.equal((await metrics()).unlocked, false); assert.equal((await os()).prompts, 1);
          await neutralPickerCover(label + order + "-active-pending");
          await page.evaluate(() => window.pickerOs.cameraResult());
        }
        await page.waitForFunction(() => window.pickerMessages.metrics().unlocked); await button("Guardar archivos · 1").waitFor(); await settle();
        assert.equal((await os()).prompts, 1, "No additional prompt after legitimate simulated camera return"); assert.equal((await os()).cameraSettled, 1); assert.equal((await metrics()).security.nativeInteractionPending, false);
        await pickerLabels(label + order + "-return", scale);
        assert.ok((await os()).privacy.includes("prevent")); assert.equal((await os()).privacy.at(-1), "allow");
        await page.getByText("0 confirmados · 0 en cola", { exact: true }).waitFor(); await dock(label + order + "-return", "files-save-dock"); await quiet(label + order + "-camera-return"); await screenshot(label + "-camera-" + order + "-return");
        await button("Volver al checklist").click(); await heading("¿El equipo está limpio?").waitFor();
        assert.equal(await page.getByRole("radio", { name: "Sí", exact: true }).getAttribute("aria-checked"), "true"); assert.equal(await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).inputValue(), "Conservar tras cámara simulada"); await progress(10, 22);
        await button("Adjuntar al paso").click(); await button("Guardar archivos · 1").waitFor();
        await page.evaluate(() => window.pickerOs.lifecycle(false)); await settle(); assert.equal((await metrics()).unlocked, false);
        await page.evaluate(() => window.pickerOs.lifecycle(true)); await page.waitForFunction(() => window.pickerOs.prompts === 2);
        assert.equal((await metrics()).unlocked, false, "Ordinary Home return still demands fresh authentication"); await page.evaluate(() => window.pickerOs.confirm()); await page.waitForFunction(() => window.pickerMessages.metrics().unlocked);
        await button("Guardar archivos · 1").waitFor(); assert.equal((await os()).prompts, 2); assert.equal((await os()).cameraStarts, 1); assert.deepEqual((await metrics()).work, before.work); assert.deepEqual((await metrics()).calls, []);
        report.measurements.push({ name: label + order + "-camera-lifecycle", os: await os(), confirmed: (await metrics()).progress, unsavedSelectedFiles: 1 });
        await screenshot(label + "-camera-" + order + "-home-return");
      });
      await check(label + "-center-opt-in", async () => {
        await fresh("percent22", "checklist", scale); await page.getByTestId("connection-status-bar").getByRole("button").first().click(); await heading("Centro offline").waitFor();
        const before = await metrics(); await quiet(label + "-center-before"); await page.getByText("1 operación(es) pendientes · 0 requieren atención", { exact: true }).waitFor();
        assert.equal(await button("Reintentar misma operación").count(), 0); await screenshot(label + "-center-before");
        await button("Ver detalles técnicos de sincronización").click(); await page.getByText(/MOBILE_SYNC_ACTIONS_UNAVAILABLE/).first().waitFor(); await screenshot(label + "-center-opted-in");
        await button("Ocultar diagnóstico de sincronización").click(); await quiet(label + "-center-after-global-hide");
        await button("Ver detalles técnicos").click(); await page.getByText("Operación: 11111111-1111-4111-8111-111111111111", { exact: true }).waitFor();
        assert.match(await page.locator("body").innerText(), /MOBILE_SYNC_ACTIONS_UNAVAILABLE/); await button("Ocultar detalles").click(); await quiet(label + "-center-after");
        assert.deepEqual((await metrics()).snapshot, before.snapshot); assert.deepEqual((await metrics()).calls, []); await button("Volver").click(); await screenshot(label + "-center-return");
      });
    }
    await check("friendly-trusted-code-regressions", async () => {
      const codes = ["TRUSTED_NATIVE_INTERACTION_REVOKED", "TRUSTED_NATIVE_INTERACTION_NOT_ALLOWED", "TRUSTED_NATIVE_PICKER_PROVIDER_REQUIRED", "TRUSTED_NATIVE_INTERACTION_CLOCK_INVALID", "TRUSTED_NATIVE_INTERACTION_PRIVACY_UNAVAILABLE"];
      for (const code of codes) {
        const value = await page.evaluate(code => window.pickerMessages.friendly(code), code);
        assert.equal(value.direct, code.endsWith("REVOKED") ? "La selección se interrumpió o tardó demasiado. Vuelve a tomar o elegir el archivo." : "No se pudo continuar con la selección. Desbloquea la app y vuelve a intentarlo.");
        assert.equal(value.wrapped, `No se pudo abrir la cámara. ${value.direct}`); assert.doesNotMatch(value.wrapped, /TRUSTED_NATIVE_/);
      }
    });
    await check("optional-utility-runner-real-provider", async () => {
      await fresh("seven", "checklist", 1);
      await page.evaluate(() => { window.utilityResult = null; window.pickerMessages.utilityCamera().then(value => { window.utilityResult = value; }); });
      await page.waitForFunction(() => window.pickerOs.cameraStarts === 1); await page.evaluate(() => window.pickerOs.lifecycle(false)); await page.evaluate(() => window.pickerOs.cameraResult()); await settle();
      assert.equal(await page.evaluate(() => window.utilityResult), null, "Optional utility runner defers result until foreground and privacy readiness");
      await page.evaluate(() => window.pickerOs.lifecycle(true)); await page.waitForFunction(() => window.utilityResult === 1);
      assert.equal((await os()).prompts, 1); assert.equal((await metrics()).unlocked, true); assert.equal((await metrics()).progress.completed, 7); assert.deepEqual((await metrics()).calls, []);
    });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []);
    report.sourceChanges = Object.entries(report.sources).filter(([file, before]) => hash(fs.readFileSync(path.join(root, file))) !== before).map(([file]) => file);
    assert.deepEqual(report.sourceChanges, [], "Actual bundled source inputs remain unchanged throughout execution");
    report.passed = report.tests.every(test => test.passed) && report.types.length === 0;
  } catch (error) { report.errors.push(error.stack); }
  finally {
    if (context) { try { await context.tracing.stop({ path: path.join(output, "trace.zip") }); await context.close(); report.cleanup.contextClosed = true; } catch (error) { report.errors.push(error.message); } }
    if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
    if (server) { await new Promise(resolve => server.close(resolve)); report.cleanup.serverClosed = true; }
    report.passed = report.passed && report.errors.length === 0;
    report.counts = { testCases: report.tests.length, passed: report.tests.filter(test => test.passed).length, failed: report.tests.filter(test => !test.passed).length, assertionsExecuted: report.assertionCount, screenshots: report.screenshots.length, pageOrRunnerErrors: report.errors.length, typeErrors: report.types?.length ?? null };
    save(); console.log(JSON.stringify({ output, passed: report.passed, counts: report.counts, cleanup: report.cleanup }));
    process.exitCode = report.passed ? 0 : 1;
  }
}
main().catch(error => { report.errors.push(error.stack); save(); console.error(error.stack); process.exitCode = 1; });