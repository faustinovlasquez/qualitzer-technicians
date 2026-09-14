const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const toolRoot = path.join(process.env.LOCALAPPDATA, 'QualitzerAndroid');
const sdk = path.join(toolRoot, 'sdk');
const serial = 'emulator-5580';
const avd = 'QualitzerAgendaApi36_20260910';
const pkg = 'com.qualitzer.field';
const output = path.join(root, 'artifacts/logs/native-stability-1.0.2');
fs.mkdirSync(output, { recursive: true });
function run(exe, args, binary = false) {
  const result = spawnSync(exe, args, { encoding: binary ? undefined : 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`COMMAND_FAILED ${path.basename(exe)} ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
function adb(args, binary = false) {
  const exe = path.join(sdk, 'platform-tools/adb.exe');
  if (run(exe, ['-s', serial, 'shell', 'getprop', 'ro.boot.qemu.avd_name']).trim() !== avd) throw new Error('REFUSING_NON_TEST_AVD');
  return run(exe, ['-s', serial, ...args], binary);
}
function nodes(xml) {
  return (xml.match(/<node\b[^>]+>/g) ?? []).map(node => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2].replaceAll('&amp;', '&').replaceAll('&quot;', '"')])));
}
function dump() {
  const result = adb(['shell', 'am', 'instrument', '-w', 'com.qualitzer.nativeuitest/.DumpInstrumentation']);
  const encoded = result.match(/UI_XML_BASE64=([A-Za-z0-9+/=]+)/)?.[1];
  if (!encoded) throw new Error(`FRESH_UI_DUMP_FAILED ${result}`);
  const xml = Buffer.from(encoded, 'base64').toString('utf8');
  if (!xml.includes('<node')) throw new Error('FRESH_UI_DUMP_REQUIRED');
  return xml;
}
function bounds(node) {
  const match = node?.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) throw new Error('UI_BOUNDS_NOT_FOUND');
  return match.slice(1).map(Number);
}
const stateFile = path.join(output, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const action = process.argv[2] ?? 'capture';
const label = process.argv[3];
const tag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${action}`;
const report = { at: new Date().toISOString(), action, label, serial, avd };
try {
  report.api = adb(['shell', 'getprop', 'ro.build.version.sdk']).trim();
  if (action === 'verify') {
    const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
    const tools = path.join(sdk, 'build-tools/36.0.0');
    const signature = run(path.join(toolRoot, 'jdk/jdk-17.0.20.1+1/bin/java.exe'), ['-jar', path.join(tools, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk]);
    report.certificate = signature.match(/Signer #1 certificate SHA-256 digest: (\w+)/)?.[1];
    if (report.certificate !== '06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510') throw new Error('CERTIFICATE_MISMATCH');
    run(path.join(tools, 'zipalign.exe'), ['-c', '-P', '16', '4', apk]);
    const badging = run(path.join(tools, 'aapt.exe'), ['dump', 'badging', apk]);
    const manifest = run(path.join(tools, 'aapt.exe'), ['dump', 'xmltree', apk, 'AndroidManifest.xml']);
    report.inspection = require('../android/inspect-apk.cjs').inspectApk(apk, { gatewayUrl: require('../android/release-policy.cjs').gatewayUrl, architectures: 'arm64-v8a,armeabi-v7a,x86_64', version: '1.0.2', versionCode: 3, badging, manifest });
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/logs', label, 'source-capture.json'), 'utf8'));
    report.provenance = require('../android/release-provenance.cjs').verifySources(root, captured, report.inspection.bundleSha256);
    report.sha256 = createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
    report.bytes = fs.statSync(apk).size;
    report.apk = path.relative(root, apk);
    report.published = false;
    fs.writeFileSync(path.join(output, 'verified-apk.json'), JSON.stringify(report, null, 2));
  } else if (action === 'install') {
    const verified = JSON.parse(fs.readFileSync(path.join(output, 'verified-apk.json'), 'utf8'));
    const apk = path.join(root, verified.apk);
    if (createHash('sha256').update(fs.readFileSync(apk)).digest('hex') !== verified.sha256) throw new Error('APK_CHANGED_AFTER_VERIFICATION');
    state.since = adb(['shell', "date '+%m-%d %H:%M:%S.000'"]).trim();
    report.result = adb(['install', '-r', apk]);
    report.version = adb(['shell', 'dumpsys', 'package', pkg]).split('\n').filter(line => /versionCode=|versionName=|primaryCpuAbi=/.test(line));
  } else if (action === 'launch') {
    report.result = adb(['shell', 'am', 'start', '-n', `${pkg}/.MainActivity`]);
  } else if (action === 'tap') {
    const candidates = nodes(dump()).filter(node => node.text === label || node['content-desc'] === label);
    const node = candidates.find(value => value.clickable === 'true') ?? candidates[0];
    if (!node || node.enabled === 'false') throw new Error(`UI_LABEL_UNAVAILABLE ${label}`);
    const [left, top, right, bottom] = bounds(node);
    report.bounds = node.bounds;
    adb(['shell', 'input', 'tap', String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2))]);
  } else if (action === 'scroll') {
    const node = nodes(dump()).find(value => value.scrollable === 'true');
    const [left, top, right, bottom] = bounds(node);
    const x = String(Math.floor((left + right) / 2));
    const a = String(Math.floor(top + (bottom - top) * .8));
    const b = String(Math.floor(top + (bottom - top) * .25));
    adb(['shell', 'input', 'swipe', x, label === 'up' ? b : a, x, label === 'up' ? a : b, '350']);
  } else if (action === 'back' || action === 'recents') {
    adb(['shell', 'input', 'keyevent', action === 'back' ? '4' : '187']);
  } else if (action === 'offline' || action === 'online') {
    adb(['shell', 'cmd', 'connectivity', 'airplane-mode', action === 'offline' ? 'enable' : 'disable']);
    report.airplaneMode = adb(['shell', 'settings', 'get', 'global', 'airplane_mode_on']).trim();
  } else if (action !== 'capture') throw new Error('UNKNOWN_ACTION');
  const pid = adb(['shell', `pidof ${pkg} || true`]).trim();
  report.pid = pid;
  report.previousPid = state.pid ?? null;
  if (pid) state.pid = pid;
  const xml = dump();
  fs.writeFileSync(path.join(output, `${tag}-ui.xml`), xml);
  fs.writeFileSync(path.join(output, `${tag}-screen.png`), adb(['exec-out', 'screencap', '-p'], true));
  report.ui = nodes(xml).filter(node => node.text || node['content-desc']).map(node => ({ text: node.text, label: node['content-desc'], enabled: node.enabled, bounds: node.bounds }));
  if (state.pid && state.since) {
    const logs = adb(['logcat', '-d', '-T', state.since, '--pid', state.pid, '-v', 'threadtime']);
    fs.writeFileSync(path.join(output, `${tag}-process.log`), logs);
    report.errorLines = logs.split('\n').filter(line => /FATAL EXCEPTION|ReactNativeJS.*(?: E |Error|Warning)|Fabric.*(?: E |Exception)|Fatal signal|SoLoaderDSONotFoundError/.test(line));
  }
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(output, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, output }, null, 2));
}