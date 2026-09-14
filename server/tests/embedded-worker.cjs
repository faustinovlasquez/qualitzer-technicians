const { createServer } = require("node:http");
const { createEmbeddedGateway } = require(process.argv[2]);
const options = JSON.parse(process.argv[3]);
const action = process.argv[4];
const token = process.argv[5];
const nativeFetch = globalThis.fetch;
const tenant = { id: "tenant-1", name: "Fixture", portalOrigin: "https://tenant.invalid", environment: "production" };
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith(options.backendUrl)) return nativeFetch(input, init);
  const path = url.slice(options.backendUrl.length);
  if (path === "/auth/mobile/config") return Response.json({ version: 1, tenants: [tenant] });
  if (path === "/auth/mobile/discover") return Response.json({ matches: [{ tenant, grant: "g".repeat(43), expiresAt: new Date(Date.now() + 120000).toISOString() }] });
  if (path === "/auth/mobile/complete") return Response.json({ tenant, token: "fixture-upstream-token", username: "fixture", email: "fixture@example.invalid", nextStep: "DONE" });
  if (path === "/companies/branding") return Response.json({ name: "Fixture" });
  if (path === "/branches/1") return Response.json({ id: 1, name: "Packed branch", logo: "https://cdn.example.com/branch.png" });
  if (path === "/auth/me" || path === "/auth/me?companyBranchId=1") return Response.json({ id: 9, workerId: 42, name: "Fixture", lastnames: "Test", email: "fixture@example.invalid", role: { name: "admin", isTechnician: false }, accessBranchs: [{ id: 1, name: "Main", main: true }], system: { name: "Test", timezone: "UTC" } });
  throw new Error("UNEXPECTED_FIXTURE_NETWORK");
};

async function main() {
  const handler = await createEmbeddedGateway(options);
  if (action === "probe") { process.stdout.write(JSON.stringify({ ok: true })); return; }
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await nativeFetch(`${url}${action === "login" ? "/api/auth/login/start" : action === "branch" ? "/api/auth/me?companyBranchId=1" : "/api/auth/me"}`, {
      method: action === "login" ? "POST" : "GET",
      headers: { "X-Forwarded-Proto": "https", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: action === "login" ? JSON.stringify({ username: "fixture", password: "fixture-only", remember: true }) : undefined,
    });
    process.stdout.write(JSON.stringify({ status: response.status, data: await response.json(), cache: response.headers.get("cache-control") }));
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
}

main().catch((error) => { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; });