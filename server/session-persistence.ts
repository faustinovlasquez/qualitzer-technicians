import childProcess from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { z } from "zod";
import { decodeSessionSecret, readMigrationTenants, type ResolvedConfig, type TenantConfig } from "./config";
import { parseSessionSnapshot, type ISessionPersistence, type SessionReference } from "./sessions";
import { backendBindingsSchema, type TenantRegistry } from "./tenants";

export type { ISessionPersistence } from "./sessions";

const header = Buffer.from("QZMS1");
const ivLength = 12;
const tagLength = 16;
const maximumFileBytes = 96 * 1024 * 1024;
const legacyPayloadSchema = z.object({
  version: z.literal(1),
  routingFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sessions: z.unknown(),
}).strict();
const payloadSchema = z.discriminatedUnion("version", [legacyPayloadSchema, z.object({
  version: z.literal(2),
  backendUrl: z.string(),
  bindings: backendBindingsSchema,
  sessions: z.unknown(),
}).strict()]);

export interface BackendPersistenceOptions {
  registry: TenantRegistry;
  legacyMigrationTenants?: () => readonly TenantConfig[];
}

export function sessionRoutingFingerprint(tenants: readonly TenantConfig[]): string {
  const routes = tenants.map(({ id, backendUrl, tenantOrigin }) => [id, backendUrl, tenantOrigin]);
  routes.sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return createHash("sha256").update(JSON.stringify(routes)).digest("hex");
}

function exists(file: string): boolean {
  try { fs.lstatSync(file); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw new Error("SESSION_PERSISTENCE_UNREADABLE");
  }
}

