import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, parse, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { inspect } from "node:util";
import type { LoginResult } from "../../src/domain/models";
import { resolveConfig, type TenantConfig } from "../config";
import { createSessionPersistence, EncryptedFileSessionPersistence, sessionRoutingFingerprint } from "../session-persistence";
import { MAX_SESSIONS, SessionManager, type ISessionPersistence, type SessionReference } from "../sessions";

const tenants: TenantConfig[] = [
  { id: "a", name: "First", backendUrl: "http://first.invalid/api", tenantOrigin: "http://first.invalid", environment: "development", enabled: true },
  { id: "b", name: "Second", backendUrl: "http://second.invalid/api", tenantOrigin: "http://second.invalid", environment: "development", enabled: true },
];
const login: LoginResult = { token: "private-upstream-token", username: "test", email: "test@example.invalid", nextStep: "DONE" };
const jwt = (exp: number): string => `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
const day = 24 * 60 * 60 * 1000;

function fixture(context: TestContext) {
  const directory = fs.mkdtempSync(join(tmpdir(), "qzm-persistence-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "sessions.enc");
  const key = Buffer.alloc(32, 71);
  const storage = () => new EncryptedFileSessionPersistence(file, key, tenants);
  return { directory, file, key, storage };
}

function encryptedPayload(data: unknown, key: Buffer): Buffer {
  const header = Buffer.from("QZMS1");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}

function plaintext(encrypted: Buffer, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(5, 17));
  decipher.setAAD(encrypted.subarray(0, 5));
  decipher.setAuthTag(encrypted.subarray(17, 33));
  return Buffer.concat([decipher.update(encrypted.subarray(33)), decipher.final()]).toString("utf8");
}

class MemoryPersistence implements ISessionPersistence {
  snapshot: readonly SessionReference[] = [];
  writes = 0;
  fail = false;
  load(): readonly SessionReference[] { return structuredClone(this.snapshot); }
  save(snapshot: readonly SessionReference[]): void {
    if (this.fail) throw new Error("sensitive-disk-details");
    this.snapshot = structuredClone(snapshot);
    this.writes++;
  }
}

test("restart reuses opaque tokens beyond seven days with exact tenant, upstream token and restricted state", (context) => {
  const { storage } = fixture(context);
  let now = 1_000;
  const sessions = new SessionManager(() => now, storage());
  const upstream = { ...login, token: jwt(10 * 365 * day / 1000) };
  const first = sessions.issue("a", upstream);
  const second = sessions.issue("b", { ...upstream, nextStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" });
  const timeless = sessions.issue("a", login);
  const expected = [first, second, timeless].map(({ token }) => sessions.resolve(token));
  now += 8 * day;
  const restarted = new SessionManager(() => now, storage());
  for (const [index, issued] of [first, second, timeless].entries()) assert.deepEqual(restarted.resolve(issued.token), expected[index]);
  assert.equal(Object.isFrozen(restarted.resolve(first.token).session), true);
  assert.equal(restarted.resolve(timeless.token).session.expiresAt, Number.MAX_SAFE_INTEGER);
  now = first.expiresAt;
  assert.throws(() => restarted.resolve(first.token), { status: 401 });
  assert.throws(() => new SessionManager(() => now, storage()).resolve(second.token), { status: 401 });
  assert.equal(new SessionManager(() => now, storage()).resolve(timeless.token).session.tenantId, "a");
});

test("successful rotation and logout remain revoked on every subsequent restart", (context) => {
  const { file, storage } = fixture(context);
  const sessions = new SessionManager(() => 1_000, storage());
  const issued = sessions.issue("a", { ...login, token: jwt(100), nextStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" });
  const oldKey = sessions.resolve(issued.token).key;
  const rotated = sessions.rotate(oldKey, { ...login, token: jwt(200) });
  const restarted = new SessionManager(() => 2_000, storage());
  assert.throws(() => restarted.resolve(issued.token), { status: 401 });
  assert.throws(() => restarted.rotate(oldKey, login), { status: 401 });
  assert.equal(restarted.resolve(rotated.token).session.expiresAt, 100_000);
  const key = restarted.resolve(rotated.token).key;
  restarted.revoke(key);
  const afterLogout = fs.readFileSync(file);
  restarted.revoke(key);
  assert.deepEqual(fs.readFileSync(file), afterLogout);
  const afterRestart = new SessionManager(() => 2_000, storage());
  assert.throws(() => afterRestart.resolve(rotated.token), { status: 401 });
  assert.throws(() => afterRestart.rotate(key, login), { status: 401 });
  assert.deepEqual(storage().load(), []);
});

test("expired persisted sessions are purged once on load; active reads do not rewrite the file", (context) => {
  const { file, storage } = fixture(context);
  const original = new SessionManager(() => 1_000, storage());
  const short = original.issue("a", { ...login, token: jwt(2) });
  const active = original.issue("b", login);
  const before = fs.readFileSync(file);
  const restarted = new SessionManager(() => 2_000, storage());
  assert.throws(() => restarted.resolve(short.token), { status: 401 });
  const after = fs.readFileSync(file);
  assert.notDeepEqual(before, after);
  for (let index = 0; index < 10; index++) {
    restarted.resolve(active.token);
    restarted.requireKey(restarted.resolve(active.token).key);
    restarted.purge();
  }
  new SessionManager(() => 2_000, storage());
  assert.deepEqual(fs.readFileSync(file), after);
  assert.equal(storage().load().length, 1);
});

test("disk is authenticated ciphertext; decrypted payload contains only the opaque SHA-256 key and encrypted upstream credentials", (context) => {
  const { directory, file, key, storage } = fixture(context);
  const store = storage();
  const sessions = new SessionManager(() => 1_000, store);
  const issued = sessions.issue("a", login);
  const reference = sessions.resolve(issued.token);
  const bytes = fs.readFileSync(file);
  for (const secret of [issued.token, reference.key, login.token, tenants[0]!.backendUrl]) assert.equal(bytes.includes(Buffer.from(secret)), false);
  const decoded = plaintext(bytes, key);
  assert.equal(decoded.includes(issued.token), false);
  assert.equal(reference.key, createHash("sha256").update(issued.token).digest("hex"));
  assert.deepEqual(JSON.parse(decoded), { version: 1, routingFingerprint: sessionRoutingFingerprint(tenants), sessions: [reference] });
  store.save(store.load());
  const replacement = fs.readFileSync(file);
  assert.notDeepEqual(replacement, bytes);
  assert.notDeepEqual(replacement.subarray(5, 17), bytes.subarray(5, 17));
  assert.equal(plaintext(replacement, key), decoded);
  assert.deepEqual(fs.readdirSync(directory), ["sessions.enc"]);
  assert.equal(inspect(store).includes(key.toString("hex")), false);
});

test("routing fingerprint is order-independent and rejects rebinding IDs, backend URLs or tenant origins", (context) => {
  const { file, key, storage } = fixture(context);
  const sessions = new SessionManager(() => 1_000, storage());
  const issued = sessions.issue("a", login);
  const reordered = [...tenants].reverse().map((tenant) => ({ ...tenant, name: "Renamed" }));
  assert.equal(sessionRoutingFingerprint(tenants), sessionRoutingFingerprint(reordered));
  assert.equal(new SessionManager(() => 1_000, new EncryptedFileSessionPersistence(file, key, reordered)).resolve(issued.token).session.tenantId, "a");
  for (const change of [{ id: "replacement" }, { backendUrl: "http://other.invalid/api" }, { tenantOrigin: "http://other.invalid" }]) {
    const routes = tenants.map((tenant, index) => index === 0 ? { ...tenant, ...change } : tenant);
    assert.throws(() => new SessionManager(() => 1_000, new EncryptedFileSessionPersistence(file, key, routes)), { message: "SESSION_PERSISTENCE_ROUTING_MISMATCH" });
  }
  assert.throws(() => new SessionManager(() => 1_000, new EncryptedFileSessionPersistence(file, key, tenants.slice(1))), { message: "SESSION_PERSISTENCE_ROUTING_MISMATCH" });
});

test("wrong keys, modified authentication tags, ciphertext, headers and truncated files fail startup without discarding data", (context) => {
  const { file, key, storage } = fixture(context);
  new SessionManager(() => 1_000, storage()).issue("a", login);
  const original = fs.readFileSync(file);
  assert.throws(() => new SessionManager(() => 1_000, new EncryptedFileSessionPersistence(file, Buffer.alloc(32, 99), tenants)), { message: "SESSION_PERSISTENCE_INVALID" });
  const modified = [0, 5, 17, original.length - 1].map((index) => {
    const bytes = Buffer.from(original);
    bytes[index] = bytes[index]! ^ 1;
    return bytes;
  });
  for (const bytes of [Buffer.alloc(0), Buffer.from("{broken plaintext"), original.subarray(0, 32), original.subarray(0, -1), ...modified]) {
    fs.writeFileSync(file, bytes);
    assert.throws(() => new SessionManager(() => 1_000, storage()), { message: "SESSION_PERSISTENCE_INVALID" });
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  fs.writeFileSync(file, original);
  assert.equal(storage().load().length, 1);
  assert.deepEqual(key, Buffer.alloc(32, 71));
});

test("authenticated but invalid payloads cannot introduce duplicates, raw mobile tokens, extended expiry or unsupported versions", (context) => {
  const { file, key, storage } = fixture(context);
  const sessions = new SessionManager(() => 1_000, storage());
  const issued = sessions.issue("a", { ...login, token: jwt(2) });
  const reference = sessions.resolve(issued.token);
  const payload = { version: 1, routingFingerprint: sessionRoutingFingerprint(tenants), sessions: [reference] };
  for (const data of [
    {}, { ...payload, version: 2 }, { ...payload, extra: true }, { ...payload, sessions: [reference, reference] },
    { ...payload, sessions: [{ ...reference, key: issued.token }] },
    { ...payload, sessions: [{ ...reference, session: { ...reference.session, expiresAt: 2_001 } }] },
    { ...payload, sessions: [{ ...reference, session: { ...reference.session, upstreamToken: "header.invalid.signature" } }] },
    { ...payload, sessions: [{ ...reference, session: { ...reference.session, nextStep: "SKIP_SECURITY" } }] },
    { ...payload, sessions: Array.from({ length: MAX_SESSIONS + 1 }, () => reference) },
  ]) {
    fs.writeFileSync(file, encryptedPayload(data, key));
    assert.throws(() => new SessionManager(() => 1_000, storage()), { message: "SESSION_PERSISTENCE_INVALID" });
  }
  fs.writeFileSync(file, encryptedPayload({ ...payload, sessions: [{ ...reference, session: { ...reference.session, tenantId: "not-configured" } }] }, key));
  assert.throws(() => new SessionManager(() => 1_000, storage()), { message: "SESSION_PERSISTENCE_ROUTING_MISMATCH" });
});

test("the file store copies a provided 32-byte key and rejects incorrect lengths without leaking bytes", (context) => {
  const { file, key } = fixture(context);
  for (const length of [0, 16, 31, 33, 64]) {
    assert.throws(() => new EncryptedFileSessionPersistence(file, Buffer.alloc(length), tenants), { message: "GATEWAY_SESSION_SECRET_INVALID" });
  }
  const original = Buffer.from(key);
  const store = new EncryptedFileSessionPersistence(file, key, tenants);
  key.fill(0);
  const issued = new SessionManager(() => 1_000, store).issue("a", login);
  assert.equal(new SessionManager(() => 1_000, new EncryptedFileSessionPersistence(file, original, tenants)).resolve(issued.token).session.upstreamToken, login.token);
});

test("development generates and reuses a private 32-byte key covered by the existing Git exclusion", (context) => {
  const { directory, file } = fixture(context);
  const config = resolveConfig({ tenants, environment: "development", sessionFile: file });
  const sessions = new SessionManager(() => 1_000, createSessionPersistence(config));
  const issued = sessions.issue("a", login);
  const keyFile = join(directory, "session.key");
  const key = fs.readFileSync(keyFile);
  assert.equal(key.length, 32);
  const restarted = new SessionManager(() => 1_000, createSessionPersistence(config));
  assert.equal(restarted.resolve(issued.token).session.upstreamToken, login.token);
  assert.deepEqual(fs.readFileSync(keyFile), key);
  assert.match(fs.readFileSync(resolve(__dirname, "../../.gitignore"), "utf8"), /^\*\.key$/m);
  if (process.platform !== "win32") {
    for (const privateFile of [keyFile, file]) assert.equal(fs.statSync(privateFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  }
});

test("missing or corrupt development keys fail closed without generating a replacement over existing sessions", (context) => {
  const { directory, file } = fixture(context);
  const config = resolveConfig({ tenants, sessionFile: file });
  new SessionManager(() => 1_000, createSessionPersistence(config)).issue("a", login);
  const keyFile = join(directory, "session.key");
  const encrypted = fs.readFileSync(file);
  fs.unlinkSync(keyFile);
  assert.throws(() => createSessionPersistence(config), { message: "SESSION_PERSISTENCE_KEY_UNAVAILABLE" });
  assert.equal(fs.existsSync(keyFile), false);
  fs.writeFileSync(keyFile, Buffer.alloc(31));
  assert.throws(() => createSessionPersistence(config), { message: "SESSION_PERSISTENCE_KEY_UNAVAILABLE" });
  assert.equal(fs.readFileSync(keyFile).length, 31);
  assert.deepEqual(fs.readFileSync(file), encrypted);
});

test("a configured session file cannot overwrite the development key, including Windows aliases", (context) => {
  const { directory, key } = fixture(context);
  for (const name of ["session.key", "SESSION.KEY", "Session.key."]) {
    const file = join(directory, name);
    assert.throws(() => new EncryptedFileSessionPersistence(file, key, tenants), { message: "GATEWAY_SESSION_FILE_INVALID" });
    assert.throws(() => createSessionPersistence(resolveConfig({ tenants, sessionFile: file })), { message: "GATEWAY_SESSION_FILE_INVALID" });
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("production uses only the supplied secret and never creates a development key", (context) => {
  const { directory, file, key } = fixture(context);
  const config = resolveConfig({
    environment: "production", tenants: tenants.map((tenant) => ({ ...tenant, backendUrl: tenant.backendUrl.replace("http:", "https:"), tenantOrigin: tenant.tenantOrigin.replace("http:", "https:"), environment: "production" })),
    corsOrigins: ["https://mobile.invalid"], trustedProxyIps: ["127.0.0.1"], sessionFile: file,
  });
  assert.throws(() => createSessionPersistence(config), { message: "GATEWAY_SESSION_SECRET_REQUIRED" });
  const secured = resolveConfig({ ...config, sessionSecret: key.toString("base64url") });
  const issued = new SessionManager(() => 1_000, createSessionPersistence(secured)).issue("a", login);
  assert.equal(new SessionManager(() => 1_000, createSessionPersistence(secured)).resolve(issued.token).session.tenantId, "a");
  assert.equal(fs.existsSync(join(directory, "session.key")), false);
});

test("POSIX storage repairs broad modes and rejects symlinks rather than modifying their targets", { skip: process.platform === "win32" }, (context) => {
  const { directory, file, storage } = fixture(context);
  new SessionManager(() => 1_000, storage()).issue("a", login);
  fs.chmodSync(directory, 0o755);
  fs.chmodSync(file, 0o644);
  storage().load();
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const target = join(directory, "target");
  fs.renameSync(file, target);
  fs.symlinkSync(target, file);
  assert.throws(() => storage().load(), { message: "SESSION_PERSISTENCE_UNREADABLE" });
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});

test("Windows storage removes inherited and explicit broad ACLs and uses current user plus SYSTEM without a shell", { skip: process.platform !== "win32" }, (context) => {
  const { directory, file } = fixture(context);
  const original = childProcess.spawnSync;
  const calls: { command: string; args: readonly string[]; shell: boolean | string | undefined }[] = [];
  context.mock.method(childProcess, "spawnSync", (command: string, args: readonly string[], options: childProcess.SpawnSyncOptionsWithStringEncoding) => {
    calls.push({ command, args, shell: options.shell });
    return original(command, args, options);
  });
  const config = resolveConfig({ tenants, sessionFile: file });
  new SessionManager(() => 1_000, createSessionPersistence(config)).issue("a", login);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(({ command, shell }) => command === "icacls.exe" && shell === false));
  assert.ok(calls.some(({ args }) => args[0] === directory && args.includes("/reset")));
  assert.ok(calls.some(({ args }) => args[0] === directory && args.includes("/inheritance:r") && args.includes(`${userInfo().username}:(OI)(CI)F`) && args.includes("*S-1-5-18:(OI)(CI)F")));
  assert.ok(calls.some(({ args }) => args[0] === join(directory, "session.key") && args.includes("/reset")));
});

test("Windows ACL failures abort storage setup with sanitized errors instead of relying on ineffective 0600", { skip: process.platform !== "win32" }, (context) => {
  const { directory, file, key } = fixture(context);
  context.mock.method(childProcess, "spawnSync", () => { throw new Error("private-acl-output"); });
  assert.throws(() => new EncryptedFileSessionPersistence(file, key, tenants), { message: "SESSION_PERSISTENCE_PERMISSIONS_ERROR" });
  assert.deepEqual(fs.readdirSync(directory), []);
});

for (const operation of ["issue", "rotate"] as const) {
  test(`failed ${operation} does not commit its snapshot or return success and disables the manager`, () => {
    const persistence = new MemoryPersistence();
    const sessions = new SessionManager(() => 1_000, persistence);
    const issued = sessions.issue("a", login);
    const reference = sessions.resolve(issued.token);
    const previous = structuredClone(persistence.snapshot);
    persistence.fail = true;
    assert.throws(() => operation === "issue" ? sessions.issue("b", login) : sessions.rotate(reference.key, login), { status: 503, code: "SESSION_PERSISTENCE_UNAVAILABLE" });
    assert.deepEqual(persistence.snapshot, previous);
    assert.throws(() => sessions.resolve(issued.token), { status: 503 });
    assert.throws(() => sessions.issue("b", login), { status: 503 });
    persistence.fail = false;
    const restarted = new SessionManager(() => 1_000, persistence);
    assert.deepEqual(restarted.resolve(issued.token), reference);
    assert.equal(persistence.writes, 1);
  });
}

test("failed revoke keeps all access denied, does not confirm logout, and cannot be retried as an in-memory success", () => {
  const persistence = new MemoryPersistence();
  const sessions = new SessionManager(() => 1_000, persistence);
  const issued = sessions.issue("a", login);
  const key = sessions.resolve(issued.token).key;
  persistence.fail = true;
  assert.throws(() => sessions.revoke(key), { status: 503, code: "SESSION_PERSISTENCE_UNAVAILABLE" });
  for (const action of [() => sessions.resolve(issued.token), () => sessions.requireKey(key), () => sessions.rotate(key, login), () => sessions.revoke(key), () => sessions.purge()]) {
    assert.throws(action, { status: 503, code: "SESSION_PERSISTENCE_UNAVAILABLE" });
  }
});

for (const operation of ["issue", "rotate", "revoke"] as const) {
  test(`atomic ${operation} rename failure keeps the prior encrypted file and blocks resurrection on restart`, (context) => {
    const { directory, file, storage } = fixture(context);
    const sessions = new SessionManager(() => 1_000, storage());
    const issued = sessions.issue("a", login);
    const key = sessions.resolve(issued.token).key;
    const before = fs.readFileSync(file);
    const rename = context.mock.method(fs, "renameSync", () => { throw new Error("sensitive-filesystem-failure"); });
    assert.throws(() => {
      if (operation === "issue") sessions.issue("b", login);
      else if (operation === "rotate") sessions.rotate(key, login);
      else sessions.revoke(key);
    }, { status: 503, code: "SESSION_PERSISTENCE_UNAVAILABLE" });
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.existsSync(`${file}.unavailable`), true);
    assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".tmp")), false);
    assert.throws(() => sessions.resolve(issued.token), { status: 503 });
    rename.mock.restore();
    assert.throws(() => new SessionManager(() => 1_000, storage()), { message: "SESSION_PERSISTENCE_UNAVAILABLE" });
    assert.throws(() => createSessionPersistence(resolveConfig({ tenants, sessionFile: file })), { message: "SESSION_PERSISTENCE_UNAVAILABLE" });
    if (process.platform !== "win32") assert.equal(fs.statSync(`${file}.unavailable`).mode & 0o777, 0o600);
  });
}

test("purge persistence failure aborts startup rather than accepting stale expired state", () => {
  const persistence = new MemoryPersistence();
  const sessions = new SessionManager(() => 1_000, persistence);
  sessions.issue("a", { ...login, token: jwt(2) });
  persistence.fail = true;
  assert.throws(() => new SessionManager(() => 2_000, persistence), { status: 503, code: "SESSION_PERSISTENCE_UNAVAILABLE" });
  persistence.fail = false;
  new SessionManager(() => 2_000, persistence);
  assert.deepEqual(persistence.snapshot, []);
});

test("storage must not apply private-directory permissions to the repository or a filesystem root", (context) => {
  const { file, key } = fixture(context);
  for (const unsafeFile of [resolve(__dirname, "../../sessions.enc"), join(parse(file).root, "sessions.enc")]) {
    assert.throws(() => new EncryptedFileSessionPersistence(unsafeFile, key, tenants), { message: "SESSION_PERSISTENCE_REQUIRES_PRIVATE_DIRECTORY" });
  }
});