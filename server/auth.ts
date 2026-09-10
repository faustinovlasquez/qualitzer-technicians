import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { LoginStartResult, User } from "../src/domain/models";
import { loginResultSchema, parseUpstream, userSchema } from "./contracts";
import { GatewayError } from "./errors";
import { LoginDiscovery } from "./login-discovery";
import { branchQuerySchema, emptySchema, loginCompleteSchema, loginSchema, loginStartSchema, passwordSchema } from "./validation";
import type { Upstream } from "./upstream";
import type { SessionContext } from "./session-context";
import { clearWebSessionCookie, respondLogin } from "./web-session";

export function bearer(req: Request): string {
  const value = req.headers.authorization;
  if (!value || value.length > 8192 || !/^Bearer [A-Za-z0-9._~+/=-]+$/i.test(value)) throw new GatewayError(401, "UNAUTHORIZED");
  return `Bearer ${value.slice(7)}`;
}

export function assertBranch(user: User, branchId: number): void {
  if (!user.accessBranchs.some((branch) => branch.id === branchId && branch.isEnabled !== false && branch.isDeleted !== true)) {
    throw new GatewayError(403, "BRANCH_FORBIDDEN");
  }
}

export async function currentUser(upstream: Upstream, token: string): Promise<User> {
  return parseUpstream(userSchema, await upstream.request("/auth/me", { token }));
}

export function authRouter(context: SessionContext): Router {
  const router = Router();
  const passwordChanges = new Set<string>();
  const discovery = new LoginDiscovery(context);
  const respondDiscoveredLogin = (req: Request, res: Response, result: LoginStartResult): void => {
    if (result.nextStep === "SELECT_TENANT") { res.json(result); return; }
    const { session } = context.sessions.resolve(result.token);
    respondLogin(req, res, result, { token: result.token, expiresAt: session.expiresAt }, result.tenant ?? context.tenants.get(session.tenantId).tenant, context.webOptions);
  };
  router.post("/login/start", async (req, res) => {
    const input: unknown = req.body;
    req.body = undefined;
    res.set("Cache-Control", "no-store");
    context.assertTransport(req);
    emptySchema.parse(req.query);
    const credentials = loginStartSchema.parse(input);
    respondDiscoveredLogin(req, res, await discovery.start(credentials));
  });
  router.post("/login/complete", async (req, res) => {
    const input: unknown = req.body;
    req.body = undefined;
    res.set("Cache-Control", "no-store");
    context.assertTransport(req);
    emptySchema.parse(req.query);
    const { challenge, tenantId } = loginCompleteSchema.parse(input);
    respondDiscoveredLogin(req, res, await discovery.complete(challenge, tenantId));
  });
  router.post("/login", async (req, res) => {
    context.assertTransport(req);
    if (context.tenants.backend) throw new GatewayError(400, "USE_LOGIN_DISCOVERY");
    emptySchema.parse(req.query);
    const selection = z.object({ tenantId: z.unknown().optional() }).parse(req.body ?? {});
    if (selection.tenantId === undefined || selection.tenantId === null || selection.tenantId === "") throw new GatewayError(400, "TENANT_REQUIRED");
    const { tenantId, ...body } = loginSchema.parse(req.body);
    const { upstream, tenant } = context.tenants.get(tenantId);
    const result = parseUpstream(loginResultSchema, await upstream.request("/auth/login", { method: "POST", json: body }));
    const issued = context.sessions.issue(tenantId, result);
    respondLogin(req, res, result, issued, tenant, context.webOptions);
  });
  router.get("/me", context.middleware(), async (req, res) => {
    const { runtime: { upstream, tenant } } = context.get(req);
    const token = bearer(req);
    const { companyBranchId } = branchQuerySchema.parse(req.query);
    const user = await currentUser(upstream, token);
    if (companyBranchId === undefined) { res.json({ ...user, tenant: await context.tenants.display(tenant.id) }); return; }
    assertBranch(user, companyBranchId);
    const selected = parseUpstream(userSchema, await upstream.request("/auth/me", { token, query: new URLSearchParams({ companyBranchId: String(companyBranchId) }) }));
    assertBranch(selected, companyBranchId);
    if (selected.id !== user.id || selected.workerId !== user.workerId) throw new GatewayError(401, "SESSION_CHANGED");
    res.json({ ...selected, tenant: await context.tenants.display(tenant.id) });
  });
  router.post("/logout", context.middleware(true), async (req, res) => {
    const { key, runtime: { upstream } } = context.get(req);
    const token = bearer(req);
    emptySchema.parse(req.query);
    emptySchema.parse(req.body ?? {});
    if (context.assertTransport(req)) clearWebSessionCookie(req, res, context.webOptions);
    context.sessions.revoke(key);
    try { await upstream.request("/auth/logout", { method: "POST", token }); } catch {}
    res.json({ success: true });
  });
  router.patch("/forced_password", context.middleware(true), async (req, res) => {
    const { key } = context.get(req);
    if (passwordChanges.has(key)) throw new GatewayError(409, "PASSWORD_CHANGE_IN_PROGRESS");
    passwordChanges.add(key);
    try {
      const { session, runtime: { upstream, tenant } } = context.get(req);
      if (session.nextStep !== "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") throw new GatewayError(403, "PASSWORD_CHANGE_NOT_REQUIRED");
      const token = bearer(req);
      emptySchema.parse(req.query);
      const body = passwordSchema.parse(req.body);
      const result = parseUpstream(loginResultSchema, await upstream.request("/auth/forced_password", { method: "PATCH", token, json: body }));
      const issued = context.sessions.rotate(key, result);
      respondLogin(req, res, result, issued, tenant, context.webOptions);
    } finally { passwordChanges.delete(key); }
  });
  return router;
}