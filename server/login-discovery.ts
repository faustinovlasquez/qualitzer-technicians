import { z } from "zod";
import type { LoginResult, LoginStartResult } from "../src/domain/models";
import { loginResultSchema, parseUpstream } from "./contracts";
import { GatewayError } from "./errors";
import { LoginChallenges, LOGIN_CHALLENGE_TTL_MS, type PreparedLogin } from "./login-challenges";
import type { SessionContext } from "./session-context";
import type { LoginCredentials } from "./validation";
import { backendDiscoverySchema, backendTenantSchema } from "./backend-directory";

export const LOGIN_DISCOVERY_CONCURRENCY = 3;
const preparedSchema = z.object({ grant: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime() }).strict();

async function mapTenants<T, R>(entries: readonly T[], operation: (entry: T) => Promise<R>): Promise<R[]> {
  let cursor = 0;
  const results: R[] = [];
  await Promise.all(Array.from({ length: Math.min(LOGIN_DISCOVERY_CONCURRENCY, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      results[index] = await operation(entries[index]!);
    }
  }));
  return results;
}

export class LoginDiscovery {
  constructor(
    private readonly context: SessionContext,
    private readonly challenges = new LoginChallenges(),
    private readonly now: () => number = Date.now,
  ) {}

  async start(credentials: LoginCredentials): Promise<LoginStartResult> {
    this.challenges.purge();
    if (this.context.tenants.backend) return this.startBackend(credentials);
    let unavailable = false;
    const prepared = await mapTenants(this.context.tenants.list(), async ({ id }): Promise<PreparedLogin | undefined> => {
      try {
        const { upstream } = this.context.tenants.get(id);
        const result = parseUpstream(preparedSchema, await upstream.request("/auth/mobile/prepare", { method: "POST", json: credentials }));
        const expiresAt = Math.min(Date.parse(result.expiresAt), this.now() + LOGIN_CHALLENGE_TTL_MS);
        if (expiresAt <= this.now()) throw new GatewayError(503, "LOGIN_DISCOVERY_UNAVAILABLE");
        return { tenantId: id, grant: result.grant, expiresAt };
      } catch (error) {
        if (!(error instanceof GatewayError && error.status === 401)) unavailable = true;
        return undefined;
      }
    });
    const matches = prepared.filter((match): match is PreparedLogin => match !== undefined);
    if (unavailable || matches.some((match) => match.expiresAt <= this.now())) throw new GatewayError(503, "LOGIN_DISCOVERY_UNAVAILABLE");
    if (!matches.length) throw new GatewayError(401, "UNAUTHORIZED");
    if (matches.length === 1) return this.exchange(matches[0]!);
    const tenants = await mapTenants(matches, ({ tenantId }) => this.context.tenants.display(tenantId));
    return { nextStep: "SELECT_TENANT", ...this.challenges.issue(matches), tenants };
  }

  complete(challenge: string, tenantId: string): Promise<LoginResult> {
    return this.exchange(this.challenges.consume(challenge, tenantId));
  }

  private async startBackend(credentials: LoginCredentials): Promise<LoginStartResult> {
    const { tenants } = this.context;
    await tenants.ensureFresh(true);
    const parsed = backendDiscoverySchema.safeParse(await tenants.backend!.request("/auth/mobile/discover", credentials));
    if (!parsed.success) throw new GatewayError(503, "LOGIN_DISCOVERY_UNAVAILABLE");
    const seen = new Set<string>();
    const grants = new Set<string>();
    const matches = parsed.data.matches.map((match): PreparedLogin => {
      const runtime = tenants.matchBackendTenant(match.tenant);
      const expiresAt = Math.min(Date.parse(match.expiresAt), this.now() + LOGIN_CHALLENGE_TTL_MS);
      if (expiresAt <= this.now() || seen.has(runtime.tenant.id) || grants.has(match.grant)) throw new GatewayError(503, "LOGIN_DISCOVERY_UNAVAILABLE");
      seen.add(runtime.tenant.id);
      grants.add(match.grant);
      return { tenantId: runtime.tenant.id, routeKey: runtime.routeKey, grant: match.grant, expiresAt };
    });
    if (!matches.length) throw new GatewayError(401, "UNAUTHORIZED");
    if (matches.length === 1) return this.exchange(matches[0]!);
    return { nextStep: "SELECT_TENANT", ...this.challenges.issue(matches), tenants: matches.map(({ tenantId }) => tenants.get(tenantId).tenant) };
  }

  private async exchange({ tenantId, grant, expiresAt, routeKey }: PreparedLogin): Promise<LoginResult> {
    if (this.context.tenants.backend) {
      await this.context.tenants.ensureFresh(true);
      if (!routeKey || routeKey !== this.context.tenants.bindingKey(tenantId)) throw new GatewayError(401, "UNAUTHORIZED");
    }
    if (expiresAt <= this.now()) throw new GatewayError(401, "UNAUTHORIZED");
    const { upstream } = this.context.tenants.get(tenantId);
    let result: LoginResult;
    try {
      if (this.context.tenants.backend) {
        const data = await this.context.tenants.backend.request("/auth/mobile/complete", { grant });
        const metadata = z.object({ tenant: backendTenantSchema }).safeParse(data);
        if (!metadata.success || this.context.tenants.matchBackendTenant(metadata.data.tenant).tenant.id !== tenantId || routeKey !== this.context.tenants.bindingKey(tenantId)) throw new GatewayError(503, "LOGIN_DISCOVERY_UNAVAILABLE");
        result = parseUpstream(loginResultSchema, data);
      } else {
        result = parseUpstream(loginResultSchema, await upstream.request("/auth/mobile/exchange", { method: "POST", json: { grant } }));
      }
    } catch (error) {
      if (error instanceof GatewayError && error.status === 401) throw new GatewayError(401, "UNAUTHORIZED");
      if (error instanceof GatewayError && error.status === 429) throw error;
      throw new GatewayError(503, "LOGIN_DISCOVERY_UNAVAILABLE");
    }
    const { token } = this.context.sessions.issue(tenantId, result);
    const tenant = await this.context.tenants.display(tenantId);
    return { ...result, token, tenant };
  }
}