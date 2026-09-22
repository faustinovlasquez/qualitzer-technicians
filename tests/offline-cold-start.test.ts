import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Session, User } from "../src/domain/models";
import type { StoredSession } from "../src/infrastructure/sessionStorage";
import { ApiError, NetworkError } from "../src/infrastructure/errors";
import * as tenantSession from "../src/domain/tenantSession";
import * as gatewayPolicy from "../config/gatewayPolicy";
import { OfflineTechnicianRepository } from "../src/offline/OfflineTechnicianRepository";
import * as offlineState from "../src/offline/state";
import { assignmentsWithStep, MemoryFiles, uuid, user } from "../src/offline/tests/fakes";
import { agendaFixture } from "./helpers/agenda-load-lifecycle";
import { loadSource } from "./helpers/tenant-challenge";

interface ISqliteTestDatabase {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    get(...params: Array<string | number>): unknown;
    all(): unknown[];
    run(...params: Array<string | number>): unknown;
  };
}
const { DatabaseSync }: { DatabaseSync: new (path: string) => ISqliteTestDatabase } = require("node:sqlite");

const gatewayUrl = "https://gateway.example.test/mobile";
const session: Session = { token: `qzm_${"a".repeat(43)}`, user, branchId: 1, tenant: user.tenant!, mode: "live" };
const stored: StoredSession = { token: session.token, branchId: 1, tenant: session.tenant, gatewayUrl };
const day = "2026-09-08";
const range = { startDate: day, endDate: day };
const crypto = { CryptoDigestAlgorithm: { SHA256: "SHA256" }, digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex"), randomUUID: () => uuid(999) };

function persistentRuntime(databasePath: string, connected: () => boolean) {
  const connection = new DatabaseSync(databasePath);
  const queries = {
    execAsync: async (sql: string) => { connection.exec(sql); },
    getFirstAsync: async (sql: string, ...params: Array<string | number>) => connection.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string) => connection.prepare(sql).all(),
    runAsync: async (sql: string, ...params: Array<string | number>) => connection.prepare(sql).run(...params),
  };
  const sqlite = {
    ...queries,
    withExclusiveTransactionAsync: async (action: (db: typeof queries) => Promise<void>) => {
      connection.exec("BEGIN IMMEDIATE");
      try { await action(queries); connection.exec("COMMIT"); }
      catch (error) { connection.exec("ROLLBACK"); throw error; }
    },
  };
  const storeModule = loadSource<typeof import("../src/offline/DurableStore")>("offline/DurableStore.ts", id => {
    if (id === "expo-sqlite") return { openDatabaseAsync: async () => sqlite };
    if (id === "./state") return offlineState;
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  });
  const profiles = loadSource<typeof import("../src/offline/profiles")>("offline/profiles.ts", id => {
    if (id === "expo-crypto") return crypto;
    if (id === "./DurableStore") return storeModule;
    if (id === "./state") return offlineState;
    if (id === "../domain/tenantSession") return tenantSession;
    if (id === "../infrastructure/errors") return { NetworkError };
    if (id === "../../config/gatewayPolicy") return gatewayPolicy;
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  });
  const files = new MemoryFiles();
  const offline = loadSource<typeof import("../src/offline")>("offline/index.ts", id => {
    if (id === "expo-crypto") return crypto;
    if (id === "./DurableStore") return storeModule;
    if (id === "./FileStore") return { createFileStore: () => files };
    if (id === "./connectivity") return { createConnectivity: () => ({ current: async () => connected(), subscribe: () => () => {} }) };
    if (id === "./profiles") return profiles;
    if (id === "./OfflineTechnicianRepository") return { OfflineTechnicianRepository };
    if (id === "./state") return offlineState;
    if (id === "./engine") return require("../src/offline/engine");
    if (id === "./contracts") return require("../src/offline/contracts");
    if (id === "../domain/offline") return require("../src/domain/offline");
    if (id === "../domain/tenantSession") return tenantSession;
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  });
  return { offline, profiles, store: storeModule.createDurableStore, close: () => connection.close() };
}

