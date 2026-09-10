import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { LoginResult } from "../../src/domain/models";
import { MAX_SESSIONS, SessionManager } from "../sessions";

const result: LoginResult = { token: "same-upstream-token", username: "test", email: "test@example.invalid", nextStep: "DONE" };
const restrictedResult: LoginResult = { ...result, nextStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" };
const jwt = (exp: unknown): string => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
const day = 24 * 60 * 60 * 1000;

test("sessions store a SHA-256 key for a random 32-byte mobile token and bind even colliding upstream tokens to distinct tenants", () => {
  const sessions = new SessionManager(() => 1_000);
  const a = sessions.issue("a", result);
  const b = sessions.issue("b", result);
  assert.match(a.token, /^qzm_[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(a.token.slice(4), "base64url").length, 32);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.token, result.token);
  const reference = sessions.resolve(a.token);
  assert.equal(reference.key, createHash("sha256").update(a.token).digest("hex"));
  assert.deepEqual(reference.session, { tenantId: "a", upstreamToken: result.token, expiresAt: Number.MAX_SAFE_INTEGER, nextStep: "DONE" });
  assert.equal(sessions.resolve(b.token).session.tenantId, "b");
  assert.equal(Object.isFrozen(reference.session), true);
  for (const token of [result.token, `Bearer ${a.token}`, "qzm_short", a.token.slice(0, -1), `qzm_${"a".repeat(43)}`]) {
    assert.throws(() => sessions.resolve(token), { status: 401, code: "UNAUTHORIZED" });
  }
});

test("JWT lifetime survives seven days and remains bounded by upstream exp at the exact boundary", () => {
  let now = 1_000;
  const sessions = new SessionManager(() => now);
  const short = sessions.issue("a", { ...result, token: jwt(2) });
  const long = sessions.issue("a", { ...result, token: jwt(10 * 365 * day / 1000) });
  assert.equal(short.expiresAt, 2_000);
  assert.equal(long.expiresAt, 10 * 365 * day);
  now = 1_999;
  assert.equal(sessions.resolve(short.token).session.expiresAt, 2_000);
  now = 2_000;
  assert.throws(() => sessions.resolve(short.token), { status: 401 });
  now = 8 * day;
  assert.equal(sessions.resolve(long.token).session.tenantId, "a");
  now = long.expiresAt;
  sessions.purge();
  assert.throws(() => sessions.resolve(long.token), { status: 401 });
});

test("absent upstream expiry is remembered until revocation, while invalid expiry cannot bypass expiration", () => {
  let now = 2_000;
  const sessions = new SessionManager(() => now);
  for (const token of [result.token, jwt(undefined)]) {
    const issued = sessions.issue("a", { ...result, token });
    assert.equal(issued.expiresAt, Number.MAX_SAFE_INTEGER);
    now += 20 * 365 * day;
    sessions.revoke(sessions.resolve(issued.token).key);
    assert.throws(() => sessions.resolve(issued.token), { status: 401 });
  }
  for (const exp of [-1, 0, 2]) assert.throws(() => sessions.issue("a", { ...result, token: jwt(exp) }), { status: 401 });
  for (const token of ["header.invalid.signature", "header..signature", jwt("invalid"), jwt(null), jwt(true), jwt({}), jwt(Infinity), "Bearer raw", "bad\r\ntoken", "", "x".repeat(8192)]) {
    assert.throws(() => sessions.issue("a", { ...result, token }), { status: 502, code: "UPSTREAM_INVALID_RESPONSE" });
  }
});

test("rotation updates upstream token and nextStep, revokes the old token and cannot extend the original lifetime", () => {
  let now = 1_000;
  const sessions = new SessionManager(() => now);
  const a = sessions.issue("a", { ...restrictedResult, token: jwt(100) });
  const b = sessions.issue("b", result);
  const reference = sessions.resolve(a.token);
  now = 2_000;
  const rotated = sessions.rotate(reference.key, { ...restrictedResult, token: jwt(200) });
  assert.notEqual(rotated.token, a.token);
  assert.equal(rotated.expiresAt, 100_000);
  assert.throws(() => sessions.resolve(a.token), { status: 401 });
  assert.deepEqual(sessions.resolve(rotated.token).session, { tenantId: "a", upstreamToken: jwt(200), expiresAt: 100_000, nextStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" });
  assert.equal(sessions.resolve(b.token).session.tenantId, "b");
  const shorter = sessions.rotate(sessions.resolve(rotated.token).key, { ...result, token: jwt(3) });
  assert.equal(shorter.expiresAt, 3_000);
  assert.equal(sessions.resolve(shorter.token).session.nextStep, "DONE");
  const withoutExpiry = sessions.rotate(sessions.resolve(shorter.token).key, result);
  assert.equal(withoutExpiry.expiresAt, shorter.expiresAt);
  now = 3_000;
  assert.throws(() => sessions.resolve(withoutExpiry.token), { status: 401 });
});

test("expired or malformed upstream responses cannot replace an active session", () => {
  const sessions = new SessionManager(() => 2_000);
  const issued = sessions.issue("a", restrictedResult);
  const original = sessions.resolve(issued.token);
  for (const token of [jwt(2), jwt(-1), jwt("2"), "header.invalid.signature"]) {
    assert.throws(() => sessions.rotate(original.key, { ...result, token }));
    assert.deepEqual(sessions.resolve(issued.token), original);
    assert.throws(() => sessions.issue("b", { ...result, token }));
  }
});

test("revocation, expiry and a new gateway registry cannot resurrect sessions by rotation", () => {
  let now = 1_000;
  const sessions = new SessionManager(() => now);
  const first = sessions.issue("a", restrictedResult);
  const key = sessions.resolve(first.token).key;
  sessions.revoke(key);
  sessions.revoke(key);
  assert.throws(() => sessions.rotate(key, result), { status: 401 });
  const expired = sessions.issue("a", { ...restrictedResult, token: jwt(2) });
  const expiredKey = sessions.resolve(expired.token).key;
  now = 2_000;
  assert.throws(() => sessions.rotate(expiredKey, result), { status: 401 });
  const active = sessions.issue("a", result);
  assert.throws(() => new SessionManager(() => now).resolve(active.token), { status: 401 });
});

test("the 10000-session bound rejects new logins without eviction; rotation and capacity recovery still work", () => {
  let now = 1_000;
  const sessions = new SessionManager(() => now);
  const tokens: string[] = [];
  const expiresAt = 10 * 365 * day;
  for (let index = 0; index < MAX_SESSIONS; index++) {
    tokens.push(sessions.issue(`tenant-${index % 2}`, { ...(index === 0 ? restrictedResult : result), token: jwt(expiresAt / 1000) }).token);
  }
  const first = tokens[0]!;
  const last = tokens.at(-1)!;
  assert.throws(() => sessions.issue("overflow", result), { status: 503, code: "SESSION_CAPACITY_REACHED" });
  assert.equal(sessions.resolve(first).session.tenantId, "tenant-0");
  assert.equal(sessions.resolve(last).session.tenantId, "tenant-1");
  const rotated = sessions.rotate(sessions.resolve(first).key, result);
  assert.throws(() => sessions.resolve(first), { status: 401 });
  assert.equal(sessions.resolve(rotated.token).session.tenantId, "tenant-0");
  now += 8 * day;
  assert.throws(() => sessions.issue("overflow", result), { status: 503 });
  sessions.revoke(sessions.resolve(last).key);
  const replacement = sessions.issue("replacement", result);
  assert.equal(sessions.resolve(replacement.token).session.tenantId, "replacement");
  now = expiresAt;
  assert.equal(sessions.resolve(sessions.issue("fresh", result).token).session.tenantId, "fresh");
  assert.throws(() => sessions.resolve(rotated.token), { status: 401 });
  assert.equal(sessions.resolve(replacement.token).session.tenantId, "replacement");
});