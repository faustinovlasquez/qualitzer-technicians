"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/native-release-1.0.12/camera-diagnosis");
const exe = path.join(process.env.LOCALAPPDATA, "QualitzerAndroid/sdk/platform-tools/adb.exe");
const pkg = "com.qualitzer.field";
const sha = "fdb67eafb6f99a5e71d29f3e90ab01fb26af093c3597044437ccc298672de941";
function adb(args, binary = false) {
  return execFileSync(exe, ["-s", "emulator-5580", ...args], { encoding: binary ? undefined : "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
function guard() {
  if (adb(["shell", "getprop", "ro.boot.qemu.avd_name"]).trim() !== "QualitzerAgendaApi36_20260910") throw new Error("REFUSING_OTHER_AVD");
  if (adb(["shell", "pidof", pkg]).trim() !== "3771") throw new Error("APP_PID_CHANGED");
}
guard();
const installed = adb(["shell", "pm", "path", pkg]).trim().replace(/^package:/, "");
if (!/^\/data\/app\/[a-zA-Z0-9_+~\/=.-]+\/base\.apk$/.test(installed)) throw new Error("INVALID_APK_PATH");
if (adb(["shell", "sha256sum", installed]).split(/\s/)[0] !== sha) throw new Error("INSTALLED_HASH_CHANGED");
fs.mkdirSync(output, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const report = { at: stamp, version: "1.0.12", pid: "3771", installedSha: sha, actions: [], snapshots: [] };
const stateFile = path.join(output, "start.json");
if (!fs.existsSync(stateFile)) fs.writeFileSync(stateFile, JSON.stringify({ since: adb(["shell", "date '+%m-%d %H:%M:%S.000'"]).trim() }));
const since = JSON.parse(fs.readFileSync(stateFile, "utf8")).since;
function nodes(xml) {
  const stack = [], result = [];
  for (const match of xml.matchAll(/<node\b[^>]*>|<\/node>/g)) {
    if (match[0] === "</node>") { stack.pop(); continue; }
    const node = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2].replaceAll("&amp;", "&").replaceAll("&quot;", '"')]));
    node.parent = stack.at(-1);
    result.push(node);
    if (!match[0].endsWith("/>")) stack.push(node);
  }
  return result;
}
function capture(label) {
  guard();
  const base = `${stamp}-${label}`;
  const remote = "/sdcard/qz-camera-diagnosis.xml";
  const xml = adb(["shell", "CLASSPATH=/data/local/tmp/qualitzer-native-ui.dex app_process /system/bin NativeUiDump"]);
  const parsed = nodes(xml);
  const packages = [...new Set(parsed.map(n => n.package).filter(Boolean))];
  if (packages.some(p => ![pkg, "com.android.systemui", "com.android.camera2", "com.google.android.permissioncontroller", "com.android.permissioncontroller"].includes(p))) throw new Error("UNEXPECTED_UI_PACKAGE");
  const currentFocus = adb(["shell", "dumpsys", "window", "windows"]).split("\n").filter(l => /mCurrentFocus|mFocusedApp/.test(l));
  if (!currentFocus.some(l => /com\.qualitzer\.field|com\.android\.camera2|com\.(?:google\.android\.)?permissioncontroller/.test(l))) throw new Error("UNEXPECTED_FOCUS");
  if (currentFocus.some(l => /mCurrentFocus.*com\.qualitzer\.field/.test(l)) && !xml.includes("Demostraci")) throw new Error("DEMO_NOT_VISIBLE");
  fs.writeFileSync(path.join(output, `${base}.xml`), xml);
  fs.writeFileSync(path.join(output, `${base}.png`), adb(["exec-out", "screencap", "-p"], true));
  const ui = parsed.filter(n => n.text || n["content-desc"] || n.clickable === "true").map(({ parent, ...n }) => n);
  const focus = adb(["shell", "dumpsys", "window", "windows"]).split("\n").filter(l => /mCurrentFocus|mFocusedApp/.test(l));
  report.snapshots.push({ label, base, focus, ui });
  console.log(JSON.stringify({ label, focus, ui: ui.map(n => ({ text: n.text, desc: n["content-desc"], id: n["resource-id"], clickable: n.clickable, bounds: n.bounds })) }));
  return parsed;
}
function tap(parsed, pattern, label) {
  const matches = parsed.filter(n => pattern.test(`${n.text ?? ""}|${n["content-desc"] ?? ""}|${n["resource-id"] ?? ""}`));
  const candidates = [...new Set(matches.map(n => { while (n && n.clickable !== "true") n = n.parent; return n; }).filter(n => n && n.enabled === "true"))];
  if (candidates.length !== 1) throw new Error(`TARGET_NOT_UNIQUE_${label}_${candidates.length}`);
  const target = candidates[0];
  const box = target.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  if (!box || box[2] <= box[0] || box[3] <= box[1]) throw new Error("INVALID_BOUNDS");
  guard();
  const xy = [Math.floor((box[0] + box[2]) / 2), Math.floor((box[1] + box[3]) / 2)];
  report.actions.push({ label, at: new Date().toISOString(), bounds: target.bounds, xy });
  adb(["shell", "input", "tap", ...xy.map(String)]);
  return capture(label);
}
try {
  report.cameraPermission = adb(["shell", "dumpsys", "package", pkg]).split("\n").filter(l => /android.permission.CAMERA|versionName=|versionCode=/.test(l));
  let current = capture("before");
  for (const action of process.argv.slice(2)) {
    const selectors = { files: /^Archivos\|/, camera: /^(?:Cámara|Camara)\||\|(?:Cámara|Camara)\|/, allow: /permission_allow_foreground_only_button$/, shutter: /\|(?:Shutter|Capture|Take photo)\||:id\/shutter_button$/, accept: /\|(?:Done|OK|Aceptar)\||:id\/(?:done_button|btn_done)$/ };
    if (!selectors[action]) throw new Error("UNKNOWN_ACTION");
    current = tap(current, selectors[action], action);
  }
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  const logs = adb(["logcat", "-d", "-b", "main", "-b", "system", "-b", "crash", "--pid", "3771", "-T", since, "-v", "threadtime"]);
  const relevant = logs.split("\n").filter(l => /TRUSTED|private|protect|privacy|camera|imagepicker|Exception|ReactNativeJS.*(?: E | W )|AndroidRuntime|at expo\.|at com.qualitzer/i.test(l)).map(l => l.replace(/(?:https?|content|file):\/\/[^\s]+/g, "[URI_REDACTED]"));
  fs.writeFileSync(path.join(output, `${stamp}-scoped.log`), relevant.join("\n"));
  report.logLines = relevant;
  report.since = since;
  fs.writeFileSync(path.join(output, `${stamp}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path.relative(root, path.join(output, `${stamp}-report.json`)), actions: report.actions, error: report.error, cameraPermission: report.cameraPermission, logLines: relevant }, null, 2));
}