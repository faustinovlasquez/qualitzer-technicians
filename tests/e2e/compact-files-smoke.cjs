const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { build } = require("esbuild");
const root = path.resolve(__dirname, "../..");
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-compact-files-"));
const report = { output, scope: "Isolated real WorkDetailScreen + FileWorkspace RN Web; existing checklist fixture, fake callbacks and pickers, no API", tests: [], errors: [], requests: [] };
const picker = `
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
function pick(source, options) {
  window.filePickerCalls ??= []; window.filePickerCalls.push({source,options});
  const mode = window.filePickerMode ?? 'mixed'; window.filePickerMode = 'mixed';
  if (mode === 'cancel') return {canceled:true,assets:null};
  if (mode === 'hold') return new Promise(resolve => {window.finishFilePicker = resolve;});
  const count = mode === 'long' ? 32 : source === 'camera' ? 1 : 3;
  return {canceled:false,assets:Array.from({length:count},(_,index)=>{
    const pdf = source === 'document' && index === 1;
    const name = source + '-' + window.filePickerCalls.length + '-' + index + (pdf ? '.pdf' : '.png');
    const file = new File([mode === 'oversize' ? new Uint8Array(25*1024*1024+1) : pdf ? '%PDF-1.4 fixture' : png],name,{type:pdf?'application/pdf':'image/png'});
    return {uri:URL.createObjectURL(file),name,fileName:name,fileSize:file.size,size:file.size,mimeType:file.type,file};
  })};
}`;
const stubs = {
  "@expo/vector-icons": `import React from 'react'; export const Ionicons = ({name}) => <span aria-hidden="true">{{'arrow-back-outline':'←','chevron-back-outline':'‹','chevron-forward-outline':'›','grid-outline':'▦','refresh-outline':'↻','attach-outline':'⌕','camera-outline':'▣','images-outline':'▧','folder-open-outline':'▱','information-circle-outline':'ⓘ','trash-outline':'×','cloud-upload-outline':'↑','document-text-outline':'▤'}[name] ?? '·'}</span>;`,
  "expo-linear-gradient": "export { View as LinearGradient } from 'react-native';",
  "expo-file-system": "export class File { constructor(){ throw new Error('NATIVE_FILESYSTEM_NOT_IN_WEB_FIXTURE'); } } export class Directory extends File {} export const Paths = {};",
  "expo-image-picker": `${picker} export const UIImagePickerPreferredAssetRepresentationMode={Current:'current'}; export const requestCameraPermissionsAsync=async()=>({granted:true}); export const launchCameraAsync=async(options)=>pick('camera',options); export const launchImageLibraryAsync=async(options)=>pick('library',options);`,
  "expo-document-picker": `${picker} export const getDocumentAsync=async(options)=>pick('document',options);`,
};
async function main() {
  const bundle = await build({ absWorkingDir: root, stdin: { contents: 'import {createRoot} from "react-dom/client"; import {mountCompactChecklist} from "./tests/e2e/fixtures/compact-checklist"; import {mountCompactFiles} from "./tests/e2e/fixtures/compact-files"; const root=createRoot(document.getElementById("root")); mountCompactChecklist(node=>root.render(node)); mountCompactFiles(node=>root.render(node));', resolveDir: root, loader: "js" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"], define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" }, alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl" }, plugins: [{ name: "isolated-files-boundaries", setup(builder) {
    builder.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:"fixture"}:undefined);
    builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:stubs[args.path],loader:"tsx",resolveDir:root}));
  } }] });
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const server = http.createServer((request,response)=>{if(request.method!=="GET" || !["/","/fixture.js"].includes(request.url)){response.writeHead(404);response.end();return;}response.setHeader("Content-Type",request.url==="/"?"text/html; charset=utf-8":"text/javascript; charset=utf-8");response.end(request.url==="/"?html:bundle.outputFiles[0].text);});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  report.url = url;
  if (process.argv.includes("--serve")) { console.log(`ISOLATED_FILES_PREVIEW ${url}`); return; }
  let browser;
  try {
    browser = await chromium.launch({channel:"msedge",headless:true});
    const context = await browser.newContext();
    await context.route("**/*",route=>{if(route.request().url().startsWith(`${url}/`))return route.continue();report.requests.push(route.request().url());return route.abort();});
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror",error=>report.errors.push(error.message));
    const button = name=>page.getByRole("button",{name,exact:true});
    const check = async(name,run)=>{await run();report.tests.push({name,passed:true});};
    async function fresh() {
      await page.evaluate(()=>window.compactChecklist.render());
      await page.getByRole("button",{name:/^Abrir .*Checklist de despacho/}).click();
      await page.getByRole("heading",{name:"¿El equipo está limpio?",exact:true}).waitFor();
      await button("Adjuntar al paso").click();
      await button("Guardar archivos · 0").waitFor();
    }
    async function controlsFit(width,height) {
      const dock = await page.getByTestId("files-save-dock").boundingBox();
      assert.ok(dock && Math.abs(dock.y+dock.height-height)<=1,JSON.stringify({dock,height}));
      for(const locator of [button("Cámara"),button("Galería"),button("Archivos"),button("Volver al checklist"),page.getByTestId("files-save-dock").getByRole("button")]) {
        const box = await locator.boundingBox();
        assert.ok(box && box.width>=44 && box.height>=44 && box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=height+1,JSON.stringify(box));
      }
      assert.equal(await page.getByTestId("files-list-scroll").evaluate(element=>{for(let p=element.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY))return true;return false;}),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      return dock;
    }
    await page.goto(url);
    for(const width of [320,360,390]) {
      await check(`${width}x480 and ${width}x380 long-list fixed controls`,async()=>{
        await page.setViewportSize({width,height:480});await fresh();
        await page.evaluate(()=>{window.filePickerMode="long";});await button("Archivos").click();await button("Guardar archivos · 32").waitFor();
        const before = await controlsFit(width,480);
        await page.getByTestId("files-list-scroll").evaluate(element=>{element.scrollTop=element.scrollHeight;});
        assert.ok(await page.getByTestId("files-list-scroll").evaluate(element=>element.scrollTop>0));
        assert.deepEqual(await controlsFit(width,480),before);
        await page.screenshot({path:path.join(output,`${width}-long-list.png`)});
        await page.setViewportSize({width,height:380});await controlsFit(width,380);
        await page.screenshot({path:path.join(output,`${width}-low-viewport.png`)});
      });
    }
    await page.setViewportSize({width:390,height:640});
    await check("mixed 3 + second 3 + repeated camera append; cancelled picker preserves eight",async()=>{
      await fresh();await button("Archivos").click();await button("Guardar archivos · 3").waitFor();
      await button("Galería").click();await button("Guardar archivos · 6").waitFor();
      await button("Cámara").click();await button("Guardar archivos · 7").waitFor();
      await button("Cámara").click();await button("Guardar archivos · 8").waitFor();
      await page.evaluate(()=>{window.filePickerMode="cancel";});await button("Archivos").click();await button("Guardar archivos · 8").waitFor();
      await page.screenshot({path:path.join(output,"390-mixed-batch.png")});
    });
    await check("back to exact step retains answer and file drafts; root destination separate",async()=>{
      await button("Volver al checklist").click();
      await page.getByRole("heading",{name:"¿El equipo está limpio?",exact:true}).waitFor();
      await page.getByRole("radio",{name:"Sí",exact:true}).click();
      await button("Adjuntar al paso").click();await button("Guardar archivos · 8").waitFor();
      await button("Archivos del trabajo").click();await button("Guardar archivos · 0").waitFor();
      await button("Ver detalle del trabajo, archivos y comentarios").click();
      await page.getByRole("tab",{name:"Checklist",exact:true}).click();
      assert.equal(await page.getByRole("radio",{name:"Sí",exact:true}).getAttribute("aria-checked"),"true");
      await button("Adjuntar al paso").click();await button("Guardar archivos · 8").waitFor();
    });
    await check("oversize batch rejected and eight existing drafts preserved",async()=>{
      await page.evaluate(()=>{window.filePickerMode="oversize";});await button("Archivos").click();
      await page.getByRole("alert").filter({hasText:"supera 25"}).waitFor();await button("Guardar archivos · 8").waitFor();
    });
    await check("cancel a pending web chooser and ignore its late result",async()=>{
      await page.evaluate(()=>{window.filePickerMode="hold";});await button("Archivos").click();
      await button("Ya cerré el selector · cancelar").click();await button("Guardar archivos · 8").waitFor();
      await page.evaluate(()=>window.finishFilePicker({canceled:false,assets:[]}));
      await button("Guardar archivos · 8").waitFor();
    });
    await check("save all eight once, each own callback and same step; no draft resubmit",async()=>{
      const before = await page.evaluate(()=>window.compactChecklist.uploads.length);
      await button("Guardar archivos · 8").click();await button("Guardar archivos · 0").waitFor();
      const uploads = await page.evaluate(start=>window.compactChecklist.uploads.slice(start),before);
      assert.equal(uploads.length,8);assert.ok(uploads.every(file=>file.stepId==="1001"));
      assert.equal(new Set(uploads.map(file=>file.name)).size,8);assert.ok(uploads.some(file=>file.name.endsWith(".pdf")));
      assert.equal(await button("Guardar archivos · 0").isDisabled(),true);
      await button("Volver al checklist").click();await button("Adjuntar al paso").click();await button("Guardar archivos · 0").waitFor();
      assert.equal(await page.evaluate(()=>window.compactChecklist.uploads.length),before+8);
    });
    await check("root work files use bounded layout too; help accessible and collapsible",async()=>{
      await button("Archivos del trabajo").click();await button("Guardar archivos · 0").waitFor();
      assert.doesNotMatch(await page.locator("body").innerText(),/TIEMPO DE EJECUCIÓN|40 MiB por destino/);
      await button("Ayuda de archivos y límites").click();await page.getByRole("heading",{name:"Archivos y límites",exact:true}).waitFor();
      await button("Cerrar ayuda").click();
      const dock = await page.getByTestId("files-save-dock").boundingBox();assert.ok(dock && Math.abs(dock.y+dock.height-640)<=1);
    });
    await check("partial success preserves suffix; retry never repeats first confirmed file",async()=>{
      await page.evaluate(()=>window.compactFiles.render("partial"));
      await button("Archivos").click();await button("Guardar archivos · 3").click();
      await page.getByText(/Fallo simulado del segundo archivo/).waitFor();
      await button("Guardar archivos · 2").waitFor();
      const before = await page.evaluate(()=>window.compactFiles.calls.slice());assert.equal(before.length,2);
      await page.evaluate(()=>window.compactFiles.retry());await button("Guardar archivos · 2").click();await button("Guardar archivos · 0").waitFor();
      const after = await page.evaluate(()=>window.compactFiles.calls);assert.equal(after.length,4);assert.equal(after[2],before[1]);assert.equal(after.filter(id=>id===before[0]).length,1);
    });
    await check("queued files are not confirmed evidence and are not resubmitted or deletable",async()=>{
      await page.evaluate(()=>window.compactFiles.render("queue"));
      await button("Archivos").click();await button("Guardar archivos · 3").click();await button("Guardar archivos · 0").waitFor();
      await page.getByText("0 confirmados · 3 en cola",{exact:true}).waitFor();
      assert.equal(await button("Guardar archivos · 0").isDisabled(),true);
      for(const entry of await button("Eliminar archivo").all())assert.equal(await entry.isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.compactFiles.calls.length),3);
      await page.screenshot({path:path.join(output,"390-queued-unconfirmed.png")});
    });
    await check("authentication warning and required evidence remain visible; no cleanup after rejection",async()=>{
      await page.evaluate(()=>window.compactFiles.render("auth"));
      await page.getByText("Verifica tu sesión · pendientes conservados",{exact:true}).waitFor();
      await page.getByText("Evidencia obligatoria · debe estar confirmada",{exact:true}).waitFor();
      await button("Archivos").click();await button("Guardar archivos · 3").click();
      await page.getByRole("alert").filter({hasText:"Sesión no verificada"}).waitFor();await button("Guardar archivos · 3").waitFor();
      assert.equal(await page.evaluate(()=>window.compactFiles.calls.length),1);
    });
    assert.ok(report.requests.every(url=>url.startsWith("https://files.example.invalid/")), "All blocked image attempts belong to the synthetic fixture");
    assert.deepEqual(report.errors,[]);
    report.passed = true;
    await context.close();
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{report.error=error.stack;process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});