function windowsPermissions(file: string, directory: boolean): void {
  const commands = directory ? [
    [file, "/reset"],
    [file, "/inheritance:r", "/grant:r", `${userInfo().username}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"],
  ] : [[file, "/reset"]];
  for (const args of commands) {
    const result = childProcess.spawnSync("icacls.exe", args, { shell: false, windowsHide: true, encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error("SESSION_PERSISTENCE_PERMISSIONS_ERROR");
  }
}

function protect(file: string, directory = false): void {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw new Error();
    if (process.platform === "win32") windowsPermissions(file, directory);
    else {
      const mode = directory ? 0o700 : 0o600;
      fs.chmodSync(file, mode);
      if ((fs.statSync(file).mode & 0o777) !== mode) throw new Error();
    }
  } catch { throw new Error("SESSION_PERSISTENCE_PERMISSIONS_ERROR"); }
}

function prepareDirectory(file: string): void {
  const directory = dirname(file);
  if (directory === parse(directory).root || directory === resolve(__dirname, "..") || directory === resolve(process.cwd())) {
    throw new Error("SESSION_PERSISTENCE_REQUIRES_PRIVATE_DIRECTORY");
  }
  try { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  catch { throw new Error("SESSION_PERSISTENCE_UNAVAILABLE"); }
  protect(directory, true);
}

function syncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeExclusive(file: string, data: Buffer): void {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    protect(file);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function developmentKey(file: string): Buffer {
  const keyFile = join(dirname(file), "session.key");
  try {
    if (!exists(keyFile)) {
      if (exists(file)) throw new Error();
      writeExclusive(keyFile, randomBytes(32));
      syncDirectory(dirname(file));
    }
    protect(keyFile);
    if (fs.statSync(keyFile).size !== 32) throw new Error();
    const key = fs.readFileSync(keyFile);
    if (key.length !== 32) throw new Error();
    return key;
  } catch { throw new Error("SESSION_PERSISTENCE_KEY_UNAVAILABLE"); }
}

export class EncryptedFileSessionPersistence implements ISessionPersistence {
  readonly #key: Buffer;
  private readonly file: string;
  private readonly routingFingerprint: string;
  private readonly tenantIds: Set<string>;
  private unavailable = false;

  constructor(file: string, key: Buffer, tenants: readonly TenantConfig[], private readonly backend?: BackendPersistenceOptions) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("GATEWAY_SESSION_SECRET_INVALID");
    this.#key = Buffer.from(key);
    this.file = resolve(file);
    if (/^session\.key[. ]*$/i.test(basename(this.file))) throw new Error("GATEWAY_SESSION_FILE_INVALID");
    this.routingFingerprint = sessionRoutingFingerprint(tenants);
    this.tenantIds = new Set(tenants.map(({ id }) => id));
    prepareDirectory(this.file);
    if (exists(this.markerFile)) throw new Error("SESSION_PERSISTENCE_UNAVAILABLE");
  }

  private get markerFile(): string { return `${this.file}.unavailable`; }

  load(): readonly SessionReference[] {
    if (this.unavailable || exists(this.markerFile)) throw new Error("SESSION_PERSISTENCE_UNAVAILABLE");
    if (!exists(this.file)) return [];
    let encrypted: Buffer;
    try {
      protect(this.file);
      if (fs.statSync(this.file).size > maximumFileBytes) throw new Error();
      encrypted = fs.readFileSync(this.file);
    } catch { throw new Error("SESSION_PERSISTENCE_UNREADABLE"); }
    let payload: z.infer<typeof payloadSchema>;
    try {
      if (encrypted.length <= header.length + ivLength + tagLength || !encrypted.subarray(0, header.length).equals(header)) throw new Error();
      const ivEnd = header.length + ivLength;
      const tagEnd = ivEnd + tagLength;
      const decipher = createDecipheriv("aes-256-gcm", this.#key, encrypted.subarray(header.length, ivEnd));
      decipher.setAAD(header);
      decipher.setAuthTag(encrypted.subarray(ivEnd, tagEnd));
      const plaintext = Buffer.concat([decipher.update(encrypted.subarray(tagEnd)), decipher.final()]);
      const data: unknown = JSON.parse(plaintext.toString("utf8"));
      payload = payloadSchema.parse(data);
    } catch { throw new Error("SESSION_PERSISTENCE_INVALID"); }
    if (this.backend) {
      const { registry } = this.backend;
      if (payload.version === 1) {
        const legacyTenants = (this.backend.legacyMigrationTenants ?? readMigrationTenants)();
        if (payload.routingFingerprint !== sessionRoutingFingerprint(legacyTenants)) throw new Error("SESSION_MIGRATION_ROUTING_FINGERPRINT_MISMATCH");
        const previous = parseSessionSnapshot(payload.sessions);
        if (previous.some(({ session }) => session.routeKey !== undefined || !legacyTenants.some(({ id }) => id === session.tenantId))) throw new Error("SESSION_MIGRATION_ROUTING_FINGERPRINT_MISMATCH");
        registry.migrateLegacyBindings(legacyTenants);
        const migrated = previous.map(({ key, session }): SessionReference => ({ key, session: { ...session, routeKey: registry.bindingKey(session.tenantId) } }));
        this.save(migrated);
        return migrated;
      }
      if (payload.backendUrl !== registry.backend?.backendUrl) throw new Error("SESSION_PERSISTENCE_ROUTING_MISMATCH");
      registry.restoreBackendBindings(payload.bindings);
      const sessions = parseSessionSnapshot(payload.sessions);
      const active = sessions.filter(({ session }) => session.routeKey !== undefined && session.routeKey === registry.bindingKey(session.tenantId));
      if (active.length !== sessions.length) this.save(active);
      return active;
    }
    if (payload.version !== 1 || payload.routingFingerprint !== this.routingFingerprint) throw new Error("SESSION_PERSISTENCE_ROUTING_MISMATCH");
    return this.validateSessions(payload.sessions);
  }

  save(sessions: readonly SessionReference[]): void {
    if (this.unavailable || exists(this.markerFile)) throw new Error("SESSION_PERSISTENCE_UNAVAILABLE");
    const snapshot = this.validateSessions(sessions);
    const temporary = `${this.file}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      writeExclusive(this.markerFile, Buffer.from("QZMS1_PENDING"));
      syncDirectory(dirname(this.file));
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
      cipher.setAAD(header);
      const payload = this.backend ? {
        version: 2, backendUrl: this.backend.registry.backend!.backendUrl,
        bindings: this.backend.registry.snapshotBackendBindings(), sessions: snapshot,
      } : { version: 1, routingFingerprint: this.routingFingerprint, sessions: snapshot };
      const plaintext = Buffer.from(JSON.stringify(payload));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      writeExclusive(temporary, Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]));
      fs.renameSync(temporary, this.file);
      syncDirectory(dirname(this.file));
      fs.unlinkSync(this.markerFile);
      syncDirectory(dirname(this.file));
    } catch {
      this.unavailable = true;
      try {
        if (!exists(this.markerFile)) writeExclusive(this.markerFile, Buffer.from("QZMS1_PENDING"));
        syncDirectory(dirname(this.file));
      } catch {}
      try { fs.unlinkSync(temporary); } catch {}
      throw new Error("SESSION_PERSISTENCE_UNAVAILABLE");
    }
  }

  private validateSessions(input: unknown): SessionReference[] {
    const sessions = parseSessionSnapshot(input);
    if (sessions.some(({ session }) => this.backend
      ? !session.routeKey || session.routeKey !== this.backend.registry.bindingKey(session.tenantId)
      : !this.tenantIds.has(session.tenantId))) throw new Error("SESSION_PERSISTENCE_ROUTING_MISMATCH");
    return sessions;
  }
}

