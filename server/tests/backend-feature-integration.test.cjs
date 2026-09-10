const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { runInNewContext } = require("node:vm");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createServer, Server } = require("node:http");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const backend = path.resolve(root, "../Qualitzer2.0-Backend");
const hostRequire = createRequire(path.join(backend, "package.json"));
const express = hostRequire("express");
const nativeFetch = globalThis.fetch;
const tenant = { id: "tenant-1", name: "Isolated fixture", portalOrigin: "https://tenant.invalid", environment: "production" };
const catalog = () => Response.json({ version: 1, tenants: [tenant] });

function feature(values) {
  const reads = [];
  const loaded = [];
  const cache = new Map();
  const environment = { getSecretValue: async (key) => { reads.push(key); return values[key]; } };
  function load(relative) {
    const filename = path.join(backend, "src", relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    assert.ok(filename.includes(`${path.sep}mobileGateway${path.sep}`));
    assert.ok(!filename.includes("__tests__"));
    loaded.push(filename);
    const module = { exports: {} };
    cache.set(filename, module);
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const localRequire = createRequire(filename);
    runInNewContext(compiled, {
      module, exports: module.exports, __dirname: path.dirname(filename), Error, URL,
      require(id) {
        if (id === "@enviroment-infra/Dependencies") return { environment };
        if (id.startsWith("@base/mobileGateway/")) return load(`${id.slice("@base/".length)}.ts`);
        assert.ok(id.startsWith("node:") || id === "express" || id === "@qualitzer/mobile-gateway", `Unexpected dependency: ${id}`);
        return localRequire(id);
      },
    }, { filename });
    return module.exports;
  }
  return { load, reads, loaded, environment };
}

function options(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qzm-backend-chain-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const privateDirectory = path.join(directory, "private");
  fs.mkdirSync(privateDirectory, { mode: 0o700 });
  if (process.platform === "win32") {
    const result = spawnSync("icacls.exe", [privateDirectory, "/inheritance:r", "/grant:r", `${os.userInfo().username}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, "Cannot provision owned temporary private directory");
  }
  return {
    MOBILE_GATEWAY_ENABLED: "true",
    MOBILE_GATEWAY_BACKEND_URL: "https://backend.invalid/api",
    MOBILE_GATEWAY_SESSION_FILE: path.join(privateDirectory, "sessions.enc"),
    MOBILE_GATEWAY_TRUSTED_PROXIES: "127.0.0.1,::ffff:127.0.0.1",
    ...extra,
  };
}

function mockCatalog(t, response = catalog) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    assert.equal(String(input), "https://backend.invalid/api/auth/mobile/config", "Real upstream network is forbidden");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Origin, undefined);
    assert.equal(init.headers.Authorization, undefined);
    calls.push(String(input));
    return response(init);
  });
  return calls;
}

function host(f) {
  assert.match(hostRequire("express/package.json").version, /^4\./);
  const app = express();
  app.set("trust proxy", true);
  app.use("/mobile", f.load("mobileGateway/infrastructure/MobileGateway.routes.ts").default());
  let legacyParsers = 0;
  app.use((_req, _res, next) => { legacyParsers++; next(); });
  app.use(express.json({ limit: "8b" }));
  app.post("/legacy", (req, res) => res.json({ legacy: true, body: req.body }));
  app.get("/legacy", (_req, res) => res.json({ legacy: true }));
  app.use((_req, res) => res.status(418).json({ legacyFallback: true }));
  return { app, legacyParsers: () => legacyParsers };
}

async function listen(t, app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "::", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, route, init = {}) {
  return nativeFetch(`${base}${route}`, { ...init, headers: { "X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.9", ...init.headers }, signal: AbortSignal.timeout(10000), redirect: "manual" });
}

test("actual disabled config, wiring and controller never read storage, import the bundle or affect legacy routes", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qzm-backend-disabled-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const missing = path.join(directory, "must-not-exist", "sessions.enc");
  const cached = new Set(Object.keys(require.cache));
  const f = feature({ MOBILE_GATEWAY_SESSION_FILE: missing });
  const h = host(f);
  assert.deepEqual(f.reads, []);
  const base = await listen(t, h.app);
  const response = await request(base, "/mobile/health");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "MOBILE_GATEWAY_NOT_FOUND" });
  assert.equal((await request(base, "/mobile/api/auth/me")).status, 404);
  assert.deepEqual(f.reads, ["MOBILE_GATEWAY_ENABLED"]);
  assert.equal(h.legacyParsers(), 0);
  assert.equal(fs.existsSync(path.dirname(missing)), false);
  assert.ok(Object.keys(require.cache).filter((file) => !cached.has(file)).every((file) => !file.includes("@qualitzer")));
  assert.deepEqual(await (await request(base, "/legacy")).json(), { legacy: true });
});

test("actual use case coalesces bootstrap before a listener with a mocked HTTPS catalog", async (t) => {
  const values = options(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const catalogEntered = new Promise((resolve) => { entered = resolve; });
  const calls = mockCatalog(t, () => { entered(); return gate; });
  const f = feature(values);
  const { MobileGatewayConfig } = f.load("mobileGateway/infrastructure/MobileGateway.config.ts");
  const { MobileGatewayLoader } = f.load("mobileGateway/infrastructure/MobileGateway.loader.ts");
  const { MobileGatewayUseCase } = f.load("mobileGateway/application/MobileGatewayUseCase.ts");
  const useCase = new MobileGatewayUseCase(new MobileGatewayConfig(f.environment), new MobileGatewayLoader());
  const guard = t.mock.method(Server.prototype, "listen", () => { throw new Error("BOOTSTRAP_MUST_NOT_LISTEN"); });
  const first = useCase.getHandler();
  const second = useCase.getHandler();
  await catalogEntered;
  try { assert.equal(calls.length, 1); } finally { release(catalog()); }
  const handlers = await Promise.all([first, second]);
  assert.equal(handlers[0], handlers[1]);
  assert.equal(await useCase.getHandler(), handlers[0]);
  assert.equal(guard.mock.callCount(), 0);
  assert.equal(f.reads.filter((key) => key === "MOBILE_GATEWAY_ENABLED").length, 1);
  assert.equal(fs.statSync(path.join(path.dirname(values.MOBILE_GATEWAY_SESSION_FILE), "session.key")).size, 32);
});

test("actual lazy Express 4 controller to installed Express 5 bundle preserves proxy, mount, parsers, queries and authentication", async (t) => {
  const values = options(t);
  const f = feature(values);
  const h = host(f);
  let catalogRequests = 0;
  const app = express();
  app.get("/api/auth/mobile/config", (_req, res) => { catalogRequests++; res.json({ version: 1, tenants: [tenant] }); });
  app.use(h.app);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(fs.readdirSync(path.dirname(values.MOBILE_GATEWAY_SESSION_FILE)), []);
  const base = await listen(t, app);
  mockCatalog(t, (init) => nativeFetch(`${base}/api/auth/mobile/config`, { ...init, signal: AbortSignal.timeout(10000) }));
  const health = await Promise.all([request(base, "/mobile/health"), request(base, "/mobile/health")]);
  for (const response of health) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, backendReachable: true });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(f.reads.filter((key) => key === "MOBILE_GATEWAY_ENABLED").length, 1);
  assert.ok(catalogRequests >= 2);
  for (const [ip, remaining] of [["203.0.113.10", 119], ["203.0.113.10", 118], ["203.0.113.11", 119]]) {
    const response = await request(base, "/mobile/health", { headers: { "X-Forwarded-For": ip } });
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get("ratelimit")?.match(/\br=(\d+)/)?.[1]), remaining);
  }
  assert.equal((await request(base, "/mobile/api/auth/me")).status, 401);
  assert.equal((await request(base, "/mobile/health?unexpected=1")).status, 400);
  assert.equal((await request(base, "/mobile/health?tenantId=tenant-1")).status, 200);
  assert.equal((await request(base, "/mobile/health?tenantId[x]=tenant-1")).status, 400);
  assert.equal((await request(base, "/mobile/health", { headers: { Origin: "https://untrusted.invalid" } })).status, 403);
  assert.equal((await request(base, "/mobile/health", { headers: { "X-Forwarded-Proto": "http" } })).status, 400);
  for (const route of ["/mobile/unknown", "/mobile/api/development/connection", "/mobile/mobile/health"]) {
    const response = await request(base, route);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
  }
  const oversized = await request(base, "/mobile/api/auth/login/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(33000) }) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "PAYLOAD_TOO_LARGE" });
  for (const route of ["/api/offline/documents", "/api/assignments/direct-11/works/11/documents", "/api/assignments/direct-11/files"]) {
    const response = await request(base, `/mobile${route}`, { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=broken" }, body: "x".repeat(33000) });
    assert.equal(response.status, 401);
  }
  for (const route of ["/api/offline/commands", "/api/assignments/maintenance-1/deliver"]) {
    assert.equal((await request(base, `/mobile${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 401);
  }
  assert.equal((await request(base, "/mobile/api/offlinex/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  assert.equal(h.legacyParsers(), 0);
  assert.deepEqual(await (await request(base, "/legacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json(), { legacy: true, body: {} });
  assert.equal((await request(base, "/mobilex/health")).status, 418);
  assert.ok(f.loaded.every((file) => !file.endsWith(`${path.sep}app.ts`)));
});

test("actual chain rejects forged forwarded headers even when the Express 4 host trusts all proxies", async (t) => {
  mockCatalog(t);
  const h = host(feature(options(t, { MOBILE_GATEWAY_TRUSTED_PROXIES: "192.0.2.1" })));
  const base = await listen(t, h.app);
  const response = await request(base, "/mobile/health", { headers: { "X-Forwarded-For": "192.0.2.1" } });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "HTTPS_REQUIRED" });
  assert.equal(h.legacyParsers(), 0);
  assert.equal((await request(base, "/legacy")).status, 200);
});

test("actual catalog bootstrap failure returns sanitized 503, coalesces failure and enforces cooldown without legacy bypass", async (t) => {
  const calls = mockCatalog(t, () => { throw new Error("PRIVATE_FAKE_UPSTREAM_FAILURE"); });
  const h = host(feature(options(t)));
  const base = await listen(t, h.app);
  for (const response of await Promise.all([request(base, "/mobile/health"), request(base, "/mobile/api/auth/me")])) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "30");
    assert.deepEqual(await response.json(), { error: "MOBILE_GATEWAY_UNAVAILABLE" });
  }
  assert.equal((await request(base, "/mobile/health")).status, 503);
  assert.equal(calls.length, 1);
  assert.equal(h.legacyParsers(), 0);
});

test("actual config rejects unsafe URLs, checkout storage and non-exact proxy settings before loading runtime", async (t) => {
  const valid = options(t);
  const calls = mockCatalog(t);
  for (const change of [
    { MOBILE_GATEWAY_ENABLED: "TRUE" },
    { MOBILE_GATEWAY_BACKEND_URL: "http://backend.invalid/api" },
    { MOBILE_GATEWAY_BACKEND_URL: "https://backend.invalid/a\tpi" },
    { MOBILE_GATEWAY_BACKEND_URL: "https://backend.invalid/api?x=1" },
    { MOBILE_GATEWAY_SESSION_FILE: path.join(backend, "private", "sessions.enc") },
    { MOBILE_GATEWAY_SESSION_FILE: "relative/sessions.enc" },
    { MOBILE_GATEWAY_TRUSTED_PROXIES: "loopback" },
    { MOBILE_GATEWAY_TRUSTED_PROXIES: "127.0.0.1/8" },
    { MOBILE_GATEWAY_CORS_ORIGINS: "https://browser.invalid/path" },
  ]) {
    const f = feature({ ...valid, ...change });
    const { MobileGatewayConfig } = f.load("mobileGateway/infrastructure/MobileGateway.config.ts");
    await assert.rejects(new MobileGatewayConfig(f.environment).getConfig());
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(path.dirname(valid.MOBILE_GATEWAY_SESSION_FILE)), []);
});

test("installed backend package matches every TGZ byte, current source hash and tracked lockfile metadata", (t) => {
  const installed = path.join(backend, "node_modules/@qualitzer/mobile-gateway");
  const manifest = JSON.parse(fs.readFileSync(path.join(backend, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(backend, "package-lock.json"), "utf8"));
  const expected = "file:infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.0.tgz";
  assert.equal(manifest.dependencies["@qualitzer/mobile-gateway"], expected);
  assert.equal(lock.packages[""].dependencies["@qualitzer/mobile-gateway"], expected);
  const entry = lock.packages["node_modules/@qualitzer/mobile-gateway"];
  assert.equal(entry.version, "1.0.0");
  assert.equal(entry.resolved, expected);
  const archive = path.join(backend, expected.slice(5));
  const integrity = `sha512-${createHash("sha512").update(fs.readFileSync(archive)).digest("base64")}`;
  assert.equal(entry.integrity, integrity);
  const tracked = spawnSync("git", ["-C", backend, "ls-files", "--error-unmatch", "package-lock.json"], { encoding: "utf8" });
  assert.equal(tracked.status, 0);
  assert.equal(tracked.stdout.trim(), "package-lock.json");
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot, "System32/tar.exe") : "tar";
  for (const filename of fs.readdirSync(installed)) {
    const extracted = spawnSync(tar, ["-xOf", archive, `package/${filename}`], { maxBuffer: 16 * 1024 * 1024 });
    assert.equal(extracted.status, 0);
    assert.deepEqual(extracted.stdout, fs.readFileSync(path.join(installed, filename)), filename);
  }
  const sources = JSON.parse(fs.readFileSync(path.join(installed, "SOURCE-MANIFEST.json"), "utf8"));
  assert.equal(sources.bundleSha256, createHash("sha256").update(fs.readFileSync(path.join(installed, "index.cjs"))).digest("hex"));
  for (const source of sources.sources) assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, source.path))).digest("hex"), source.sha256, source.path);
  t.diagnostic(`Matched ${sources.sources.length} source hashes; TGZ SHA256 ${createHash("sha256").update(fs.readFileSync(archive)).digest("hex")}`);
});

