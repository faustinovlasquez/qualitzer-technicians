const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parseEnv } = require("node:util");
const { canonicalGatewayUrl } = require("./gatewayPolicy");

function readApiEnvironment(projectRoot, environment = process.env) {
  let input = environment.BACKEND_URL;
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
  return Object.freeze({ backendUrl, gatewayUrl: new URL("mobile", backendUrl).href });
}

module.exports = { readApiEnvironment };