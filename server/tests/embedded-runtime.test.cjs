const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createServer, Server } = require("node:http");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { test, before, after } = require("node:test");

const root = path.resolve(__dirname, "../..");
const archive = path.resolve(root, process.env.QZM_GATEWAY_ARCHIVE ?? "artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz");
const expectedVersion = process.env.QZM_GATEWAY_VERSION ?? "1.0.1";
const extraction = fs.mkdtempSync(path.join(os.tmpdir(), "qzm-embedded-artifact-"));
const packageDirectory = path.join(extraction, "package");
const nativeFetch = globalThis.fetch;
const tenant = { id: "tenant-1", name: "Fixture", portalOrigin: "https://tenant.invalid", environment: "production" };
let createEmbeddedGateway;

before(() => {
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot, "System32/tar.exe") : "tar";
  const unpack = spawnSync(tar, ["-xzf", archive, "-C", extraction], { encoding: "utf8" });
  assert.equal(unpack.status, 0, unpack.stderr);
  const previous = new Set(Object.keys(require.cache));
  const api = require(packageDirectory);
  assert.deepEqual(Object.keys(api), ["createEmbeddedGateway"]);
  createEmbeddedGateway = api.createEmbeddedGateway;
  assert.ok(Object.keys(require.cache).filter((file) => !previous.has(file)).every((file) => file.startsWith(packageDirectory)));
});
after(() => fs.rmSync(extraction, { recursive: true, force: true }));

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qzm-embedded-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { backendUrl: "https://backend.invalid/api", sessionFile: path.join(directory, "private", "sessions.enc"), trustedProxyIps: ["127.0.0.1"], ...overrides };
}

function mockCatalog(t, response = () => Response.json({ version: 1, tenants: [tenant] })) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    assert.equal(url, "https://backend.invalid/api/auth/mobile/config", "No real network is permitted");
    calls.push({ url, init });
    return response();
  });
  return calls;
}

async function listen(t, handler) {
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function request(base, route, options = {}) {
  return nativeFetch(`${base}${route}`, { ...options, headers: { "X-Forwarded-Proto": "https", ...options.headers } });
}

function child(options, action = "probe", token) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "embedded-worker.cjs"), packageDirectory, JSON.stringify(options), action, ...(token ? [token] : [])], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, "");
  return { status: result.status, data: JSON.parse(result.stdout) };
}

test("published package is one bundled CJS runtime, Node-only declarations, versioned licenses and source hashes", () => {
  const manifest = require(path.join(packageDirectory, "package.json"));
  const source = require(path.join(packageDirectory, "SOURCE-MANIFEST.json"));
  assert.equal(manifest.name, "@qualitzer/mobile-gateway");
  assert.equal(manifest.version, expectedVersion);
  assert.equal(source.version, expectedVersion);
  assert.equal(manifest.engines.node, ">=20.12.2");
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(manifest.scripts, undefined);
  assert.deepEqual(fs.readdirSync(packageDirectory).sort(), ["LICENSE", "README.md", "SOURCE-MANIFEST.json", "THIRD-PARTY-LICENSES.md", "embedded-contract.d.ts", "index.cjs", "index.d.ts", "package.json"].sort());
  assert.equal(source.bundleSha256, createHash("sha256").update(fs.readFileSync(path.join(packageDirectory, "index.cjs"))).digest("hex"));
  for (const { path: file, sha256 } of source.sources) {
    assert.doesNotMatch(file, /(?:^|\/)(?:expo|@expo|react-native|sharp|qrcode|tests|\.data)(?:\/|$)|^server\/(?:index|development|app)\.ts$/);
    assert.match(sha256, /^[a-f0-9]{64}$/);
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"), sha256, `Source provenance mismatch: ${file}`);
  }
  assert.ok(source.dependencies.some(({ name, version }) => name === "express" && version.startsWith("5.")));
  assert.ok(source.dependencies.some(({ name, version }) => name === "multer" && version.startsWith("2.")));
  const types = ["index.d.ts", "embedded-contract.d.ts"].map((file) => fs.readFileSync(path.join(packageDirectory, file), "utf8")).join("\n");
  assert.doesNotMatch(types, /from ["'](?:express|zod)/);
  assert.match(types, /IncomingMessage/);
  assert.match(types, /ServerResponse/);
  assert.match(types, /error\?: unknown/);
  assert.match(fs.readFileSync(path.join(packageDirectory, "THIRD-PARTY-LICENSES.md"), "utf8"), /express@5\./);
});

test("published declarations typecheck in a Node consumer without Express types", () => {
  const ts = require(path.join(root, "node_modules/typescript"));
  const file = path.join(extraction, "consumer.ts");
  fs.writeFileSync(file, 'import { createServer } from "node:http";\nimport { createEmbeddedGateway, type EmbeddedGatewayHandler, type EmbeddedGatewayOptions } from "./package";\nconst options: EmbeddedGatewayOptions = { backendUrl: "https://backend.invalid/api", sessionFile: "/private/sessions.enc", trustedProxyIps: ["127.0.0.1"] };\nconst ready: Promise<EmbeddedGatewayHandler> = createEmbeddedGateway(options);\nready.then(handler => createServer((req, res) => handler(req, res, (error?: unknown) => { if (error) res.destroy(); })));\n');
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16,
    strict: true, skipLibCheck: false, noEmit: true, types: ["node"], typeRoots: [path.join(root, "node_modules/@types")],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
  assert.ok(program.getSourceFiles().every((source) => !source.fileName.replaceAll("\\", "/").includes("/@types/express")));
});

test("factory rejects invalid production destinations, proxies, Origin and unexpected options before disk or network", async (t) => {
  const valid = fixture(t);
  const calls = mockCatalog(t);
  for (const overrides of [
    { backendUrl: "http://backend.invalid/api" }, { backendUrl: " https://backend.invalid/api" },
    { backendUrl: "https://user:pass@backend.invalid/api" }, { backendUrl: "https://backend.invalid/api?x=1" },
    { backendUrl: "https://backend.invalid/a\tpi" }, { backendUrl: "https://backend.invalid/api#x" },
    { trustedProxyIps: [] }, { trustedProxyIps: ["loopback"] }, { trustedProxyIps: ["127.0.0.1/8"] },
    { corsOrigins: ["http://app.invalid"] }, { corsOrigins: ["https://app.invalid/"] }, { corsOrigins: ["*"] },
    { sessionFile: "" }, { sessionFile: "\\\\server\\sessions.enc" }, { sessionSecret: "x" }, { environment: "development" },
  ]) await assert.rejects(createEmbeddedGateway({ ...valid, ...overrides }));
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.dirname(valid.sessionFile)), false);
});

test("native health with no Origin works through trusted loopback, private cache and no development endpoint", async (t) => {
  const calls = mockCatalog(t);
  const base = await listen(t, await createEmbeddedGateway(fixture(t)));
  const response = await request(base, "/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, backendReachable: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  for (const origin of ["https://app.invalid", "null", "http://localhost:8081"]) {
    const denied = await request(base, "/health", { headers: { Origin: origin } });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "ORIGIN_FORBIDDEN" });
  }
  for (const route of ["/api/development", "/api/development/connection", "/api/development/qr"]) assert.equal((await request(base, route)).status, 404);
  for (const call of calls) {
    assert.equal(call.init.headers.Origin, undefined);
    assert.equal(call.init.headers.Authorization, undefined);
    assert.equal(call.init.redirect, "manual");
  }
});

test("HTTP and forged forwarded proto fail without a trusted socket, not merely a forwarded IP", async (t) => {
  mockCatalog(t);
  const base = await listen(t, await createEmbeddedGateway(fixture(t, { trustedProxyIps: ["192.0.2.1"] })));
  for (const headers of [{}, { "X-Forwarded-Proto": "https", "X-Forwarded-For": "192.0.2.1" }]) {
    const response = await nativeFetch(`${base}/health`, { headers });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "HTTPS_REQUIRED" });
  }
  const trustedBase = await listen(t, await createEmbeddedGateway(fixture(t)));
  assert.equal((await nativeFetch(`${trustedBase}/health`)).status, 400);
});

test("optional exact HTTPS CORS opt-in permits browser preflight but not other origins", async (t) => {
  mockCatalog(t);
  const base = await listen(t, await createEmbeddedGateway(fixture(t, { corsOrigins: ["https://app.invalid"] })));
  const response = await request(base, "/api/auth/me", { method: "OPTIONS", headers: { Origin: "https://app.invalid", "Access-Control-Request-Method": "GET" } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.invalid");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.equal((await request(base, "/health", { headers: { Origin: "https://other.invalid" } })).status, 403);
  assert.equal((await request(base, "/health")).status, 200);
});

test("JSON remains bounded and authentication precedes multipart and special JSON parsers", async (t) => {
  mockCatalog(t);
  const base = await listen(t, await createEmbeddedGateway(fixture(t)));
  const large = await request(base, "/api/auth/login/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(33000) }) });
  assert.equal(large.status, 413);
  assert.deepEqual(await large.json(), { error: "PAYLOAD_TOO_LARGE" });
  for (const route of ["/api/offline/documents", "/api/assignments/direct-11/works/11/documents", "/api/assignments/direct-11/files"]) {
    const response = await request(base, route, { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=broken" }, body: "not multipart" });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  for (const route of ["/api/offline/commands", "/api/assignments/maintenance-1/deliver"]) {
    const response = await request(base, route, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(response.status, 401);
  }
});

test("bootstrap awaits catalog without opening a listener; duplicate in-flight factory and second process fail closed", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = mockCatalog(t, () => gate);
  const options = fixture(t);
  const listenMock = t.mock.method(Server.prototype, "listen", () => { throw new Error("FACTORY_MUST_NOT_LISTEN"); });
  let resolved = false;
  const pending = createEmbeddedGateway(options).then((handler) => { resolved = true; return handler; });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(calls.length, 1);
  await assert.rejects(createEmbeddedGateway(options), /SESSION_PERSISTENCE_WRITER_EXISTS/);
  await assert.rejects(createEmbeddedGateway({ ...options, sessionFile: path.join(path.dirname(options.sessionFile), "other.enc") }), /SESSION_PERSISTENCE_WRITER_EXISTS/);
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_WRITER_EXISTS" });
  release(Response.json({ version: 1, tenants: [tenant] }));
  assert.equal(typeof await pending, "function");
  assert.equal(listenMock.mock.callCount(), 0);
});

test("catalog failure releases only the writer and retry reuses the existing key", async (t) => {
  const options = fixture(t);
  let valid = false;
  mockCatalog(t, () => valid ? Response.json({ version: 1, tenants: [tenant] }) : Response.json({ secret: "not-published" }, { status: 503 }));
  await assert.rejects(createEmbeddedGateway(options), /BACKEND_DIRECTORY_UNAVAILABLE/);
  const directory = path.dirname(options.sessionFile);
  const key = fs.readFileSync(path.join(directory, "session.key"));
  assert.equal(key.length, 32);
  assert.equal(fs.existsSync(path.join(directory, ".writer.lock")), false);
  valid = true;
  await createEmbeddedGateway(options);
  assert.deepEqual(fs.readFileSync(path.join(directory, "session.key")), key);
});

test("invalid backend catalog Origin prevents startup and does not publish a handler", async (t) => {
  mockCatalog(t, () => Response.json({ version: 1, tenants: [{ ...tenant, portalOrigin: "https://tenant.invalid/path" }] }));
  await assert.rejects(createEmbeddedGateway(fixture(t)), /BACKEND_DIRECTORY_INVALID/);
});

test("persistent synthetic login survives process restart; no raw mobile token is stored and the key is not exported", (t) => {
  const options = fixture(t);
  const login = child(options, "login");
  assert.equal(login.status, 0);
  assert.equal(login.data.status, 200);
  const token = login.data.data.token;
  assert.match(token, /^qzm_/);
  const directory = path.dirname(options.sessionFile);
  const key = fs.readFileSync(path.join(directory, "session.key"));
  const encrypted = fs.readFileSync(options.sessionFile);
  assert.equal(key.length, 32);
  assert.equal(encrypted.includes(Buffer.from(token)), false);
  assert.equal(encrypted.includes(Buffer.from("fixture-upstream-token")), false);
  assert.equal(fs.existsSync(path.join(directory, ".writer.lock")), false);
  const restored = child(options, "me", token);
  assert.equal(restored.status, 0);
  assert.equal(restored.data.status, 200);
  assert.deepEqual(fs.readFileSync(path.join(directory, "session.key")), key);
  assert.match(restored.data.cache, /no-store/);
  assert.equal(JSON.stringify(restored.data).includes(key.toString("hex")), false);
});

test("packed branch branding uses the authenticated selected branch without changing tenant identity", (t) => {
  const options = fixture(t);
  const login = child(options, "login");
  assert.equal(login.data.status, 200);
  const result = child(options, "branch", login.data.data.token);
  assert.equal(result.status, 0);
  assert.equal(result.data.status, 200);
  assert.deepEqual(result.data.data.branchBranding, { companyBranchId: 1, status: "APPLIED" });
  assert.equal(result.data.data.tenant.id, tenant.id);
  assert.equal(result.data.data.tenant.name, "Packed branch");
  assert.equal(result.data.data.tenant.logo, "https://cdn.example.com/branch.png");
});

test("missing key with an existing encrypted session refuses reset and preserves the snapshot", (t) => {
  const options = fixture(t);
  assert.equal(child(options, "login").status, 0);
  const encrypted = fs.readFileSync(options.sessionFile);
  const keyFile = path.join(path.dirname(options.sessionFile), "session.key");
  fs.unlinkSync(keyFile);
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_KEY_UNAVAILABLE" });
  assert.deepEqual(fs.readFileSync(options.sessionFile), encrypted);
  assert.equal(fs.existsSync(keyFile), false);
});

test("a leftover writer lock is never auto-deleted on presumed process death", (t) => {
  const options = fixture(t);
  assert.equal(child(options).status, 0);
  const lock = path.join(path.dirname(options.sessionFile), ".writer.lock");
  const owner = JSON.stringify({ pid: 99999999, nonce: "fixture-dead-owner" });
  fs.writeFileSync(lock, owner, { mode: 0o600 });
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_WRITER_EXISTS" });
  assert.equal(fs.readFileSync(lock, "utf8"), owner);
});

test("wrong keys, ciphertext corruption, backend rebinding and unavailable marker never silently reset sessions", (t) => {
  const options = fixture(t);
  assert.equal(child(options, "login").status, 0);
  const keyFile = path.join(path.dirname(options.sessionFile), "session.key");
  const key = fs.readFileSync(keyFile);
  const encrypted = fs.readFileSync(options.sessionFile);
  fs.writeFileSync(keyFile, Buffer.alloc(32, 7));
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_INVALID" });
  assert.deepEqual(fs.readFileSync(options.sessionFile), encrypted);
  fs.writeFileSync(keyFile, key);
  const corrupt = Buffer.from(encrypted);
  corrupt[corrupt.length - 1] ^= 1;
  fs.writeFileSync(options.sessionFile, corrupt);
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_INVALID" });
  assert.deepEqual(fs.readFileSync(options.sessionFile), corrupt);
  fs.writeFileSync(options.sessionFile, encrypted);
  assert.deepEqual(child({ ...options, backendUrl: "https://other.invalid/api" }).data, { error: "SESSION_PERSISTENCE_ROUTING_MISMATCH" });
  fs.writeFileSync(`${options.sessionFile}.unavailable`, "QZMS1_PENDING", { mode: 0o600 });
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_UNAVAILABLE" });
  assert.deepEqual(fs.readFileSync(options.sessionFile), encrypted);
});

test("shared hardlinked key and symlink directory fail closed", (t) => {
  const options = fixture(t);
  assert.equal(child(options).status, 0);
  const directory = path.dirname(options.sessionFile);
  const keyFile = path.join(directory, "session.key");
  const alias = path.join(directory, "shared.key");
  fs.linkSync(keyFile, alias);
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_REQUIRES_PRIVATE_DIRECTORY" });
  fs.unlinkSync(alias);
  const link = path.join(path.dirname(directory), "linked");
  fs.symlinkSync(directory, link, process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(child({ ...options, sessionFile: path.join(link, "sessions.enc") }).data, { error: "SESSION_PERSISTENCE_REQUIRES_PRIVATE_DIRECTORY" });
});

test("POSIX existing shared permissions are rejected, never silently chmod-repaired", { skip: process.platform === "win32" }, (t) => {
  const options = fixture(t);
  assert.equal(child(options).status, 0);
  const directory = path.dirname(options.sessionFile);
  const keyFile = path.join(directory, "session.key");
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  fs.chmodSync(keyFile, 0o644);
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_PERMISSIONS_ERROR" });
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o644);
});

test("Windows existing shared ACL is rejected instead of silently repaired", { skip: process.platform !== "win32" }, (t) => {
  const options = fixture(t);
  assert.equal(child(options).status, 0);
  const keyFile = path.join(path.dirname(options.sessionFile), "session.key");
  const grant = spawnSync("icacls.exe", [keyFile, "/grant", "*S-1-1-0:R"], { encoding: "utf8" });
  assert.equal(grant.status, 0, grant.stderr);
  assert.deepEqual(child(options).data, { error: "SESSION_PERSISTENCE_PERMISSIONS_ERROR" });
});

test("isolated Express 4 host mounts Express 5 lazily after listener; self HTTP catalog cannot deadlock", async (t) => {
  const hostRequire = createRequire(path.resolve(root, "../Qualitzer2.0-Backend/package.json"));
  let express;
  try {
    assert.match(hostRequire("express/package.json").version, /^4\./);
    express = hostRequire("express");
  } catch { t.skip("Backend Express 4 is not installed"); return; }
  const app = express();
  const options = fixture(t);
  let pending;
  let initializations = 0;
  let catalogRequests = 0;
  app.use("/mobile-gateway", (req, res, next) => {
    if (!pending) { initializations++; pending = createEmbeddedGateway(options); }
    pending.then((handler) => handler(req, res, next), next);
  });
  app.get("/api/auth/mobile/config", (_req, res) => { catalogRequests++; res.json({ version: 1, tenants: [tenant] }); });
  const base = await listen(t, app);
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    assert.equal(url, `${options.backendUrl}/auth/mobile/config`);
    return nativeFetch(`${base}/api/auth/mobile/config`, init);
  });
  const responses = await Promise.all([request(base, "/mobile-gateway/health"), request(base, "/mobile-gateway/health")]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, backendReachable: true });
  }
  assert.equal(initializations, 1);
  assert.ok(catalogRequests >= 2);
  assert.equal((await request(base, "/mobile-gateway/api/auth/me")).status, 401);
});