"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { zipEntries, entryBytes } = require("./inspect-apk.cjs");
const { expectedRelease, sha256File, verifyPrevious, certificateSha256 } = require("./release-policy.cjs");
const sharp = require("sharp");

async function main() {
const root = path.resolve(__dirname, "../..");
const release = expectedRelease(root);
const report = JSON.parse(fs.readFileSync(path.join(root, `artifacts/release-verification-${release.version}.json`), "utf8"));
const apk = path.join(root, "artifacts", release.name);
assert.equal(sha256File(apk), report.sha256);
assert.equal(fs.statSync(apk).size, report.bytes);
assert.equal(report.certificateSha256, certificateSha256);
assert.equal(report.versionCode, release.versionCode);
assert.equal(report.protectedProjectFilesUnchanged, true);
assert(report.phases.every(phase => phase.exitCode === 0));
const previous = verifyPrevious(root);
const toolRoot = process.argv[2] ?? path.join(process.env.LOCALAPPDATA, "QualitzerAndroid");
const aapt = path.join(toolRoot, "sdk/build-tools/36.0.0/aapt.exe");
const oldBadging = execFileSync(aapt, ["dump", "badging", path.join(root, "artifacts", previous.name)], { encoding: "utf8" });
const previousPermissions = [...oldBadging.matchAll(/uses-permission(?:-sdk-\d+)?: name='([^']+)'/g)].map(match => match[1]);
const addedPermissions = report.permissions.filter(permission => !previousPermissions.includes(permission));
assert.deepEqual(addedPermissions, []);
assert.equal(report.deviceSecurityConfigured, true);
const bytes = fs.readFileSync(apk);
const entries = zipEntries(bytes);
const resourceLines = execFileSync(aapt, ["dump", "--values", "resources", apk], { encoding: "utf8", maxBuffer: 24 * 1024 * 1024 }).split(/\r?\n/);
const iconPaths = new Map();
const notificationPaths = new Map();
let densityConfig = "";
for (let index = 0; index < resourceLines.length; index++) {
  const config = /^\s+config ([^:]+):/.exec(resourceLines[index]);
  if (config) densityConfig = config[1];
  const icon = /^\s+resource [^ ]+ com\.qualitzer\.field:mipmap\/(ic_launcher(?:_round|_foreground)?):/.exec(resourceLines[index]);
  const value = icon && /^\s+\(string8\) "([^"]+)"/.exec(resourceLines[index + 1] ?? "");
  if (value) iconPaths.set(`${densityConfig}:${icon[1]}`, value[1]);
  if (/^\s+resource [^ ]+ com\.qualitzer\.field:drawable\/notification_icon:/.test(resourceLines[index])) {
    const image = /^\s+\(string8\) "([^"]+)"/.exec(resourceLines[index + 1] ?? "");
    if (image) notificationPaths.set(densityConfig, image[1]);
  }
}
const nativeIcons = [];
for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  for (const icon of ["ic_launcher", "ic_launcher_round", "ic_launcher_foreground"]) {
    const sourceDirectory = path.join(root, "android/app/src/main/res", `mipmap-${density}`);
    const filename = fs.readdirSync(sourceDirectory).find(name => name === `${icon}.webp` || name === `${icon}.png`);
    assert(filename, "NATIVE_ICON_SOURCE_MISSING");
    const resource = iconPaths.get(`${density}:${icon}`);
    assert(resource && entries.has(resource), "APK_ICON_RESOURCE_MISSING");
    const content = entryBytes(bytes, entries.get(resource));
    const sha256 = createHash("sha256").update(content).digest("hex");
    assert.equal(sha256, sha256File(path.join(sourceDirectory, filename)), "APK_ICON_DIFFERS_FROM_NATIVE_RESOURCE");
    nativeIcons.push({ density, icon, resource, sha256 });
  }
}
const notificationIcons = [];
for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  const resource = notificationPaths.get(density);
  assert(resource && entries.has(resource), "APK_NOTIFICATION_ICON_MISSING");
  const content = entryBytes(bytes, entries.get(resource));
  const compiled = await sharp(content).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = await sharp(path.join(root, `android/app/src/main/res/drawable-${density}/notification_icon.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(compiled.info.width, source.info.width);
  assert.equal(compiled.info.height, source.info.height);
  assert(compiled.data.equals(source.data), "APK_NOTIFICATION_ICON_PIXELS_DIFFER");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const pixelsSha256 = createHash("sha256").update(compiled.data).digest("hex");
  notificationIcons.push({ density, resource, sha256, pixelsSha256, pixelsMatch: true });
}
const manifestLog = report.phases.find(phase => phase.name === "apk-manifest").log;
const manifest = fs.readFileSync(path.join(root, manifestLog), "utf8");
assert(manifest.includes("com.google.firebase.messaging.default_notification_icon"));
assert(manifest.includes("expo.modules.notifications.default_notification_icon"));
for (const component of ["CompanyShortcutActivity", "CompanyPinReceiver"]) {
  assert(manifest.includes(`expo.modules.companybranding.${component}`));
}
assert.equal(fs.existsSync(path.join(root, ".data/android-signing/.build.lock")), false);
const audit = {
  checkedAt: new Date().toISOString(), apk: report.apk, sha256: report.sha256, bytes: report.bytes,
  certificateMatchesPrevious: true, previousApkUnchanged: true, addedPermissions, nativeIcons, notificationIcons,
  companyBrandingCompiled: report.companyBrandingModule, sourceProvenanceMatches: report.provenance.sources.every(source => source.matches),
  health: report.health, compileSeconds: report.phases.find(phase => phase.name === "assemble-release")?.elapsedSeconds ?? null,
  buildLockReleased: true, physicalDeviceTested: false,
};
fs.writeFileSync(path.join(root, `artifacts/final-audit-${release.version}.json`), JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });