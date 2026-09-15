"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const packageName = "com.qualitzer.field";
const applicationName = "Qualitzer técnicos";
const gatewayUrl = "https://api-demos-qz-v2.qualitzer.com/mobile";
const certificateSha256 = "06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510";
const previous = Object.freeze({
  name: "qualitzer-tecnicos-1.0.16-android.apk", version: "1.0.16", versionCode: 17,
  sha256: "7511bf8278a669a4de2b34a18d7f42b8beb2b06bb6958871965b0fe9206f9f04",
});

function validateVersion(version, versionCode) {
  if (typeof version !== "string" || version.length > 50 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !version.split(".").every(part => Number.isSafeInteger(Number(part))) ||
      !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) {
    throw new Error("INVALID_RELEASE_VERSION_OR_CODE");
  }
  return { version, versionCode, name: `qualitzer-tecnicos-${version}-android.apk` };
}

function expectedRelease(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo;
  if (config?.android?.package !== packageName) throw new Error("RELEASE_PACKAGE_CHANGED");
  if (config.name !== applicationName || config.icon !== "./assets/qualitzer-icon.png" || config.android.adaptiveIcon?.foregroundImage !== "./assets/qualitzer-adaptive.png") throw new Error("RELEASE_BRANDING_MISMATCH");
  return validateVersion(config.version, config.android.versionCode);
}

function sha256File(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function verifyPrevious(root) {
  const filename = path.join(root, "artifacts", previous.name);
  if (sha256File(filename) !== previous.sha256) throw new Error("PREVIOUS_APK_CHANGED");
  return { ...previous, bytes: fs.statSync(filename).size, unchanged: true };
}

module.exports = { packageName, applicationName, gatewayUrl, certificateSha256, previous, validateVersion, expectedRelease, sha256File, verifyPrevious };