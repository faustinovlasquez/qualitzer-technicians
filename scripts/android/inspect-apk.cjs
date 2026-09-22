const fs = require("node:fs");
const { inflateRawSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const { validateVersion, packageName, applicationName, gatewayUrl: pinnedGatewayUrl } = require("./release-policy.cjs");

function zipEntries(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65557)) throw new Error("APK_ZIP_DIRECTORY_MISSING");
  let offset = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("APK_ZIP_DIRECTORY_INVALID");
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.set(name, {
      method: bytes.readUInt16LE(offset + 10), size: bytes.readUInt32LE(offset + 20),
      localOffset: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return entries;
}

function entryBytes(bytes, entry, maxOutputLength) {
  if (!entry) throw new Error("APK_REQUIRED_ASSET_MISSING");
  const offset = entry.localOffset;
  if (bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error("APK_LOCAL_ENTRY_INVALID");
  const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
  const compressed = bytes.subarray(start, start + entry.size);
  if (maxOutputLength !== undefined && entry.method === 0 && compressed.length > maxOutputLength) throw new Error("APK_ASSET_SIZE_LIMIT_EXCEEDED");
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed, { maxOutputLength });
  throw new Error("APK_ZIP_METHOD_UNSUPPORTED");
}

function inspectApk(filename, { gatewayUrl, architectures, badging, manifest, version, versionCode }) {
  validateVersion(version, versionCode);
  if (gatewayUrl !== pinnedGatewayUrl || !badging.includes(`package: name='${packageName}'`) || !badging.includes(`versionName='${version}'`) || !badging.includes(`versionCode='${versionCode}'`)) throw new Error("APK_IDENTITY_MISMATCH");
  if (/application-debuggable/.test(badging) || /android:debuggable[^\n]*0xffffffff/i.test(manifest)) throw new Error("APK_IS_DEBUGGABLE");
  if (!badging.includes("sdkVersion:'24'") || !badging.includes("targetSdkVersion:'36'")) throw new Error("APK_SDK_MISMATCH");
  const bytes = fs.readFileSync(filename);
  const entries = zipEntries(bytes);
  const bundle = entryBytes(bytes, entries.get("assets/index.android.bundle"));
  if (bundle.subarray(0, 8).toString("hex") !== "c61fbc03c103191f") throw new Error("APK_BUNDLE_IS_NOT_HERMES_BYTECODE");
  if (!bundle.includes(Buffer.from(gatewayUrl))) throw new Error("APK_BUNDLE_GATEWAY_MISSING");
  const config = JSON.parse(entryBytes(bytes, entries.get("assets/app.config")).toString("utf8"));
  if (config.android?.package !== packageName || config.version !== version || config.android.versionCode !== versionCode || config.extra?.gateway?.standalone !== true || config.extra.gateway.url !== gatewayUrl || config.updates?.enabled !== false || config.updates.useEmbeddedUpdate !== true) throw new Error("APK_EMBEDDED_CONFIG_INVALID");
  if (config.name !== applicationName || !badging.includes(`application-label:'${applicationName}'`)) throw new Error("APK_APPLICATION_NAME_MISMATCH");
  if (config.icon !== "./assets/qualitzer-icon.png" || config.android.adaptiveIcon?.foregroundImage !== "./assets/qualitzer-adaptive.png") throw new Error("APK_BRANDING_ASSETS_MISMATCH");
  for (const component of ["CompanyShortcutActivity", "CompanyPinReceiver"]) {
    if (!manifest.includes(`expo.modules.companybranding.${component}`)) throw new Error("APK_COMPANY_BRANDING_COMPONENT_MISSING");
  }
  const dex = [...entries].filter(([name]) => /^classes\d*\.dex$/.test(name)).map(([, entry]) => entryBytes(bytes, entry));
  const nativeGoogleMapsConfigured = config.extra?.googleMaps?.native === true;
  if (nativeGoogleMapsConfigured) {
    if (!manifest.includes("com.google.android.geo.API_KEY")) throw new Error("APK_GOOGLE_MAPS_CONFIGURATION_MISSING");
    for (const marker of ["QualitzerPlacesModule", "com/rnmaps/maps/MapView", "com/google/android/libraries/places"]) {
      if (!dex.some(content => content.includes(Buffer.from(marker)))) throw new Error("APK_NATIVE_GOOGLE_MODULE_MISSING");
    }
  }
  if (!dex.some(content => content.includes(Buffer.from("Lexpo/modules/companybranding/CompanyBrandingModule;")))) throw new Error("APK_COMPANY_BRANDING_MODULE_MISSING");
  const deviceSecurityConfigured = config.plugins?.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-local-authentication") === true;
  if (deviceSecurityConfigured) {
    for (const module of ["LocalAuthenticationModule", "ScreenCaptureModule"]) {
      if (!dex.some(content => content.includes(Buffer.from(module)))) throw new Error("APK_DEVICE_SECURITY_MODULE_MISSING");
    }
    if (!badging.includes("name='android.permission.DETECT_SCREEN_CAPTURE'")) throw new Error("APK_SCREEN_CAPTURE_STARTUP_PERMISSION_MISSING");
    if (badging.includes("name='android.permission.READ_MEDIA_IMAGES'")) throw new Error("APK_UNEXPECTED_MEDIA_PERMISSION");
  }
  const abis = [...new Set([...entries.keys()].filter((name) => name.startsWith("lib/")).map((name) => name.split("/")[1]))].sort();
  const actionLocationConfigured = config.extra?.locationTrackingMode === "actions";
  const locationConfigured = config.plugins?.some(plugin => Array.isArray(plugin) && plugin[0] === "expo-location") === true;
  if (locationConfigured) {
    for (const permission of actionLocationConfigured ? ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"] : ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_LOCATION"]) {
      if (!badging.includes(`name='android.permission.${permission}'`)) throw new Error("APK_LOCATION_PERMISSION_MISSING");
    }
    if (actionLocationConfigured && ["ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE_LOCATION"].some(permission => badging.includes(`name='android.permission.${permission}'`))) throw new Error("ACTION_LOCATION_BACKGROUND_PERMISSION_FORBIDDEN");
    for (const module of ["LocationModule", "TaskManagerModule", "BackgroundTaskModule"]) {
      if (!dex.some(content => content.includes(Buffer.from(module)))) throw new Error("APK_LOCATION_MODULE_MISSING");
    }
    if (!manifest.includes("expo.modules.location.services.LocationTaskService") || config.android.allowBackup !== false || !/android:allowBackup[^\n]*0x0\b/.test(manifest)) throw new Error("APK_LOCATION_PRIVACY_CONFIGURATION_MISSING");
  }
  if (abis.join(",") !== architectures.split(",").sort().join(",")) throw new Error("APK_ABI_MISMATCH");
  for (const abi of abis) {
    for (const library of ["libhermesvm.so", "libhermestooling.so", "libreactnative.so"]) {
      if (!entries.has(`lib/${abi}/${library}`)) throw new Error("APK_HERMES_NATIVE_LIBRARY_MISSING");
    }
  }
  if ([...entries.keys()].some((name) => /(?:^|\/)(?:\.env[^/]*|credentials\.json|[^/]*\.(?:p12|jks|key))$/i.test(name))) throw new Error("APK_CONTAINS_PRIVATE_FILE");
  return {
    package: config.android.package, version: config.version, applicationName: config.name, companyBrandingModule: true, deviceSecurityConfigured, locationConfigured, nativeGoogleMapsConfigured, actionLocationConfigured,
    versionCode,
    minSdk: Number(badging.match(/sdkVersion:'(\d+)'/)?.[1]),
    targetSdk: Number(badging.match(/targetSdkVersion:'(\d+)'/)?.[1]),
    abis, debuggable: false, hermesBytecode: true, bundleBytes: bundle.length,
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    clockBytecodeMarkers: ["tenantChallengeMonotonicNow", "registerTenantChallengeClock", "getTenantChallengeRemaining", "Date"].filter(value => bundle.includes(Buffer.from(value))),
    embeddedStandalone: true, remoteUpdatesEnabled: false,
    permissions: [...badging.matchAll(/uses-permission(?:-sdk-\d+)?: name='([^']+)'/g)].map((match) => match[1]),
  };
}

module.exports = { inspectApk, zipEntries, entryBytes };