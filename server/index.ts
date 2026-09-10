import { createServer } from "node:http";
import { createConfiguredApp } from "./app";
import { loadConfig } from "./config";

async function start(): Promise<void> {
  const config = loadConfig();
  if (config.tenantResolution === "legacy") process.stderr.write("GATEWAY_LEGACY_TENANT_CONFIGURATION_DEPRECATED\n");
  const server = createServer(await createConfiguredApp(config));
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.on("error", () => { process.stderr.write("GATEWAY_START_FAILED\n"); process.exitCode = 1; });
  server.listen(config.port, config.host);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close(() => { process.exitCode = 0; });
      server.closeIdleConnections();
      const deadline = setTimeout(() => { server.closeAllConnections(); }, 10_000);
      deadline.unref();
    });
  }
}

void start().catch((error: unknown) => {
  const code = error instanceof Error && /^(?:GATEWAY_|BACKEND_|SESSION_)[A-Z_]+$/.test(error.message) ? error.message : "GATEWAY_CONFIGURATION_ERROR";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});