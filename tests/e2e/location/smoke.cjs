const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../..");
const { build } = require(path.join(root, "node_modules/esbuild"));
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = path.join(root, "artifacts/logs/location-ui", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { passed: false, cases: [], errors: [], scope: "Actual RN Web location panel, native Alert and repository simulated; no phone, GPS, API or SQL execution" };
async function main() {
  const native = JSON.stringify(path.join(root, "node_modules/react-native-web/dist/index.js").replaceAll("\\", "/"));
  const stubs = {
    "google-places": `const address=point=>({address:'Camino del Equipo 10',country:'Chile',region:'Metropolitana',county:'Paine',city:'',postalCode:'',lat:String(point.lat),lon:String(point.lng)});export const googlePlaces={configuration:()=>({packageName:'com.example.field',keyConfigured:true,certificateSha1:[Array(20).fill('AB').join(':')],playServicesStatus:0}),diagnose:async()=>({status:403,accepted:false,reasons:['SERVICE_DISABLED']}),available:()=>true,endSession:()=>{},search:async query=>{if(window.locationFixture.googleDenied)throw new Error('GOOGLE_DENIED');return [{id:'place-1',label:'Camino del Equipo 10, Paine'}];},details:async()=>address({lat:-33.83,lng:-70.76}),reverse:async point=>address(point)};`,
    "react-native-maps": `import React,{forwardRef,useEffect,useRef,useImperativeHandle} from 'react';export const PROVIDER_GOOGLE='google';export function Marker(){return null;}export function Circle(){return null;}export default forwardRef(function Map(props,ref){const canvas=useRef(null);useImperativeHandle(ref,()=>({animateToRegion:()=>{}}));useEffect(()=>{props.onMapLoaded?.();},[]);useEffect(()=>{const brush=canvas.current.getContext('2d');brush.fillStyle='#d0e6d5';brush.fillRect(0,0,500,300);brush.strokeStyle='#ffffff';brush.lineWidth=18;brush.beginPath();brush.moveTo(0,190);brush.lineTo(500,120);brush.stroke();if(React.Children.toArray(props.children).some(child=>child.type===Marker)){brush.fillStyle='#d63230';brush.beginPath();brush.arc(250,150,10,0,Math.PI*2);brush.fill();}},[props.children]);return <canvas data-testid="google-native-map" aria-label="Mapa Google simulado" ref={canvas} width="500" height="300" style={{width:'100%',height:300}} onClick={()=>props.onPress?.({nativeEvent:{coordinate:{latitude:-33.82,longitude:-70.75}}})}/>;});`,
    "equipment-position": 'export async function requestEquipmentPosition(){window.locationFixture.prompts++;if(!window.locationFixture.allow)throw new Error("Permiso de ubicación denegado.");return {lat:-33.9,lng:-70.8,accuracy:20};}',
    "react-native": `export * from ${native};export const Linking={openURL:async url=>{window.locationFixture.maps.push(url);},openSettings:async()=>{}};export const Alert={alert(_title,_body,buttons){window.locationFixture.prompts++;window.locationFixture.confirm=buttons.find(button=>button.text==='Aceptar y permitir').onPress;}};`,
    "expo-font": 'const loaded=new Set();export const isLoaded=name=>loaded.has(name);export async function loadAsync(fonts){for(const [name,source] of Object.entries(fonts)){if(loaded.has(name))continue;const face=new FontFace(name,`url(${source})`);await face.load();document.fonts.add(face);loaded.add(name);}}',
  };
  const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/e2e/location/fixture.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }, loader: { ".ttf": "dataurl", ".png": "dataurl", ".js": "jsx" }, resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js", ".json"],
    plugins: [{ name: "location-os-boundaries", setup(builder) {
      builder.onResolve({ filter: /\/GoogleMap$/ }, () => ({ path: path.join(root, "src/location/GoogleMap.tsx") }));
      builder.onResolve({ filter: /\/googlePlaces$/ }, () => ({ path: "google-places", namespace: "fixture" }));
      builder.onResolve({ filter: /\/equipmentPosition$/ }, () => ({ path: "equipment-position", namespace: "fixture" }));
      builder.onResolve({ filter: /^(react-native|react-native-maps|expo-font)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "jsx", resolveDir: root }));
    } }],
  });
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
    else if (request.url === "/api/mobile-map" || request.url === "/mobile-map.js") { response.writeHead(404); response.end(); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;width:100%}#root{display:flex}</style><div id="root"></div><script src="/fixture.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    if (process.argv.includes("--equipment-picker")) {
      await equipmentPickerFlows(browser, `http://127.0.0.1:${server.address().port}`);
      assert.deepEqual(report.errors, []); report.passed = true; return;
    }
    if (process.argv.includes("--work-edit")) {
      await workEditFlows(browser, `http://127.0.0.1:${server.address().port}`);
      assert.deepEqual(report.errors, []); report.passed = true; return;
    }
    if (process.argv.includes("--equipment-map")) {
      await equipmentFlows(browser, `http://127.0.0.1:${server.address().port}`);
      assert.deepEqual(report.errors, []); report.passed = true; return;
    }
    for (const width of [360, 390, 1280]) for (const scale of [1, 2]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-CL" });
      const page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.message));
      await page.clock.install({ fixedTime: new Date("2026-09-21T12:00:00Z") });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByRole("switch", { name: "Registrar mi ubicación" }).waitFor();
      if (scale === 2) await page.evaluate(() => { for (const element of document.querySelectorAll("div,span,button,input")) {
        if (![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
        const style = getComputedStyle(element); element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
        if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
      } });
      const toggle = page.getByRole("switch", { name: "Registrar mi ubicación" });
      assert.equal(await toggle.isChecked(), false);
      await page.evaluate(() => { window.locationFixture.allow = false; });
      await toggle.click(); assert.equal(await page.evaluate(() => window.locationFixture.prompts), 1);
      assert.equal(await toggle.isChecked(), false);
      await page.evaluate(() => window.locationFixture.confirm());
      await page.getByText("Permisos denegados. El trabajo no se bloquea.", { exact: true }).waitFor();
      assert.equal(await toggle.isChecked(), false);
      await page.evaluate(() => { window.locationFixture.allow = true; });
      await toggle.click(); await page.evaluate(() => window.locationFixture.confirm());
      await page.waitForFunction(() => document.querySelector('[role="switch"]').checked);
      assert.equal(await page.getByRole("button", { name: "Guardar horario", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Mi historial de ubicación", exact: true }).click();
      await page.getByText("-33.00000, -70.00000 · precisión 20 m", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const file = `${width}-${scale}x.png`; await page.screenshot({ path: path.join(output, file), fullPage: true });
      await toggle.click(); assert.equal(await toggle.isChecked(), false);
      report.cases.push({ view: "profile", width, scale, passed: true, screenshot: file });
      for (const view of ["work", "maintenance"]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/?view=${view}`);
        await page.getByText("-33.00000, -70.00000 · precisión 20 m", { exact: true }).waitFor();
        if (scale === 2) await page.evaluate(() => {
          const resize = () => { for (const element of document.querySelectorAll("div,span,button,input")) {
            if (element.dataset.resized || ![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
            element.dataset.resized = "true"; const style = getComputedStyle(element);
            element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
            if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
          } }; resize(); new MutationObserver(resize).observe(document.body, { childList: true, subtree: true });
        });
        const first = await page.evaluate(() => window.locationFixture.reads[0]);
        assert.equal(first.resource.groupId, "maintenance-5"); assert.equal(first.resource.workId, view === "work" ? 7 : undefined);
        await page.getByText("Pendientes de sincronizar (1)", { exact: true }).waitFor();
        await page.getByText(/Trabajo pausado/).first().waitFor();
        assert.equal(await page.getByText("Sin ubicación disponible", { exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => window.locationFixture.maps.length), 0);
        await page.getByRole("button", { name: /^Ver en mapa/ }).click();
        await page.getByTestId("google-native-map").waitFor();
        assert.equal(await page.evaluate(() => window.locationFixture.maps.length), 0);
        await page.getByRole("button", { name: "Cerrar Ubicación registrada", exact: true }).last().click();
        await page.getByRole("button", { name: "Página siguiente", exact: true }).click();
        await page.getByText("-34.00000, -70.00000 · precisión 20 m", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.locationFixture.reads.at(-1).page), 1);
        await page.getByRole("button", { name: "Página anterior", exact: true }).click();
        await page.getByText("Pendientes de sincronizar (1)", { exact: true }).waitFor();
        const historyFile = `${view}-${width}-${scale}x.png`; await page.screenshot({ path: path.join(output, historyFile), fullPage: true });
        await page.getByRole("radio", { name: "Mis acciones del día", exact: true }).click();
        await page.waitForFunction(() => window.locationFixture.reads.at(-1).resource === undefined);
        await page.evaluate(() => { window.locationFixture.offline = true; });
        await page.getByRole("button", { name: "Actualizar historial", exact: true }).click();
        await page.getByText("Conecta la app para consultar el historial sincronizado.", { exact: true }).waitFor();
        await page.getByText("Pendientes de sincronizar (2)", { exact: true }).waitFor();
        assert.equal(await page.getByText("Sincronizado", { exact: true }).count(), 0);
        await page.evaluate(() => { window.locationFixture.offline = false; window.locationFixture.defer = true; });
        await page.getByRole("button", { name: "21-09-2026", exact: true }).click();
        await page.getByRole("button", { name: /domingo,? 20 de septiembre de 2026/ }).click();
        await page.waitForFunction(() => window.locationFixture.resolves.length === 1);
        await page.getByRole("button", { name: "20-09-2026", exact: true }).click();
        await page.getByRole("button", { name: /sábado,? 19 de septiembre de 2026/ }).click();
        await page.waitForFunction(() => window.locationFixture.resolves.length === 2);
        await page.evaluate(() => window.locationFixture.resolves[0]());
        assert.equal(await page.getByText("Sincronizado", { exact: true }).count(), 0);
        await page.evaluate(() => window.locationFixture.resolves[1]());
        await page.getByText("Sincronizado", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.locationFixture.reads.at(-1).date), "2026-09-19");
        assert.equal(await page.evaluate(() => window.locationFixture.prompts + window.locationFixture.saves.length), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        report.cases.push({ view, width, scale, passed: true, screenshot: historyFile });
      }
      for (const kind of ["work", "maintenance"]) for (const confirmed of [true, false]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/?view=success&kind=${kind}&confirmed=${confirmed}`);
        const title = confirmed ? kind === "work" ? "Trabajo creado exitosamente" : "Mantenimiento creado exitosamente" : kind === "work" ? "Trabajo guardado en el teléfono" : "Mantenimiento guardado en el teléfono";
        await page.getByRole("heading", { name: title, exact: true }).waitFor();
        if (!confirmed) await page.getByText("Pendiente de sincronizar con Qualitzer.", { exact: true }).waitFor();
        const successFile = `success-${kind}-${confirmed}-${width}-${scale}x.png`;
        if (scale === 2) await page.evaluate(() => { for (const element of document.querySelectorAll("div,span,button,input,h1,h2,h3,p")) {
          if (![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
          const style = getComputedStyle(element); element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
          if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
        } });
        await page.screenshot({ path: path.join(output, successFile), fullPage: true, animations: "disabled" });
        await page.getByRole("button", { name: kind === "work" ? "Gestionar trabajo" : "Gestionar mantenimiento", exact: true }).click();
        assert.equal(await page.getByTestId("creation-success").count(), 0);
        report.cases.push({ view: "success", kind, confirmed, width, scale, passed: true, screenshot: successFile });
      }
      await context.close();
    }
    assert.deepEqual(report.errors, []); report.passed = true;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
async function workEditFlows(browser, base) {
  for (const width of [360, 390, 1280]) for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-CL" });
    const page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.message));
    await page.goto(`${base}/?view=work-edit`);
    await page.getByRole("button", { name: "Asociar equipo", exact: true }).click();
    await page.getByRole("textbox", { name: "Título *", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Título *", exact: true }).fill("Trabajo editado");
    await page.getByRole("textbox", { name: "Resumen del trabajo (opcional)", exact: true }).fill("Nueva descripcion");
    await page.getByRole("button", { name: "Asociar equipo", exact: true }).click();
    await page.getByRole("tab", { name: "Catálogo", exact: true }).click();
    await page.getByRole("button", { name: /Equipo elegido 9/ }).click();
    if (scale === 2) await page.evaluate(() => { const resize = () => { for (const element of document.querySelectorAll("div,span,button,input,textarea")) {
      if (element.dataset.resized || ![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
      element.dataset.resized = "true"; const style = getComputedStyle(element); element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    } }; resize(); new MutationObserver(resize).observe(document.body, { childList: true, subtree: true }); });
    const screenshot = `work-edit-${width}-${scale}x.png`; await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole("button", { name: "Continuar a horario", exact: true }).click();
    await page.getByRole("textbox", { name: "Fecha *", exact: true }).fill("2026-09-23");
    await page.getByRole("button", { name: "Revisar cambios", exact: true }).click();
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await page.getByRole("button", { name: "Editar trabajo", exact: true }).waitFor();
    const saved = await page.evaluate(() => window.workEditFixture.saves);
    assert.equal(saved.length, 1); assert.equal(saved[0].fields.title, "Trabajo editado"); assert.equal(saved[0].fields.schedule.date, "2026-09-23"); assert.equal(saved[0].fields.rentalEquipmentId, 9);
    await page.goto(`${base}/?view=work-edit&inherited=true`);
    await page.getByText("Equipo del mantenimiento", { exact: true }).waitFor();
    assert.equal(await page.getByText("Equipo hijo incorrecto", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Asociar equipo", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Editar trabajo", exact: true }).click();
    await page.getByText("Equipo heredado", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /catálogo/i }).count(), 0);
    await page.getByRole("button", { name: "Continuar a horario", exact: true }).click();
    await page.getByRole("button", { name: "Revisar cambios", exact: true }).click();
    await page.evaluate(() => { window.workEditFixture.conflict = true; });
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await page.getByText(/El trabajo cambió/).waitFor();
    assert.equal(await page.evaluate(() => window.workEditFixture.confirmed), 0);
    report.cases.push({ view: "work-edit", width, scale, passed: true, screenshot, apiSimulated: true });
    await context.close();
  }
}
async function equipmentPickerFlows(browser, base) {
  for (const width of [360, 390, 1280]) for (const scale of [1, 2]) for (const kind of ["work", "maintenance"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-CL" });
    const page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.message));
    await page.goto(`${base}/?view=equipment-picker&kind=${kind}`);
    const associate = page.getByRole("button", { name: "Asociar equipo", exact: true }); await associate.waitFor();
    if (scale === 2) await page.evaluate(() => { const resize = () => { for (const element of document.querySelectorAll("div,span,button,input,textarea")) {
      if (element.dataset.resized || ![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
      element.dataset.resized = "true"; const style = getComputedStyle(element); element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    } }; resize(); new MutationObserver(resize).observe(document.body, { childList: true, subtree: true }); });
    assert.equal(await page.getByRole("textbox", { name: "Código / número interno", exact: true }).count(), 0);
    await associate.click();
    const code = page.getByRole("textbox", { name: "Código / número interno", exact: true }); await code.fill("8");
    await page.getByRole("button", { name: "Buscar equipo", exact: true }).click();
    await page.getByRole("button", { name: "Seleccionar BULLDOZER D10T · Agrícola", exact: true }).waitFor();
    const dialogFile = `equipment-dialog-${kind}-${width}-${scale}x.png`; await page.screenshot({ path: path.join(output, dialogFile), animations: "disabled" });
    await page.getByRole("button", { name: "Seleccionar BULLDOZER D10T · Agrícola", exact: true }).click();
    const summary = page.getByTestId("selected-equipment-summary"); await summary.waitFor();
    assert.match(await summary.innerText(), /CRHD-31/); assert.match(await summary.innerText(), /Equipo seleccionado/);
    assert.equal(await code.count(), 0);
    await summary.scrollIntoViewIfNeeded();
    const screenshot = `equipment-summary-${kind}-${width}-${scale}x.png`; await page.screenshot({ path: path.join(output, screenshot), animations: "disabled" });
    if (scale === 1) assert((await summary.boundingBox()).height < 150, "COMPACT_EQUIPMENT_SUMMARY");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole("button", { name: "Cambiar equipo", exact: true }).click();
    await page.getByRole("tab", { name: "Catálogo", exact: true }).click();
    await page.getByRole("button", { name: "Excavadora de mantenimiento de brazo extendido", exact: true }).waitFor();
    await page.getByRole("button", { name: "Cerrar Cambiar equipo", exact: true }).last().click();
    assert.match(await summary.innerText(), /CRHD-31/);
    await page.getByRole("button", { name: "Cambiar equipo", exact: true }).click();
    await page.getByRole("tab", { name: "Catálogo", exact: true }).click();
    await page.getByRole("button", { name: "Excavadora de mantenimiento de brazo extendido", exact: true }).click();
    assert.match(await summary.innerText(), /EQ-009/);
    await page.getByRole("button", { name: "Quitar equipo", exact: true }).click();
    await associate.waitFor(); assert.equal(await summary.count(), 0);
    await page.getByRole("textbox", { name: "Título *", exact: true }).fill("Trabajo de prueba");
    if (kind === "maintenance") {
      await page.getByRole("textbox", { name: "Motivo del mantenimiento *", exact: true }).fill("Inspeccionar equipo");
      await page.getByRole("button", { name: "Continuar a horario", exact: true }).click();
      await page.getByText("Selecciona un equipo.", { exact: true }).waitFor();
    }
    await associate.click(); await page.getByRole("tab", { name: "Catálogo", exact: true }).click();
    await page.getByRole("button", { name: "BULLDOZER D10T · Agrícola", exact: true }).click();
    await page.getByRole("button", { name: "Continuar a horario", exact: true }).click();
    await page.getByRole("textbox", { name: "Fecha *", exact: true }).waitFor();
    report.cases.push({ view: "equipment-picker", kind, width, scale, passed: true, screenshot, dialogFile, apiSimulated: true });
    await context.close();
  }
}
async function equipmentFlows(browser, base) {
  for (const width of [360, 390, 1280]) for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-CL" });
    const page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.message));
    const portalRequests = []; page.on("request", request => { if (/mobile-map/.test(request.url())) portalRequests.push(request.url()); });
    await page.goto(`${base}/?view=equipment&source=dispatch`);
    await page.getByText("Calle 4 Poniente, Paine, Metropolitana, Chile", { exact: true }).waitFor();
    assert.equal(await page.getByText("Direccion de despacho anterior", { exact: true }).count(), 0);
    if (scale === 2) await page.evaluate(() => { const resize = () => { for (const element of document.querySelectorAll("div,span,button,input,h1,h2,h3")) {
      if (element.dataset.resized || ![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
      element.dataset.resized = "true"; const computed = getComputedStyle(element); element.style.fontSize = `${parseFloat(computed.fontSize) * 2}px`; if (computed.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(computed.lineHeight) * 2}px`;
    } }; resize(); new MutationObserver(resize).observe(document.body, { childList: true, subtree: true }); });
    await page.getByRole("button", { name: "Ver ubicación en el mapa", exact: true }).click();
    const map = page.getByTestId("google-native-map"); await map.waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Buscar dirección en Google" }).count(), 0);
    assert.equal(await map.evaluate(canvas => canvas.getContext("2d").getImageData(250,150,1,1).data[0]), 214);
    await page.getByRole("button", { name: "Cerrar Ubicación actual del equipo", exact: true }).last().click();
    await page.getByRole("button", { name: "Editar ubicación actual", exact: true }).click();
    await page.getByRole("textbox", { name: "Buscar dirección en Google", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Dirección", exact: true }).inputValue(), "Calle 4 Poniente");
    await map.click();
    await page.waitForFunction(() => [...document.querySelectorAll("input")].some(input => input.value === "Camino del Equipo 10"));
    assert.equal(await page.evaluate(() => window.locationFixture.equipmentSaves.length), 0);
    await page.evaluate(() => { window.locationFixture.allow = false; });
    await page.getByRole("button", { name: "Usar mi ubicación", exact: true }).click();
    await page.getByText("Permiso de ubicación denegado.", { exact: true }).waitFor();
    await page.evaluate(() => { window.locationFixture.allow = true; });
    await page.getByRole("button", { name: "Usar mi ubicación", exact: true }).click();
    await page.getByText("-33.9, -70.8", { exact: true }).waitFor();
    const file = `equipment-map-${width}-${scale}x.png`; await page.screenshot({ path: path.join(output, file), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Guardar ubicación", exact: true }).click();
    await page.getByText("Ubicación actualizada en Qualitzer.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Direccion de despacho anterior", { exact: true }).count(), 0);
    await page.getByText("Camino del Equipo 10, Paine, Metropolitana, Chile", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.locationFixture.equipmentSaves.length), 1);
    assert.equal(await page.evaluate(() => window.locationFixture.equipmentSaves[0].expected.address), "Calle 4 Poniente");
    assert.equal(await page.evaluate(() => window.locationFixture.equipmentSaves[0].address.lat), "-33.9");
    await page.getByRole("button", { name: "Editar ubicación actual", exact: true }).click();
    await page.getByRole("textbox", { name: "Buscar dirección en Google", exact: true }).fill("Paine");
    await page.getByRole("button", { name: "Buscar dirección", exact: true }).click();
    await page.getByRole("button", { name: "Camino del Equipo 10, Paine", exact: true }).click();
    await page.getByText("-33.83, -70.76", { exact: true }).waitFor();
    await page.evaluate(() => { window.locationFixture.conflict = true; });
    await page.getByRole("button", { name: "Guardar ubicación", exact: true }).click();
    await page.getByText(/La ubicación cambió\. Actualiza antes de guardar\./).waitFor();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Guardar ubicación", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Editar ubicación actual", exact: true }).click();
    await page.getByRole("textbox", { name: "Dirección", exact: true }).fill("Direccion escrita manualmente");
    await page.getByText("Sin punto seleccionado", { exact: true }).waitFor();
    assert.notEqual(await map.evaluate(canvas => canvas.getContext("2d").getImageData(250,150,1,1).data[0]), 214);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.goto(`${base}/?view=equipment&readonly=true`); await page.getByText("Sin permiso para editar la ubicación del equipo.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Editar ubicación actual", exact: true }).count(), 0);
    await page.goto(`${base}/?view=work&embedded=true`); await page.getByRole("button", { name: /^Ver en mapa/ }).click();
    await map.waitFor(); assert.equal(await page.getByRole("textbox", { name: "Buscar dirección en Google" }).count(), 0);
    assert.equal(await page.evaluate(() => window.locationFixture.maps.length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole("button", { name: "Cerrar Ubicación registrada", exact: true }).last().click();
    await page.getByText("Registro de ubicación desactivado en este teléfono.", { exact: true }).waitFor();
    await page.goto(`${base}/?view=equipment`);
    await page.getByRole("button", { name: "Editar ubicación actual", exact: true }).click();
    if (scale === 2) await page.evaluate(() => { const resize = () => { for (const element of document.querySelectorAll("div,span,button,input,h1,h2,h3")) {
      if (element.dataset.resized || ![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
      element.dataset.resized = "true"; const style = getComputedStyle(element); element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
      if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
    } }; resize(); new MutationObserver(resize).observe(document.body, { childList: true, subtree: true }); });
    await page.evaluate(() => { window.locationFixture.googleDenied = true; });
    await page.getByRole("textbox", { name: "Buscar dirección en Google", exact: true }).fill("Paine");
    await page.getByRole("button", { name: "Buscar dirección", exact: true }).click();
    await page.getByText("No se pudo buscar en Google. Revisa conexión, Places API y restricciones de la clave Android.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Comprobar acceso a Google", exact: true }).click();
    await page.getByText("Falta habilitar Places API (New) en el proyecto de esta clave.", { exact: true }).waitFor();
    await page.getByText("Paquete Android: com.example.field", { exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(output, `google-configuration-${width}-${scale}x.png`), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Usar mi ubicación", exact: true }).click();
    await page.getByText("-33.9, -70.8", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Guardar ubicación", exact: true }).click();
    await page.getByText("Ubicación actualizada en Qualitzer.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.locationFixture.equipmentSaves[0].address.lat), "-33.9");
    assert.equal(portalRequests.length, 0); assert.equal(await page.locator("iframe").count(), 0);
    report.cases.push({ view: "equipment-and-history-map", width, scale, passed: true, screenshot: file, googleApiSimulated: true }); await context.close();
  }
}
main().catch(error => { report.error = error.stack; process.exitCode = 1; }).finally(() => { fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, ...report }, null, 2)); });