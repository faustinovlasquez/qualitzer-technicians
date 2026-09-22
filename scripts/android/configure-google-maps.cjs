"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const root = path.resolve(__dirname, "../..");
const environmentFile = path.join(root, ".env");
const values = fs.existsSync(environmentFile) ? parseEnv(fs.readFileSync(environmentFile, "utf8")) : {};
const key = process.env.GOOGLE_MAPS_API_KEY ?? values.GOOGLE_MAPS_API_KEY;
if (!key || !/^AIza[A-Za-z0-9_-]{35}$/.test(key)) throw new Error("GOOGLE_MAPS_LOCAL_KEY_REQUIRED");
console.log(JSON.stringify({ configured: true, localFile: ".env", keyPrinted: false, cloudRestrictionsVerified: false }));
if (process.argv.includes("--probe-places") || process.argv.includes("--probe-existing-places")) {
  const headers = { "Content-Type": "application/json", "X-Goog-Api-Key": key,
    "X-Android-Package": "com.qualitzer.field", "X-Android-Cert": "B1A31ECE4EB753D18ED21A4DBB46BD74811F3BE4" };
  const existing = process.argv.includes("--probe-existing-places");
  const endpoint = new URL(existing ? "https://maps.googleapis.com/maps/api/place/autocomplete/json" : "https://places.googleapis.com/v1/places:autocomplete");
  if (existing) { endpoint.search = new URLSearchParams({ key, input: "Paine, Chile", language: "es" }).toString(); }
  fetch(endpoint, { method: existing ? "GET" : "POST", headers, body: existing ? undefined : JSON.stringify({ input: "Paine, Chile", languageCode: "es" }), signal: AbortSignal.timeout(15000) })
    .then(async response => {
      const body = await response.json();
      const reasons = (body.error?.details ?? []).map(detail => detail.reason).filter(reason => typeof reason === "string" && /^[A-Z_]+$/.test(reason));
      const report = { checkedAt: new Date().toISOString(), service: existing ? "Places API" : "Places API New", httpStatus: response.status, accepted: response.ok && (!existing || body.status === "OK"), reasons,
        apiStatus: typeof body.status === "string" && /^[A-Z_]+$/.test(body.status) ? body.status : undefined,
        package: headers["X-Android-Package"], certificateSha1: headers["X-Android-Cert"], mapsSdkOnDeviceTested: false };
      fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
      fs.writeFileSync(path.join(root, existing ? "artifacts/google-existing-places-preflight.json" : "artifacts/google-places-preflight.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    }).catch(() => { console.error("GOOGLE_PLACES_PREFLIGHT_UNAVAILABLE"); process.exitCode = 1; });
}