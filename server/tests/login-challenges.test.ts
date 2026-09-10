import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { inspect } from "node:util";
import { LoginChallenges, LOGIN_CHALLENGE_TTL_MS, MAX_LOGIN_CHALLENGES, type PreparedLogin } from "../login-challenges";

const matches = (expiresAt = 200_000): PreparedLogin[] => [
  { tenantId: "a", grant: "a".repeat(43), expiresAt },
  { tenantId: "b", grant: "b".repeat(43), expiresAt },
];

test("challenges retain only SHA-256 keys and allowlisted grant fields, never credentials or session tokens", () => {
  const store = new LoginChallenges(() => 1000);
  const input = matches().map((match) => ({ ...match, password: "private-password", token: "private-access-token", username: "private-username" }));
  const first = store.issue(input);
  const second = store.issue(input);
  assert.match(first.challenge, /^qzc_[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first.challenge.slice(4), "base64url").length, 32);
  assert.notEqual(first.challenge, second.challenge);
  const snapshot = inspect(store, { depth: 10 });
  assert.ok(snapshot.includes(createHash("sha256").update(first.challenge).digest("hex")));
  assert.ok(!snapshot.includes(first.challenge));
  assert.doesNotMatch(snapshot, /private-password|private-access-token|private-username/);
  assert.deepEqual(store.consume(first.challenge, "b"), matches()[1]);
  assert.deepEqual(Object.keys(first).sort(), ["challenge", "expiresAt"]);
});

test("challenge expiry is capped at 120 seconds and the earliest upstream grant, including the exact boundary", () => {
  let now = 1000;
  const store = new LoginChallenges(() => now);
  const capped = store.issue(matches());
  assert.equal(Date.parse(capped.expiresAt), now + LOGIN_CHALLENGE_TTL_MS);
  const earlier = store.issue([matches()[0]!, { ...matches()[1]!, expiresAt: 5000 }]);
  assert.equal(Date.parse(earlier.expiresAt), 5000);
  now = 5000;
  assert.throws(() => store.consume(earlier.challenge, "a"), { status: 401, code: "UNAUTHORIZED" });
  now = Date.parse(capped.expiresAt);
  assert.throws(() => store.consume(capped.challenge, "b"), { status: 401, code: "UNAUTHORIZED" });
  assert.throws(() => store.issue(matches(now)), { status: 503, code: "LOGIN_DISCOVERY_UNAVAILABLE" });
});

test("consume is synchronous, irrevocable and binds the whole challenge to its original choices", () => {
  const store = new LoginChallenges(() => 1000);
  const issued = store.issue(matches());
  assert.throws(() => store.consume(issued.challenge, "configured-but-unmatched"), { status: 401, code: "UNAUTHORIZED" });
  assert.throws(() => store.consume(issued.challenge, "a"), { status: 401, code: "UNAUTHORIZED" });
  const valid = store.issue(matches());
  assert.equal(store.consume(valid.challenge, "a").tenantId, "a");
  for (const tenantId of ["a", "b", "unknown"]) assert.throws(() => store.consume(valid.challenge, tenantId), { status: 401, code: "UNAUTHORIZED" });
});

test("tampering, another gateway and malformed challenges never expose tenant existence", () => {
  const store = new LoginChallenges(() => 1000);
  const issued = store.issue(matches());
  const tampered = `${issued.challenge.slice(0, 4)}${issued.challenge[4] === "a" ? "b" : "a"}${issued.challenge.slice(5)}`;
  for (const challenge of [tampered, "qzc_short", "", `qzm_${"a".repeat(43)}`, `qzc_${"z".repeat(43)}`]) {
    for (const tenantId of ["a", "unknown"]) assert.throws(() => store.consume(challenge, tenantId), { status: 401, code: "UNAUTHORIZED" });
  }
  assert.throws(() => new LoginChallenges(() => 1000).consume(issued.challenge, "a"), { status: 401 });
  assert.equal(store.consume(issued.challenge, "b").tenantId, "b");
});

test("challenge choices are immutable snapshots, not mutable caller references", () => {
  const store = new LoginChallenges(() => 1000);
  const input = matches();
  const issued = store.issue(input);
  input.splice(0, input.length, { tenantId: "attacker", grant: "stolen", expiresAt: 999_999 });
  const selected = store.consume(issued.challenge, "a");
  assert.deepEqual(selected, matches()[0]);
  assert.equal(Object.isFrozen(selected), true);
});

test("1000 outstanding challenges fail closed without eviction, then recover after consumption or TTL purge", () => {
  let now = 1000;
  const store = new LoginChallenges(() => now);
  const challenges = Array.from({ length: MAX_LOGIN_CHALLENGES }, () => store.issue(matches()).challenge);
  assert.throws(() => store.issue(matches()), { status: 503, code: "LOGIN_DISCOVERY_UNAVAILABLE" });
  assert.equal(store.consume(challenges[0]!, "a").tenantId, "a");
  const replacement = store.issue(matches());
  assert.throws(() => store.issue(matches()), { status: 503 });
  now += LOGIN_CHALLENGE_TTL_MS;
  store.purge();
  assert.throws(() => store.consume(replacement.challenge, "a"), { status: 401 });
  assert.throws(() => store.consume(challenges.at(-1)!, "b"), { status: 401 });
  assert.match(store.issue(matches(now + 1000)).challenge, /^qzc_/);
});