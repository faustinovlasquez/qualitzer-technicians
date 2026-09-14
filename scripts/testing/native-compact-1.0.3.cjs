const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/native-release-1.0.3/compact-native");
const parent = path.dirname(output);
const serial = "emulator-5580";
const avd = "QualitzerAgendaApi36_20260910";
const pkg = "com.qualitzer.field";
const exe = path.join(process.env.LOCALAPPDATA, "QualitzerAndroid/sdk/platform-tools/adb.exe");
const expectedSha = "4c6cd709ffcbce4167013e9cab9a277a9d0fee03e4cbe9c85784911738d560ae";
function raw(args, binary = false) {
  const result = spawnSync(exe, ["-s", serial, ...args], { encoding: binary ? undefined : "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`ADB_FAILED ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function adb(args, binary = false) {
  if (raw(["shell", "getprop", "ro.boot.qemu.avd_name"]).trim() !== avd) throw new Error("REFUSING_NON_TEST_AVD");
  return raw(args, binary);
}
const input = process.argv.length > 2 ? process.argv.slice(2) : JSON.parse(fs.readFileSync(path.join(__dirname, "native-compact-request.json"), "utf8"));
const [action = "capture", label = action, ...args] = input;
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("INVALID_LABEL");
const verified = JSON.parse(fs.readFileSync(path.join(parent, "verified-apk.json"), "utf8"));
if (verified.sha256 !== expectedSha || createHash("sha256").update(fs.readFileSync(path.join(root, verified.apk))).digest("hex") !== expectedSha) throw new Error("APK_HASH_MISMATCH");
const packageDump = adb(["shell", "dumpsys", "package", pkg]);
if (!/versionCode=4\s/.test(packageDump) || !/versionName=1\.0\.3\s/.test(packageDump)) throw new Error("INSTALLED_VERSION_MISMATCH");
const installedPath = adb(["shell", "pm", "path", pkg]).trim().replace(/^package:/, "");
if (!/^\/data\/app\/[a-zA-Z0-9_+~\/=.-]+\/base\.apk$/.test(installedPath)) throw new Error("UNEXPECTED_APK_PATH");
const installedSha = adb(["shell", "sha256sum", installedPath]).trim().split(/\s/)[0];
if (installedSha !== expectedSha) throw new Error("INSTALLED_HASH_MISMATCH");
fs.mkdirSync(output, { recursive: true });
const stateFile = path.join(output, "state.json");
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : JSON.parse(fs.readFileSync(path.join(parent, "state.json"), "utf8"));
const report = { at: new Date().toISOString(), action, label, serial, avd, installedSha, version: "1.0.3", versionCode: 4, api: adb(["shell", "getprop", "ro.build.version.sdk"]).trim() };
const file = path.join(output, label);
try {
  const beforePid = adb(["shell", `pidof ${pkg} || true`]).trim();
  if (state.pid && beforePid !== state.pid) throw new Error("UNEXPECTED_PID_BEFORE_ACTION");
  if (action === "cold-shortcut") {
    report.previousPid = beforePid;
    state.since = adb(["shell", "date '+%m-%d %H:%M:%S.000'"]).trim();
    adb(["shell", "am", "force-stop", pkg]);
    report.stoppedPid = adb(["shell", `pidof ${pkg} || true`]).trim();
    if (report.stoppedPid) throw new Error("APP_NOT_STOPPED");
    const source = fs.readFileSync(path.join(root, "modules/company-branding/android/src/main/java/expo/modules/companybranding/CompanyBrandingState.kt"), "utf8");
    const openAction = source.match(/const val OPEN_ACTION = "([^"]+)"/)[1];
    const idExtra = source.match(/const val ID_EXTRA = "([^"]+)"/)[1];
    const shortcutId = "qz-company-" + createHash("sha256").update("native-cold-shortcut-demo-only-1.0.3").digest("hex");
    report.intent = { component: `${pkg}/expo.modules.companybranding.CompanyShortcutActivity`, action: openAction, identityKey: idExtra, shortcutId, credentials: false, otherExtras: false };
    report.launch = adb(["shell", "am", "start", "-W", "-n", report.intent.component, "-a", openAction, "--es", idExtra, shortcutId]);
    state.pid = adb(["shell", `pidof ${pkg} || true`]).trim();
    if (!state.pid || state.pid === beforePid) throw new Error("COLD_PID_NOT_CREATED");
    fs.writeFileSync(path.join(parent, "state.json"), JSON.stringify({ ...state, sha256: expectedSha }, null, 2));
  } else if (action === "tap" || action === "touch" || action === "swipe") {
    if (args.length !== (action === "swipe" ? 5 : 2) || args.some(value => !/^\d+$/.test(value))) throw new Error("OBSERVED_COORDINATES_REQUIRED");
    report.coordinates = args;
    adb(["shell", "input", ...(action === "touch" ? ["touchscreen", "tap"] : [action]), ...args]);
  } else if (action === "text") {
    if (args.length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(args[0])) throw new Error("DEMO_TEXT_ONLY");
    report.demoText = args[0];
    adb(["shell", "input", "text", args[0]]);
  } else if (action === "back") {
    adb(["shell", "input", "keyevent", "4"]);
  } else if (action !== "capture") throw new Error("UNKNOWN_ACTION");
  const png = adb(["exec-out", "screencap", "-p"], true);
  fs.writeFileSync(`${file}.png`, png);
  report.screen = path.relative(root, `${file}.png`).replaceAll("\\", "/");
  report.pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  report.pid = adb(["shell", `pidof ${pkg} || true`]).trim();
  const windows = adb(["shell", "dumpsys", "window", "windows"]);
  fs.writeFileSync(`${file}-windows.log`, windows);
  report.windowSummary = windows.split("\n").filter(line => /mCurrentFocus|mFocusedApp|mInputMethod|type=ime|InsetsSource.*ime|mFrame=|mHasSurface=/.test(line));
  const ime = adb(["shell", "dumpsys", "input_method"]);
  report.ime = ime.split("\n").filter(line => /mInputShown|mIsInputViewShown|mShowRequested|mImeWindowVis|mCurFocusedWindow=/.test(line));
  const logs = adb(["logcat", "-b", "main", "-b", "system", "-b", "crash", "-d", "-T", state.since, "--pid", state.pid, "-v", "threadtime"]);
  fs.writeFileSync(`${file}-process.log`, logs);
  report.since = state.since;
  report.errorLines = logs.split("\n").filter(line => /FATAL EXCEPTION|Fatal signal|AndroidRuntime.* E |ReactNativeJS.*(?: E |Error)|SoLoaderDSONotFoundError/.test(line));
  report.stable = report.pid === state.pid && report.errorLines.length === 0;
  if (!report.stable) throw new Error("CURRENT_PROCESS_NOT_STABLE");
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  fs.writeFileSync(`${file}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}