const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Cada rama apunta a su servidor: local → API en este PC (pasarela con `npm run gateway`),
// desarrollo → servidor de desarrollo, main → producción. BACKEND_URL en el entorno lo reemplaza.
const branchEnvironments = Object.freeze({
  local: Object.freeze({ backendUrl: "http://localhost:5001/api", gatewayUrl: "http://localhost:8787" }),
  desarrollo: Object.freeze({ backendUrl: "https://api-dev-qz-v2.qualitzer.com/api" }),
  main: Object.freeze({ backendUrl: "https://api-qz-v2.qualitzer.com/api" }),
});

function currentBranch(projectRoot) {
  try {
    const head = readFileSync(resolve(projectRoot, ".git", "HEAD"), "utf8").trim();
    const match = /^ref: refs\/heads\/(.+)$/.exec(head);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

function branchEnvironment(projectRoot) {
  const branch = currentBranch(projectRoot);
  if (branch === undefined || !Object.hasOwn(branchEnvironments, branch)) return undefined;
  return { branch, ...branchEnvironments[branch] };
}

module.exports = { branchEnvironments, currentBranch, branchEnvironment };
