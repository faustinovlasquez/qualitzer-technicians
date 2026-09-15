"use strict";

const { createServer } = require("node:http");
const { readFileSync, lstatSync, readdirSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { networkInterfaces } = require("node:os");
const { resolve } = require("node:path");
const QRCode = require("qrcode");
const { validateVersion, expectedRelease, packageName, applicationName, gatewayUrl, certificateSha256 } = require("./release-policy.cjs");

const root = resolve(__dirname, "../..");
function publicPath(base, relative, directory = false) {
  const parts = relative.split("/");
  if (parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))) throw new Error("DOWNLOAD_PATH_NOT_ALLOWED");
  let current = base;
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile())) throw new Error("DOWNLOAD_FILE_TYPE_NOT_ALLOWED");
  }
  return current;
}
function readPublicFile(base, relative, limit = 2 * 1024 * 1024) {
  const file = publicPath(base, relative);
  if (lstatSync(file).size > limit) throw new Error("DOWNLOAD_FILE_TOO_LARGE");
  return readFileSync(file);
}
const report = JSON.parse(readPublicFile(root, "artifacts/release-verification.json").toString("utf8"));
const { name, version, versionCode } = validateVersion(report.version, report.versionCode);
const expected = expectedRelease(root);
if (version !== expected.version || versionCode !== expected.versionCode || report.apk?.replaceAll("\\", "/") !== `artifacts/${name}` || report.package !== packageName || report.certificateSha256 !== certificateSha256 || report.gatewayUrl !== gatewayUrl || report.embeddedStandalone !== true || report.remoteUpdatesEnabled !== false || report.zipAlignment16KiB !== true || report.previousApk?.signerMatches !== true) throw new Error("APK_RELEASE_IDENTITY_REQUIRED");
if (report.applicationName !== applicationName || report.companyBrandingModule !== true) throw new Error("APK_COMPANY_BRANDING_REQUIRED");
if (report.pushConfigured !== true || report.push?.clientConfigured !== true || report.push?.scope !== "CLIENT_ONLY") throw new Error("APK_FIREBASE_CLIENT_CONFIGURATION_REQUIRED");
const apkContent = readPublicFile(root, `artifacts/${name}`, 256 * 1024 * 1024);
const sha256 = createHash("sha256").update(apkContent).digest("hex");
if (sha256 !== report.sha256 || report.debuggable !== false || report.variant !== "release") throw new Error("APK_RELEASE_VERIFICATION_REQUIRED");
const size = apkContent.length;
if (size !== report.bytes) throw new Error("APK_RELEASE_SIZE_MISMATCH");
const gatewayVersion = "1.0.7";
const gatewayArchiveName = `qualitzer-mobile-gateway-${gatewayVersion}.tgz`;
const gatewayArchivePath = `artifacts/mobile-gateway/${gatewayArchiveName}`;
const gatewayContent = readPublicFile(root, gatewayArchivePath, 32 * 1024 * 1024);
const gatewaySha256 = createHash("sha256").update(gatewayContent).digest("hex");
if (gatewaySha256 !== "c0b8de858f06e65852cf0f1033b743d33a6c23582bcf7d4660d9238ae93525f7") throw new Error("GATEWAY_IMMUTABLE_HASH_REQUIRED");
const validationDirectory = "artifacts/logs/fluidity-package";
const validationName = readdirSync(publicPath(root, validationDirectory, true), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-zA-Z0-9]{6}$/.test(entry.name))
  .map(entry => entry.name).sort().at(-1);
if (!validationName) throw new Error("GATEWAY_VALIDATION_REPORT_REQUIRED");
const gatewayValidation = JSON.parse(readPublicFile(root, `${validationDirectory}/${validationName}/report.json`).toString("utf8"));
const requiredGatewayChecks = ["generated-package-hash", "archive-structure-and-manifest", "all-source-and-dependency-provenance",
  "timer-checklist-and-retained-notifications-static", "actual-isolated-commonjs-node20-load", "observed-inputs-stable-at-completion"];
if (gatewayValidation.passed !== true || gatewayValidation.version !== gatewayVersion || !gatewayValidation.completedAt
  || gatewayValidation.package?.path !== gatewayArchivePath || gatewayValidation.package?.sha256 !== gatewaySha256
  || gatewayValidation.package?.bytes !== gatewayContent.length || !Array.isArray(gatewayValidation.checks)
  || !requiredGatewayChecks.every(name => gatewayValidation.checks.some(check => check.name === name && check.passed === true))) throw new Error("GATEWAY_DELIVERY_VERIFICATION_REQUIRED");
const deploymentGuide = readPublicFile(resolve(root, "../Qualitzer2.0-Backend"), "docs/ACTUALIZACION-ASIGNACIONES-MOVILES.md");
const fluidityGuide = readPublicFile(root, "docs/ACTUALIZACION-FLUIDEZ-MOVIL.md");
const releaseGuide = readPublicFile(root, `docs/ACTUALIZACION-${version}.md`);
const logo = readPublicFile(root, "assets/qualitzer-logo.png");
const addresses = Object.entries(networkInterfaces()).flatMap(([network, entries]) => (entries ?? []).map(address => ({ ...address, network })))
  .filter(address => address.family === "IPv4" && !address.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address));
const requestedHost = process.env.QUALITZER_APK_HOST;
if (requestedHost && !addresses.some(address => address.address === requestedHost)) throw new Error("APK_HOST_MUST_BE_ASSIGNED_PRIVATE_ADDRESS");
const host = requestedHost ?? addresses.find(address => /^(?:wi-?fi|wlan|en0)/i.test(address.network))?.address
  ?? addresses.find(address => /^(?:ethernet|eth\d|en\d)/i.test(address.network) && !/virtual|vethernet|vpn|tun|tap/i.test(address.network))?.address;
