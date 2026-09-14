const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const strict = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const { build } = require(require.resolve("esbuild", { paths: [root] }));
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = path.join(root, "artifacts/logs/durable-fluidity-ui", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { passed: false, node: process.version, output, assertionCount: 0, tests: [], errors: [], blocked: [], screenshots: [], measurements: [], sourceIssues: [],
  scope: "Real RN Web WorkDetailScreen/ChecklistTab/StepEditor/AssignmentWorkCard/CommentsTab/FileWorkspace/ChecklistAssociationPanel and draft stores; isolated IndexedDB commit gate + never-resolving mock remote callbacks. No real repository/engine/network sync/native/OS auth/API/business account tested.",
  limitations: ["Picker is synthetic; real Ionicons font is embedded", "Checklist association is an inline expanded panel, not a Modal", "Applied receipt and causal snapshot proofs are fixture inputs; repository read-before-GET provenance is not exercised", "Browser IndexedDB persistence is tested, not native SQLite/filesystem or process death", "No historical visual baseline: screenshots compare before commit, held commit, queued and reconciled states"] };
const assert = new Proxy(strict, { get(target, key) { const value = target[key]; return typeof value === "function" ? (...args) => { report.assertionCount++; return value(...args); } : value; } });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const stubs = {
  "@expo/vector-icons": 'export {default as Ionicons} from "@expo/vector-icons/build/Ionicons";',
  "expo-font": 'const loaded = new Set(); export const isLoaded = name => loaded.has(name); export async function loadAsync(fonts) { for (const [name, source] of Object.entries(fonts)) { if (loaded.has(name)) continue; const face = new FontFace(name, `url(${source})`); await face.load(); document.fonts.add(face); loaded.add(name); } }',
  "expo-linear-gradient": 'export { View as LinearGradient } from "react-native";',
  "expo-file-system": 'export class File { constructor(){throw new Error("FIXTURE_FORBIDS_NATIVE_FILESYSTEM");} } export class Directory extends File {} export const Paths = {};',
  "expo-image-picker": 'export const UIImagePickerPreferredAssetRepresentationMode={Current:"current"}; export const requestCameraPermissionsAsync=async()=>({granted:true}); export const launchCameraAsync=async()=>({canceled:true}); export const launchImageLibraryAsync=launchCameraAsync;',
  "expo-document-picker": 'let count=0; export const getDocumentAsync=async()=>{const file=new File(["isolated durable evidence " + ++count],"evidence-"+count+".txt",{type:"text/plain"}); return {canceled:false,assets:[{uri:URL.createObjectURL(file),name:file.name,mimeType:file.type,size:file.size,file}]};};',
};
async function main() {
  let browser, server, context, page;
  process.chdir(root);
  assert.match(process.version, /^v22\./, "Use project-local Node 22 only");
  try {
    const ts = require("typescript");
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const program = ts.createProgram([path.join(root, "tests/e2e/durable-fluidity-fixture.tsx")], { ...parsed.options, noEmit: true });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    report.types = diagnostics.map(item => ({ file: item.file ? path.relative(root, item.file.fileName).replace(/\\/g, "/") : null, line: item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start).line + 1 : null, code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, "\n") }));
    report.sourceIssues.push(...report.types.filter(item => item.file?.startsWith("src/")));
    const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/e2e/durable-fluidity-fixture.tsx"], bundle: true, write: false, metafile: true, sourcemap: "external", outfile: path.join(output, "fixture.js"), platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }, alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl", ".ttf": "dataurl", ".js": "jsx" }, resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
      plugins: [{ name: "durable-isolated-boundaries", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "fixture" } : /\/infrastructure\/photos$/.test(args.path) ? { path: "photos", namespace: "fixture" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "photos" ? 'export const uploadFetch=async()=>{throw new Error("FIXTURE_FORBIDS_NETWORK");};' : stubs[args.path], loader: "js", resolveDir: root }));
      } }],
    });
    const sourcePaths = Object.keys(bundle.metafile.inputs).filter(file => file.startsWith("src/") || file === "tests/e2e/durable-fluidity-fixture.tsx");
    report.sources = Object.fromEntries(sourcePaths.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
    report.realComponents = ["src/screens/WorkDetailScreen.tsx", "src/screens/orders/AssignmentWorkCard.tsx", "src/screens/workDetail/CommentsTab.tsx", "src/screens/workDetail/FileWorkspace.tsx", "src/screens/workDetail/checklist/ChecklistAssociationPanel.tsx", "src/screens/workDetail/checklist/StepEditor.tsx"];
    for (const file of report.realComponents) assert.ok(bundle.metafile.inputs[file], `Real source missing: ${file}`);
    assert.equal(Object.keys(bundle.metafile.inputs).some(file => /HttpTechnicianRepository|DeviceSecurityProvider|sessionStorage|expo-secure-store|(?:^|\/)server\//.test(file)), false, "No real API or OS authentication graph");
    for (const compiled of bundle.outputFiles) fs.writeFileSync(compiled.path, compiled.contents);
    fs.writeFileSync(path.join(output, "metafile.json"), JSON.stringify(bundle.metafile, null, 2));
    const js = bundle.outputFiles.find(file => file.path.endsWith("fixture.js")).text;
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'unsafe-inline\'; font-src data:; img-src blob: data:; connect-src blob:"><link rel="icon" href="data:,"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
    server = http.createServer((request, response) => {
      if (request.method !== "GET" || !["/", "/fixture.js"].includes(request.url)) return response.writeHead(404).end();
      response.setHeader("Content-Type", request.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
      response.end(request.url === "/" ? html : js);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.origin = origin;
    browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
    context = await browser.newContext({ serviceWorkers: "block", locale: "es-CL", timezoneId: "UTC" });
    await context.route("**/*", route => {
      if (route.request().method() === "GET" && [origin + "/", origin + "/fixture.js"].includes(route.request().url())) return route.continue();
      report.blocked.push(route.request().url()); return route.abort();
    });
    await context.routeWebSocket("**/*", socket => { report.blocked.push("websocket"); socket.close(); });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on("pageerror", error => report.errors.push(error.message));
    await page.clock.install({ fixedTime: new Date("2026-09-14T12:00:00Z") });
    const button = name => page.getByRole("button", { name, exact: true });
    const heading = name => page.getByRole("heading", { name, exact: true });
    const metrics = () => page.evaluate(() => window.durableFluidity.metrics());
    const settle = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.evaluate(() => document.fonts.ready); };
    async function fresh(screen, options = {}) {
      await page.goto(origin); await page.waitForFunction(() => Boolean(window.durableFluidity));
      await page.evaluate(({ screen, options }) => window.durableFluidity.render(screen, options), { screen, options });
      await settle();
    }
    async function screenshot(name) {
      await settle();
      const file = path.join(output, `${name}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(path.relative(root, file).replace(/\\/g, "/"));
    }
    async function targets(name, locators, width) {
      for (const locator of locators) {
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= -1 && box.x + box.width <= width + 1, `${name}: ${JSON.stringify(box)}`);
        report.measurements.push({ name, width, label: await locator.getAttribute("aria-label") ?? await locator.innerText(), box });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    async function holding(count) {
      await page.waitForFunction(count => window.durableFluidity.metrics().attempts.length === count && window.durableFluidity.metrics().gates === 1, count);
      const value = await metrics();
      assert.equal(value.committed.length, count - 1, "No acceptance before local commit");
      assert.equal(value.remoteStarts, count - 1, "No remote dispatch before local commit");
      assert.equal((await page.evaluate(() => window.durableFluidity.durable())).length, count - 1, "Separate IndexedDB read sees only committed records");
    }
    async function release(count) {
      const started = performance.now();
      await page.evaluate(() => window.durableFluidity.release());
      await page.waitForFunction(count => window.durableFluidity.metrics().committed.length === count, count);
      const value = await metrics();
      assert.equal(value.remoteStarts, count);
      assert.equal(value.remoteCompleted, 0, "Mock remote promises are never resolved");
      const persisted = await page.evaluate(() => window.durableFluidity.durable());
      assert.equal(persisted.length, count);
      assert.deepEqual(persisted.map(row => row.operation.id).sort(), value.committed.map(op => op.id).sort());
      report.measurements.push({ name: "local-commit-to-publication-ms", count, milliseconds: performance.now() - started });
    }
    async function check(name, run) {
      const before = report.assertionCount;
      const started = performance.now();
      try { await run(); report.tests.push({ name, passed: true, assertions: report.assertionCount - before, milliseconds: performance.now() - started }); }
      catch (error) {
        report.tests.push({ name, passed: false, assertions: report.assertionCount - before, error: error.stack, milliseconds: performance.now() - started });
        try { await screenshot(`${name}-FAILED`); fs.writeFileSync(path.join(output, `${name}-body.txt`), await page.locator("body").innerText()); } catch {}
      }
      save();
    }
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const screen of ["card", "card-explicit", "detail"]) await check(`${width}-${screen}-timer-sequence-reconciliation`, async () => {
        await fresh(screen);
        const names = screen === "detail" ? ["Iniciar trabajo", "Pausar trabajo", "Reanudar trabajo", "Entregar trabajo"] : ["Iniciar", "Pausar", "Reanudar", "Entregar"];
        await targets(`${screen}-timer`, [button(names[0]), button(names[3])], width);
        await screenshot(`${width}-${screen}-before`);
        await button(names[0]).click(); await holding(1);
        assert.equal(await button(names[0]).isDisabled(), true);
        assert.equal(await button(names[1]).count(), 0);
        await screenshot(`${width}-${screen}-commit-held`);
        await release(1); await button(names[1]).waitFor();
        assert.equal(await button(names[1]).isEnabled(), true);
        assert.equal(await button(names[3]).isDisabled(), true);
        assert.equal((await metrics()).work.status, "pending");
        await screenshot(`${width}-${screen}-start-queued`);
        await button(names[1]).click(); await holding(2);
        assert.equal(await button(names[1]).isDisabled(), true);
        await release(2); await button(names[2]).waitFor();
        assert.equal(await button(names[2]).isEnabled(), true);
        const value = await metrics();
        assert.deepEqual(value.attempts.map(op => op.payload.status), ["in_progress", "paused"]);
        assert.equal(value.committed[1].dependencyId, value.committed[0].id);
        assert.equal(value.committed[1].payload.baseStatus, "in_progress");
        const before = await page.locator("body").innerText();
        await page.clock.runFor(3100); await settle();
        assert.equal(await page.locator("body").innerText(), before, "Pending timer does not simulate elapsed progress");
        await page.evaluate(() => window.durableFluidity.applied()); await settle();
        await page.getByText(`${names[2]} · Actualizando…`, { exact: true }).waitFor();
        assert.equal(await button(names[2]).isDisabled(), true);
        assert.equal(await button(names[3]).isDisabled(), true);
        await screenshot(`${width}-${screen}-applied-stale`);
        await page.evaluate(() => window.durableFluidity.publishWork("paused", false)); await settle();
        assert.equal(await button(names[2]).isDisabled(), true, "Matching status without causal proof is not reconciliation");
        await page.evaluate(() => window.durableFluidity.publishWork("pending", true)); await settle();
        await button(names[0]).waitFor();
        assert.equal(await button(names[0]).isEnabled(), true, "Fresh authoritative status wins over desired paused state");
        assert.equal(await page.getByText(`${names[2]} · Actualizando…`, { exact: true }).count(), 0);
        assert.equal((await metrics()).attempts.length, 2, "Reconciliation never resubmits");
        await screenshot(`${width}-${screen}-reconciled`);
      });
      await check(`${width}-answer-save-next-local-commit`, async () => {
        await fresh("answers", { holdReads: true });
        await page.getByRole("button", { name: /^Abrir FLUIDITY:/ }).click();
        await heading("¿El equipo está limpio?").waitFor();
        await targets("answer-dock", [button("Paso anterior sin guardar"), button("Guardar y siguiente"), button("Paso siguiente sin guardar"), button("Resumen de pasos")], width);
        const dock = await page.getByTestId("checklist-step-dock").boundingBox();
        assert.ok(dock && Math.abs(dock.y + dock.height - 844) <= 1, "Checklist dock anchored to viewport");
        await page.getByRole("radio", { name: "Sí", exact: true }).click();
        await button("Guardar y siguiente").click(); await holding(1);
        await heading("¿El equipo está limpio?").waitFor();
        assert.equal(await button("Paso siguiente sin guardar").isDisabled(), true);
        await screenshot(`${width}-answer-commit-held`);
        await release(1); await heading("Observación siguiente").waitFor();
        assert.equal(await button("Paso anterior sin guardar").isEnabled(), true);
        assert.equal((await metrics()).work.checklistDone, 0);
        assert.equal((await metrics()).refreshes, 0);
        await button("Paso anterior sin guardar").click();
        await page.getByText("Respuesta registrada en el teléfono", { exact: true }).waitFor();
        assert.equal(await button("Respuesta ya registrada en cola").isDisabled(), true);
        assert.equal((await metrics()).attempts.length, 1);
        await screenshot(`${width}-answer-queued-no-progress`);
        await page.evaluate(() => window.durableFluidity.applied()); await settle();
        assert.equal((await metrics()).work.checklistDone, 0, "Receipt alone does not invent checklist progress");
        assert.equal((await metrics()).work.checklists[0].steps[0].isCompleted, null);
      });
      await check(`${width}-comments-distinct-while-history-unresolved`, async () => {
        await fresh("comments", { holdReads: true });
        const field = page.getByRole("textbox", { name: "Comentario", exact: true });
        const submit = button("Guardar comentario · sincronizar");
        for (let count = 1; count <= 2; count++) {
          await field.fill(`Comentario distinto ${count}`);
          await targets("comment-submit", [submit], width);
          await submit.click(); await holding(count);
          assert.equal(await field.inputValue(), `Comentario distinto ${count}`);
          assert.equal(await submit.isDisabled(), true);
          await release(count);
          await page.waitForFunction(() => document.querySelector('[aria-label="Comentario"]').value === "");
        }
        const value = await metrics();
        assert.deepEqual(value.committed.map(op => op.text), ["Comentario distinto 1", "Comentario distinto 2"]);
        assert.equal(value.commentLoads, 1, "Queued acceptance does not await or refetch history");
        assert.equal(new Set(value.committed.map(op => op.id)).size, 2);
        await field.fill("Comentario distinto 1"); await settle();
        assert.equal(await submit.isDisabled(), true, "Same pending text cannot enqueue twice");
        await field.fill("Tercer borrador conservado"); await settle();
        assert.equal(await submit.isEnabled(), true);
        await page.getByRole("heading", { name: "Comentarios locales · pendientes", exact: true }).scrollIntoViewIfNeeded();
        await screenshot(`${width}-comments-two-queued`);
        await page.evaluate(() => window.durableFluidity.applied());
        await page.waitForFunction(() => window.durableFluidity.metrics().commentLoads === 2);
        assert.equal(await field.inputValue(), "Tercer borrador conservado");
        assert.equal(await submit.isEnabled(), true, "Applied background history read does not lock new comment");
        await page.evaluate(() => window.durableFluidity.revision());
        await page.waitForFunction(() => window.durableFluidity.metrics().commentLoads === 3);
        assert.equal((await metrics()).attempts.length, 2);
      });
      await check(`${width}-files-enqueue-with-list-unresolved`, async () => {
        await fresh("files", { holdReads: true });
        await targets("file-actions", [button("Cámara"), button("Galería"), button("Archivos"), button("Ayuda de archivos y límites")], width);
        const dock = await page.getByTestId("files-save-dock").boundingBox();
        assert.ok(dock && Math.abs(dock.y + dock.height - 844) <= 1);
        for (let count = 1; count <= 2; count++) {
          await button("Archivos").click(); await button("Guardar archivos · 1").waitFor();
          await targets("file-save", [button("Guardar archivos · 1")], width);
          await button("Guardar archivos · 1").click(); await holding(count);
          assert.equal(await button("Guardar archivos · 1").isDisabled(), true);
          await release(count); await button("Guardar archivos · 0").waitFor();
          assert.equal(await button("Archivos").isEnabled(), true);
          await page.getByText(`0 confirmados · ${count} en cola`, { exact: true }).waitFor();
        }
        const value = await metrics();
        assert.equal(value.fileLoads, 1, "Queue callback does not trigger/wait for file list");
        assert.equal(value.attempts.length, 2);
        const bytes = await page.evaluate(async () => Promise.all((await window.durableFluidity.durable()).map(async row => ({ id: row.operation.id, text: await row.bytes?.text(), size: row.bytes?.size }))));
        assert.deepEqual(bytes.map(row => row.text).sort(), ["isolated durable evidence 1", "isolated durable evidence 2"]);
        assert.ok(bytes.every(row => row.size === Buffer.byteLength(row.text, "utf8")));
        assert.ok(value.committed.every(op => op.sourceDraftId && op.file.sha256.length === 64));
        for (const entry of await button("Eliminar archivo").all()) assert.equal(await entry.isDisabled(), true);
        await screenshot(`${width}-files-two-queued`);
        await page.evaluate(() => window.durableFluidity.applied());
        await page.waitForFunction(() => window.durableFluidity.metrics().fileLoads === 2);
        assert.equal(await button("Archivos").isEnabled(), true);
        assert.equal((await metrics()).attempts.length, 2);
      });
      await check(`${width}-checklist-queued-closes-panel-no-fake-progress`, async () => {
        await fresh("association", { holdReads: true });
        await button("Agregar checklist").click();
        await page.getByRole("radio").filter({ hasText: "Inspección adicional" }).click();
        await targets("checklist-association", [button("Confirmar asociación"), button("Cancelar")], width);
        await button("Confirmar asociación").click(); await holding(1);
        assert.equal(await button("Confirmar asociación").isDisabled(), true);
        assert.equal(await button("Cancelar").isDisabled(), true);
        await screenshot(`${width}-association-commit-held`);
        await release(1); await button("Confirmar asociación").waitFor({ state: "detached" });
        await page.getByText(/^Checklist \d+ · Pendiente$/, { exact: true }).waitFor();
        assert.equal(await page.getByRole("textbox", { name: "Buscar por nombre o código", exact: true }).count(), 0);
        assert.equal(await button("Agregar checklist").isEnabled(), true);
        assert.equal((await metrics()).refreshes, 0, "Queued association does not await a remote detail refresh");
        assert.equal((await metrics()).work.checklists.length, 1);
        assert.equal((await metrics()).work.checklistTotal, 2);
        assert.equal((await metrics()).work.checklistDone, 0);
        await screenshot(`${width}-association-queued-closed`);
        await button("Agregar checklist").click();
        assert.equal(await page.getByRole("radio").filter({ hasText: "Inspección adicional" }).isDisabled(), true);
        assert.equal((await metrics()).attempts.length, 1);
        await page.evaluate(() => window.durableFluidity.applied()); await settle();
        assert.equal(await page.getByRole("radio").filter({ hasText: "Inspección adicional" }).isDisabled(), true, "Applied entry still awaits canonical association");
        assert.equal((await metrics()).work.checklists.length, 1);
      });
      await check(`${width}-readiness-pending-props`, async () => {
        await fresh("card", { offlineReady: false });
        assert.equal(await button("Iniciar").isDisabled(), true);
        await page.evaluate(() => window.durableFluidity.ready(true)); await settle();
        assert.equal(await button("Iniciar").isEnabled(), true);
        await fresh("comments", { offlineReady: false, holdReads: true });
        await page.getByRole("textbox", { name: "Comentario", exact: true }).fill("Borrador protegido");
        assert.equal(await button("Guardar comentario · sincronizar").isDisabled(), true);
        await page.evaluate(() => window.durableFluidity.ready(true)); await settle();
        assert.equal(await button("Guardar comentario · sincronizar").isEnabled(), true);
        await fresh("association", { offlineReady: false });
        assert.equal(await button("Agregar checklist").isDisabled(), true);
        assert.equal((await metrics()).attempts.length, 0);
      });
      await check(`${width}-local-commit-failure-preserves-comment`, async () => {
        await fresh("comments", { holdReads: true });
        const field = page.getByRole("textbox", { name: "Comentario", exact: true });
        await field.fill("No perder este borrador");
        await button("Guardar comentario · sincronizar").click(); await holding(1);
        await page.evaluate(() => window.durableFluidity.reject());
        await page.getByRole("alert").filter({ hasText: "No se confirmó el envío" }).waitFor();
        assert.equal(await field.inputValue(), "No perder este borrador");
        assert.equal(await button("Guardar comentario · sincronizar").isEnabled(), true);
        assert.equal((await metrics()).remoteStarts, 0);
        assert.equal((await page.evaluate(() => window.durableFluidity.durable())).length, 0);
        assert.equal(await heading("Comentarios locales · pendientes").count(), 0);
        await screenshot(`${width}-commit-failed-draft-preserved`);
      });
    }
    report.sourceChangesDuringRun = sourcePaths.filter(file => report.sources[file] !== hash(fs.readFileSync(path.join(root, file))));
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.blocked, [], "No runtime attempted remote network access");
    assert.deepEqual(report.sourceChangesDuringRun, [], "Do not certify sources changed during validation");
    report.counts = { total: report.tests.length, passed: report.tests.filter(test => test.passed).length, failed: report.tests.filter(test => !test.passed).length, assertions: report.assertionCount, screenshots: report.screenshots.length, typeErrors: report.types.length };
    report.passed = report.counts.failed === 0 && report.types.length === 0;
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (context) { await context.tracing.stop({ path: path.join(output, "trace.zip") }).catch(() => {}); await context.close(); }
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    report.finishedAt = new Date().toISOString();
    report.cleanedUp = true;
    save();
  }
}
main().catch(error => { report.error = error.stack; report.passed = false; process.exitCode = 1; }).finally(() => {
  save();
  fs.writeFileSync(path.join(output, "SUMMARY.md"), `# Validación de fluidez durable RN Web\n\n- Resultado: ${report.passed ? "PASS" : "FAIL"}\n- Node: ${report.node}\n- Casos: ${JSON.stringify(report.counts ?? {})}\n- Alcance: ${report.scope}\n- Límites: ${report.limitations.join("; ")}\n- Informe: report.json\n- Traza: trace.zip\n\n${report.tests.map(test => `- ${test.passed ? "PASS" : "FAIL"}: ${test.name}`).join("\n")}\n`);
  console.log(JSON.stringify({ passed: report.passed, output, counts: report.counts, types: report.types, failures: report.tests.filter(test => !test.passed), error: report.error, cleanedUp: report.cleanedUp }, null, 2));
});