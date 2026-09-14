const { spawn } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { inspectApk } = require("./inspect-apk.cjs");
const { expectedRelease, gatewayUrl, certificateSha256: pinnedCertificate, verifyPrevious, previous, sha256File } = require("./release-policy.cjs");
const { captureSources, protectedSnapshot, verifySources, checkHealth } = require("./release-provenance.cjs");
const { releaseEnvironment, resolveReleaseConfig, verifyPushConfig, readApkResources, verifyCompiledPush } = require("./release-push.cjs");

const root = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const toolRoot = args[args.indexOf("--tool-root") + 1];
const architectures = args[args.indexOf("--architectures") + 1];
if (!toolRoot || !["arm64-v8a", "arm64-v8a,armeabi-v7a", "arm64-v8a,armeabi-v7a,x86_64"].includes(architectures)) throw new Error("INVALID_BUILD_ARGUMENTS");
const expected = expectedRelease(root);
const signingRoot = path.join(root, ".data/android-signing");
const artifacts = path.join(root, "artifacts");
const logs = path.join(artifacts, "logs", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(logs, { recursive: true });
const environment = releaseEnvironment(process.env);
const javaHome = path.join(toolRoot, "jdk/jdk-17.0.20.1+1");
const buildTools = path.join(toolRoot, "sdk/build-tools/36.0.0");
const phases = [];

async function run(name, executable, arguments_, extraEnvironment = {}) {
  const started = Date.now();
  const logfile = path.join(logs, `${name}.log`);
  const output = fs.createWriteStream(logfile, { flags: "wx" });
  const childEnvironment = { ...environment, ...extraEnvironment };
  const secrets = [...new Set(Object.entries(extraEnvironment)
    .filter(([key, value]) => key.endsWith("_PASSWORD") && value)
    .map(([, value]) => value))];
  const emit = (text) => {
    for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
    output.write(text);
    process.stdout.write(text);
  };
  const attachOutput = (stream) => {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (data) => {
      pending += data;
      const end = pending.lastIndexOf("\n") + 1;
      if (end > 0) {
        emit(pending.slice(0, end));
        pending = pending.slice(end);
      }
    });
    stream.on("end", () => { if (pending) emit(pending); });
  };
  const batch = executable.endsWith(".bat");
  const command = batch ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe") : executable;
  const commandArguments = batch
    ? ["/d", "/s", "/c", `"${[executable, ...arguments_].map((value) => `"${value}"`).join(" ")}"`]
    : arguments_;
  console.log(`START ${name}`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, commandArguments, {
      cwd: root, env: childEnvironment, windowsHide: true,
      windowsVerbatimArguments: batch, stdio: ["ignore", "pipe", "pipe"],
    });
    attachOutput(child.stdout);
    attachOutput(child.stderr);
    child.once("error", reject);
    child.once("close", resolve);
  });
  const elapsedSeconds = Math.round((Date.now() - started) / 1000);
  const marker = `\nEND ${name} EXIT=${exitCode} SECONDS=${elapsedSeconds}\n`;
  await new Promise((resolve) => output.end(marker, resolve));
  console.log(marker.trim());
  phases.push({ name, exitCode, elapsedSeconds, log: path.relative(root, logfile) });
  fs.writeFileSync(path.join(logs, "phases.json"), JSON.stringify(phases, null, 2));
  if (exitCode !== 0) throw new Error(`${name.toUpperCase()}_FAILED_EXIT_${exitCode}`);
  return fs.readFileSync(logfile, "utf8");
}

