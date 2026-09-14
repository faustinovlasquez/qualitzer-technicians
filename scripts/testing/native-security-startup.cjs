const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { expectedRelease, sha256File } = require("../android/release-policy.cjs");
const { zipEntries, entryBytes } = require("../android/inspect-apk.cjs");

const root = path.resolve(__dirname, "../..");
const release = expectedRelease(root);
const verification = JSON.parse(fs.readFileSync(path.join(root, `artifacts/release-verification-${release.version}.json`), "utf8"));
const apk = path.join(root, "artifacts", release.name);
const output = path.join(root, `artifacts/logs/native-release-${release.version}`);
fs.mkdirSync(output, { recursive: true });
const adb = path.join(process.env.LOCALAPPDATA, "QualitzerAndroid/sdk/platform-tools/adb.exe");
const serial = "emulator-5580";
const report = { version: release.version, sha256: verification.sha256, nativeModulesPresent: false, ownEmulatorAvailable: false,
  startupTested: false, deviceAuthenticationTested: false, physicalDeviceTested: false, remotePushTested: false };
function invoke(args, binary = false) {
  report.phase = args.filter(value => !value.includes("/") && !value.includes("\\")).slice(0, 5).join(" ");
  return execFileSync(adb, args, { cwd: root, encoding: binary ? undefined : "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
function device(args, binary = false) { return invoke(["-s", serial, ...args], binary); }
try {
  if (sha256File(apk) !== verification.sha256) throw new Error("APK_CHANGED");
  const bytes = fs.readFileSync(apk);
  const entries = zipEntries(bytes);
  const dex = [...entries].filter(([name]) => /^classes\d*\.dex$/.test(name)).map(([, entry]) => entryBytes(bytes, entry, 64 * 1024 * 1024));
  report.nativeModulesPresent = ["expo/modules/localauthentication/LocalAuthenticationModule", "expo/modules/screencapture/ScreenCaptureModule"]
    .every(name => dex.some(content => content.includes(Buffer.from(name))));
  if (!report.nativeModulesPresent) throw new Error("NATIVE_SECURITY_MODULE_MISSING");
  const connected = invoke(["devices"]);
  if (!connected.split(/\r?\n/).some(line => line.startsWith(`${serial}\tdevice`))) {
    report.skippedReason = "OWN_EMULATOR_NOT_RUNNING";
  } else {
    if (device(["shell", "getprop", "ro.boot.qemu.avd_name"]).trim() !== "QualitzerAgendaApi36_20260910") throw new Error("REFUSING_NON_TEST_AVD");
    report.ownEmulatorAvailable = true;
    const since = device(["shell", "date '+%m-%d %H:%M:%S.000'"]).trim();
    device(["install", "-r", apk]);
    device(["shell", "am", "start", "-W", "-n", "com.qualitzer.field/.MainActivity"]);
    device(["shell", "uiautomator", "dump", "--compressed", "/sdcard/qualitzer-security-startup.xml"]);
    const pid = device(["shell", "pidof", "com.qualitzer.field"]).trim();
    if (!/^\d+$/.test(pid)) throw new Error("APP_NOT_RUNNING");
    const installed = device(["shell", "pm", "path", "com.qualitzer.field"]).trim().replace(/^package:/, "");
    if (!/^\/data\/app\/[a-zA-Z0-9_+~\/=.-]+\/base\.apk$/.test(installed)) throw new Error("INSTALLED_PATH_INVALID");
    if (device(["shell", "sha256sum", installed]).trim().split(/\s/)[0] !== verification.sha256) throw new Error("INSTALLED_APK_MISMATCH");
    const logs = device(["logcat", "-b", "main", "-b", "system", "-b", "crash", "-d", "--pid", pid, "-T", since,
      "FirebaseInitProvider:I", "AndroidRuntime:E", "ReactNativeJS:E", "libc:F", "*:S"]);
    report.fatalError = /FATAL EXCEPTION|Fatal signal|ReactNativeJS.*(?: E |Error)/.test(logs);
    report.firebaseInitialized = /FirebaseApp initialization successful/.test(logs);
    report.installedApkMatches = true;
    report.pid = pid;
    report.startupTested = true;
    fs.writeFileSync(path.join(output, "security-startup.png"), device(["exec-out", "screencap", "-p"], true));
    if (report.fatalError) throw new Error("APP_STARTUP_FAILED");
  }
} catch (error) {
  report.error = "NATIVE_SECURITY_VERIFICATION_FAILED";
  report.reason = /^(APK_CHANGED|NATIVE_SECURITY_MODULE_MISSING|REFUSING_NON_TEST_AVD|APP_NOT_RUNNING|INSTALLED_PATH_INVALID|INSTALLED_APK_MISMATCH|APP_STARTUP_FAILED)$/.test(error.message) ? error.message : "COMMAND_FAILED";
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "security-startup.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}