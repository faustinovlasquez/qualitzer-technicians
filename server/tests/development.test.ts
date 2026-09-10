import assert from "node:assert/strict";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import { test, type TestContext } from "node:test";
import express from "express";
import qrCode from "qrcode";
import { z } from "zod";
import { resolveConfig, type GatewayConfig } from "../config";
import { developmentRouter, selectDevelopmentHost, type DevelopmentRouterOptions } from "../development";

const route = "/api/development/connection";
const qrOptions = { type: "image/png", width: 280, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } } as const;
const connectionSchema = z.object({ expoUrl: z.string(), gatewayUrl: z.string(), qrDataUrl: z.string(), metroReachable: z.boolean(), lanAvailable: z.boolean(), message: z.string().optional() }).strict();
const enabled: DevelopmentRouterOptions = { enabled: true, metroPort: 8081, gatewayPort: 8787 };

function ipv4(address: string, internal = false): os.NetworkInterfaceInfoIPv4 {
  return { address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24` };
}

function environmentOptions(environment: GatewayConfig["environment"]): DevelopmentRouterOptions {
  const config = resolveConfig({ environment, port: 8790, backendUrl: "https://backend.example.invalid/api", tenantOrigin: "https://portal.example.invalid", corsOrigins: ["https://mobile.example.invalid"], trustedProxyIps: ["127.0.0.1"] });
  return { enabled: config.environment === "development", metroPort: 8081, gatewayPort: config.port };
}

async function harness(t: TestContext, options?: DevelopmentRouterOptions) {
  const app = express();
  app.set("query parser", "simple");
  app.use(express.json());
  app.use("/api/development", developmentRouter(options));
  app.use((_req, res) => { res.status(404).json({ error: "NOT_FOUND" }); });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return (path = route, options: { method?: string; body?: string; headers?: IncomingHttpHeaders } = {}) => new Promise<{ status: number; headers: IncomingHttpHeaders; data: unknown }>((resolve, reject) => {
    const body = options.body;
    const req = request({ hostname: "127.0.0.1", port: address.port, path, method: options.method ?? "GET", headers: {
      ...(body !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}), ...options.headers,
    } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try { const data: unknown = text ? JSON.parse(text) : null; resolve({ status: res.statusCode ?? 0, headers: res.headers, data }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function network(t: TestContext, interfaces: ReturnType<typeof os.networkInterfaces> = { "Wi-Fi": [ipv4("192.168.1.20")] }) {
  const addresses = t.mock.method(os, "networkInterfaces", () => interfaces);
  const fetchMetro = t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => new Response("packager-status:running"));
  return { addresses, fetchMetro };
}

test("LAN selection prioritizes Wi-Fi/WLAN, then physical Ethernet, then the first private IPv4", () => {
  const interfaces = { adapter: [ipv4("10.0.0.9")], en0: [ipv4("192.168.1.10")], WLAN: [ipv4("172.16.0.20")] };
  assert.equal(selectDevelopmentHost(interfaces), "172.16.0.20");
  assert.equal(selectDevelopmentHost({ adapter: interfaces.adapter, en0: interfaces.en0 }), "192.168.1.10");
  assert.equal(selectDevelopmentHost({ adapter: interfaces.adapter, other: [ipv4("10.0.0.10")] }), "10.0.0.9");
  assert.equal(selectDevelopmentHost({ "Wi-Fi": [ipv4("192.168.1.30")], wlan0: [ipv4("192.168.1.31")] }), "192.168.1.30");
});

test("VPN, virtual, internal, IPv6, public and link-local interfaces cannot become a phone target", () => {
  const interfaces: ReturnType<typeof os.networkInterfaces> = {
    tun0: [ipv4("10.0.0.1")], utun2: [ipv4("10.0.0.2")], "Company VPN": [ipv4("10.0.0.3")],
    "vEthernet (WSL)": [ipv4("172.20.0.1")], docker0: [ipv4("172.17.0.1")], Tailscale: [ipv4("10.0.0.4")],
    "Wi-Fi": [ipv4("10.0.0.5", true), ipv4("127.0.0.1"), ipv4("169.254.1.1"), ipv4("8.8.8.8"), ipv4("100.64.0.1"),
      { address: "fd00::1", family: "IPv6", internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", cidr: "fd00::1/64", scopeid: 0 }],
    empty: undefined,
  };
  assert.equal(selectDevelopmentHost(interfaces), "localhost");
  assert.equal(selectDevelopmentHost({ ...interfaces, Ethernet: [ipv4("192.168.1.40")] }), "192.168.1.40");
});

test("preferred hosts must be literal private IPv4 addresses assigned to an eligible local interface", () => {
  const interfaces = { "Wi-Fi": [ipv4("192.168.1.20")], en0: [ipv4("10.10.0.20")], tun0: [ipv4("10.9.0.1")] };
  assert.equal(selectDevelopmentHost(interfaces, "10.10.0.20"), "10.10.0.20");
  for (const host of ["127.0.0.1", "localhost", "0.0.0.0", "8.8.8.8", "169.254.1.1", "100.64.1.1", "172.15.1.1", "172.32.1.1", "::1", "fd00::1", "10.9.0.1", "10.99.0.1", "2130706433", "0x7f000001", "192.168.001.20", "http://192.168.1.20", "192.168.1.20:8081", "user@192.168.1.20", "192.168.1.20.evil.invalid", "192.168.1.20/path", "192.168.1.20?token=secret", "192.168.1.20#hash", "192.168.1.20\r\nHost:evil.invalid", " 192.168.1.20", "192.168.1.20\t", ""]) {
    assert.equal(selectDevelopmentHost(interfaces, host), "192.168.1.20", host);
  }
  for (const host of ["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.0.1"]) {
    assert.equal(selectDevelopmentHost({ Ethernet: [ipv4(host)] }), host);
  }
});

test("production, test and omitted options return 404 without discovery, Metro requests or QR generation", async (t) => {
  const { addresses, fetchMetro } = network(t);
  const qr = t.mock.method(qrCode, "toDataURL");
  for (const options of [undefined, environmentOptions("production"), environmentOptions("test")]) {
    const get = await harness(t, options);
    const response = await get();
    assert.equal(response.status, 404);
    assert.deepEqual(response.data, { error: "NOT_FOUND" });
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal((await get(`${route}?host=evil.invalid`)).status, 404);
  }
  assert.equal(addresses.mock.callCount(), 0);
  assert.equal(fetchMetro.mock.callCount(), 0);
  assert.equal(qr.mock.callCount(), 0);
});

test("development fixtures produce the exact Expo QR locally and never derive URLs or headers from requests", async (t) => {
  const { fetchMetro } = network(t);
  const expectedQr = await qrCode.toDataURL("exp://192.168.1.20:8081", qrOptions);
  const qr = t.mock.method(qrCode, "toDataURL");
  const get = await harness(t, environmentOptions("development"));
  const response = await get(route, { headers: { Host: "attacker.invalid:4444", "X-Forwarded-Host": "169.254.169.254", "X-Forwarded-Proto": "https", Authorization: "Bearer secret", "X-Qualitzer-Tenant": "private-tenant", Cookie: "session=secret" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const connection = connectionSchema.parse(response.data);
  assert.deepEqual(connection, { expoUrl: "exp://192.168.1.20:8081", gatewayUrl: "http://192.168.1.20:8790", qrDataUrl: expectedQr, metroReachable: true, lanAvailable: true });
  assert.equal(qr.mock.callCount(), 1);
  assert.deepEqual(qr.mock.calls[0]?.arguments, [connection.expoUrl, qrOptions]);
  const png = Buffer.from(connection.qrDataUrl.split(",")[1]!, "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 280);
  assert.equal(png.readUInt32BE(20), 280);
  assert.equal(fetchMetro.mock.callCount(), 1);
  const [url, init] = fetchMetro.mock.calls[0]!.arguments;
  assert.equal(url, "http://127.0.0.1:8081/status");
  assert.deepEqual(init?.headers, { Accept: "text/plain" });
  assert.equal(init?.redirect, "error");
  assert.equal(init?.credentials, "omit");
  assert.ok(init?.signal instanceof AbortSignal);
  assert.doesNotMatch(JSON.stringify(response.data), /attacker|private-tenant|secret|token|backendUrl/);
});

test("unknown queries, bodies, methods and path parameters are rejected before any generation", async (t) => {
  const { addresses, fetchMetro } = network(t);
  const qr = t.mock.method(qrCode, "toDataURL");
  const get = await harness(t, enabled);
  for (const query of ["host=evil.invalid", "gatewayUrl=http://evil.invalid", "metroPort=80", "platform=ios", "tenantId=private", "__proto__[host]=evil.invalid"]) {
    assert.equal((await get(`${route}?${query}`)).status, 400);
  }
  for (const body of ["{}", '{"host":"evil.invalid"}', "[]"]) assert.equal((await get(route, { body })).status, 400);
  assert.equal((await get(route, { body: "unparsed body", headers: { "Content-Type": "text/plain" } })).status, 400);
  for (const method of ["POST", "HEAD", "PUT", "PATCH", "DELETE"]) assert.equal((await get(route, { method })).status, 404);
  assert.equal((await get(`${route}/untrusted`)).status, 404);
  assert.equal(addresses.mock.callCount(), 0);
  assert.equal(fetchMetro.mock.callCount(), 0);
  assert.equal(qr.mock.callCount(), 0);
});

test("no LAN explicitly reports localhost as unusable from a phone while retaining a local QR", async (t) => {
  network(t, { lo: [ipv4("127.0.0.1", true)] });
  const get = await harness(t, { ...enabled, preferredHost: "evil.invalid" });
  const response = await get();
  assert.equal(response.status, 200);
  const connection = connectionSchema.parse(response.data);
  assert.equal(connection.expoUrl, "exp://localhost:8081");
  assert.equal(connection.gatewayUrl, "http://localhost:8787");
  assert.equal(connection.lanAvailable, false);
  assert.match(connection.message ?? "", /No se detectó una red LAN privada.*localhost/);
  assert.equal(connection.qrDataUrl, await qrCode.toDataURL(connection.expoUrl, qrOptions));
});

test("only server-configured ports and a verified preferred LAN host affect generated connections", async (t) => {
  const { fetchMetro } = network(t, { "Wi-Fi": [ipv4("192.168.1.20")], en0: [ipv4("10.0.0.20")] });
  const options = { ...enabled, preferredHost: "10.0.0.20", metroPort: 8091, gatewayPort: 8791 };
  const get = await harness(t, options);
  options.preferredHost = "evil.invalid";
  options.metroPort = 80;
  const connection = connectionSchema.parse((await get()).data);
  assert.equal(connection.expoUrl, "exp://10.0.0.20:8091");
  assert.equal(connection.gatewayUrl, "http://10.0.0.20:8791");
  assert.equal(fetchMetro.mock.calls[0]?.arguments[0], "http://127.0.0.1:8091/status");
});

test("invalid ports fail before discovery and disabled routers do not validate development-only settings", (t) => {
  const { addresses, fetchMetro } = network(t);
  for (const port of [0, -1, 65536, 8081.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => developmentRouter({ ...enabled, metroPort: port }), /DEVELOPMENT_PORT_INVALID/);
    assert.throws(() => developmentRouter({ ...enabled, gatewayPort: port }), /DEVELOPMENT_PORT_INVALID/);
    assert.doesNotThrow(() => developmentRouter({ enabled: false, metroPort: port, gatewayPort: port }));
  }
  assert.equal(addresses.mock.callCount(), 0);
  assert.equal(fetchMetro.mock.callCount(), 0);
});

test("cache shares simultaneous generation for 30 seconds and invalidates on LAN changes", async (t) => {
  const interfaces = { "Wi-Fi": [ipv4("192.168.1.20")] };
  const { fetchMetro } = network(t, interfaces);
  const qr = t.mock.method(qrCode, "toDataURL");
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  const get = await harness(t, enabled);
  const [first, simultaneous] = await Promise.all([get(), get()]);
  assert.equal(first.status, 200);
  assert.deepEqual(first.data, simultaneous.data);
  now += 29_999;
  assert.deepEqual((await get()).data, first.data);
  assert.equal(fetchMetro.mock.callCount(), 1);
  assert.equal(qr.mock.callCount(), 1);
  now += 1;
  await get();
  assert.equal(fetchMetro.mock.callCount(), 2);
  assert.equal(qr.mock.callCount(), 2);
  interfaces["Wi-Fi"] = [ipv4("192.168.1.21")];
  const changed = connectionSchema.parse((await get()).data);
  assert.equal(changed.expoUrl, "exp://192.168.1.21:8081");
  assert.equal(fetchMetro.mock.callCount(), 3);
  assert.equal(qr.mock.callCount(), 3);
});

test("Metro failure, redirects and unexpected status content report unreachable without hiding the QR", async (t) => {
  const { fetchMetro } = network(t);
  for (const result of [new Response("packager-status:running", { status: 503 }), new Response("unrelated service"), new Response(null, { status: 302, headers: { Location: "http://evil.invalid/" } }), new Error("PRIVATE_NETWORK_FAILURE")]) {
    fetchMetro.mock.mockImplementation(async () => { if (result instanceof Error) throw result; return result; });
    const get = await harness(t, enabled);
    const response = await get();
    assert.equal(response.status, 200);
    const connection = connectionSchema.parse(response.data);
    assert.equal(connection.metroReachable, false);
    assert.match(connection.qrDataUrl, /^data:image\/png;base64,/);
    assert.doesNotMatch(JSON.stringify(response.data), /PRIVATE_NETWORK_FAILURE|evil.invalid/);
  }
});

test("Metro's three-second abort also bounds waiting for its response body", async (t) => {
  const { fetchMetro } = network(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => { entered = resolve; });
  fetchMetro.mock.mockImplementation(async (_input, init) => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      assert.ok(init?.signal);
      init.signal.addEventListener("abort", () => controller.error(new Error("ABORTED")), { once: true });
      entered();
    },
  })));
  const get = await harness(t, enabled);
  const pending = get();
  await reading;
  const signal = fetchMetro.mock.calls[0]?.arguments[1]?.signal;
  t.mock.timers.tick(2_999);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal?.aborted, true);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(connectionSchema.parse(response.data).metroReachable, false);
});

test("QR failures return only a generic error and do not poison subsequent retries", async (t) => {
  network(t);
  const original = qrCode.toDataURL;
  const qr = t.mock.method(qrCode, "toDataURL", async () => { throw new Error("private-path-and-token"); });
  const get = await harness(t, enabled);
  const failed = await get();
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.data, { error: "DEVELOPMENT_CONNECTION_UNAVAILABLE" });
  qr.mock.mockImplementation(original);
  const retried = await get();
  assert.equal(retried.status, 200);
  assert.equal(connectionSchema.parse(retried.data).expoUrl, "exp://192.168.1.20:8081");
});