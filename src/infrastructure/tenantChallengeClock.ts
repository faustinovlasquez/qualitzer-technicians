import type { TenantLoginChallenge } from "../domain/models";

export interface TenantChallengeResponseTiming {
  requestStartedAt: number;
  headersReceivedAt: number;
  serverDate: string | null;
}

export interface TenantChallengeRemaining {
  remainingMs: number;
  source: "server" | "unverified" | "invalid";
}

interface ChallengeAnchor {
  deadline: number;
  lastRead: number;
  source: TenantChallengeRemaining["source"];
  clock: () => number;
}

const anchors = new WeakMap<TenantLoginChallenge, ChallengeAnchor>();
const maximumBudgetMs = 120_000;

export function tenantChallengeMonotonicNow(): number {
  return globalThis.performance?.now() ?? Number.NaN;
}

function validExpiry(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : Number.NaN;
}

export function registerTenantChallengeClock(
  challenge: TenantLoginChallenge,
  timing?: TenantChallengeResponseTiming,
  clock: () => number = tenantChallengeMonotonicNow,
): void {
  if (anchors.has(challenge)) return;
  const now = clock();
  const started = timing?.requestStartedAt ?? now;
  const received = timing?.headersReceivedAt ?? now;
  const expiry = validExpiry(challenge.expiresAt);
  const date = timing?.serverDate;
  const serverTime = date ? Date.parse(date) : Number.NaN;
  const hasServerTime = Number.isFinite(serverTime) && new Date(serverTime).toUTCString() === date;
  const valid = [now, started, received, expiry].every(Number.isFinite) && started >= 0 && received >= started && now >= received;
  // Date has one-second precision; charge the full request trip and subsequent body/read time conservatively.
  const budget = hasServerTime ? Math.min(maximumBudgetMs, Math.max(0, expiry - serverTime - 1000)) : maximumBudgetMs;
  anchors.set(challenge, {
    deadline: valid ? started + budget : 0,
    lastRead: now,
    source: valid ? hasServerTime ? "server" : "unverified" : "invalid",
    clock,
  });
}

export function getTenantChallengeRemaining(challenge: TenantLoginChallenge): TenantChallengeRemaining {
  registerTenantChallengeClock(challenge);
  const anchor = anchors.get(challenge)!;
  const now = anchor.clock();
  if (!Number.isFinite(now) || now < anchor.lastRead || !Number.isFinite(validExpiry(challenge.expiresAt))) {
    anchor.source = "invalid";
  }
  anchor.lastRead = now;
  const remainingMs = anchor.source === "invalid" ? 0 : Math.max(0, anchor.deadline - now);
  if (remainingMs === 0) anchor.deadline = 0;
  return { remainingMs, source: anchor.source };
}