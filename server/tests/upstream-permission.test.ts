import assert from "node:assert/strict";
import { test } from "node:test";
import { Upstream } from "../upstream";
import { TOKEN } from "./fixtures";
import { harness, jsonRequest } from "./mock-upstream";

// El backend responde 401 tanto por sesión inválida como por falta de permiso; solo lo primero debe cerrar la sesión del teléfono.
test("a backend 401 for a missing permission becomes 403 and keeps the session", async (t) => {
  const { state, backendUrl } = await harness(t);
  const upstream = new Upstream({ backendUrl, tenantOrigin: "http://localhost:3000" });
  for (const error of ["PERMISSION_REQUIRED", "MAINTENANCE_REOPEN_UNAUTHORIZED", "MAINTENANCE_REOPEN_FORBIDDEN", "TENANT_TYPE_NOT_ALLOWED"]) {
    state.failures.set("/api/branches/1", { status: 401, body: { error } });
    await assert.rejects(upstream.request("/branches/1", { token: TOKEN }), { status: 403, code: "FORBIDDEN" });
  }
  for (const body of [{ error: "UNAUTHORIZED" }, { error: "JWT_EXPIRED" }, { error: "USER_NOT_FOUND" }, "not-json", null]) {
    state.failures.set("/api/branches/1", { status: 401, body });
    await assert.rejects(upstream.request("/branches/1", { token: TOKEN }), { status: 401, code: "UNAUTHORIZED" });
  }
});

test("a permission 401 from the backend does not revoke the gateway session", async (t) => {
  const { state, baseUrl } = await harness(t);
  state.failures.set("/api/auth/me", { status: 401, body: { error: "PERMISSION_REQUIRED" } });
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me")).response.status, 403);
  state.failures.delete("/api/auth/me");
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me")).response.status, 200);
  state.failures.set("/api/auth/me", { status: 401, body: { error: "UNAUTHORIZED" } });
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me")).response.status, 401);
  state.failures.delete("/api/auth/me");
  assert.equal((await jsonRequest(baseUrl, "/api/auth/me")).response.status, 401);
});
