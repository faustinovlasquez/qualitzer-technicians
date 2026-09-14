const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const toolRoot = path.join(process.env.LOCALAPPDATA, 'QualitzerAndroid');
const sdk = path.join(toolRoot, 'sdk');
const out = path.join(root, 'artifacts/logs/native-stability-1.0.2/ui-dump');
fs.mkdirSync(out, { recursive: true });
function run(exe, args) {
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0 || result.error) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout;
}
const java = path.join(toolRoot, 'jdk/jdk-17.0.20.1+1/bin');
const jar = path.join(sdk, 'platforms/android-36/android.jar');
run(path.join(java, 'javac.exe'), ['-source', '8', '-target', '8', '-cp', jar, '-d', out, path.join(__dirname, 'NativeUiDump.java')]);
run(path.join(java, 'java.exe'), ['-cp', path.join(sdk, 'build-tools/36.0.0/lib/d8.jar'), 'com.android.tools.r8.D8', '--lib', jar, '--output', out, path.join(out, 'NativeUiDump.class')]);
const adb = path.join(sdk, 'platform-tools/adb.exe');
if (run(adb, ['-s', 'emulator-5580', 'shell', 'getprop', 'ro.boot.qemu.avd_name']).trim() !== 'QualitzerAgendaApi36_20260910') throw new Error('REFUSING_NON_TEST_AVD');
console.log(run(adb, ['-s', 'emulator-5580', 'push', path.join(out, 'classes.dex'), '/data/local/tmp/qualitzer-native-ui.dex']));