import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import express from "express";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { userSignatureInputSchema, type UserSignature, type UserSignatureOptions } from "../../src/domain/userSignatures";
import { errorHandler, GatewayError } from "../errors";
import { Upstream } from "../upstream";
import { createUserSignatureRouter } from "../userSignatures/routes";
import { PNG, user } from "./fixtures";
import { harness as gatewayHarness, jsonRequest } from "./mock-upstream";

const image = `data:image/png;base64,${PNG.toString("base64")}`;
const input = { signatureName: "Firma del tecnico", signatureEmail: "tecnico@example.invalid", signaturePhone: null, signatureImage: image, branchIds: [1] };

async function harness(context: TestContext) {
  const actor = user();
  actor.accessBranchs = actor.accessBranchs.filter(branch => branch.id === 1);
  const state = { signatures: [] as UserSignature[], corrupt: false, calls: [] as Array<{ path: string; method: string; body: unknown }> };
  let nextId = 7;
  const catalog = (selectedId: number | null = null): UserSignatureOptions => ({
    userId: state.corrupt ? actor.id + 1 : actor.id, companyBranchId: 1,
    defaultSignatureId: state.signatures.find(signature => signature.isDefaultForBranch)?.id ?? null,
    selectedSignatureId: selectedId ?? state.signatures.find(signature => signature.isDefaultForBranch)?.id ?? null,
    options: state.signatures,
  });
  const upstream = new Upstream({ backendUrl: "https://example.invalid/api", tenantOrigin: "https://tenant.example.invalid" });
  upstream.request = async (path, options = {}) => {
    state.calls.push({ path, method: options.method ?? "GET", body: options.json });
    if (path === "/auth/me") return actor;
    if (path === "/user_signatures/me") {
      assert.equal(options.query?.get("companyBranchId"), "1");
      if (options.method === "PUT") {
        const value = userSignatureInputSchema.parse(options.json);
        if (value.id !== undefined && !state.signatures.some(signature => signature.id === value.id)) throw new GatewayError(404, "USER_SIGNATURE_NOT_FOUND");
        const id = value.id ?? nextId++;
        const signature = { id, value: String(id), label: value.signatureName, signatureName: value.signatureName,
          signatureEmail: value.signatureEmail, signaturePhone: value.signaturePhone, signatureImage: value.signatureImage ?? image,
          isDefaultForBranch: true, branches: [{ value: "1", label: "Taller" }] };
        state.signatures = [...state.signatures.filter(item => item.id !== id), signature];
        return catalog(id);
      }
      return catalog();
    }
    if (options.method === "DELETE" && path.startsWith("/user_signatures/me/")) {
      const id = Number(path.split("/").at(-1));
      state.signatures = state.signatures.filter(signature => signature.id !== id);
      return null;
    }
    throw new Error(`UNEXPECTED_SIGNATURE_REQUEST:${path}`);
  };
  const app = express();
  app.set("query parser", "simple");
  app.use("/api/user-signatures", createUserSignatureRouter(upstream));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS");
  const request = async (method = "GET", body?: unknown, suffix = "?companyBranchId=1", authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/user-signatures${suffix}`, {
      method, headers: { ...(authenticated ? { Authorization: "Bearer test-token" } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() as unknown };
  };
  return { state, actor, request };
}

test("own signature routes read, create, edit the same ID and delete without updating the whole user profile", async context => {
  const { state, actor, request } = await harness(context);
  assert.deepEqual((await request()).data, { userId: actor.id, companyBranchId: 1, defaultSignatureId: null, selectedSignatureId: null, options: [] });
  const created = await request("PUT", input);
  assert.equal(created.status, 200);
  assert.equal(state.signatures[0]?.id, 7);
  assert.equal((await request("PUT", { ...input, id: 7, signatureName: "Firma actualizada" })).status, 200);
  assert.equal(state.signatures.length, 1);
  assert.equal(state.signatures[0]?.signatureName, "Firma actualizada");
  assert.equal((await request("DELETE", undefined, "/7?companyBranchId=1")).status, 200);
  assert.equal(state.signatures.length, 0);
  assert.deepEqual(state.calls.filter(call => call.method !== "GET").map(call => call.path), ["/user_signatures/me", "/user_signatures/me", "/user_signatures/me/7"]);
});

test("signature operations reject actor overrides, foreign branches, unknown IDs and missing authentication before writes", async context => {
  const { state, request } = await harness(context);
  for (const value of [{ ...input, userId: 99 }, { ...input, branchIds: [999] }, { ...input, id: 99 }]) {
    assert.ok((await request("PUT", value)).status >= 400);
  }
  assert.equal((await request("DELETE", undefined, "/99?companyBranchId=1")).status, 404);
  assert.equal((await request("GET", undefined, "?companyBranchId=999")).status, 403);
  assert.equal((await request("GET", undefined, "?companyBranchId=1&userId=99")).status, 400);
  assert.equal((await request("PUT", input, "?companyBranchId=1", false)).status, 401);
  assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
});

test("signature images reject URLs and malformed PNG without upstream writes", async context => {
  const { state, request } = await harness(context);
  for (const signatureImage of ["https://example.invalid/signature.png", "data:image/png;base64,AAAA", "data:image/svg+xml;base64,PHN2Zz4="]) {
    assert.equal((await request("PUT", { ...input, signatureImage })).status, 400);
  }
  assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
});

test("signature responses belonging to another authenticated user fail closed", async context => {
  const { state, request } = await harness(context);
  state.corrupt = true;
  assert.equal((await request()).status, 502);
});

test("real gateway routes authorize signature JSON over 32 KiB without widening unrelated parser limits", async context => {
  const { state, baseUrl } = await gatewayHarness(context);
  const png = await sharp(randomBytes(100 * 100 * 3), { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
  const signatureImage = `data:image/png;base64,${png.toString("base64")}`;
  const body = { ...input, signatureImage };
  assert.ok(JSON.stringify(body).length > 32 * 1024);
  const catalog = { userId: state.user.id, companyBranchId: 1, defaultSignatureId: null, selectedSignatureId: null, options: [] };
  state.failures.set("/api/user_signatures/me", { status: 200, body: catalog });
  const result = await jsonRequest(baseUrl, "/api/user-signatures?companyBranchId=1", "PUT", body);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.equal(state.calls.filter(call => call.method === "PUT" && call.path === "/api/user_signatures/me").length, 1);
  state.calls.length = 0;
  assert.equal((await jsonRequest(baseUrl, "/api/user-signatures?companyBranchId=1", "PUT", body, null)).response.status, 401);
  assert.equal(state.calls.length, 0);
  assert.equal((await jsonRequest(baseUrl, "/api/user-signatures/7?companyBranchId=1", "PUT", body)).response.status, 413);
});