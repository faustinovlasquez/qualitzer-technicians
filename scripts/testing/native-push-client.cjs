"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { expectedRelease, sha256File } = require("../android/release-policy.cjs");
const root = path.resolve(__dirname, "../..");
const release = expectedRelease(root);
const output = path.join(root, `artifacts/logs/native-release-${release.version}`);
const state = JSON.parse(fs.readFileSync(path.join(output, "state.json"), "utf8"));
const verified = JSON.parse(fs.readFileSync(path.join(output, "verified-apk.json"), "utf8"));
const adb = path.join(process.env.LOCALAPPDATA, "QualitzerAndroid/sdk/platform-tools/adb.exe");
function invoke(args, binary = false) {
  try {
    return execFileSync(adb, ["-s", "emulator-5580", ...args], {
      encoding: binary ? undefined : "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { throw new Error("NATIVE_PUSH_CHECK_COMMAND_FAILED"); }
}
if (invoke(["shell", "getprop", "ro.boot.qemu.avd_name"]).trim() !== "QualitzerAgendaApi36_20260910") throw new Error("REFUSING_NON_TEST_AVD");
if (sha256File(path.join(root, verified.apk)) !== verified.sha256) throw new Error("NATIVE_PUSH_APK_CHANGED");
const installed = invoke(["shell", "pm", "path", "com.qualitzer.field"]).trim().replace(/^package:/, "");
if (!/^\/data\/app\/[a-zA-Z0-9_+~\/=.-]+\/base\.apk$/.test(installed)) throw new Error("NATIVE_PUSH_INSTALLED_PATH_INVALID");
if (invoke(["shell", "sha256sum", installed]).trim().split(/\s/)[0] !== verified.sha256) throw new Error("NATIVE_PUSH_INSTALLED_APK_MISMATCH");
const pid = invoke(["shell", "pidof", "com.qualitzer.field"]).trim();
if (!state.pid || pid !== state.pid) throw new Error("NATIVE_PUSH_PROCESS_CHANGED");
const logs = invoke(["logcat", "-b", "main", "-b", "system", "-b", "crash", "-d", "--pid", pid, "-T", state.since, "FirebaseApp:I", "FirebaseInitProvider:I", "FirebaseMessaging:W", "AndroidRuntime:E", "ReactNativeJS:E", "libc:F", "*:S"]);
const report = {
  checkedAt: new Date().toISOString(), version: release.version, versionCode: release.versionCode,
  apkSha256: verified.sha256, installedApkMatches: true, serial: "emulator-5580", api: invoke(["shell", "getprop", "ro.build.version.sdk"]).trim(), pid,
  firebaseInitializationSuccessful: /FirebaseApp initialization successful/.test(logs),
  firebaseInitializationMissing: /initialization unsuccessful|Default FirebaseApp is not initialized|default options are not found/i.test(logs),
  firebaseMessagingError: /FirebaseMessaging.*(?:SERVICE_NOT_AVAILABLE|AUTHENTICATION_FAILED|FIS_AUTH_ERROR|INVALID_SENDER)/.test(logs),
  fatalError: /FATAL EXCEPTION|Fatal signal|ReactNativeJS.*(?: E |Error)/.test(logs),
  remotePushDeliveryTested: false, permissionRequested: false,
  screenshot: path.relative(root, path.join(output, "push-client-startup.png")).replaceAll("\\", "/"),
};
fs.writeFileSync(path.join(output, "push-client-startup.png"), invoke(["exec-out", "screencap", "-p"], true));
fs.writeFileSync(path.join(output, "push-client-startup.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.firebaseInitializationSuccessful || report.firebaseInitializationMissing || report.fatalError) process.exitCode = 1;