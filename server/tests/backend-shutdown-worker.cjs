const { createServer } = require("node:http");
const path = require("node:path");
const { backend, loadShutdown } = require("./backend-shutdown-source.cjs");
const { createEmbeddedGateway } = require(path.join(backend, "node_modules/@qualitzer/mobile-gateway"));
const options = JSON.parse(process.argv[2]);
const forced = process.argv[3] === "force";
const tenant = { id: "tenant-1", name: "Fixture", portalOrigin: "https://tenant.invalid", environment: "production" };
const nativeFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === `${options.backendUrl}/auth/mobile/config`) return Response.json({ version: 1, tenants: [tenant] });
  if (url === `${options.backendUrl}/auth/mobile/discover`) return Response.json({ matches: [{ tenant, grant: "g".repeat(43), expiresAt: new Date(Date.now() + 120000).toISOString() }] });
  if (url === `${options.backendUrl}/auth/mobile/complete`) return Response.json({ tenant, token: "fixture-upstream-token", username: "fixture", email: "fixture@example.invalid", nextStep: "DONE" });
  if (url === `${options.backendUrl}/companies/branding`) return Response.json({ name: "Fixture" });
  throw new Error("UNEXPECTED_FIXTURE_NETWORK");
};

async function main() {
  let handler;
  let held;
  let forceTimeout;
  const server = createServer((req, res) => {
    if (req.url === "/hold") {
      held = res;
      process.send({ event: "holding" });
      return;
    }
    handler(req, res, () => { res.statusCode = 404; res.end(); });
  });
  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  });
  const runtime = forced ? {
    onSignal: (signal, listener) => process.on(signal, listener),
    exit: (code) => process.exit(code),
    schedule: (callback, milliseconds) => {
      if (milliseconds !== 30000) throw new Error("INVALID_SHUTDOWN_DEADLINE");
      forceTimeout = callback;
      const timer = setTimeout(callback, milliseconds);
      return () => clearTimeout(timer);
    },
  } : undefined;
  loadShutdown()(server, true, runtime);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.send({ event: "draining", listening: server.listening }));
  process.on("message", (message) => {
    if (message.signal === "SIGINT" || message.signal === "SIGTERM") process.emit(message.signal);
    if (message.action === "release") held.end("drained");
    if (message.action === "timeout") forceTimeout();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  handler = await createEmbeddedGateway(options);
  const response = await nativeFetch(`http://127.0.0.1:${server.address().port}/api/auth/login/start`, {
    method: "POST", headers: { "X-Forwarded-Proto": "https", "Content-Type": "application/json" },
    body: JSON.stringify({ username: "fixture", password: "fixture-only", remember: true }),
  });
  const data = await response.json();
  if (response.status !== 200 || typeof data.token !== "string") throw new Error("FIXTURE_LOGIN_FAILED");
  process.send({ event: "ready", port: server.address().port, token: data.token });
}

main().catch((error) => { process.stderr.write(error.message); process.exit(1); });