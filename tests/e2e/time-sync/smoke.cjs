const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "../../..");
const shared = path.join(root, "tests/e2e/picker-messages-smoke.cjs");
let runner = fs.readFileSync(shared, "utf8");
function replace(before, after) {
  if (runner.split(before).length !== 2) throw new Error(`STALE_HARNESS: ${before.slice(0, 100)}`);
  runner = runner.replace(before, after);
}
replace('const root = path.resolve(__dirname, "../..");', `const root = ${JSON.stringify(root)};`);
replace('"artifacts/logs/picker-messages-ui"', '"artifacts/logs/time-sync-ui"');
runner = runner.replaceAll('path.join(root, "tests/e2e/picker-messages-fixture.tsx")', 'path.join(root, "tests/e2e/time-sync/fixture.tsx")');
replace('entryPoints: ["tests/e2e/picker-messages-fixture.tsx"]', 'entryPoints: ["tests/e2e/time-sync/fixture.tsx"]');
replace('const program = ts.createProgram([path.join(root, "tests/e2e/time-sync/fixture.tsx")]', 'const program = ts.createProgram([path.join(root, "tests/e2e/time-sync/fixture.tsx"), path.join(root, "src/ui/time/TimePickerPanel.native.tsx")]');
replace('async function main() {', `
report.scope = "Isolated actual RN Web controls and four real screen consumers, real React security provider with existing fake OS ports, actual OfflineEngine and MemoryStore/MemoryFiles with fake upstream; no runtime function modified.";
report.limitations = ["Browser only; no Android/iOS picker, physical keyboard, camera, biometric sensor or native durability proof", "100/200% DOM text stress is not native Dynamic Type", "Synthetic in-memory upstream only, no API/account/SQL/business submission", "MemoryFiles fingerprint fallback covers reservation metadata, not real disk/bytes", "Only scoped fixture/native-panel type graph and this browser matrix; no full suite rerun"];
report.nativePickerVersion = JSON.parse(fs.readFileSync(path.join(root,"node_modules/@react-native-community/datetimepicker/package.json"),"utf8")).version;
report.fixtureAdapters = ["Existing picker-messages fixture exports OS ports only; its screen/root setup omitted in memory", "node:crypto import in existing MemoryFiles replaced with a throwing boundary; default synthetic fingerprint only", "AsyncStorage port isolated to a Map; actual creation draft store unchanged"];
report.fixtureAdapters.push("JSX instrumentation wraps only TimeField onChange with a call-through spy; real component identity, implementation, props and consumer callback remain unchanged; every invocation is recorded");
stubs["react/jsx-runtime"] = 'import {jsx as actualJsx,jsxs as actualJsxs,Fragment} from '+JSON.stringify(path.join(root,"node_modules/react/jsx-runtime.js").replace(/\\\\/g,"/"))+';export {Fragment};function observe(type,props){if(type?.name!=="TimeField")return props;const original=props.onChange;const label=props.label;return {...props,onChange(value){window.timeSync.clockCommit(label,value);return original(value);}};}export const jsx=(type,props,key)=>actualJsx(type,observe(type,props),key);export const jsxs=(type,props,key)=>actualJsxs(type,observe(type,props),key);';
stubs["node:crypto"] = 'export function createHash(){throw new Error("UNEXPECTED_NODE_HASH");}';
stubs["expo-crypto"] = 'export const randomUUID=()=>crypto.randomUUID();';
stubs["expo-image-picker"] += 'export const getCameraPermissionsAsync=async()=>{throw new Error("UNEXPECTED_CAMERA");};';
stubs["@react-native-async-storage/async-storage"] = 'const data=new Map();export default {getItem:async k=>data.get(k)??null,setItem:async(k,v)=>{data.set(k,v);},removeItem:async k=>{data.delete(k);},getAllKeys:async()=>[...data.keys()],multiRemove:async keys=>{for(const k of keys)data.delete(k);}};';
async function main() {`);
replace('builder.onResolve({ filter: /.*/ }, args => {', `builder.onLoad({filter: /picker-messages-fixture\\.tsx$/}, args => {
          const source=fs.readFileSync(args.path,"utf8");
          const start=source.indexOf("const listeners ="); const end=source.indexOf('const date = "2026-09-14";');
          if(start<0||end<start)throw new Error("STALE_SECURITY_PORT_FIXTURE");
          return {contents:source.slice(start,end),loader:"tsx",resolveDir:path.dirname(args.path)};
        });
        builder.onResolve({ filter: /.*/ }, args => {`);