if (!host) throw new Error("PRIVATE_LAN_REQUIRED_FOR_APK_DOWNLOAD");
const port = Number(process.env.QUALITZER_APK_PORT ?? "8790");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("APK_PORT_INVALID");
const url = `http://${host}:${port}/${name}`;

async function main() {
  const qr = await QRCode.toString(url, { type: "svg", margin: 2, width: 260 });
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actualizar ${applicationName} ${version}</title>
<style>body{font:16px system-ui;background:#f3f7f8;color:#153c46;margin:0;padding:24px}main{max-width:560px;background:white;border-radius:20px;padding:24px;margin:auto}a{display:block;padding:16px;background:#007f80;color:white;text-decoration:none;text-align:center;border-radius:12px;font-weight:700;margin:12px 0}img{display:block;margin:20px auto}small{word-break:break-all}p,li{line-height:1.55}li{margin:8px 0}details{margin:20px 0}</style>
<main><img src="/logo.png" width="72" height="72" alt="Logo de Qualitzer"><h1>${applicationName} · ${version}</h1>
<p>Android · código ${versionCode} · APK release firmado · ${(size / 1024 / 1024).toFixed(2)} MiB · Android 7 o superior.</p>
<a href="/${name}">Descargar actualización ${version}</a><img src="/qr.svg" width="260" height="260" alt="QR para descargar la actualización en el teléfono">
<p><strong>Navegación por pasos y ficha de trabajo ordenada.</strong></p>
<ul><li>Atrás vuelve a la vista anterior; Inicio y Listado son acciones separadas.</li><li>Archivos de checklist y actividades conservan el contexto del trabajo.</li><li>Pestañas siempre visibles y acciones de ejecución fijas abajo.</li><li>Actividades en tarjetas propias, con minutos, estado y archivos.</li><li>La actividad recién añadida queda destacada y visible.</li><li>Sin instrucciones duplicadas ni secciones de materiales vacías.</li></ul>
<p><strong>No requiere cambios nuevos de servidor respecto de 1.0.18.</strong> Conserva el gateway ${gatewayVersion} y las funciones de actividades anteriores.</p>
<p>Elige <strong>Actualizar</strong> sobre la app instalada. No desinstales ni borres datos o pendientes.</p>
<p>Guardado local no significa envío confirmado ni ficha actualizada. La sincronización requiere conexión, sesión válida y la app en primer plano y desbloqueada. El cronómetro conserva el tiempo oficial del servidor.</p>
<a href="/actualizacion.txt">Detalles de esta actualización</a>
<a href="/fluidez.txt">Guía de fluidez y preparación del gateway</a>
<details><summary>Requisitos de servidor para soporte</summary><a href="/${gatewayArchiveName}">Gateway ${gatewayVersion}</a><a href="/actualizacion-servidor.txt">Despliegue de asignaciones completas</a><small>SHA-256 gateway: ${gatewaySha256}</small><p>Paquete reproducible verificado en Node 20.12.2. También deben desplegarse las fuentes de asignaciones y notificaciones del backend. Sin migración nueva. Se conservan los paquetes anteriores; no se borran sesiones ni pendientes. La verificación local no acredita el despliegue remoto.</p></details>
<p>La misma Wi-Fi se necesita solo para descargar. La app instalada no necesita Expo Go, Metro ni el computador.</p><small>SHA-256 APK: ${sha256}</small></main></html>`;
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
    if (req.url === `/${name}`) {
      res.writeHead(200, { "Content-Type": "application/vnd.android.package-archive", "Content-Length": size, "Content-Disposition": `attachment; filename="${name}"` });
      if (req.method === "HEAD") { res.end(); return; }
      res.end(apkContent);
      return;
    }
    if (req.url === "/" || req.url === "/qr.svg") {
      const body = req.url === "/" ? html : qr;
      res.writeHead(200, { "Content-Type": req.url === "/" ? "text/html; charset=utf-8" : "image/svg+xml", "Content-Length": Buffer.byteLength(body) });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if (req.url === "/logo.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": logo.length });
      res.end(req.method === "HEAD" ? undefined : logo);
      return;
    }
    if (req.url === "/actualizacion.txt" || req.url === "/fluidez.txt") {
      const content = req.url === "/actualizacion.txt" ? releaseGuide : fluidityGuide;
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": content.length });
      res.end(req.method === "HEAD" ? undefined : content);
      return;
    }
    if (req.url === `/${gatewayArchiveName}` || req.url === "/actualizacion-servidor.txt") {
      const archive = req.url === `/${gatewayArchiveName}`;
      const content = archive ? gatewayContent : deploymentGuide;
      res.writeHead(200, { "Content-Type": archive ? "application/gzip" : "text/plain; charset=utf-8", "Content-Length": content.length, "Content-Disposition": `attachment; filename="${archive ? gatewayArchiveName : "actualizacion-servidor.txt"}"` });
      res.end(req.method === "HEAD" ? undefined : content);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  server.on("error", () => { console.error("APK_DOWNLOAD_SERVER_UNAVAILABLE"); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`APK_DOWNLOAD_PID ${process.pid}\nAPK_DOWNLOAD_PAGE http://${host}:${port}/\nAPK_DOWNLOAD ${url}\nAPK_QR http://${host}:${port}/qr.svg\nVERSION ${version} CODE ${versionCode}\nSHA256 ${sha256}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
}

main().catch(() => { console.error("APK_DOWNLOAD_PREPARATION_FAILED"); process.exitCode = 1; });