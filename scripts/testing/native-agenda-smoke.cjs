const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const sdk = path.join(process.env.LOCALAPPDATA, 'QualitzerAndroid/sdk');
const serial = 'emulator-5580';
const avd = 'QualitzerAgendaApi36_20260910';
const packageName = 'com.qualitzer.field';
const output = path.join(root, 'artifacts/logs/native-agenda-smoke-20260910');
fs.mkdirSync(output, { recursive: true });
function adb(args, binary = false) {
  const result = spawnSync(path.join(sdk, 'platform-tools/adb.exe'), ['-s', serial, ...args], {
    encoding: binary ? undefined : 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`ADB ${args.join(' ')}: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
const identity = adb(['shell', 'getprop', 'ro.boot.qemu.avd_name']).trim();
if (identity !== avd) throw new Error('REFUSING_NON_TEST_DEVICE');
const action = process.argv[2] ?? 'capture';
const tag = new Date().toISOString().replace(/[:.]/g, '-');
const report = { at: new Date().toISOString(), serial, avd, action };
if (action === 'install') {
  if (adb(['shell', 'pm', 'list', 'packages', packageName]).trim()) throw new Error('ALREADY_INSTALLED_PRESERVE_DATA');
  const apk = path.join(root, 'artifacts/qualitzer-tecnicos-1.0.1-android.apk');
  report.apkSha256 = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
  report.install = adb(['install', apk]);
} else if (action === 'launch') {
  report.launch = adb(['shell', 'am', 'start', '-n', `${packageName}/.MainActivity`]);
} else if (action === 'tap') {
  const label = process.argv[3];
  if (!label) throw new Error('UI_LABEL_REQUIRED');
  adb(['shell', 'uiautomator', 'dump', '/sdcard/native-agenda-smoke.xml']);
  const xml = adb(['shell', 'cat', '/sdcard/native-agenda-smoke.xml']);
  const nodes = xml.match(/<node\b[^>]+>/g) ?? [];
  const node = nodes.find((value) => value.includes(`text="${label}"`) || value.includes(`content-desc="${label}"`));
  const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) throw new Error(`UI_LABEL_NOT_FOUND: ${label}`);
  report.label = label;
  report.tap = adb(['shell', 'input', 'tap', String(Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2)), String(Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2))]);
} else if (action === 'offline' || action === 'online') {
  report.network = adb(['shell', 'cmd', 'connectivity', 'airplane-mode', action === 'offline' ? 'enable' : 'disable']);
} else if (action === 'capture') {
  const pid = adb(['shell', `pidof ${packageName} || true`]).trim();
  report.pid = pid;
  report.api = adb(['shell', 'getprop', 'ro.build.version.sdk']).trim();
  report.abis = adb(['shell', 'getprop', 'ro.product.cpu.abilist']).trim();
  report.nativeBridge = adb(['shell', 'getprop', 'ro.dalvik.vm.native.bridge']).trim();
  if (pid) fs.writeFileSync(path.join(output, `${tag}-process.log`), adb(['logcat', '-d', '--pid', pid, '-v', 'threadtime', 'ReactNativeJS:V', 'AndroidRuntime:V', 'libc:F', '*:S']));
  fs.writeFileSync(path.join(output, `${tag}-fatal.log`), adb(['logcat', '-d', '-b', 'crash', '-v', 'threadtime', 'AndroidRuntime:V', 'DEBUG:V', 'libc:F', '*:S']));
  adb(['shell', 'uiautomator', 'dump', '/sdcard/native-agenda-smoke.xml']);
  fs.writeFileSync(path.join(output, `${tag}-ui.xml`), adb(['shell', 'cat', '/sdcard/native-agenda-smoke.xml']));
  fs.writeFileSync(path.join(output, `${tag}-screen.png`), adb(['exec-out', 'screencap', '-p'], true));
} else throw new Error('UNKNOWN_ACTION');
fs.writeFileSync(path.join(output, `${tag}-${action}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, output }, null, 2));