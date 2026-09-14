const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "../../..");
const shared = path.join(root, "tests/e2e/picker-messages-smoke.cjs");
let runner = fs.readFileSync(shared, "utf8");
function replaceOnce(before, after) {
  if (runner.split(before).length !== 2) throw new Error(`STALE_SHARED_HARNESS: ${before.slice(0, 90)}`);
  runner = runner.replace(before, after);
}
replaceOnce('const root = path.resolve(__dirname, "../..");', `const root = ${JSON.stringify(root)};`);
replaceOnce('"artifacts/logs/picker-messages-ui"', '"artifacts/logs/camera-delivery-ui"');
replaceOnce('async function main() {', `
report.scope = "Shared actual picker-messages RN Web fixture, current WorkDetail/FileWorkspace/CompletionDialog/CameraPermissionGuide/security provider. Only fixture data and OS imports are adapted in memory; runtime function bodies are unchanged.";
report.limitations = ["Fake OS permission, camera, Settings, privacy and auth ports; no physical camera, sensor, permission or native activity proof", "Native permission branch runs via a Platform port in localPhotos only; file copying/storage/layout remain actual web implementations, not native durable-copy proof", "100/200 percent DOM text stress, not native Dynamic Type", "No real API/account/photo/SQL or business submission; valid onStatus is a counted unresolved stub", "Shared fixture had no camera permission read stub and fixed pending-only snapshots; adaptations are fixture-only, not runtime fixes"];
report.sharedHarness = ${JSON.stringify(path.relative(root, shared).replace(/\\/g, "/"))};
report.sharedHarnessHash = hash(fs.readFileSync(${JSON.stringify(shared)}));
report.fixtureAdapters = [];
stubs["expo-image-picker"] = 'export const UIImagePickerPreferredAssetRepresentationMode={Current:"current"}; export async function getCameraPermissionsAsync(){window.cameraDelivery.permissionReads++;return window.cameraDelivery.permission;} export const requestCameraPermissionsAsync=()=>window.cameraDelivery.requestPermission(); export const launchCameraAsync=()=>window.pickerOs.launchCamera(); export const launchImageLibraryAsync=()=>{throw new Error("UNEXPECTED_GALLERY");};';
stubs["expo-screen-capture"] = 'export const preventScreenCaptureAsync=()=>window.cameraDelivery.protect(); export const allowScreenCaptureAsync=async()=>{window.pickerOs.privacy.push("allow");}; export const enableAppSwitcherProtectionAsync=async()=>{};export const disableAppSwitcherProtectionAsync=async()=>{};';
stubs["camera-delivery-native-platform"] = 'export const Platform={OS:"android"}; export const Linking={openSettings:()=>window.cameraDelivery.openSettings()};';
async function main() {`);
runner = runner.replaceAll('path.join(root, "tests/e2e/picker-messages-fixture.tsx")', 'path.join(root, "tests/e2e/camera-delivery/fixture.tsx")');
replaceOnce('entryPoints: ["tests/e2e/picker-messages-fixture.tsx"]', 'entryPoints: ["tests/e2e/camera-delivery/fixture.tsx"]');
replaceOnce('builder.onResolve({ filter: /.*/ }, args => {', `
        builder.onLoad({filter: /picker-messages-fixture\\.tsx$/}, args => {
          let source = fs.readFileSync(args.path, "utf8");
          const replace = (before, after) => { if(source.split(before).length !== 2) throw new Error("STALE_SHARED_FIXTURE: " + before); source = source.replace(before, after); report.fixtureAdapters.push(before); };
          replace('useState(() => makeWork(scenario))', 'useState(() => window.cameraDelivery.configureWork(makeWork(scenario)))');
          replace('useState<OfflineSnapshot | null>(makeSnapshot)', 'useState<OfflineSnapshot | null>(() => window.cameraDelivery.configureSnapshot(makeSnapshot()))');
          replace('const files = async (): Promise<Attachment[]> => [];', 'const files = async (): Promise<Attachment[]> => window.cameraDelivery.loadFiles();');
          replace('onStatus={() => fail("status")}', 'onStatus={input => window.cameraDelivery.submit(input)}');
          replace('error="No se pudo verificar la conexión con Qualitzer. Los pendientes siguen guardados en el dispositivo."', 'error={null}');
          return {contents:source,loader:"tsx",resolveDir:path.dirname(args.path)};
        });
        builder.onLoad({filter: /(?:localPhotos|useCameraPermissionGuide)\\.ts$/}, args => {
          const source = fs.readFileSync(args.path, "utf8");
          const before = args.path.endsWith("localPhotos.ts") ? 'import { Platform } from "react-native";' : 'import { Linking } from "react-native";';
          if(source.split(before).length !== 2) throw new Error("STALE_OS_IMPORT");
          report.fixtureAdapters.push({file:path.relative(root,args.path),importOnly:before});
          return {contents:source.replace(before,before.replace('"react-native"','"camera-delivery-native-platform"')),loader:"ts",resolveDir:path.dirname(args.path)};
        });
        builder.onResolve({ filter: /.*/ }, args => {`);