async function signingEnvironment(allowCreate) {
  const store = path.join(signingRoot, "qualitzer-field-release.p12");
  const credentialsFile = path.join(signingRoot, "credentials.json");
  const hasStore = fs.existsSync(store);
  const hasCredentials = fs.existsSync(credentialsFile);
  if (hasStore !== hasCredentials) throw new Error("INCOMPLETE_SIGNING_IDENTITY_PRESERVED_MANUAL_RECOVERY_REQUIRED");
  if (!hasStore && !allowCreate) throw new Error("RELEASE_IDENTITY_REQUIRED_FOR_VERIFICATION");
  let credentials;
  try {
    credentials = hasCredentials
      ? JSON.parse(fs.readFileSync(credentialsFile, "utf8"))
      : { alias: "qualitzer-field", password: randomBytes(48).toString("hex") };
  } catch {
    throw new Error("SIGNING_CREDENTIALS_UNREADABLE_OR_INVALID");
  }
  if (credentials?.alias !== "qualitzer-field" || typeof credentials.password !== "string" || !/^[a-f0-9]{96}$/.test(credentials.password)) throw new Error("INVALID_SIGNING_CREDENTIALS");
  const signing = {
    QUALITZER_SIGNING_STORE_FILE: store,
    QUALITZER_SIGNING_STORE_PASSWORD: credentials.password,
    QUALITZER_SIGNING_KEY_PASSWORD: credentials.password,
  };
  if (!hasStore) {
    fs.writeFileSync(credentialsFile, JSON.stringify(credentials), { flag: "wx", mode: 0o600 });
    await run("create-release-key", path.join(javaHome, "bin/keytool.exe"), [
      "-genkeypair", "-keystore", store, "-storetype", "PKCS12",
      "-storepass:env", "QUALITZER_SIGNING_STORE_PASSWORD", "-keypass:env", "QUALITZER_SIGNING_KEY_PASSWORD",
      "-alias", "qualitzer-field", "-keyalg", "RSA", "-keysize", "3072", "-sigalg", "SHA256withRSA",
      "-validity", "10000", "-dname", "CN=Qualitzer Field,O=Qualitzer", "-noprompt",
    ], signing);
  }
  const certificateLog = await run("release-certificate", path.join(javaHome, "bin/keytool.exe"), [
    "-J-Duser.language=en", "-J-Duser.country=US", "-list", "-v", "-keystore", store,
    "-storepass:env", "QUALITZER_SIGNING_STORE_PASSWORD", "-alias", "qualitzer-field",
  ], signing);
  const certificateSha256 = certificateLog.match(/SHA256:\s*([A-Fa-f0-9:]+)/)?.[1].replaceAll(":", "").toLowerCase();
  if (!certificateSha256 || certificateSha256.length !== 64) throw new Error("RELEASE_CERTIFICATE_FINGERPRINT_MISSING");
  if (certificateSha256 !== pinnedCertificate || !certificateLog.includes("PrivateKeyEntry")) throw new Error("EXISTING_RELEASE_PRIVATE_KEY_MISMATCH");
  return { environment: signing, certificateSha256 };
}