replace('file === "tests/e2e/picker-messages-fixture.tsx"', 'file.startsWith("tests/e2e/time-sync/") || file === "src/offline/tests/fakes.ts"');
const components = ["src/ui/time/TimeField.tsx", "src/ui/time/TimePickerPanel.tsx", "src/ui/time/useSelectionSession.ts", "src/ui/time/SelectorUi.tsx", "src/ui/time/NumericSelectField.tsx", "src/screens/creation/CreationScreen.tsx", "src/screens/workDetail/CompletionDialog.tsx", "src/screens/notifications/NotificationSettingsScreen.tsx", "src/screens/orders/lifecycle/MaintenanceDeliveryDialog.tsx", "src/screens/offline/OfflineCenterScreen.tsx", "src/screens/offline/OfflineStatusBar.tsx", "src/screens/offline/syncAttemptPresentation.ts", "src/offline/engine.ts", "src/offline/syncScheduling.ts", "src/offline/state.ts", "src/offline/tests/fakes.ts", "src/security/DeviceSecurityProvider.tsx", "src/security/DeviceSecurityContext.tsx", "src/security/DeviceLockController.ts"];
const componentStart = runner.indexOf('    report.realComponents = [');
const componentEnd = runner.indexOf(';', componentStart);
if(componentStart<0||componentEnd<0)throw new Error("STALE_COMPONENT_LIST");
runner = runner.slice(0, componentStart) + `    report.realComponents = ${JSON.stringify(components)}` + runner.slice(componentEnd);
replace('const metrics = () => page.evaluate(() => window.pickerMessages.metrics());', 'const metrics = () => page.evaluate(() => window.timeSync.metrics());');
replace('await page.screenshot({ path: file });', 'await page.screenshot({ path: file, animations: "disabled" });');
const freshStart = runner.indexOf('    async function fresh(');
const freshEnd = runner.indexOf('    async function openChecklist', freshStart);
runner = runner.slice(0, freshStart) + `
    async function fresh(screen, scale) {
      await page.goto(origin);
      await page.waitForFunction(() => window.pickerOs?.prompts === 1);
      await page.evaluate(() => window.pickerOs.confirm());
      await page.waitForFunction(() => window.timeSync.metrics().unlocked === true);
      await page.evaluate(screen => window.timeSync.render(screen), screen);
      await settle();
      await page.evaluate(factor => {
        const scaled = new WeakSet();
        const apply = () => { for (const element of document.querySelectorAll("body *")) {
          if (scaled.has(element) || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
          const style=getComputedStyle(element); if(style.fontFamily.includes("ionicons"))continue;
          scaled.add(element); element.style.fontSize=String(parseFloat(style.fontSize)*factor)+"px";
          if(style.lineHeight!=="normal")element.style.lineHeight=String(parseFloat(style.lineHeight)*factor)+"px";
        }};
        new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});apply();
      },scale);
      await settle();
      assert.equal((await metrics()).unlocked,true);
      assert.equal((await os()).prompts,1);
    }
` + runner.slice(freshEnd);
const start = runner.indexOf('    for (const width of [360, 390])');
const end = runner.indexOf('    assert.deepEqual(report.errors, []);', start);
if(start<0||end<start)throw new Error("STALE_SCENARIO_BOUNDARIES");
runner = runner.slice(0,start) + fs.readFileSync(path.join(__dirname,"scenarios.cjs"),"utf8") + "\n" + runner.slice(end);
replace('    save(); console.log(JSON.stringify({ output,', '    report.finishedAt=new Date().toISOString(); report.screenshotHashes=Object.fromEntries(report.screenshots.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));\n    save(); console.log(JSON.stringify({ output,');
const script = new Module(__filename, module);
script.filename = __filename;
script.paths = Module._nodeModulePaths(root);
script._compile(runner, __filename);