export function createSessionPersistence(config: ResolvedConfig, backend?: BackendPersistenceOptions): ISessionPersistence | undefined {
  if (config.tenantResolution === "backend" && !backend) throw new Error("BACKEND_BOOTSTRAP_REQUIRED");
  if (config.environment === "test" || config.sessionFile === undefined) return undefined;
  const file = resolve(config.sessionFile);
  if (/^session\.key[. ]*$/i.test(basename(file))) throw new Error("GATEWAY_SESSION_FILE_INVALID");
  if (config.environment === "production" && config.sessionSecret === undefined) throw new Error("GATEWAY_SESSION_SECRET_REQUIRED");
  prepareDirectory(file);
  if (exists(`${file}.unavailable`)) throw new Error("SESSION_PERSISTENCE_UNAVAILABLE");
  const key = config.sessionSecret === undefined ? developmentKey(file) : decodeSessionSecret(config.sessionSecret);
  return new EncryptedFileSessionPersistence(file, key, config.tenants, backend);
}

const embeddedWriters = new Set<() => void>();
let embeddedExitRegistered = false;

function assertPrivateEmbeddedPath(file: string, directory: boolean): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
    throw new Error("SESSION_PERSISTENCE_REQUIRES_PRIVATE_DIRECTORY");
  }
  if (process.platform !== "win32" && ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600) || stat.uid !== process.getuid?.())) {
    throw new Error("SESSION_PERSISTENCE_PERMISSIONS_ERROR");
  }
  if (process.platform === "win32") {
    const script = "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:QZ_PRIVATE_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); foreach($rule in $rules){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid -and $rule.IdentityReference.Value -ne 'S-1-5-18'){exit 1}}; exit 0";
    const result = childProcess.spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
      shell: false, windowsHide: true, stdio: "ignore", env: { ...process.env, QZ_PRIVATE_PATH: file },
    });
    if (result.error || result.status !== 0) throw new Error("SESSION_PERSISTENCE_PERMISSIONS_ERROR");
  }
}

export function prepareEmbeddedSessionStorage(sessionFile: string) {
  const file = resolve(sessionFile);
  const directory = dirname(file);
  if (/^(?:session\.key|\.writer\.lock)[. ]*$/i.test(basename(file))) throw new Error("GATEWAY_SESSION_FILE_INVALID");
  for (let ancestor = directory; ; ancestor = dirname(ancestor)) {
    if (exists(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw new Error("SESSION_PERSISTENCE_REQUIRES_PRIVATE_DIRECTORY");
    if (ancestor === dirname(ancestor)) break;
  }
  if (exists(directory)) assertPrivateEmbeddedPath(directory, true);
  prepareDirectory(file);
  const keyFile = join(directory, "session.key");
  for (const candidate of [file, keyFile]) if (exists(candidate)) assertPrivateEmbeddedPath(candidate, false);
  if (exists(`${file}.unavailable`)) throw new Error("SESSION_PERSISTENCE_UNAVAILABLE");
  const lockFile = join(directory, ".writer.lock");
  const owner = Buffer.from(JSON.stringify({ pid: process.pid, nonce: randomBytes(16).toString("hex") }));
  try { writeExclusive(lockFile, owner); }
  catch { throw new Error("SESSION_PERSISTENCE_WRITER_EXISTS"); }
  let released = false;
  let key: Buffer | undefined;
  const release = (): void => {
    if (released) return;
    released = true;
    key?.fill(0);
    embeddedWriters.delete(release);
    try {
      if (fs.readFileSync(lockFile).equals(owner)) { fs.unlinkSync(lockFile); syncDirectory(directory); }
    } catch {}
  };
  try {
    syncDirectory(directory);
    if (!exists(keyFile)) {
      if (exists(file)) throw new Error("SESSION_PERSISTENCE_KEY_UNAVAILABLE");
      const temporary = join(directory, `.session-key-${randomBytes(12).toString("hex")}.tmp`);
      try {
        writeExclusive(temporary, randomBytes(32));
        fs.linkSync(temporary, keyFile);
      } finally {
        if (exists(temporary)) fs.unlinkSync(temporary);
      }
      syncDirectory(directory);
    }
    assertPrivateEmbeddedPath(keyFile, false);
    protect(keyFile);
    if (fs.statSync(keyFile).size !== 32) throw new Error("SESSION_PERSISTENCE_KEY_UNAVAILABLE");
    key = fs.readFileSync(keyFile);
    if (key.length !== 32) throw new Error("SESSION_PERSISTENCE_KEY_UNAVAILABLE");
    embeddedWriters.add(release);
    if (!embeddedExitRegistered) {
      process.once("exit", () => { for (const close of embeddedWriters) close(); });
      embeddedExitRegistered = true;
    }
    return {
      createPersistence(backend: BackendPersistenceOptions): ISessionPersistence {
        if (released || !key) throw new Error("SESSION_PERSISTENCE_UNAVAILABLE");
        const persistence = new EncryptedFileSessionPersistence(file, key, [], backend);
        key.fill(0);
        key = undefined;
        return persistence;
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}