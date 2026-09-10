/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineSnapshot } from "../../../domain/offline";
import { isPendingLocalWork, offlineStatusLabel, unavailableCoverageDates } from "../offlineDashboardUi";
import { connectionPresentation } from "../../../offline/connectionPresentation";

const range = { startDate: "2026-09-07", endDate: "2026-09-13" };
const fetchedAt = Date.parse("2026-09-08T10:30:00Z");
const snapshot: OfflineSnapshot = {
  online: false, preparing: false, syncing: false, authBlocked: false,
  pending: 0, conflicts: 0, lastError: null, lastSyncedAt: null, operations: [],
  coverage: [{ date: "2026-09-07", branchId: 1, fetchedAt }],
  missingDates: ["2026-10-01"],
};

test("visible range coverage ignores missingDates from the last background read", () => {
  assert.deepEqual(unavailableCoverageDates(snapshot, range, 1), ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  assert.equal(unavailableCoverageDates(snapshot, range, 2).length, 7);
  assert.equal(unavailableCoverageDates(snapshot, range).length, 7);
});

test("coverage never marks server reads or an unknown snapshot as incomplete", () => {
  assert.deepEqual(unavailableCoverageDates({ ...snapshot, online: true }, range, 1), []);
  assert.deepEqual(unavailableCoverageDates(null, range, 1), []);
  assert.deepEqual(unavailableCoverageDates(undefined, range, 1), []);
});

test("all current range dates are checked, not just the seven-day prepare limit", () => {
  assert.equal(unavailableCoverageDates(snapshot, { startDate: "2026-09-01", endDate: "2026-09-30" }, 1).length, 29);
  assert.deepEqual(unavailableCoverageDates(snapshot, { startDate: "2026-09-07", endDate: "2026-09-07" }, 1), []);
});

test("compact status does not claim offline availability from cachedAt alone", () => {
  assert.equal(offlineStatusLabel(null), "Recuperando estado local…");
  assert.equal(offlineStatusLabel({ ...snapshot, pending: 3 }), "Verificando conexión con Qualitzer… · 3 pendientes");
  assert.equal(offlineStatusLabel({ ...snapshot, online: true, cachedAt: fetchedAt, coverage: [] }), "Conectado a Qualitzer · 0 pendientes");
  assert.match(connectionPresentation({ ...snapshot, online: true }).secondary, /Agenda disponible offline · datos al/);
  assert.match(connectionPresentation({ ...snapshot, online: true, cachedAt: fetchedAt, coverage: [] }).secondary, /Sin agenda disponible offline/);
  assert.match(offlineStatusLabel({ ...snapshot, online: true, conflicts: 1 }), /1 por revisar/);
  assert.match(offlineStatusLabel({ ...snapshot, online: true, authBlocked: true }), /^Verificar sesión/);
});

test("local work detection supports metadata and remapped work awaiting canonical data", () => {
  assert.equal(isPendingLocalWork({ id: "local-operation", missingRequiredInfo: [] }), true);
  assert.equal(isPendingLocalWork({ id: "42", missingRequiredInfo: ["OFFLINE_AWAITING_SERVER_SNAPSHOT"] }), true);
  const pending = { id: "42", missingRequiredInfo: [], offline: { downloaded: true, confirmed: false } };
  assert.equal(isPendingLocalWork(pending), true);
  assert.equal(isPendingLocalWork({ ...pending, offline: { downloaded: true, confirmed: true } }), false);
  assert.equal(isPendingLocalWork({ id: "42", missingRequiredInfo: [] }), false);
});