import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { LoginResult } from "../src/domain/models";
import { tenantIdSchema } from "./config";
import { GatewayError } from "./errors";

export const MAX_SESSIONS = 10_000;
export interface GatewaySession {
  readonly tenantId: string;
  readonly routeKey?: string;
  readonly upstreamToken: string;
  readonly expiresAt: number;
  readonly nextStep: LoginResult["nextStep"];
}
export interface SessionReference { readonly key: string; readonly session: GatewaySession; }
export interface IssuedSession { token: string; expiresAt: number; }
export interface ISessionPersistence {
  load(): readonly SessionReference[];
  save(sessions: readonly SessionReference[]): void;
}

const upstreamTokenSchema = z.string().regex(/^[A-Za-z0-9._~+/=-]{1,8185}$/);
const snapshotSchema = z.array(z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  session: z.object({
    tenantId: tenantIdSchema,
    routeKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    upstreamToken: upstreamTokenSchema,
    expiresAt: z.number().finite().max(Number.MAX_SAFE_INTEGER),
    nextStep: z.enum(["DONE", "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"]),
  }).strict(),
}).strict()).max(MAX_SESSIONS);

function upstreamExpiry(token: string): number {
  if (!upstreamTokenSchema.safeParse(token).success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
  const parts = token.split(".");
  if (parts.length !== 3) return Number.MAX_SAFE_INTEGER;
  try {
    if (!parts[1] || !/^[A-Za-z0-9_-]+$/.test(parts[1])) throw new Error();
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const parsed = z.object({ exp: z.number().finite().optional() }).safeParse(payload);
    if (!parsed.success) throw new Error();
    return parsed.data.exp === undefined ? Number.MAX_SAFE_INTEGER : Math.min(Number.MAX_SAFE_INTEGER, parsed.data.exp * 1000);
  } catch { throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE"); }
}

export function parseSessionSnapshot(input: unknown): SessionReference[] {
  try {
    const entries = snapshotSchema.parse(input);
    const keys = new Set<string>();
    for (const { key, session } of entries) {
      if (keys.has(key) || session.expiresAt > upstreamExpiry(session.upstreamToken)) throw new Error();
      keys.add(key);
    }
    return entries;
  } catch { throw new Error("SESSION_PERSISTENCE_INVALID"); }
}

export class SessionManager {
  private entries = new Map<string, GatewaySession>();
  private unavailable = false;

  constructor(private readonly now: () => number = Date.now, private readonly persistence?: ISessionPersistence, private readonly bindingKey?: (tenantId: string) => string | undefined) {
    if (persistence) {
      for (const { key, session } of parseSessionSnapshot(persistence.load())) this.entries.set(key, Object.freeze(session));
      this.purge();
    }
  }

  purge(): void {
    this.assertAvailable();
    const now = this.now();
    const expired = [...this.entries].filter(([, session]) => session.expiresAt <= now);
    if (expired.length === 0) return;
    this.change(() => { for (const [key] of expired) this.entries.delete(key); });
  }

  requireKey(key: string): GatewaySession {
    this.purge();
    const session = this.entries.get(key);
    if (!session) throw new GatewayError(401, "UNAUTHORIZED");
    if (this.bindingKey && (!session.routeKey || session.routeKey !== this.bindingKey(session.tenantId))) {
      this.revoke(key);
      throw new GatewayError(401, "UNAUTHORIZED");
    }
    return session;
  }

  reconcileBindings(): void {
    this.assertAvailable();
    if (!this.bindingKey) return;
    this.change(() => {
      for (const [key, session] of this.entries) {
        if (!session.routeKey || session.routeKey !== this.bindingKey!(session.tenantId)) this.entries.delete(key);
      }
    }, true);
  }

  resolve(token: string): SessionReference {
    if (!/^qzm_[A-Za-z0-9_-]{43}$/.test(token)) throw new GatewayError(401, "UNAUTHORIZED");
    const key = this.hash(token);
    return { key, session: this.requireKey(key) };
  }

  issue(tenantId: string, result: LoginResult): IssuedSession {
    this.purge();
    if (this.entries.size >= MAX_SESSIONS) throw new GatewayError(503, "SESSION_CAPACITY_REACHED");
    return this.store(tenantId, result, Number.MAX_SAFE_INTEGER);
  }

  rotate(key: string, result: LoginResult): IssuedSession {
    const previous = this.requireKey(key);
    return this.store(previous.tenantId, result, previous.expiresAt, key);
  }

  revoke(key: string): void {
    this.assertAvailable();
    if (this.entries.has(key)) this.change(() => { this.entries.delete(key); }, true);
  }

  private assertAvailable(): void {
    if (this.unavailable) throw new GatewayError(503, "SESSION_PERSISTENCE_UNAVAILABLE");
  }

  private change(mutate: () => void, failClosed = false): void {
    const previous = this.persistence ? new Map(this.entries) : undefined;
    mutate();
    try { this.persistence?.save([...this.entries].map(([key, session]) => ({ key, session }))); }
    catch {
      if (!failClosed && previous) this.entries = previous;
      this.unavailable = true;
      throw new GatewayError(503, "SESSION_PERSISTENCE_UNAVAILABLE");
    }
  }

  private hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

  private store(tenantId: string, result: LoginResult, maximum: number, replacingKey?: string): IssuedSession {
    const routeKey = this.bindingKey?.(tenantId);
    if (this.bindingKey && !routeKey) throw new GatewayError(401, "UNAUTHORIZED");
    if (!tenantIdSchema.safeParse(tenantId).success || !["DONE", "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"].includes(result.nextStep)) {
      throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    const expiry = Math.min(upstreamExpiry(result.token), maximum);
    if (expiry <= this.now()) throw new GatewayError(401, "UNAUTHORIZED");
    let token: string;
    let key: string;
    do { token = `qzm_${randomBytes(32).toString("base64url")}`; key = this.hash(token); } while (this.entries.has(key));
    this.change(() => {
      if (replacingKey !== undefined) this.entries.delete(replacingKey);
      this.entries.set(key, Object.freeze({ tenantId, upstreamToken: result.token, expiresAt: expiry, nextStep: result.nextStep, ...(routeKey === undefined ? {} : { routeKey }) }));
    });
    return { token, expiresAt: expiry };
  }
}