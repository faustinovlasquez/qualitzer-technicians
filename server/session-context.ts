import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { GatewayError } from "./errors";
import { SessionManager, type SessionReference } from "./sessions";
import { TenantRegistry, type TenantRuntime } from "./tenants";
import { emptySchema } from "./validation";
import { assertWebSessionTransport, clearWebSessionCookie, readWebSessionToken, type WebSessionOptions } from "./web-session";

export interface AuthContext extends SessionReference { readonly runtime: TenantRuntime; }

export class SessionContext {
  private readonly requests = new WeakMap<Request, AuthContext>();
  private readonly webRequests = new WeakSet<Request>();

  constructor(readonly tenants: TenantRegistry, readonly sessions: SessionManager, readonly webOptions?: WebSessionOptions) {}

  assertTransport(req: Request): boolean { return assertWebSessionTransport(req, this.webOptions); }

  middleware(allowRestricted = false): RequestHandler {
    return (req, res, next) => {
      if (this.tenants.backend) {
        void this.tenants.ensureFresh().then(() => this.authenticate(allowRestricted)(req, res, next)).catch(next);
        return;
      }
      this.authenticate(allowRestricted)(req, res, next);
    };
  }

  private authenticate(allowRestricted: boolean): RequestHandler {
    return (req, _res, next) => {
      const authorization = req.headers.authorization;
      delete req.headers.authorization;
      const webSession = this.assertTransport(req);
      if (webSession) this.webRequests.add(req);
      if (webSession && authorization !== undefined) throw new GatewayError(401, "UNAUTHORIZED");
      const token = webSession ? readWebSessionToken(req) : /^Bearer (\S+)$/i.exec(authorization ?? "")?.[1];
      if (!token) throw new GatewayError(401, "UNAUTHORIZED");
      const reference = this.sessions.resolve(token);
      const header = req.headers["x-qualitzer-tenant"];
      if (header !== undefined && header !== reference.session.tenantId) throw new GatewayError(409, "TENANT_SESSION_MISMATCH");
      const runtime = this.tenants.get(reference.session.tenantId);
      if (!allowRestricted && reference.session.nextStep !== "DONE") throw new GatewayError(403, "PASSWORD_CHANGE_REQUIRED");
      if (req.method === "GET" || req.method === "HEAD") emptySchema.parse(req.body ?? {});
      this.requests.set(req, { ...reference, runtime });
      req.headers.authorization = `Bearer ${reference.session.upstreamToken}`;
      next();
    };
  }

  get(req: Request): AuthContext {
    const context = this.requests.get(req);
    if (!context) throw new GatewayError(401, "UNAUTHORIZED");
    this.tenants.assertFresh();
    this.sessions.requireKey(context.key);
    if (this.tenants.backend && this.tenants.bindingKey(context.session.tenantId) !== context.runtime.routeKey) throw new GatewayError(401, "UNAUTHORIZED");
    return context;
  }

  readonly invalidateUnauthorized: ErrorRequestHandler = (error: unknown, req, res, next) => {
    const context = this.requests.get(req);
    if (error instanceof GatewayError && error.status === 401) {
      if (this.webRequests.has(req) && !res.headersSent) clearWebSessionCookie(req, res, this.webOptions);
      if (context) this.sessions.revoke(context.key);
    }
    next(error);
  };
}