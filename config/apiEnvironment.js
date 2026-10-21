const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parseEnv } = require("node:util");
const { canonicalGatewayUrl } = require("./gatewayPolicy");
const { branchEnvironment } = require("./branchEnvironments");

function readApiEnvironment(projectRoot, environment = process.env) {
  let input = environment.BACKEND_URL;
  let gatewayInput = environment.GATEWAY_URL;
  if (input === undefined) {
    const target = branchEnvironment(projectRoot);
    input = target?.backendUrl;
    gatewayInput ??= target?.gatewayUrl;
  }
  if (input === undefined) {
    const filename = resolve(projectRoot, ".env");
    try {
      input = existsSync(filename) ? parseEnv(readFileSync(filename, "utf8")).BACKEND_URL : undefined;
    } catch {
      throw new Error("API_ENV_FILE_INVALID");
    }
  }
  if (typeof input !== "string" || input.length === 0) throw new Error("BACKEND_URL_REQUIRED");
  let backendUrl;
  try {
    if (input.trim() !== input) throw new Error();
    backendUrl = canonicalGatewayUrl(input);
    if (!new URL(backendUrl).pathname.endsWith("/api")) throw new Error();
  } catch {
    throw new Error("BACKEND_URL_MUST_BE_API_BASE");
  }
  // GATEWAY_URL solo existe para la rama local, donde la pasarela corre aparte (`npm run gateway`).
  const gatewayUrl = gatewayInput === undefined ? new URL("mobile", backendUrl).href : canonicalGatewayUrl(gatewayInput);
  return Object.freeze({ backendUrl, gatewayUrl });
}

module.exports = { readApiEnvironment };
