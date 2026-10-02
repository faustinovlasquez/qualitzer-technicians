import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { randomBytes } from "node:crypto";
import express from "express";
import sharp from "sharp";
import { ownProfileInputSchema, type OwnProfile } from "../../src/domain/ownProfile";
import { errorHandler } from "../errors";
import { Upstream } from "../upstream";
import { createUserProfileRouter } from "../userProfile/routes";
import { PNG, user } from "./fixtures";
import { harness as gatewayHarness, jsonRequest } from "./mock-upstream";

const input = { firstNames: "Faustino", lastNames: "Velásquez", secondLastName: null, preferredName: null, birthdate: "1990-05-12", gender: "M", nationality: "VE", maritalStatus: "SINGLE", bloodType: "O+" };

async function jpeg(size = 64): Promise<string> {
  const buffer = await sharp(randomBytes(size * size * 3), { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function harness(context: TestContext) {
  const actor = user();
  const state = {
    corrupt: false,
    calls: [] as Array<{ path: string; method: string; body: unknown }>,
    profile: {
      userId: actor.id, workerId: actor.workerId, email: actor.email, firstNames: actor.name, lastNames: actor.lastnames,
      secondLastName: null, preferredName: null, birthdate: null, gender: null, nationality: null, maritalStatus: null, bloodType: null,
      identification: { type: "DNI", number: "4444444" }, avatarUrl: null, avatarThumbnailUrl: null, avatarColor: "#2f7d6b", updatedAt: null,
    } as OwnProfile,
  };
  const upstream = new Upstream({ backendUrl: "https://example.invalid/api", tenantOrigin: "https://tenant.example.invalid" });
  upstream.request = async (path, options = {}) => {
    state.calls.push({ path, method: options.method ?? "GET", body: options.json });
    if (path === "/auth/me") return actor;
    const reply = () => ({ ...state.profile, userId: state.corrupt ? actor.id + 1 : actor.id });
    if (path === "/profiles/me") {
      if (options.method === "PUT") state.profile = { ...state.profile, ...ownProfileInputSchema.parse(options.json) };
      return reply();
    }
    if (path === "/profiles/me/avatar") {
      const url = options.method === "DELETE" ? null : "https://files.example.invalid/acme/workers/worker_1/avatar.jpg";
      state.profile = { ...state.profile, avatarUrl: url, avatarThumbnailUrl: url };
      return reply();
    }
    throw new Error(`UNEXPECTED_PROFILE_REQUEST:${path}`);
  };
  const app = express();
  app.set("query parser", "simple");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/user-profile", createUserProfileRouter(upstream));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS");
  const request = async (method = "GET", body?: unknown, suffix = "", authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/user-profile${suffix}`, {
      method, headers: { ...(authenticated ? { Authorization: "Bearer test-token" } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() as OwnProfile };
  };
  return { state, actor, request };
}

test("own profile routes read and update personal data for the authenticated user only", async context => {
  const { state, actor, request } = await harness(context);
  const read = await request();
  assert.equal(read.status, 200);
  assert.equal(read.data.userId, actor.id);
  const saved = await request("PUT", input);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.bloodType, "O+");
  assert.equal(saved.data.birthdate, "1990-05-12");
  assert.deepEqual(state.calls.filter(call => call.method === "PUT").map(call => call.path), ["/profiles/me"]);
});

test("profile updates reject identity overrides, unknown catalogs, future dates and missing auth before upstream writes", async context => {
  const { state, request } = await harness(context);
  for (const body of [{ ...input, userId: 99 }, { ...input, isEnabled: false }, { ...input, gender: "X" }, { ...input, birthdate: "2999-01-01" }, { ...input, firstNames: " " }, { ...input, documentIdentification: "1" }]) {
    assert.equal((await request("PUT", body)).status, 400);
  }
  assert.equal((await request("GET", undefined, "?userId=99")).status, 400);
  assert.equal((await request("PUT", input, "", false)).status, 401);
  assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
});

test("avatar uploads accept only JPEG data and can be removed", async context => {
  const { state, request } = await harness(context);
  const saved = await request("PUT", { image: await jpeg() }, "/avatar");
  assert.equal(saved.status, 200);
  assert.match(saved.data.avatarUrl ?? "", /^https:\/\//);
  for (const image of [`data:image/png;base64,${PNG.toString("base64")}`, `data:image/jpeg;base64,${PNG.toString("base64")}`, "https://example.invalid/a.jpg"]) {
    assert.equal((await request("PUT", { image }, "/avatar")).status, 400);
  }
  const removed = await request("DELETE", undefined, "/avatar");
  assert.equal(removed.status, 200);
  assert.equal(removed.data.avatarUrl, null);
  assert.deepEqual(state.calls.filter(call => call.method !== "GET").map(call => `${call.method} ${call.path}`), ["PUT /profiles/me/avatar", "DELETE /profiles/me/avatar"]);
});

test("profile responses belonging to another user fail closed", async context => {
  const { state, request } = await harness(context);
  state.corrupt = true;
  assert.equal((await request()).status, 502);
});

test("real gateway routes accept avatar JSON over 32 KiB only on the avatar route", async context => {
  const { state, baseUrl } = await gatewayHarness(context);
  const image = await jpeg(210);
  assert.ok(image.length > 32 * 1024 && image.length < 90 * 1024);
  const profile = { userId: state.user.id, workerId: null, email: null, firstNames: "A", lastNames: "B", secondLastName: null, preferredName: null, birthdate: null, gender: null, nationality: null, maritalStatus: null, bloodType: null, identification: { type: null, number: null }, avatarUrl: null, avatarThumbnailUrl: null, avatarColor: null, updatedAt: null };
  state.failures.set("/api/profiles/me/avatar", { status: 200, body: profile });
  const result = await jsonRequest(baseUrl, "/api/user-profile/avatar", "PUT", { image });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.equal((await jsonRequest(baseUrl, "/api/user-profile", "PUT", { ...input, padding: image })).response.status, 413);
});
