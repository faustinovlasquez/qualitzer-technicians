import { createHash, randomBytes } from "node:crypto";
import { GatewayError } from "./errors";

export const LOGIN_CHALLENGE_TTL_MS = 120_000;
export const MAX_LOGIN_CHALLENGES = 1000;
export interface PreparedLogin {
  readonly tenantId: string;
  readonly grant: string;
  readonly expiresAt: number;
  readonly routeKey?: string;
}
interface LoginChallenge {
  readonly matches: readonly PreparedLogin[];
  readonly expiresAt: number;
}

export class LoginChallenges {
  private readonly entries = new Map<string, LoginChallenge>();

  constructor(private readonly now: () => number = Date.now) {}

  purge(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }

  issue(matches: readonly PreparedLogin[]): { challenge: string; expiresAt: string } {
    this.purge();
    const expiresAt = Math.min(this.now() + LOGIN_CHALLENGE_TTL_MS, ...matches.map((match) => match.expiresAt));
    if (matches.length < 2 || !Number.isFinite(expiresAt) || expiresAt <= this.now() || this.entries.size >= MAX_LOGIN_CHALLENGES) {
      throw new GatewayError(503, "LOGIN_DISCOVERY_UNAVAILABLE");
    }
    let challenge: string;
    let key: string;
    do { challenge = `qzc_${randomBytes(32).toString("base64url")}`; key = this.hash(challenge); } while (this.entries.has(key));
    this.entries.set(key, Object.freeze({
      expiresAt,
      matches: Object.freeze(matches.map(({ tenantId, grant, expiresAt, routeKey }) => Object.freeze({
        tenantId, grant, expiresAt, ...(routeKey === undefined ? {} : { routeKey }),
      }))),
    }));
    return { challenge, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(challenge: string, tenantId: string): PreparedLogin {
    this.purge();
    if (!/^qzc_[A-Za-z0-9_-]{43}$/.test(challenge)) throw new GatewayError(401, "UNAUTHORIZED");
    const key = this.hash(challenge);
    const entry = this.entries.get(key);
    this.entries.delete(key);
    const match = entry?.matches.find((candidate) => candidate.tenantId === tenantId);
    if (!match) throw new GatewayError(401, "UNAUTHORIZED");
    return match;
  }

  private hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
}