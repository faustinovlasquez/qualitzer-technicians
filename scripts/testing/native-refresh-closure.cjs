const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const tools = path.join(process.env.LOCALAPPDATA, "QualitzerAndroid");
const sdk = path.join(tools, "sdk");
const serial = "emulator-5580";
const avd = "QualitzerAgendaApi36_20260910";
const pkg = "com.qualitzer.field";
const release = require("../android/release-policy.cjs").expectedRelease(root);
const output = path.join(root, `artifacts/logs/native-release-${release.version}`);
fs.mkdirSync(output, { recursive: true });
function run(exe, args, binary = false) {
  const result = spawnSync(exe, args, { cwd: root, encoding: binary ? undefined : "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`COMMAND_FAILED ${path.basename(exe)} ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
const adbExe = path.join(sdk, "platform-tools/adb.exe");
function adb(args, binary = false) {
  if (run(adbExe, ["-s", serial, "shell", "getprop", "ro.boot.qemu.avd_name"]).trim() !== avd) throw new Error("REFUSING_NON_TEST_AVD");
  return run(adbExe, ["-s", serial, ...args], binary);
}
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const stateFile = path.join(output, "state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const [action = "capture", label = action, ...args] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error("INVALID_LABEL");
const tag = `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`;
const report = { at: new Date().toISOString(), action, label, serial, avd };
function capture(suffix = "") {
  const basename = `${tag}${suffix}`;
  const screen = path.join(output, `${basename}.png`);
  fs.writeFileSync(screen, adb(["exec-out", "screencap", "-p"], true));
  const pid = adb(["shell", `pidof ${pkg} || true`]).trim();
  const item = { screen: path.relative(root, screen), pid, expectedPid: state.pid ?? null };
  if (state.pid && state.since) {
    const logs = adb(["logcat", "-b", "main", "-b", "system", "-b", "crash", "-d", "-T", state.since, "--pid", state.pid, "-v", "threadtime"]);
    fs.writeFileSync(path.join(output, `${basename}-process.log`), logs);
    item.errorLines = logs.split("\n").filter(line => /FATAL EXCEPTION|Fatal signal|AndroidRuntime.* E |ReactNativeJS.*(?: E |Error)|SoLoaderDSONotFoundError/.test(line));
    item.stable = pid === state.pid && item.errorLines.length === 0;
  }
  return item;
}
try {
  report.api = adb(["shell", "getprop", "ro.build.version.sdk"]).trim();
  if (action === "verify") {
    const apk = path.join(root, "android/app/build/outputs/apk/release/app-release.apk");
    const buildTools = path.join(sdk, "build-tools/36.0.0");
    const signature = run(path.join(tools, "jdk/jdk-17.0.20.1+1/bin/java.exe"), ["-jar", path.join(buildTools, "lib/apksigner.jar"), "verify", "--verbose", "--print-certs", apk]);
    report.certificate = signature.match(/Signer #1 certificate SHA-256 digest: (\w+)/)?.[1];
    if (report.certificate !== "06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510") throw new Error("CERTIFICATE_MISMATCH");
    run(path.join(buildTools, "zipalign.exe"), ["-c", "-P", "16", "4", apk]);
    const badging = run(path.join(buildTools, "aapt.exe"), ["dump", "badging", apk]);
    const manifest = run(path.join(buildTools, "aapt.exe"), ["dump", "xmltree", apk, "AndroidManifest.xml"]);
    report.inspection = require("../android/inspect-apk.cjs").inspectApk(apk, { gatewayUrl: require("../android/release-policy.cjs").gatewayUrl, architectures: "arm64-v8a,armeabi-v7a,x86_64", ...release, badging, manifest });
    const captured = JSON.parse(fs.readFileSync(path.join(root, "artifacts/logs", args[0], "source-capture.json"), "utf8"));
    report.provenance = require("../android/release-provenance.cjs").verifySources(root, captured, report.inspection.bundleSha256);
    report.sha256 = sha(apk);
    report.bytes = fs.statSync(apk).size;
    report.apk = path.relative(root, apk);
    report.published = false;
    fs.writeFileSync(path.join(output, "verified-apk.json"), JSON.stringify(report, null, 2));
  } else if (action === "install") {
    const verified = JSON.parse(fs.readFileSync(path.join(output, "verified-apk.json"), "utf8"));
    const apk = path.join(root, verified.apk);
    if (sha(apk) !== verified.sha256) throw new Error("APK_CHANGED_AFTER_VERIFICATION");
    state.since = adb(["shell", "date '+%m-%d %H:%M:%S.000'"]).trim();
    delete state.pid;
    report.result = adb(["install", "-r", apk]);
    report.version = adb(["shell", "dumpsys", "package", pkg]).split("\n").filter(line => /versionCode=|versionName=|primaryCpuAbi=|firstInstallTime=|lastUpdateTime=/.test(line));
    state.sha256 = verified.sha256;
  } else if (action === "launch") {
    report.result = adb(["shell", "am", "start", "-W", "-n", `${pkg}/.MainActivity`]);
    state.pid = adb(["shell", `pidof ${pkg} || true`]).trim();
    if (!state.pid) throw new Error("APP_NOT_RUNNING");
  } else if (action === "tap" || action === "swipe") {
    const required = action === "tap" ? 2 : 5;
    if (args.length !== required || args.some(value => !/^\d+$/.test(value))) throw new Error("OBSERVED_COORDINATES_REQUIRED");
    adb(["shell", "input", action, ...args]);
  } else if (["recents", "back", "home"].includes(action)) {
    adb(["shell", "input", "keyevent", { recents: "187", back: "4", home: "3" }[action]]);
  } else if (action === "offline" || action === "online") {
    adb(["shell", "cmd", "connectivity", "airplane-mode", action === "offline" ? "enable" : "disable"]);
    report.airplaneMode = adb(["shell", "settings", "get", "global", "airplane_mode_on"]).trim();
  } else if (action === "cycles") {
    if (args.join(",") !== "135,2204,404,2204,945,2204") throw new Error("OBSERVED_NAVIGATION_COORDINATES_REQUIRED");
    report.cycles = [];
    for (let cycle = 1; cycle <= 10; cycle++) {
      for (const [name, x, y] of [["jornada", "135", "2204"], ["agenda", "404", "2204"], ["perfil", "945", "2204"]]) {
        adb(["shell", "input", "tap", x, y]);
        const frame = capture(`-${cycle}-${name}`);
        report.cycles.push({ cycle, name, ...frame });
        if (!frame.stable) throw new Error("NATIVE_NAVIGATION_NOT_STABLE");
      }
    }
  } else if (action !== "capture") throw new Error("UNKNOWN_ACTION");
  report.capture = capture();
  if (report.capture.stable === false) throw new Error("CURRENT_PROCESS_NOT_STABLE");
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(output, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, output }, null, 2));
}