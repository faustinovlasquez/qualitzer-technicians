/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineOperation } from "../../domain/offline";
import { clockOffsetMs, noteServerDate, resetServerClock, serverNow } from "../serverClock";
import { emptyState } from "../state";
import { rebaseTimerChain } from "../timerConflicts";

test("la hora del servidor corrige un teléfono atrasado y se ignoran mediciones dudosas", () => {
  resetServerClock();
  const phone = Date.parse("2026-10-27T10:00:00.000Z");
  // El servidor marca 10:10:00 mientras el teléfono cree que son 10:00:00 (ida y vuelta de 200 ms).
  noteServerDate("Tue, 27 Oct 2026 10:10:00 GMT", phone - 100, phone + 100);
  assert.ok(Math.abs(clockOffsetMs() - 600_500) < 1_000);
  assert.ok(serverNow() - Date.now() > 590_000);
  // Diferencias de menos de 2 s son ruido de la cabecera.
  noteServerDate("Tue, 27 Oct 2026 10:00:01 GMT", phone - 100, phone + 100);
  assert.equal(clockOffsetMs(), 0);
  // Una respuesta lenta (más de 10 s) no sirve para medir; tampoco una fecha inválida.
  noteServerDate("Tue, 27 Oct 2026 12:00:00 GMT", phone, phone + 20_000);
  noteServerDate("no es una fecha", phone, phone + 100);
  assert.equal(clockOffsetMs(), 0);
  resetServerClock();
});

test("si otro dejó el trabajo finalizado, la entrega pedida no desaparece: queda a la vista para revisarla", () => {
  const state = emptyState();
  const scope = { companyBranchId: 1, groupId: "direct-10", workId: "10", startDate: "2026-10-27", endDate: "2026-10-27" };
  const delivery: OfflineOperation = {
    id: "c1", createdAt: 100, status: "conflict", attempts: 1, nextAttemptAt: 0, lastError: "MOBILE_SYNC_STATUS_CONFLICT",
    receipt: { operationId: "c1", state: "conflict", error: "MOBILE_SYNC_STATUS_CONFLICT" }, kind: "completion", scope, prerequisiteIds: [],
    localClock: { elapsedSeconds: 600 },
    payload: { input: { status: "delivered", isManual: false }, recordedAt: "2026-10-27T10:00:00.000Z", observedAt: "2026-10-27T09:00:00.000Z", baseStatus: "in_progress" }
  } as OfflineOperation;
  state.operations.push(delivery);
  rebaseTimerChain(state, scope, "completed", () => "nuevo");
  assert.equal(state.operations.length, 1);
  assert.equal(state.operations[0]?.status, "needs_review");
  assert.equal(state.operations[0]?.lastError, "OFFLINE_WORK_COMPLETED_ELSEWHERE");
  // Si ya está entregado, se da por reflejada y se retira.
  const done = emptyState();
  done.operations.push({ ...delivery });
  rebaseTimerChain(done, scope, "delivered", () => "nuevo");
  assert.equal(done.operations.length, 0);
});
