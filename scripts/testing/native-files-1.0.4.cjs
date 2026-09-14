const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const release = require("../android/release-policy.cjs").expectedRelease(root);
const parent = path.join(root, `artifacts/logs/native-release-${release.version}`);
const output = path.join(parent, "smoke-final");
const serial = "emulator-5580";
const avd = "QualitzerAgendaApi36_20260910";
const pkg = "com.qualitzer.field";
const exe = path.join(process.env.LOCALAPPDATA, "QualitzerAndroid/sdk/platform-tools/adb.exe");
function raw(args, binary = false) {
  const result = spawnSync(exe, ["-s", serial, ...args], { encoding: binary ? undefined : "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`ADB_FAILED ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function adb(args, binary = false) {
  if (raw(["shell", "getprop", "ro.boot.qemu.avd_name"]).trim() !== avd) throw new Error("REFUSING_NON_TEST_AVD");
  return raw(args, binary);
}
const [action = "capture", label = action, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("INVALID_LABEL");
const verified = JSON.parse(fs.readFileSync(path.join(parent, "verified-apk.json"), "utf8"));
const expectedSha = verified.sha256;
if (createHash("sha256").update(fs.readFileSync(path.join(root, verified.apk))).digest("hex") !== expectedSha) throw new Error("APK_HASH_MISMATCH");
const packageDump = adb(["shell", "dumpsys", "package", pkg]);
if (packageDump.match(/versionCode=(\d+)/)?.[1] !== String(verified.inspection.versionCode) || packageDump.match(/versionName=([^\s]+)/)?.[1] !== release.version) throw new Error("INSTALLED_VERSION_MISMATCH");
const installedPath = adb(["shell", "pm", "path", pkg]).trim().replace(/^package:/, "");
if (!/^\/data\/app\/[a-zA-Z0-9_+~\/=.-]+\/base\.apk$/.test(installedPath)) throw new Error("UNEXPECTED_APK_PATH");
const installedSha = adb(["shell", "sha256sum", installedPath]).trim().split(/\s/)[0];
if (installedSha !== expectedSha) throw new Error("INSTALLED_HASH_MISMATCH");
fs.mkdirSync(output, { recursive: true });
const stateFile = path.join(output, "state.json");
const state = JSON.parse(fs.readFileSync(fs.existsSync(stateFile) ? stateFile : path.join(parent, "state.json"), "utf8"));
const report = { at: new Date().toISOString(), action, label, serial, avd, installedSha, version: release.version, versionCode: verified.inspection.versionCode, api: adb(["shell", "getprop", "ro.build.version.sdk"]).trim() };
const file = path.join(output, label);
try {
  if (report.api !== "36") throw new Error("UNEXPECTED_API");
  const beforePid = adb(["shell", `pidof ${pkg} || true`]).trim();
  if (state.pid && beforePid !== state.pid) throw new Error("UNEXPECTED_PID_BEFORE_ACTION");
  if (action === "cold-main") {
    report.previousPid = beforePid;
    state.since = adb(["shell", "date '+%m-%d %H:%M:%S.000'"]).trim();
    adb(["shell", "am", "force-stop", pkg]);
    const result = spawnSync(process.execPath, [path.join(__dirname, "native-refresh-closure.cjs"), "launch", label], { encoding: "utf8", timeout: 30000 });
    if (result.status !== 0) throw new Error("LAUNCH_HELPER_FAILED");
    state.pid = adb(["shell", `pidof ${pkg} || true`]).trim();
    if (!state.pid || state.pid === beforePid) throw new Error("COLD_PID_NOT_CREATED");
  } else if (action === "tap" || action === "swipe") {
    if (args.length !== (action === "swipe" ? 5 : 2) || args.some(value => !/^\d+$/.test(value))) throw new Error("OBSERVED_COORDINATES_REQUIRED");
    report.coordinates = args;
    adb(["shell", "input", action, ...args]);
  } else if (action === "text") {
    if (args.length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(args[0])) throw new Error("DEMO_TEXT_ONLY");
    adb(["shell", "input", "text", args[0]]);
  } else if (action === "back") {
    adb(["shell", "input", "keyevent", "4"]);
  } else if (action === "fixtures") {
    const fixtureDir = path.join(output, "fixtures");
    fs.mkdirSync(fixtureDir, { recursive: true });
    const png = fs.readFileSync(path.join(root, "assets/qualitzer-logo.png"));
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>", "<< /Length 0 >>\nstream\nendstream"];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    report.fixtures = [];
    for (const [name, bytes] of [["qz-native-104-final.pdf", Buffer.from(pdf)], ["qz-native-104-final.png", png]]) {
      const local = path.join(fixtureDir, name);
      const remote = `/sdcard/Download/${name}`;
      fs.writeFileSync(local, bytes);
      if (adb(["shell", `if [ -e '${remote}' ]; then echo exists; fi`]).trim()) throw new Error("FIXTURE_ALREADY_EXISTS");
      adb(["push", local, remote]);
      adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", `file://${remote}`]);
      report.fixtures.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  } else if (action !== "capture") throw new Error("UNKNOWN_ACTION");
  fs.writeFileSync(`${file}.png`, adb(["exec-out", "screencap", "-p"], true));
  report.screen = path.relative(root, `${file}.png`).replaceAll("\\", "/");
  report.pid = adb(["shell", `pidof ${pkg} || true`]).trim();
  report.focus = adb(["shell", "dumpsys", "window", "windows"]).split("\n").filter(line => /mCurrentFocus|mFocusedApp/.test(line));
  const logs = adb(["logcat", "-b", "main", "-b", "system", "-b", "crash", "-d", "-T", state.since, "--pid", state.pid, "-v", "threadtime"]);
  report.since = state.since;
  report.newFatal = logs.split("\n").filter(line => /FATAL EXCEPTION|Fatal signal|AndroidRuntime.* E |ReactNativeJS.*(?: E |Error)|SoLoaderDSONotFoundError/.test(line));
  fs.writeFileSync(`${file}-process.log`, logs);
  report.stable = report.pid === state.pid && report.newFatal.length === 0;
  if (!report.stable) throw new Error("CURRENT_PROCESS_NOT_STABLE");
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  fs.writeFileSync(`${file}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}