test("actual backend feature contracts typecheck with its compiler and installed bundle without the backend application graph", (t) => {
  const compiler = hostRequire("typescript");
  const virtual = path.join(backend, "src/mobileGateway/FinalValidation.virtual.ts");
  const source = [
    'import { MobileGatewayConfig } from "./infrastructure/MobileGateway.config";',
    'import { MobileGatewayLoader } from "./infrastructure/MobileGateway.loader";',
    'import { MobileGatewayController } from "./infrastructure/MobileGateway.controller";',
    'import { MobileGatewayUseCase } from "./application/MobileGatewayUseCase";',
    'import type { IMobileGatewayModule, MobileGatewayFactory } from "./domain/interfaces/IMobileGateway";',
    'import { createEmbeddedGateway } from "@qualitzer/mobile-gateway";',
    'const fakeEnvironment = { getSecretValue: async (_key: string): Promise<string | undefined> => undefined };',
    'const factory: MobileGatewayFactory = createEmbeddedGateway;',
    'const installed: IMobileGatewayModule = { createEmbeddedGateway: factory };',
    'const config = new MobileGatewayConfig(fakeEnvironment);',
    'const loader = new MobileGatewayLoader(async () => installed);',
    'const useCase = new MobileGatewayUseCase(config, loader);',
    'const controller = new MobileGatewayController(useCase);',
    'void controller.handle;',
  ].join("\n");
  const config = {
    target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS,
    moduleResolution: compiler.ModuleResolutionKind.NodeJs, strict: true,
    esModuleInterop: true, skipLibCheck: true, noEmit: true,
    baseUrl: path.join(backend, "src"),
    paths: { "@base/*": ["*"], "@enviroment-domain/*": ["enviroment/domain/*"] },
    types: ["node"], typeRoots: [path.join(backend, "node_modules/@types")],
  };
  const host = compiler.createCompilerHost(config);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (file) => path.resolve(file) === virtual ? source : read(file);
  host.fileExists = (file) => path.resolve(file) === virtual || exists(file);
  const program = compiler.createProgram([virtual], config, host);
  const diagnostics = compiler.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map((item) => `${item.file?.fileName ?? ""}: ${compiler.flattenDiagnosticMessageText(item.messageText, "\n")}`), []);
  const actual = program.getSourceFiles().filter((file) => !file.isDeclarationFile);
  assert.ok(actual.every((file) => file.fileName.includes("mobileGateway") || file.fileName.endsWith("IEnvironment.ts")));
  assert.ok(!fs.existsSync(virtual));
  t.diagnostic(`Backend TypeScript ${compiler.version}; ${actual.length} isolated source files; zero diagnostics`);
});