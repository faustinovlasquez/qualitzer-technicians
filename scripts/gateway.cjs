const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { branchEnvironment } = require("../config/branchEnvironments");

// Pasarela de este PC: en la rama local apunta a la API local y guarda sus sesiones aparte,
// para no mezclarlas con las de otro servidor. BACKEND_URL en el entorno lo reemplaza.
const root = resolve(__dirname, "..");
const shellBackendUrl = process.env.BACKEND_URL;
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const target = branchEnvironment(root);
const env = { ...process.env };
if (shellBackendUrl === undefined && target) {
  env.BACKEND_URL = target.backendUrl;
  if (target.branch === "local") {
    env.GATEWAY_SESSION_FILE = resolve(root, ".data/local/sessions.enc");
    env.GATEWAY_PORT = new URL(target.gatewayUrl).port;
  }
}
console.log(`Pasarela → ${env.BACKEND_URL}`);
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: root, env, stdio: "inherit" });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