async function main() {
  const lock = path.join(signingRoot, ".build.lock");
  const descriptor = fs.openSync(lock, "wx", 0o600);
  try {
    console.log(`BUILD_LOGS ${logs}`);
    const protectedBefore = protectedSnapshot(root);
    const sourcesBefore = captureSources(root);
    fs.writeFileSync(path.join(logs, "source-capture.json"), JSON.stringify(sourcesBefore, null, 2));
    if (expected.versionCode <= previous.versionCode || expected.version === previous.version) throw new Error("UPDATE_VERSION_MUST_ADVANCE");
    verifyPrevious(root);
    const signing = await signingEnvironment(false);
    const oldSignature = await run("previous-apk-signature", path.join(buildTools, "apksigner.bat"), ["verify", "--verbose", "--print-certs", path.join(artifacts, previous.name)]);
    if (oldSignature.match(/Signer #1 certificate SHA-256 digest: (\w+)/)?.[1] !== pinnedCertificate || !/Verified using v2 scheme.*true/.test(oldSignature)) throw new Error("PREVIOUS_APK_SIGNATURE_MISMATCH");
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (packageJson.dependencies?.["expo-dev-client"] || fs.existsSync(path.join(root, "node_modules/expo-dev-client"))) throw new Error("DEV_CLIENT_NOT_ALLOWED");
    const config = resolveReleaseConfig(root, environment);
    const pushConfig = verifyPushConfig(root, config);
    if (config.extra?.gateway?.standalone !== true || config.extra.gateway.url !== gatewayUrl || config.updates?.enabled !== false || config.android?.package !== "com.qualitzer.field" || config.version !== expected.version || config.android.versionCode !== expected.versionCode) throw new Error("INVALID_PUBLIC_RELEASE_CONFIG");
    const profile = JSON.parse(fs.readFileSync(path.join(root, "eas.json"), "utf8")).build?.["standalone-apk"];
    if (profile?.developmentClient !== false || profile.android?.buildType !== "apk" || profile.env?.EXPO_PUBLIC_GATEWAY_URL !== gatewayUrl || profile.env.EXPO_PUBLIC_STANDALONE !== "true") throw new Error("INVALID_STANDALONE_EAS_PROFILE");
    fs.writeFileSync(path.join(logs, "release-config.json"), JSON.stringify(config, null, 2));
    if (!args.includes("--skip-prebuild") && !args.includes("--verify-only")) {
      await run("prebuild", process.execPath, [path.join(root, "node_modules/expo/bin/cli"), "prebuild", "--platform", "android", "--no-clean", "--no-install", "--skip-dependency-update", "react-native,react"]);
    }
    if (args.includes("--prebuild-only")) return;
    if (!args.includes("--verify-only")) {
      await run("assemble-release", path.join(toolRoot, "gradle/gradle-9.3.1/bin/gradle.bat"), [
        "-p", path.join(root, "android"), "--init-script", path.join(__dirname, "release-signing.gradle"),
        ":app:assembleRelease", `-PreactNativeArchitectures=${architectures}`, "--no-daemon", "--no-configuration-cache", "--console=plain", "--max-workers=4",
      ], signing.environment);
    }
    const sourceApk = path.join(root, "android/app/build/outputs/apk/release/app-release.apk");
    const finalPushConfig = verifyPushConfig(root, resolveReleaseConfig(root, environment));
    if (finalPushConfig.firebaseConfigSha256 !== pushConfig.firebaseConfigSha256) throw new Error("PUSH_FIREBASE_CONFIG_CHANGED_DURING_BUILD");
    const manifest = await run("apk-manifest", path.join(buildTools, "aapt.exe"), ["dump", "xmltree", sourceApk, "AndroidManifest.xml"]);
    const push = verifyCompiledPush(sourceApk, finalPushConfig, readApkResources(path.join(buildTools, "aapt.exe"), sourceApk, environment), manifest);
    fs.writeFileSync(path.join(logs, "push-verification.json"), JSON.stringify(push, null, 2));
    console.log(`CLIENT_PUSH_VERIFIED ${JSON.stringify(push)}`);
    if (args.includes("--diagnostic-only")) {
      console.log(`DIAGNOSTIC_APK ${sourceApk}`);
      return;
    }
    const signature = await run("verify-signature", path.join(buildTools, "apksigner.bat"), ["verify", "--verbose", "--print-certs", sourceApk]);
    if (/Android Debug|CN=AndroidDebug/i.test(signature) || !signature.includes("CN=Qualitzer Field") || !/Verified using v2 scheme.*true/.test(signature)) throw new Error("INVALID_RELEASE_SIGNATURE");
    const certificateSha256 = signature.match(/Signer #1 certificate SHA-256 digest: (\w+)/)?.[1];
    if (certificateSha256 !== signing.certificateSha256) throw new Error("APK_SIGNER_DOES_NOT_MATCH_LOCAL_RELEASE_IDENTITY");
    await run("verify-alignment", path.join(buildTools, "zipalign.exe"), ["-c", "-P", "16", "4", sourceApk]);
    const badging = await run("apk-badging", path.join(buildTools, "aapt.exe"), ["dump", "badging", sourceApk]);
    const inspection = inspectApk(sourceApk, { gatewayUrl, architectures, badging, manifest, ...expected });
    const provenance = verifySources(root, sourcesBefore, inspection.bundleSha256);
    if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedSnapshot(root))) throw new Error("PROTECTED_PROJECT_FILES_CHANGED_DURING_BUILD");
    const previousApk = { ...verifyPrevious(root), certificateSha256: pinnedCertificate, signerMatches: certificateSha256 === pinnedCertificate };
    const health = await checkHealth();
    const destination = path.join(artifacts, expected.name);
    if (fs.existsSync(destination)) {
      if (sha256File(destination) !== sha256File(sourceApk)) throw new Error("VERSIONED_APK_ALREADY_EXISTS_WITH_DIFFERENT_BYTES");
    } else fs.copyFileSync(sourceApk, destination, fs.constants.COPYFILE_EXCL);
    const sha256 = createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
    const report = {
      verifiedAt: new Date().toISOString(),
      apk: path.relative(root, destination), sha256, bytes: fs.statSync(destination).size,
      certificateSha256, zipAlignment16KiB: true,
      variant: "release", gatewayUrl, ...inspection, pushConfigured: push.pushConfigured, push, phases,
      previousApk, provenance, health, protectedProjectFilesUnchanged: true,
      installation: `Install over ${previous.version}; do not uninstall or clear app data/queue`,
      limits: ["Client push configuration verified only; remote FCM/EAS credentials, backend readiness, device permission and delivery remain pending", "No physical device installation or native login tested", "Local sideload signing; retain private signing directory for updates"],
    };
    fs.writeFileSync(path.join(logs, "verification.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(artifacts, `release-verification-${expected.version}.json`), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(artifacts, "release-verification.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(`${destination}.sha256`, `${sha256}  ${path.basename(destination)}\n`);
    console.log(`VERIFIED_RELEASE ${JSON.stringify(report, null, 2)}`);
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

main().catch((error) => { console.error(`BUILD_FAILED ${error.message}`); process.exitCode = 1; });