const { spawnSync } = require("node:child_process");
const { readdirSync, existsSync, mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join, delimiter, basename } = require("node:path");
const root = resolve(__dirname, "../../..");
const tools = process.env.QUALITZER_ANDROID_TOOLS || resolve(process.env.LOCALAPPDATA, "QualitzerAndroid");
const output = mkdtempSync(resolve(tmpdir(), "qualitzer-branding-native-"));
function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? walk(join(directory, item.name)) : [join(directory, item.name)]);
}
const cached = walk(resolve(tools, "gradle-user/caches/modules-2/files-2.1"));
function jar(name) { const file = cached.find((file) => basename(file) === name); if (!file) throw new Error("Missing local JVM dependency: " + name); return file; }
const java = walk(resolve(tools, "jdk")).find((file) => basename(file) === "java.exe");
const compiler = ["kotlin-compiler-embeddable-2.1.20.jar", "kotlin-stdlib-2.1.20.jar", "kotlin-script-runtime-2.1.20.jar", "kotlin-reflect-2.1.20.jar", "kotlin-daemon-embeddable-2.1.20.jar", "kotlinx-coroutines-core-jvm-1.10.2.jar", "annotations-23.0.0.jar", "trove4j-1.0.20200330.jar"].map(jar);
const dependencies = ["kotlin-stdlib-2.1.20.jar", "kotlinx-coroutines-core-jvm-1.10.2.jar", "okhttp-4.9.2.jar", "okio-jvm-2.9.0.jar", "annotations-23.0.0.jar"].map(jar);
const nativeDirectory = resolve(root, "modules/company-branding/android/src/main/java/expo/modules/companybranding");
const pureSources = ["CompanyBrandingSafety.kt", "CompanyLogoPolicy.kt", "CompanyLogoDownloader.kt", "CompanyPinRequests.kt"].map((name) => resolve(nativeDirectory, name));
const report = { observedAt: new Date().toISOString(), output, stages: [] };
function run(name, args) {
  const result = spawnSync(java, args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const stage = { name, exit: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  report.stages.push(stage);
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(name, result.status, result.stdout, result.stderr);
  if (result.status !== 0) { console.log(output); process.exit(1); }
}
function compile(name, sources, classpath, destination) {
  run(name, ["-cp", compiler.join(delimiter), "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect", "-jvm-target", "17", "-classpath", classpath.join(delimiter), "-d", destination, ...sources]);
}
compile("compile-real-policy-safety-downloader", [...pureSources, resolve(__dirname, "NativeRegression.kt")], dependencies, resolve(output, "tests.jar"));
run("execute-real-kotlin-regressions", ["-cp", [resolve(output, "tests.jar"), ...dependencies].join(delimiter), "expo.modules.companybranding.NativeRegressionKt"]);
compile("compile-real-shortcut-activity-with-android-doubles", [resolve(nativeDirectory, "CompanyShortcutActivity.kt"), resolve(nativeDirectory, "CompanyBrandingSafety.kt"), ...walk(resolve(__dirname, "shortcut")).filter((file) => file.endsWith(".kt"))], dependencies, resolve(output, "shortcut-tests.jar"));
run("execute-real-shortcut-activity", ["-cp", [resolve(output, "shortcut-tests.jar"), ...dependencies].join(delimiter), "expo.modules.companybranding.ShortcutRegressionKt"]);
if (process.argv.includes("--all-sources")) {
  const transforms = walk(resolve(tools, "gradle-user/caches/9.3.1/transforms"));
  const react = transforms.find((file) => file.includes("react-android-0.86.3-release") && file.endsWith(join("jars", "classes.jar")));
  const expo = resolve(root, "node_modules/expo-modules-core/android/build/intermediates/compile_library_classes_jar/release/bundleLibCompileToJarRelease/classes.jar");
  const android = resolve(tools, "sdk/platforms/android-36/android.jar");
  if (!react || !existsSync(expo) || !existsSync(android)) throw new Error("Missing existing native compile classpath; no Android build was started");
  compile("compile-all-current-native-sources", walk(nativeDirectory).filter((file) => file.endsWith(".kt")), [...dependencies, react, expo, android], resolve(output, "module-checked.jar"));
}
console.log("NATIVE_VALIDATION_COMPLETE", output);