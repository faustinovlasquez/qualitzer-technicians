const fs = require("node:fs");
const { inflateRawSync } = require("node:zlib");

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

function entryBytes(bytes, entry) {
  if (!entry) throw new Error("APK_REQUIRED_ASSET_MISSING");
  const offset = entry.localOffset;
  if (bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error("APK_LOCAL_ENTRY_INVALID");
  const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
  const compressed = bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error("APK_ZIP_METHOD_UNSUPPORTED");
}

function inspectApk(filename, { gatewayUrl, architectures, badging, manifest }) {
  if (!badging.includes("package: name='com.qualitzer.field'") || !badging.includes("versionName='1.0.0'")) throw new Error("APK_IDENTITY_MISMATCH");
  if (/application-debuggable/.test(badging) || /android:debuggable[^\n]*0xffffffff/i.test(manifest)) throw new Error("APK_IS_DEBUGGABLE");
  const bytes = fs.readFileSync(filename);
  const entries = zipEntries(bytes);
  const bundle = entryBytes(bytes, entries.get("assets/index.android.bundle"));
  if (bundle.subarray(0, 8).toString("hex") !== "c61fbc03c103191f") throw new Error("APK_BUNDLE_IS_NOT_HERMES_BYTECODE");
  if (!bundle.includes(Buffer.from(gatewayUrl))) throw new Error("APK_BUNDLE_GATEWAY_MISSING");
  const config = JSON.parse(entryBytes(bytes, entries.get("assets/app.config")).toString("utf8"));
  if (config.extra?.gateway?.standalone !== true || config.extra.gateway.url !== gatewayUrl || config.updates?.enabled !== false) throw new Error("APK_EMBEDDED_CONFIG_INVALID");
  const abis = [...new Set([...entries.keys()].filter((name) => name.startsWith("lib/")).map((name) => name.split("/")[1]))].sort();
  if (abis.join(",") !== architectures.split(",").sort().join(",")) throw new Error("APK_ABI_MISMATCH");
  for (const abi of abis) {
    for (const library of ["libhermesvm.so", "libhermestooling.so", "libreactnative.so"]) {
      if (!entries.has(`lib/${abi}/${library}`)) throw new Error("APK_HERMES_NATIVE_LIBRARY_MISSING");
    }
  }
  if ([...entries.keys()].some((name) => /(?:^|\/)(?:\.env[^/]*|credentials\.json|[^/]*\.(?:p12|jks|key))$/i.test(name))) throw new Error("APK_CONTAINS_PRIVATE_FILE");
  return {
    package: config.android.package, version: config.version,
    versionCode: badging.match(/versionCode='([^']+)'/)?.[1],
    minSdk: Number(badging.match(/sdkVersion:'(\d+)'/)?.[1]),
    targetSdk: Number(badging.match(/targetSdkVersion:'(\d+)'/)?.[1]),
    abis, debuggable: false, hermesBytecode: true, bundleBytes: bundle.length,
    embeddedStandalone: true, remoteUpdatesEnabled: false,
    permissions: [...badging.matchAll(/uses-permission(?:-sdk-\d+)?: name='([^']+)'/g)].map((match) => match[1]),
  };
}

module.exports = { inspectApk };