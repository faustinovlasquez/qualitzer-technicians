import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, NetworkError } from "../src/infrastructure/errors";
import { expoGatewayUrl, gatewayLoopbackWarning, loginConnectionError, probeGatewayConnection, safeGatewayUrl, suggestedExpoGatewayUrl, validGatewayUrl, type GatewayProbeFetch } from "../src/infrastructure/gatewayConnection";

const current = "http://192.168.1.105:8787";
function response(body: unknown, contentType = "application/json", ok = true): Awaited<ReturnType<GatewayProbeFetch>> {
  return { ok, headers: { get: () => contentType }, json: async () => body };
}

test("canonical gateway validation accepts private LAN and public HTTPS bases", () => {
  assert.equal(validGatewayUrl(` ${current}/ `), current);
  assert.equal(validGatewayUrl("https://EXAMPLE.com:443/"), "https://example.com");
  for (const value of ["http://10.0.0.1:8787", "http://172.16.0.1:8787", "http://172.31.255.255:8787", "http://[fd12::1]:8787", "http://localhost:8787", "http://[::1]:8787"]) assert.equal(validGatewayUrl(value), value);
});

test("invalid URLs never issue health requests or expose credentials in errors", async () => {
  const values = ["", "not a URL", "file:///secret", "javascript:alert(1)", "http://example.com", "http://10.evil.test", "http://127.evil.test", "http://172.32.0.1", "http://192.169.0.1", "https://user:secret@example.com", `${current}/secret`, `${current}?token=secret`, `${current}#secret`, `${current}?`, `${current}#`, "http://192.168.1.105\n:8787", "https://example.com\\secret"];
  for (const value of values) {
    let calls = 0;
    const result = await probeGatewayConnection(value, async () => { calls += 1; throw new Error("Must not fetch"); });
    assert.equal(result.status, "invalid_url", value);
    assert.equal(calls, 0);
    assert.equal(safeGatewayUrl(value), undefined);
    assert.doesNotMatch(result.message, /secret|token=/);
  }
});

test("Expo host resolution only suggests a private address from the actual hostUri", () => {
  for (const value of ["192.168.1.105:8081", "http://192.168.1.105:8081", "exp://192.168.1.105:8081", "http://192.168.1.105:8081/"]) assert.equal(expoGatewayUrl(value), current);
  assert.equal(expoGatewayUrl("10.1.2.3:8081"), "http://10.1.2.3:8787");
  for (const value of [undefined, null, "", "localhost:8081", "127.0.0.1:8081", "[::1]:8081", "exp://8.8.8.8:8081", "exp://evil.test:8081", "https://192.168.1.105:8081", "file://192.168.1.105", "exp://user:secret@192.168.1.105:8081", "exp://192.168.1.105:8081/path", "192.168.1.105:8081?url=http://evil.test", "192.168.1.105:8081#", "192.168.1.105\n:8081", "10.evil.test:8081"]) assert.equal(expoGatewayUrl(value), undefined, String(value));
});

test("a stored IP mismatch is only a suggestion and never changes the stored value", () => {
  const stored = { gatewayUrl: "http://192.168.1.104:8787", namespace: "original-offline-queue" };
  assert.equal(suggestedExpoGatewayUrl("192.168.1.105:8081", stored.gatewayUrl), current);
  assert.deepEqual(stored, { gatewayUrl: "http://192.168.1.104:8787", namespace: "original-offline-queue" });
  assert.equal(suggestedExpoGatewayUrl("exp://192.168.1.105:8081", `${current}/`), undefined);
  assert.equal(suggestedExpoGatewayUrl("localhost:8081", stored.gatewayUrl), undefined);
});

test("native loopback warning explains that localhost refers to the phone", () => {
  for (const value of ["http://localhost:8787", "http://127.0.0.1:8787", "http://127.1:8787", "http://[::1]:8787"]) assert.match(gatewayLoopbackWarning(value) ?? "", /propio teléfono/);
  assert.equal(gatewayLoopbackWarning(current), null);
  assert.equal(gatewayLoopbackWarning("invalid"), null);
});

