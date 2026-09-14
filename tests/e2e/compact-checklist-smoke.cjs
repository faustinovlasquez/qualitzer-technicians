const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { build } = require("esbuild");
const root = path.resolve(__dirname, "../..");
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-compact-checklist-"));
const report = { output, scope: "Real WorkDetailScreen, checklist, files and comments on RN Web; fake in-memory callbacks, native picker/filesystem boundaries; no native runtime or real API", tests: [], errors: [], requests: [] };
const stubs = {
  "@expo/vector-icons": `import React from 'react'; export const Ionicons = ({name}) => <span aria-hidden="true">{{'arrow-back-outline':'←','chevron-back-outline':'‹','chevron-forward-outline':'›','grid-outline':'▦','refresh-outline':'↻','attach-outline':'⌕','radio-button-off':'○','radio-button-on':'●'}[name] ?? '·'}</span>;`,
  "expo-linear-gradient": "export { View as LinearGradient } from 'react-native';",
  "expo-file-system": "export class File { constructor(){ throw new Error('NATIVE_FILESYSTEM_NOT_IN_WEB_FIXTURE'); } } export class Directory extends File {} export const Paths = {};",
  "expo-image-picker": `export const UIImagePickerPreferredAssetRepresentationMode = { Current: 'current' }; export const requestCameraPermissionsAsync = async () => ({ granted:true }); export const launchCameraAsync = async () => ({canceled:true}); export const launchImageLibraryAsync = launchCameraAsync;`,
  "expo-document-picker": `export const getDocumentAsync = async () => { const file = new File(['fixture evidence'], 'evidence.txt', {type:'text/plain'}); return {canceled:false,assets:[{uri:URL.createObjectURL(file),name:file.name,mimeType:file.type,size:file.size,file}]}; };`,
};
async function bundleFixture() {
  return build({ absWorkingDir: root, stdin: { contents: 'import { createRoot } from "react-dom/client"; import { mountCompactChecklist } from "./tests/e2e/fixtures/compact-checklist"; const root = createRoot(document.getElementById("root")); mountCompactChecklist((node) => root.render(node));', resolveDir: root, loader: "js" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }, alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl" },
    plugins: [{ name: "explicit-native-boundaries", setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: stubs[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
}
async function main() {
  const bundle = await bundleFixture();
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" || !["/", "/fixture.js"].includes(request.url)) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", request.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
    response.end(request.url === "/" ? html : bundle.outputFiles[0].text);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  if (process.argv.includes("--serve")) { console.log(`ISOLATED_CHECKLIST_FIXTURE ${url} (Ctrl+C to stop; no API)`); return; }
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      if (route.request().url().startsWith(`${url}/`)) return route.continue();
      report.requests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.goto(url);
    const button = (name) => page.getByRole("button", { name, exact: true });
    const heading = (name) => page.getByRole("heading", { name, exact: true });
    async function fresh(scenario = "standard") {
      await page.evaluate((value) => window.compactChecklist.render(value), scenario);
      await button("Abrir EQUIPMENT_DISPATCH_CHECKLIST_1: Checklist de despacho").click();
      await heading("¿El equipo está limpio?").waitFor();
    }
    async function step(number) {
      await button("Resumen de pasos").click();
      await page.getByRole("textbox", { name: "Buscar paso", exact: true }).fill(String(number));
      await page.getByRole("button", { name: new RegExp(`^Paso ${number}:`) }).click();
    }
    async function dockFits(width, height) {
      const dock = await page.getByTestId("checklist-step-dock").boundingBox();
      assert.ok(dock && dock.y >= 0 && Math.abs(dock.y + dock.height - height) <= 1, JSON.stringify({ dock, height }));
      for (const locator of [button("Paso anterior sin guardar"), button("Paso siguiente sin guardar"), page.getByTestId("checklist-step-dock").getByRole("button").nth(1)]) {
        const box = await locator.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, JSON.stringify(box));
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      return dock;
    }
    async function check(name, run) { await run(); report.tests.push({ name, passed: true }); }
    for (const width of [320, 360, 390]) {
      await check(`layout ${width}x640 question, answer and dock visible`, async () => {
        await page.setViewportSize({ width, height: 640 });
        await fresh();
        const question = await heading("¿El equipo está limpio?").boundingBox();
        const answer = await page.getByRole("radio", { name: "Sí", exact: true }).boundingBox();
        const dock = await dockFits(width, 640);
        assert.ok(question && question.y < 260, JSON.stringify(question));
        assert.ok(answer && answer.y + answer.height < dock.y, JSON.stringify(answer));
        assert.equal(await heading("Checklist de despacho").count(), 1);
        assert.doesNotMatch(await page.locator("body").innerText(), /EQUIPMENT_DISPATCH_CHECKLIST_1|Complementario|PASO 1 DE|Detalle de ejecución|TIEMPO DE EJECUCIÓN/);
        assert.equal(await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).count(), 0);
        const nested = await page.getByTestId("checklist-question-scroll").evaluate((element) => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return true;
          return false;
        });
        assert.equal(nested, false, "question must have no competing scroll ancestor");
        await page.screenshot({ path: path.join(output, `${width}-question.png`) });
      });
    }
    await check("draft survives navigation; scroll resets; no implicit save", async () => {
      await page.getByRole("radio", { name: "Sí", exact: true }).click();
      await button("Añadir comentario del paso").click();
      await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).fill("Borrador que se conserva");
      const saves = await page.evaluate(() => window.compactChecklist.saves.length);
      await page.getByTestId("checklist-question-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await button("Paso siguiente sin guardar").click();
      await heading("Pregunta 2").waitFor();
      assert.equal(await page.getByTestId("checklist-question-scroll").evaluate((element) => element.scrollTop), 0);
      await button("Paso anterior sin guardar").click();
      assert.equal(await page.getByRole("radio", { name: "Sí", exact: true }).getAttribute("aria-checked"), "true");
      assert.equal(await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).inputValue(), "Borrador que se conserva");
      assert.equal(await page.evaluate(() => window.compactChecklist.saves.length), saves);
    });
    await check("save failure remains on question and retry confirms once then advances", async () => {
      await page.evaluate(() => { window.compactChecklist.mode = "fail"; });
      await button("Guardar y siguiente").click();
      await page.getByRole("alert").filter({ hasText: "No se pudo confirmar el guardado" }).waitFor();
      await heading("¿El equipo está limpio?").waitFor();
      assert.equal(await page.getByTestId("checklist-question-scroll").evaluate((element) => element.scrollTop), 0);
      await page.evaluate(() => { window.compactChecklist.mode = "save"; });
      await button("Guardar y siguiente").click();
      await heading("Pregunta 2").waitFor();
    });
    await check("pending save locks navigation and prevents duplicate submission", async () => {
      await page.getByRole("textbox", { name: "Texto (opcional)", exact: true }).fill("Texto legible");
      await page.evaluate(() => { window.compactChecklist.mode = "hold"; });
      const before = await page.evaluate(() => window.compactChecklist.saves.length);
      await button("Guardar y siguiente").click();
      assert.equal(await button("Paso siguiente sin guardar").isDisabled(), true);
      assert.equal(await button("Resumen de pasos").isDisabled(), true);
      assert.equal(await button("Guardar y siguiente").isDisabled(), true);
      assert.equal(await page.evaluate(() => window.compactChecklist.saves.length), before + 1);
      await page.evaluate(() => { window.compactChecklist.release(); window.compactChecklist.mode = "save"; });
      await heading("Pregunta 3").waitFor();
    });
    await check("number, multiselect, approval and select inputs retain semantics", async () => {
      await page.getByRole("textbox", { name: "Respuesta numérica", exact: true }).fill("12.5");
      await button("Guardar y siguiente").click();
      await heading("Pregunta 4").waitFor();
      await page.getByRole("checkbox", { name: "Primera opción", exact: true }).click();
      await page.getByRole("checkbox", { name: "Segunda opción", exact: true }).click();
      await button("Guardar y siguiente").click();
      await heading("Pregunta 5").waitFor();
      await page.getByRole("radio", { name: "Rechazado", exact: true }).click();
      await page.getByText("La respuesta es «Rechazado». Responder este paso no equivale a aprobarlo.", { exact: true }).waitFor();
      await button("Guardar y siguiente").click();
      await heading("Pregunta 6").waitFor();
      await page.getByRole("radio", { name: "Primera opción", exact: true }).click();
      await button("Guardar y siguiente").click();
      await heading("Pregunta 7").waitFor();
      const answers = await page.evaluate(() => window.compactChecklist.saves.slice(-4).map((item) => item.answer.responseValue));
      assert.deepEqual(answers, ["12.5", [{ value: "a", label: "Primera opción" }, { value: "b", label: "Segunda opción" }], "rejected", "a"]);
    });
    await check("required evidence visible and missing evidence blocks save", async () => {
      await page.getByText("Evidencia obligatoria", { exact: true }).waitFor();
      await page.getByRole("radio", { name: "Sí", exact: true }).click();
      const before = await page.evaluate(() => window.compactChecklist.saves.length);
      await button("Guardar y siguiente").click();
      await page.getByRole("alert").filter({ hasText: "Falta evidencia confirmada" }).waitFor();
      assert.equal(await page.evaluate(() => window.compactChecklist.saves.length), before);
      await page.screenshot({ path: path.join(output, "390-required-evidence.png") });
    });
    await check("step files upload/delete and return preserve selected step", async () => {
      await button("Adjuntar al paso").click();
      await button("Archivos").click();
      await button("Guardar archivos · 1").click();
      await button("Eliminar archivo guardado: evidence.txt").waitFor();
      assert.deepEqual(await page.evaluate(() => window.compactChecklist.uploads.at(-1)), { stepId: "1007", name: "evidence.txt", size: 16 });
      await button("Volver al checklist").click();
      await heading("Pregunta 7").waitFor();
      await page.getByText("Archivos · 1 confirmados · requeridos para entregar", { exact: true }).waitFor();
      await button("Adjuntar al paso").click();
      await button("Eliminar archivo guardado: evidence.txt").click();
      await button("Confirmar eliminación").click();
      await button("Confirmar eliminación").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => window.compactChecklist.deletes.length), 1);
      await button("Volver al checklist").click();
      await heading("Pregunta 7").waitFor();
    });
    await check("summary jump to last and first respects navigation limits", async () => {
      await step(47);
      await heading("Pregunta 47").waitFor();
      assert.equal(await button("Paso siguiente sin guardar").isDisabled(), true);
      await button("Guardar respuesta").waitFor();
      await step(1);
      assert.equal(await button("Paso anterior sin guardar").isDisabled(), true);
    });
    await check("full work details and comments remain reachable", async () => {
      await button("Ver detalle del trabajo, archivos y comentarios").click();
      await page.getByRole("tab", { name: "Comentarios", exact: true }).click();
      await page.getByRole("textbox", { name: "Comentario", exact: true }).fill("Comentario independiente");
      await button("Guardar comentario · sincronizar").click();
      await page.getByText("Comentario publicado.", { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.compactChecklist.comments), ["Comentario independiente"]);
      await page.getByRole("tab", { name: "Checklist", exact: true }).click();
      await heading("¿El equipo está limpio?").waitFor();
    });
    await check("queued answer stays visibly unconfirmed and cannot be sent twice", async () => {
      await fresh();
      await page.evaluate(() => { window.compactChecklist.mode = "queue"; });
      await page.getByRole("radio", { name: "Sí", exact: true }).click();
      await button("Guardar y siguiente").click();
      await heading("Pregunta 2").waitFor();
      await button("Paso anterior sin guardar").click();
      await page.getByText("En cola · sin confirmar", { exact: true }).waitFor();
      assert.equal(await button("Respuesta ya registrada en cola").isDisabled(), true);
      assert.match(await page.getByTestId("connection-status-bar").innerText(), /1/);
      await page.screenshot({ path: path.join(output, "390-queued.png") });
    });
    await check("readonly and empty checklist remain usable", async () => {
      await fresh("readonly");
      assert.equal(await page.getByRole("radio", { name: "Sí", exact: true }).isDisabled(), true);
      assert.equal(await button("Guardar y siguiente").count(), 0);
      await button("Consultar evidencias del paso").waitFor();
      await button("Paso siguiente sin guardar").click();
      await heading("Pregunta 2").waitFor();
      await page.evaluate(() => window.compactChecklist.render("empty"));
      await heading("Sin checklists disponibles").waitFor();
    });
    await check("long question scroll cannot move fixed navigation", async () => {
      await page.setViewportSize({ width: 320, height: 640 });
      await fresh("long");
      const before = await dockFits(320, 640);
      await page.getByTestId("checklist-question-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
      assert.ok(await page.getByTestId("checklist-question-scroll").evaluate((element) => element.scrollTop > 0));
      assert.deepEqual(await dockFits(320, 640), before);
      await button("Paso siguiente sin guardar").click();
      await heading("Pregunta 2").waitFor();
      assert.equal(await page.getByTestId("checklist-question-scroll").evaluate((element) => element.scrollTop), 0);
    });
    for (const width of [320, 360, 390]) {
      await check(`reduced viewport ${width}x380 with text focus (not native keyboard)`, async () => {
        await page.setViewportSize({ width, height: 640 });
        await fresh();
        await button("Paso siguiente sin guardar").click();
        await page.getByRole("textbox", { name: "Texto (opcional)", exact: true }).fill("Respuesta con teclado");
        await page.setViewportSize({ width, height: 380 });
        await dockFits(width, 380);
        await page.screenshot({ path: path.join(output, `${width}-reduced-viewport.png`) });
        await button("Guardar y siguiente").click();
        await heading("Pregunta 3").waitFor();
      });
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.requests, []);
    report.passed = true;
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { report.error = error.stack; process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});