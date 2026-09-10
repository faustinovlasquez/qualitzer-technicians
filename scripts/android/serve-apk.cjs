"use strict";

const { createServer } = require("node:http");
const { createReadStream, readFileSync, statSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { networkInterfaces } = require("node:os");
const { resolve } = require("node:path");
const QRCode = require("qrcode");

const root = resolve(__dirname, "../..");
const name = "qualitzer-field-1.0.0-android.apk";
const file = resolve(root, "artifacts", name);
const report = JSON.parse(readFileSync(resolve(root, "artifacts/release-verification.json"), "utf8"));
const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
if (sha256 !== report.sha256 || report.debuggable !== false || report.variant !== "release") throw new Error("APK_RELEASE_VERIFICATION_REQUIRED");
const size = statSync(file).size;
const addresses = Object.values(networkInterfaces()).flat().filter(address => address && address.family === "IPv4" && !address.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address));
const host = addresses.find(address => address.address === "192.168.1.105")?.address ?? addresses[0]?.address;
if (!host) throw new Error("PRIVATE_LAN_REQUIRED_FOR_APK_DOWNLOAD");
const url = `http://${host}:8790/${name}`;

async function main() {
  const qr = await QRCode.toString(url, { type: "svg", margin: 2, width: 260 });
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instalar Qualitzer Field</title><style>body{font:16px system-ui;background:#f3f7f8;color:#153c46;margin:0;padding:28px}main{max-width:560px;background:white;border-radius:20px;padding:28px;margin:auto}a{display:block;padding:16px;background:#007f80;color:white;text-decoration:none;text-align:center;border-radius:12px;font-weight:700}img{display:block;margin:20px auto}small{word-break:break-all}p{line-height:1.55}</style><main><h1>Qualitzer Field · Android</h1><p>APK release firmado · ${(size / 1024 / 1024).toFixed(2)} MiB · Android 7 o superior.</p><a href="/${name}">Descargar APK</a><img src="/qr.svg" width="260" height="260" alt="QR para descargar el APK en el teléfono"><p>Abre este enlace desde el teléfono conectado a la misma Wi-Fi. El computador solo sirve esta descarga; la app instalada no necesita Expo Go ni Metro.</p><p><strong>Antes de iniciar sesión:</strong> actualiza y habilita la ruta /mobile en el servidor de la API. Esta descarga no realiza el despliegue.</p><small>SHA-256: ${sha256}</small></main></html>`;
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
    if (req.url === `/${name}`) {
      res.writeHead(200, { "Content-Type": "application/vnd.android.package-archive", "Content-Length": size, "Content-Disposition": `attachment; filename="${name}"` });
      if (req.method === "HEAD") { res.end(); return; }
      const stream = createReadStream(file);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
      return;
    }
    if (req.url === "/" || req.url === "/qr.svg") {
      const body = req.url === "/" ? html : qr;
      res.writeHead(200, { "Content-Type": req.url === "/" ? "text/html; charset=utf-8" : "image/svg+xml", "Content-Length": Buffer.byteLength(body) });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  server.on("error", () => { console.error("APK_DOWNLOAD_SERVER_UNAVAILABLE"); process.exitCode = 1; });
  server.listen(8790, host, () => console.log(`APK_DOWNLOAD_PAGE http://${host}:8790/\nAPK_DOWNLOAD ${url}\nSHA256 ${sha256}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
}

main().catch(() => { console.error("APK_DOWNLOAD_PREPARATION_FAILED"); process.exitCode = 1; });