test("cold app restart restores SQLite work, checklist and pending changes without any network request", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T12:00:00Z") });
  const directory = mkdtempSync(join(tmpdir(), "qualitzer-cold-start-"));
  const databasePath = join(directory, "offline.db");
  let online = true;
  let reads = 0;
  let verifies = 0;
  let sessionWrites = 0;
  let savedSession: StoredSession | null = stored;
  let verifyError: Error | undefined;
  const original = assignmentsWithStep("approval");
  original.groups[0].works[0].title = "Revision guardada";
  original.groups[0].works[0].checklists[0].steps[0].selectValue = "a";
  original.groups[0].equipment = { label: "Equipo de prueba", identifier: "EQ-53", internalNumber: "53", ownerLabel: "Interno" };
  original.groups[0].works[0].activities = [{ id: 71, activity: "Revision", executionTime: 15, isStarted: false, isCompleted: false, isChecklist: false, checklistId: null, technicalDocuments: [] }];
  original.groups[0].works[0].materials = [{ id: "31", name: "Filtro", ref: "FIL-31", quantity: 1, stockStatus: "reserved" }];
  class Remote {
    token = stored.token;
    tenant = session.tenant;
    onUnauthorized: (() => void) | null = null;
    async me(): Promise<User> {
      verifies++;
      if (!online) throw new NetworkError("network");
      if (verifyError) throw verifyError;
      return user;
    }
    async assignments() { reads++; if (!online) throw new NetworkError("network"); return structuredClone(original); }
    async offlineReceipt() { return null; }
    async offlineCommand(command: { operationId: string }) { return { operationId: command.operationId, state: "applied" as const }; }
  }
  let runtime = persistentRuntime(databasePath, () => online);
  let appFixture: ReturnType<typeof agendaFixture> | undefined;
  try {
    const seedApp = agendaFixture({ overrides: {
      "../offline": runtime.offline,
      "../infrastructure/HttpTechnicianRepository": { HttpTechnicianRepository: Remote },
      "../infrastructure/sessionStorage": { loadSession: async () => savedSession, saveSession: async (value: StoredSession) => { savedSession = value; sessionWrites++; }, saveGateway: async () => {}, removeSession: async () => { savedSession = null; } },
      "../offline/connectivity": { createConnectivity: () => ({ current: async () => online, subscribe: () => () => {} }) },
    } });
    appFixture = seedApp;
    let app = await seedApp.flush();
    for (let turn = 0; turn < 20 && !app.data; turn++) app = await seedApp.flush();
    assert.ok(app.offlineController);
    app.offlineController.stop();
    await app.offlineController.syncNow();
    const namespaces = await (await runtime.store()).namespaces();
    const namespace = namespaces.find(value => value !== "offline-passports-v1");
    assert.ok(namespace);
    const downloadedState = await (await runtime.store()).read(namespace);
    assert.ok(downloadedState.cache.some(entry => entry.key === `assignments:${day}`), "The network read must be persisted before the work is shown");
    await offlineState.updateState(await runtime.store(), namespace, state => {
      state.operations.push({ id: uuid(601), kind: "comment", text: "Reporte pendiente", scope: { ...range, groupId: "direct-80", workId: "80", companyBranchId: 1 }, createdAt: Date.now(), status: "pending", nextAttemptAt: 0, attempts: 0 });
    });
    seedApp.unmount();
    runtime.close();
    online = false;
    context.mock.timers.setTime(Date.parse("2026-09-15T12:00:00Z"));
    runtime = persistentRuntime(databasePath, () => online);
    const beforeReads = reads;
    const beforeVerifies = verifies;
    const beforeWrites = sessionWrites;
    appFixture = agendaFixture({ overrides: {
      "../offline": runtime.offline,
      "../infrastructure/HttpTechnicianRepository": { HttpTechnicianRepository: Remote },
      "../infrastructure/sessionStorage": { loadSession: async () => savedSession, saveSession: async () => { sessionWrites++; }, saveGateway: async () => {}, removeSession: async () => { savedSession = null; } },
      "../offline/connectivity": { createConnectivity: () => ({ current: async () => online, subscribe: () => () => {} }) },
    } });
    app = await appFixture.flush();
    assert.equal(app.restoring, false);
    assert.equal(app.finalizingSession, false);
    assert.equal(app.session?.user.id, user.id);
    assert.equal(app.tab, "today");
    assert.equal(app.range.startDate, "2026-09-15");
    assert.equal(app.range.endDate, "2026-09-15");
    assert.equal(app.data, null);
    assert.equal(app.offline?.pending, 1);
    app.changeRange(range);
    app = await appFixture.flush();
    assert.equal(app.data?.groups[0].works[0].title, "Revision guardada");
    assert.equal(app.data?.groups[0].works[0].checklists[0].steps[0].selectValue, "a");
    assert.equal(app.data?.groups[0].equipment?.identifier, "EQ-53");
    assert.equal(app.data?.groups[0].works[0].materials[0].ref, "FIL-31");
    assert.equal(app.data?.groups[0].works[0].activities?.[0].isChecklist, false);
    assert.equal(app.offline?.pending, 1);
    assert.equal(app.liveVerified, false);
    assert.equal(reads, beforeReads);
    assert.equal(verifies, beforeVerifies);
    assert.equal(sessionWrites, beforeWrites);
    assert.ok(app.offlineController);
    const data = app.data!;
    app.openWork(data.groups[0], data.groups[0].works[0]);
    app = await appFixture.flush();
    assert.equal(app.work?.title, "Revision guardada");
    online = true;
    verifyError = new ApiError(503, "UPSTREAM_UNAVAILABLE", "Service unavailable");
    await app.offlineController!.syncNow();
    app = await appFixture.flush();
    assert.equal(app.data?.groups[0].works[0].title, "Revision guardada");
    assert.equal(app.offline?.pending, 1);
    assert.ok(savedSession);
    verifyError = undefined;
    context.mock.timers.setTime(Date.now() + 31_000);
    await app.offlineController!.syncNow();
    app = await appFixture.flush();
    for (let turn = 0; turn < 20 && !app.liveVerified; turn++) app = await appFixture.flush();
    assert.equal(app.liveVerified, true, JSON.stringify({ offline: app.offline, error: app.error, verifies }));
    assert.equal(app.offline?.pending, 0);
    assert.equal(app.data?.groups[0].works[0].title, "Revision guardada");
    app.closeDetails();
    app = await appFixture.flush();
    assert.ok(app.offlineController);
    verifyError = new ApiError(401, "UNAUTHORIZED", "Expired session");
    context.mock.timers.setTime(Date.now() + 31_000);
    await assert.rejects(app.offlineController.syncNow(), /Vuelve a ingresar/);
    app = await appFixture.flush();
    assert.equal(app.session, null);
    assert.equal(savedSession, null);
    const retained = await (await runtime.store()).read(namespace);
    assert.equal(retained.authBlocked, true);
    assert.ok(retained.cache.some(entry => entry.key === `assignments:${day}`));
    assert.equal(retained.operations[0].id, uuid(601));
  } finally {
    appFixture?.unmount();
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});