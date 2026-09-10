import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { authRouter } from "./auth";
import { loadConfig, resolveConfig, type GatewayConfig, type ResolvedConfig, type TenantConfig } from "./config";
import { errorHandler, GatewayError } from "./errors";
import { assignmentRouter } from "./assignments/routes";
import { createPanelRouter } from "./panel/routes";
import { createChecklistRouter } from "./checklists/routes";
import { createOrderRouter } from "./orders/routes";
import { createCreationRouter } from "./creation/routes";
import { createNotificationsRouter } from "./notifications/routes";
import { createOfflineRouter } from "./offline/routes";
import { TenantRegistry, type TenantRuntime } from "./tenants";
import { BackendDirectory } from "./backend-directory";
import { SessionManager } from "./sessions";
import { createSessionPersistence } from "./session-persistence";
import { SessionContext } from "./session-context";
import { developmentRouter } from "./development";
import { emptySchema, healthQuerySchema } from "./validation";
import { WEB_SESSION_HEADER } from "./web-session";

export function createApp(input: GatewayConfig = {}) {
  const config = resolveConfig(input);
  if (config.tenantResolution === "backend") throw new Error("BACKEND_BOOTSTRAP_REQUIRED");
  const tenants = new TenantRegistry(config.tenants);
  return assembleApp(config, tenants, new SessionManager(Date.now, createSessionPersistence(config)));
}

export interface BackendBootstrapOptions {
  now?: () => number;
  legacyMigrationTenants?: () => readonly TenantConfig[];
}

export async function createConfiguredApp(input: GatewayConfig = loadConfig(), options: BackendBootstrapOptions = {}) {
  const config = resolveConfig(input);
  if (config.tenantResolution === "legacy") return createApp(config);
  const now = options.now ?? Date.now;
  const tenants = new TenantRegistry([], now, new BackendDirectory(config.backendUrl));
  await tenants.ensureFresh(true);
  const persistence = createSessionPersistence(config, { registry: tenants, legacyMigrationTenants: options.legacyMigrationTenants });
  const sessions = new SessionManager(now, persistence, (id) => tenants.bindingKey(id));
  sessions.reconcileBindings();
  tenants.onCatalogChange(() => sessions.reconcileBindings());
  return assembleApp(config, tenants, sessions);
}

function assembleApp(config: ResolvedConfig, tenants: TenantRegistry, sessions: SessionManager) {
  const app = express();
  const context = new SessionContext(tenants, sessions, { webOrigins: config.corsOrigins, secureCookies: config.environment === "production" });
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("query parser", "simple");
  app.set("trust proxy", config.trustedProxyIps.length ? config.trustedProxyIps : false);
  app.use(helmet());
  app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "RATE_LIMITED" } }));
  app.use((req, _res, next) => {
    if (config.environment === "production" && !req.secure) throw new GatewayError(400, "HTTPS_REQUIRED");
    const origin = req.headers.origin;
    if (origin !== undefined && !config.corsOrigins.includes(origin)) throw new GatewayError(403, "ORIGIN_FORBIDDEN");
    next();
  });
  app.use(cors({ origin: config.corsOrigins, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "X-Qualitzer-Tenant", WEB_SESSION_HEADER], credentials: true, maxAge: 600 }));
  const credentialsLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "AUTH_RATE_LIMITED" } });
  const authLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "AUTH_RATE_LIMITED" } });
  const uploadLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "UPLOAD_RATE_LIMITED" } });
  app.use(["/api/auth/login", "/api/auth/forced_password"], credentialsLimiter);
  const parseJson = express.json({ limit: "32kb", strict: true, inflate: false });
  app.use((req, res, next) => {
    if (req.method === "POST" && (/^\/api\/assignments\/maintenance-\d+\/deliver\/?$/i.test(req.path) || /^\/api\/offline\/(commands|documents)\/?$/i.test(req.path))) next();
    else parseJson(req, res, next);
  });
  app.use("/api/development", developmentRouter({ enabled: config.environment === "development", metroPort: 8081, gatewayPort: config.port, preferredHost: process.env.REACT_NATIVE_PACKAGER_HOSTNAME }));
  app.get("/api/tenants", async (req, res) => {
    emptySchema.parse(req.query);
    emptySchema.parse(req.body ?? {});
    await tenants.ensureFresh();
    res.json({ data: tenants.list() });
  });
  app.get("/health", async (req, res) => {
    const { tenantId } = healthQuerySchema.parse(req.query);
    emptySchema.parse(req.body ?? {});
    if (tenantId === undefined) { res.json({ ok: true, backendReachable: await tenants.reachable() }); return; }
    if (tenants.backend) {
      await tenants.ensureFresh(true);
      const { tenant } = tenants.get(tenantId);
      res.json({ ok: true, backendReachable: true, tenantOrigin: tenant.portalOrigin, tenant });
      return;
    }
    const { upstream, tenant } = tenants.get(tenantId);
    res.json({ ok: true, backendReachable: await upstream.reachable(), tenantOrigin: tenant.portalOrigin, tenant });
  });
  app.use("/api/auth", authLimiter, authRouter(context));
  const uploads = { active: 0 };
  const mobileRouters = new WeakMap<TenantRuntime, express.Router>();
  const mobileRouter = (runtime: TenantRuntime): express.Router => {
    const existing = mobileRouters.get(runtime);
    if (existing) return existing;
    const { upstream, tenant } = runtime;
    const router = express.Router();
    router.use("/creation", createCreationRouter(upstream));
    router.use("/mobile-notifications", createNotificationsRouter(upstream, tenant.portalOrigin));
    router.use("/offline", createOfflineRouter(upstream, uploadLimiter, uploads));
    mobileRouters.set(runtime, router);
    return router;
  };
  app.use("/api", (req, res, next) => {
    if (!/^\/(creation|mobile-notifications|offline)(\/|$)/.test(req.path)) { next(); return; }
    context.middleware()(req, res, (error?: unknown) => {
      if (error) { next(error); return; }
      mobileRouter(context.get(req).runtime)(req, res, next);
    });
  });
  const assignmentRouters = new WeakMap<TenantRuntime, express.Router>();
  const assignmentRouterFor = (runtime: TenantRuntime): express.Router => {
    const existing = assignmentRouters.get(runtime);
    if (existing) return existing;
    const { upstream } = runtime;
    const router = express.Router();
    router.use(createOrderRouter(upstream));
    router.use(createChecklistRouter(upstream));
    router.use(createPanelRouter(upstream, uploadLimiter, uploads));
    router.use(assignmentRouter(upstream, uploadLimiter, uploads));
    assignmentRouters.set(runtime, router);
    return router;
  };
  app.use("/api/assignments", context.middleware(), (req, res, next) => {
    assignmentRouterFor(context.get(req).runtime)(req, res, next);
  });
  app.use((_req, res) => { res.status(404).json({ error: "NOT_FOUND" }); });
  app.use(context.invalidateUnauthorized);
  app.use(errorHandler);
  return app;
}

export type { GatewayConfig } from "./config";