"use strict";

// Publica una actualización OTA firmada para los APK ya instalados de la misma versión (runtime = versión de la app).
// Uso: node scripts/android/publish-ota.cjs "Mensaje de la actualización"
// Requiere sesión de Expo (npx eas-cli login) o EXPO_TOKEN, y la clave privada de firma en
// %LOCALAPPDATA%\QualitzerAndroid\updates-signing\private-key.pem (nunca en el repositorio).
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { expectedRelease } = require("./release-policy.cjs");
const { releaseEnvironment } = require("./release-push.cjs");

const root = path.resolve(__dirname, "../..");
const message = process.argv.slice(2).join(" ").trim();
if (message.length < 3 || message.length > 200) throw new Error("OTA_MESSAGE_REQUIRED (3 a 200 caracteres)");
const release = expectedRelease(root);
// Solo se publica para una versión que ya tiene APK compilado y verificado: así el OTA llega a teléfonos reales.
const verification = path.join(root, "artifacts", `release-verification-${release.version}.json`);
if (!fs.existsSync(verification)) throw new Error(`OTA_REQUIRES_BUILT_APK_${release.version}`);
const privateKey = path.join(process.env.LOCALAPPDATA ?? "", "QualitzerAndroid", "updates-signing", "private-key.pem");
if (!fs.existsSync(privateKey)) throw new Error("OTA_PRIVATE_KEY_MISSING");
const channel = process.env.QUALITZER_UPDATES_CHANNEL ?? "production";
const base = releaseEnvironment(process.env);
// eas-cli exige Node 20.18 o superior: se antepone el Node del propio proyecto (node_modules/node) en el PATH del proceso hijo.
const localNode = path.join(root, "node_modules", "node", "bin");
const pathKey = Object.keys(base).find(key => key.toUpperCase() === "PATH") ?? "PATH";
const environment = { ...base, [pathKey]: `${fs.existsSync(localNode) ? `${localNode}${path.delimiter}` : ""}${base[pathKey] ?? ""}`,
  ...(process.env.EXPO_TOKEN ? { EXPO_TOKEN: process.env.EXPO_TOKEN } : {}), QUALITZER_UPDATES_CHANNEL: channel };
const windows = process.platform === "win32";
// Con shell en Windows los argumentos con espacios se separan: se envían entre comillas.
const quote = value => (windows && /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
const args = ["--yes", "eas-cli@latest", "update", "--channel", channel, "--platform", "android", "--message", `${release.version}: ${message}`,
  "--private-key-path", privateKey, "--non-interactive"].map(quote);
const result = spawnSync(windows ? "npx.cmd" : "npx", args, { cwd: root, env: environment, stdio: "inherit", shell: windows });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`OTA_PUBLISHED version=${release.version} channel=${channel}`);
