const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const toolRoot = path.join(process.env.LOCALAPPDATA, 'QualitzerAndroid');
const sdk = path.join(toolRoot, 'sdk');
const out = path.join(root, 'artifacts/logs/native-stability-1.0.2/instrumentation');
const source = path.join(__dirname, 'native-ui-instrumentation');
fs.mkdirSync(out, { recursive: true });
function run(exe, args) {
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout;
}
const java = path.join(toolRoot, 'jdk/jdk-17.0.20.1+1/bin');
const jar = path.join(sdk, 'platforms/android-36/android.jar');
const tools = path.join(sdk, 'build-tools/36.0.0');
run(path.join(java, 'javac.exe'), ['-source', '8', '-target', '8', '-cp', jar, '-d', out, path.join(source, 'DumpInstrumentation.java')]);
run(path.join(java, 'java.exe'), ['-cp', path.join(tools, 'lib/d8.jar'), 'com.android.tools.r8.D8', '--lib', jar, '--output', out, path.join(out, 'com/qualitzer/nativeuitest/DumpInstrumentation.class')]);
const unsigned = path.join(out, 'ui-unsigned.apk');
const apk = path.join(out, 'ui-test.apk');
run(path.join(tools, 'aapt2.exe'), ['link', '-I', jar, '--manifest', path.join(source, 'AndroidManifest.xml'), '-o', unsigned]);
run(path.join(java, 'jar.exe'), ['uf', unsigned, '-C', out, 'classes.dex']);
run(path.join(tools, 'zipalign.exe'), ['-f', '4', unsigned, apk]);
run(path.join(java, 'java.exe'), ['-jar', path.join(tools, 'lib/apksigner.jar'), 'sign', '--ks', path.join(root, 'android/app/debug.keystore'), '--ks-pass', 'pass:android', '--key-pass', 'pass:android', apk]);
const adb = path.join(sdk, 'platform-tools/adb.exe');
if (run(adb, ['-s', 'emulator-5580', 'shell', 'getprop', 'ro.boot.qemu.avd_name']).trim() !== 'QualitzerAgendaApi36_20260910') throw new Error('REFUSING_NON_TEST_AVD');
console.log(run(adb, ['-s', 'emulator-5580', 'install', '-r', apk]));