replaceOnce('file === "tests/e2e/picker-messages-fixture.tsx"', 'file.startsWith("tests/e2e/")');
replaceOnce('for (const file of report.realComponents)', 'report.realComponents.push("src/screens/workDetail/CompletionDialog.tsx", "src/screens/workDetail/files/CameraPermissionGuide.tsx", "src/screens/workDetail/files/useCameraPermissionGuide.ts", "src/screens/workDetail/localPhotos.ts", "src/screens/workDetail/files/WorkspaceDraftStore.ts");\n    for (const file of report.realComponents)');
replaceOnce('window.pickerMessages.render(scenario, tab)', 'window.cameraDelivery.render(scenario, tab)');
replaceOnce('document.querySelectorAll("#root *")', 'document.querySelectorAll("body *")');
replaceOnce('observe(document.getElementById("root"),', 'observe(document.body,');
replaceOnce('await page.screenshot({ path: file });', 'await page.screenshot({ path: file, animations: "disabled" });');
replaceOnce('report.fixtureAdapters = [];', `report.fixtureAdapters = [];
report.protectedInputs = Object.fromEntries(["app.json", "app.config.ts", "package.json", "package-lock.json", "tests/e2e/picker-messages-smoke.cjs", "tests/e2e/camera-delivery/fixture.tsx", "tests/e2e/camera-delivery/smoke.cjs", "tests/e2e/camera-delivery/scenarios.cjs"].filter(file => fs.existsSync(path.join(root,file))).map(file => [file,hash(fs.readFileSync(path.join(root,file)))]));
report.previousFixtureOnlyFailures = ["17-39-28: optional nativeInteractionPending was undefined, not false, before any trusted interaction", "17-39-28: synthetic OfflineConnection.errorCode must be omitted, not null", "Screenshots disable finite RN Web modal animations to avoid transitional compositing"];
`);
replaceOnce('report.sourceChanges = Object.entries(report.sources)', 'report.sourceChanges = Object.entries({...report.sources,...report.protectedInputs})');
replaceOnce('    save(); console.log(JSON.stringify({ output,', '    report.screenshotHashes = Object.fromEntries(report.screenshots.map(file => [file,hash(fs.readFileSync(path.join(root,file)))]));\n    report.finishedAt = new Date().toISOString();\n    save(); console.log(JSON.stringify({ output,');
const start = runner.indexOf('    for (const width of [360, 390])');
const end = runner.indexOf('    assert.deepEqual(report.errors, []);', start);
if (start < 0 || end < start) throw new Error("STALE_SHARED_SCENARIO_BOUNDARIES");
runner = runner.slice(0, start) + fs.readFileSync(path.join(__dirname, "scenarios.cjs"), "utf8") + "\n" + runner.slice(end);
const script = new Module(__filename, module);
script.filename = __filename;
script.paths = Module._nodeModulePaths(root);
script._compile(runner, __filename);