test("probe uses only the canonical health URL with no credentials, bearer, body or redirects", async () => {
  let calls = 0;
  const result = await probeGatewayConnection(`${current}/`, async (url, init) => {
    calls += 1;
    assert.equal(url, `${current}/health`);
    assert.deepEqual(Object.keys(init).sort(), ["credentials", "headers", "method", "redirect", "signal"]);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.deepEqual(init.headers, { Accept: "application/json" });
    assert.equal(init.signal.aborted, false);
    return response({ ok: true, backendReachable: true, gatewayUrl: "https://evil.test", token: "secret" });
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  assert.doesNotMatch(JSON.stringify(result), /evil|secret|token/);
});

test("reachable gateway with unavailable backend has its own message", async () => {
  const result = await probeGatewayConnection(current, async () => response({ ok: true, backendReachable: false }));
  assert.equal(result.status, "backend_unavailable");
  assert.match(result.message, /pasarela responde/);
});

test("probe accepts only the expected JSON health shape", async () => {
  for (const body of [null, [], "<html>secret</html>", {}, { ok: false, backendReachable: true }, { ok: true }, { ok: true, backendReachable: "true" }, { ok: true, backendReachable: 1 }]) {
    const result = await probeGatewayConnection(current, async () => response(body));
    assert.equal(result.status, "unexpected_response");
    assert.doesNotMatch(result.message, /html|secret/);
  }
  assert.equal((await probeGatewayConnection(current, async () => response({ ok: true, backendReachable: true }, "Application/JSON; charset=utf-8"))).status, "ready");
});

test("HTML, JSON parsing failures and non-JSON 502 never leak response content", async () => {
  for (const ok of [true, false]) {
    let parsed = false;
    const result = await probeGatewayConnection(current, async () => ({ ok, headers: { get: () => "text/html" }, json: async () => { parsed = true; throw new Error("<html>secret upstream</html>"); } }));
    assert.equal(result.status, ok ? "unexpected_response" : "http_error");
    assert.equal(parsed, false);
    assert.doesNotMatch(result.message, /<html>|secret upstream/);
  }
  const result = await probeGatewayConnection(current, async () => ({ ok: true, headers: { get: () => "application/json" }, json: async () => { throw new TypeError("secret parser detail"); } }));
  assert.equal(result.status, "unexpected_response");
  assert.doesNotMatch(result.message, /secret parser/);
});

test("native network errors and browser CORS failures are safe connection failures", async () => {
  for (const error of [new TypeError("Failed to fetch secret"), new Error("fetch failed: secret native details"), new NetworkError("network")]) {
    const result = await probeGatewayConnection(current, async () => { throw error; });
    assert.equal(result.status, "network");
    assert.match(result.message, /192\.168\.1\.105:8787/);
    assert.doesNotMatch(result.message, /secret/);
  }
});

test("probe timeout aborts the request even when transport ignores cancellation", async () => {
  let signal: AbortSignal | undefined;
  const result = await probeGatewayConnection(current, async (_url, init) => {
    signal = init.signal;
    return new Promise(() => undefined);
  }, 5);
  assert.equal(result.status, "timeout");
  assert.equal(signal?.aborted, true);
});

test("probe deadline also covers a stalled JSON body", async () => {
  const result = await probeGatewayConnection(current, async () => ({ ok: true, headers: { get: () => "application/json" }, json: () => new Promise(() => undefined) }), 5);
  assert.equal(result.status, "timeout");
});

test("login network message includes safe canonical destination without implying rejected password", () => {
  for (const kind of ["network", "timeout"] as const) {
    const result = loginConnectionError(new NetworkError(kind), `${current}/`);
    assert.match(result, /http:\/\/192\.168\.1\.105:8787\./);
    assert.match(result, /no indica que tu contraseña haya sido rechazada/);
  }
  for (const value of ["https://user:secret@example.com", `${current}?secret=token`, `${current}/secret`]) {
    assert.doesNotMatch(loginConnectionError(new NetworkError("network"), value), /secret|token|user:/);
  }
  const rejected = new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Revisa tu usuario y contraseña.");
  assert.equal(loginConnectionError(rejected, current), rejected.message);
  const unrelated = new Error("No se pudo guardar la sesión.");
  assert.equal(loginConnectionError(unrelated, current), unrelated.message);
});