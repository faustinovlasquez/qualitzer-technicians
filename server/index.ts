import { createServer } from "node:http";
import { createConfiguredApp } from "./app";
import { loadConfig } from "./config";
import { configureRealtime } from "./realtime/hub";

async function start(): Promise<void> {
  const config = loadConfig();
  // Comentarios en vivo: la misma clave SOCKET_IO_TOKEN del backend; sin ella el chat se actualiza por consultas.
  // GATEWAY_REALTIME=on lo activa con clave vacía (backend local sin SOCKET_IO_TOKEN).
  configureRealtime(process.env.GATEWAY_SOCKET_TOKEN ?? (process.env.GATEWAY_REALTIME === "on" ? "" : undefined));
  if (config.tenantResolution === "legacy") process.stderr.write("GATEWAY_LEGACY_TENANT_CONFIGURATION_DEPRECATED\n");
  const server = createServer(await createConfiguredApp(config));
  // Las subidas sin conexión con mala señal pueden tardar hasta 10 minutos (cada ruta limita su propio tiempo).
  server.requestTimeout = 11 * 60_000;
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