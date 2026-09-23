"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { readApiEnvironment } = require("../../config/apiEnvironment");
const { standaloneGatewayUrl } = require("../../config/gatewayPolicy");

const packageName = "com.qualitzer.field";
const applicationName = "Qualitzer técnicos";
const certificateSha256 = "06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510";
const previous = Object.freeze({
  name: "qualitzer-tecnicos-1.0.52-android.apk", version: "1.0.52", versionCode: 53,
  sha256: "47a4fccc0568f7ea4fb8414b675eab0b3dbe15b0580385496688e97a31640099",
});

function releaseEndpoints(root, environment = process.env) {
  const endpoints = readApiEnvironment(root, environment);
  standaloneGatewayUrl(endpoints.gatewayUrl);
  return endpoints;
}

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

module.exports = { packageName, applicationName, releaseEndpoints, certificateSha256, previous, validateVersion, expectedRelease, sha256File, verifyPrevious };