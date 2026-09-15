import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { TestContext } from "node:test";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { Assignments, User } from "../../src/domain/models";
import { createApp } from "../app";
import type { GatewayConfig } from "../config";
import { loginResultSchema } from "../contracts";
import { assignments, PNG, TOKEN, user } from "./fixtures";

export interface RecordedCall {
  path: string;
  method: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  json: unknown;
  files: Array<{ field: string; name: string; mime: string; bytes: Buffer }>;
}
interface Failure { status: number; body: unknown; location?: string; }
export interface MockState {
  user: User;
  loginNextStep: "DONE" | "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  forcedNextStep: "DONE" | "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  branding: string;
  branches: Map<number, unknown>;
  beforeResponse?: (call: RecordedCall) => Promise<void>;
  assignments: Assignments;
  sequence: Assignments[];
  calls: RecordedCall[];
  failures: Map<string, Failure>;
  files: unknown;
  invalidAssignments?: unknown;
  activities?: unknown;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

const gatewayTokens = new Map<string, string>();

export async function mockBackend(t: TestContext, overrides: Partial<MockState> = {}) {
  const state: MockState = {
    user: user(), assignments: assignments(), sequence: [], calls: [], failures: new Map(),
    loginNextStep: "DONE", forcedNextStep: "DONE", branding: "Grupoeliseo",
    branches: new Map(),
    files: { data: [{ id: 1, name: "Foto", url: "https://files.example.invalid/photo.png", thumbnailUrl: "https://files.example.invalid/thumb.png", type: "image/png", createdAt: "2026-09-01T10:00:00Z", responsible: { id: 9, name: "Técnico" }, netCost: 100 }], totalRows: 1, totalPages: 1 },
    ...overrides,
  };
  const upstream = express();
  upstream.use(express.json());
  upstream.use(multer({ storage: multer.memoryStorage() }).any());
  upstream.use(async (req, res) => {
    const url = new URL(req.originalUrl, "http://mock.invalid");
    const json: unknown = req.body;
    const call: RecordedCall = { path: req.path, method: req.method, query: url.searchParams, headers: req.headers, json,
      files: Array.isArray(req.files) ? req.files.map((file) => ({ field: file.fieldname, name: file.originalname, mime: file.mimetype, bytes: file.buffer })) : [],
    };
    state.calls.push(call);
    await state.beforeResponse?.(call);
    const failure = state.failures.get(req.path);
    if (failure) {
      if (failure.location) res.set("Location", failure.location);
      res.status(failure.status).send(failure.body);
      return;
    }
    if (req.path !== "/api/auth/login" && req.headers.authorization !== TOKEN) { res.status(401).json({ error: "UPSTREAM_SECRET_ERROR" }); return; }
    if (req.path === "/api/auth/me") { res.json(state.user); return; }
    if (req.method === "GET" && /^\/api\/branches\/[1-9]\d*$/.test(req.path)) {
      const branch = state.branches.get(Number(req.path.split("/").pop()));
      if (branch !== undefined) { res.json(branch); return; }
    }
    if (req.path === "/api/companies/branding") { res.json({ name: state.branding }); return; }
    if (req.path === "/api/auth/login" || req.path === "/api/auth/forced_password") {
      res.json({ username: "test", email: "test@example.invalid", token: "test-token", nextStep: req.path === "/api/auth/login" ? state.loginNextStep : state.forcedNextStep, defaultModule: "secret", internal: { secret: true } }); return;
    }
    if (req.path === "/api/auth/logout") { res.status(200).end(); return; }
    if (req.path === "/api/technician-dashboard/assignments") { res.json(state.invalidAssignments ?? state.sequence.shift() ?? state.assignments); return; }
    if (/\/panel\/[^/]+\/works\/\d+\/activities$/.test(req.path)) { res.json(req.method === "POST" ? { id: 71 } : state.activities ?? []); return; }
    if (req.method === "GET" && /\/activities\/\d+\/files$/.test(req.path)) { res.json([]); return; }
    if (req.method === "GET" && /^\/api\/(work_files|maintenance_files)\/\d+$/.test(req.path)) { res.json(state.files); return; }
    if (req.path.startsWith("/api/works/comments/")) { res.status(201).end(); return; }
    if (req.method === "POST" || req.method === "PATCH") { res.json({ success: true }); return; }
    res.status(404).json({ error: "MOCK_NOT_FOUND" });
  });
  const upstreamServer = createServer(upstream);
  const backendUrl = `${await listen(upstreamServer)}/api`;
  t.after(() => close(upstreamServer));
  return { state, backendUrl };
}

export async function gatewayHarness(t: TestContext, config: GatewayConfig) {
  const app = createApp({ environment: "test", ...config });
  const gatewayServer = createServer(app);
  const baseUrl = await listen(gatewayServer);
  t.after(async () => { gatewayTokens.delete(baseUrl); await close(gatewayServer); });
  return { baseUrl };
}

export async function loginGateway(baseUrl: string, tenantId = "local") {
  const result = await jsonRequest(baseUrl, "/api/auth/login", "POST", { tenantId, username: "test", password: "password", remember: false }, null);
  if (result.response.status !== 200) throw new Error("TEST_LOGIN_FAILED");
  const login = loginResultSchema.parse(result.data);
  gatewayTokens.set(baseUrl, `Bearer ${login.token}`);
  return { ...result, token: `Bearer ${login.token}` };
}

export function gatewayToken(baseUrl: string): string {
  const token = gatewayTokens.get(baseUrl);
  if (!token) throw new Error("TEST_SESSION_REQUIRED");
  return token;
}

export async function harness(t: TestContext, options: { login?: boolean } = {}) {
  const { state, backendUrl } = await mockBackend(t);
  const { baseUrl } = await gatewayHarness(t, { backendUrl });
  if (options.login !== false) await loginGateway(baseUrl);
  state.calls.length = 0;
  return { state, backendUrl, baseUrl };
}

export async function jsonRequest(baseUrl: string, path: string, method = "GET", body?: unknown, token: string | null = TOKEN) {
  const headers = new Headers();
  if (token !== null) headers.set("Authorization", token === TOKEN ? gatewayToken(baseUrl) : token);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const data: unknown = await response.json();
  if (response.ok && path === "/api/auth/forced_password") gatewayTokens.set(baseUrl, `Bearer ${loginResultSchema.parse(data).token}`);
  return { response, data };
}

export const errorCode = (data: unknown): string => z.object({ error: z.string() }).parse(data).error;
export const writeCalls = (state: MockState): RecordedCall[] => state.calls.filter((call) => call.method !== "GET");
export const assignmentCalls = (state: MockState): RecordedCall[] => state.calls.filter((call) => call.path === "/api/technician-dashboard/assignments");

export function form(count = 1, bytes = PNG, name = "untrusted.exe", mime = "application/octet-stream"): FormData {
  const value = new FormData();
  for (let i = 0; i < count; i++) value.append("files", new Blob([new Uint8Array(bytes)], { type: mime }), name);
  return value;
}

export async function uploadRequest(baseUrl: string, path: string, body: FormData, token: string | null = TOKEN) {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: token === null ? {} : { Authorization: token === TOKEN ? gatewayToken(baseUrl) : token }, body });
  const data: unknown = await response.json();
  return { response, data };
}