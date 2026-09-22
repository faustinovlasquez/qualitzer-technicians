const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve, dirname, delimiter } = require("node:path");
const { networkInterfaces } = require("node:os");
const { readApiEnvironment } = require("../config/apiEnvironment");

const root = resolve(__dirname, "..");
const node = process.platform === "win32" ? resolve(root, "node_modules/node/bin/node.exe") : resolve(root, "node_modules/node/bin/node");
if (!existsSync(node)) {
  console.error("Faltan dependencias. Abre INSTALAR.cmd primero.");
  process.exit(1);
}
const env = { ...process.env, PATH: `${dirname(node)}${delimiter}${process.env.PATH}` };
if (existsSync(resolve(root, ".env"))) process.loadEnvFile?.(resolve(root, ".env"));
Object.assign(env, process.env, { PATH: `${dirname(node)}${delimiter}${process.env.PATH}` });
const endpoints = readApiEnvironment(root, env);
env.BACKEND_URL = endpoints.backendUrl;
const addresses = Object.values(networkInterfaces()).flat().filter((address) => address?.family === "IPv4" && !address.internal).map((address) => address.address);
console.log("\nQUALITZER FIELD\n");
console.log("Vista de prueba: http://localhost:8081");
console.log(`Pasarela configurada: ${endpoints.gatewayUrl}`);
for (const address of addresses) console.log(`Teléfono (Expo Go): exp://${address}:8081`);
console.log("Usa la misma red Wi-Fi. Ctrl+C detiene solo esta app.\n");
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
function launch(args) {
  const child = spawn(node, args, { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => { console.error(error.message); stop(1); });
  child.on("exit", (code) => { if (!stopping) stop(code ?? 1); });
}
launch(["node_modules/expo/bin/cli", "start", "--port", "8081", "--lan", ...(process.argv.includes("--mobile") ? [] : ["--web"])]);
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());