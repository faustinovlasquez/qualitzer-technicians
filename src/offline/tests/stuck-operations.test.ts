/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../../infrastructure/errors";
import type { OfflineOperation } from "../../domain/offline";
import { OfflineEngine } from "../engine";
import { discardSet } from "../discard";
import { updateState } from "../state";
import { creation, fixture, uuid } from "./fakes";

const base = (id: number, status: OfflineOperation["status"] = "pending") => ({ id: uuid(id), createdAt: 100, status, attempts: 0, nextAttemptAt: 0 });
const scope = { companyBranchId: 1, groupId: "direct-10", workId: "10", startDate: "2026-09-08", endDate: "2026-09-08" };
const file = (id: number) => ({ id: `file-${id}`, namespace: "a", name: "foto.jpg", mimeType: "image/jpeg", size: 10, sha256: "a".repeat(64) });

test("una operación rechazada se descarta junto con lo que depende de ella y se borran sus archivos", async () => {
  const f = fixture();
  const create: OfflineOperation = { ...base(1, "blocked"), kind: "create", input: creation(1), localGroupId: "local-g", localWorkId: "local-w" };
  const photo: OfflineOperation = { ...base(2), kind: "document", scope: { ...scope, groupId: "local-g", workId: "local-w" }, file: file(2), dependencyId: uuid(1) };
  const note: OfflineOperation = { ...base(3), kind: "comment", scope: { ...scope, groupId: "local-g", workId: "local-w" }, text: "Hecho" };
  const other: OfflineOperation = { ...base(4), kind: "comment", scope, text: "Otro trabajo" };
  await updateState(f.store, "a", (state) => { state.operations.push(create, photo, note, other); });
  f.files.files.set("file-2", file(2));
  assert.deepEqual(discardSet([create, photo, note, other], uuid(1)).map((op) => op.id), [uuid(1), uuid(2), uuid(3)]);

  const engine = new OfflineEngine(f.dependencies);
  const removed = await engine.discard(uuid(1));
  assert.equal(removed.length, 3);
  assert.deepEqual((await f.store.read("a")).operations.map((op) => op.id), [uuid(4)]);
  assert.deepEqual(f.files.removes, ["file-2"]);
});

test("solo se descarta lo que ya terminó mal; lo pendiente o enviándose no", async () => {
  const f = fixture();
  await updateState(f.store, "a", (state) => {
    state.operations.push({ ...base(1), kind: "comment", scope, text: "En espera" });
    state.operations.push({ ...base(2, "needs_review"), kind: "comment", scope, text: "Revisar" });
    state.operations.push({ ...base(3, "syncing"), kind: "comment", scope, text: "Enviando", dependencyId: uuid(2) });
  });
  const engine = new OfflineEngine(f.dependencies);
  await assert.rejects(engine.discard(uuid(1)), /OFFLINE_DISCARD_NOT_ALLOWED/);
  await assert.rejects(engine.discard(uuid(2)), /OFFLINE_DISCARD_BUSY/);
  assert.equal((await f.store.read("a")).operations.length, 3);
});

test("en el teléfono, una reserva de envío que quedó de un cierre forzado no hace esperar 4 minutos", async () => {
  const f = fixture();
  await updateState(f.store, "a", (state) => {
    state.operations.push({ ...base(1), kind: "comment", scope, text: "Pendiente" });
    state.lease = { owner: "ejecucion-anterior", until: 1_000 + 200_000 };
  });
  // Sin «una sola ejecución» (web) se respeta la reserva ajena.
  const web = new OfflineEngine(f.dependencies);
  await web.syncNow();
  assert.equal(f.upstream.commands.length, 0);
  const phone = new OfflineEngine({ ...f.dependencies, exclusiveProcess: true });
  await phone.syncNow();
  assert.equal(f.upstream.commands.length, 1);
  assert.equal((await f.store.read("a")).operations[0]?.status, "applied");
  assert.equal((await f.store.read("a")).lease, null);
});

test("una creación con respuesta inesperada se reintenta en vez de quedar en revisión", async () => {
  const f = fixture();
  await updateState(f.store, "a", (state) => {
    state.operations.push({ ...base(1), kind: "create", input: creation(1), localGroupId: "local-g", localWorkId: "local-w" });
  });
  f.upstream.sendError = new Error("RESPUESTA_RARA");
  const engine = new OfflineEngine(f.dependencies);
  await engine.syncNow();
  assert.equal((await f.store.read("a")).operations[0]?.status, "pending");
  // Un rechazo real del servidor sí se informa.
  f.advance();
  f.upstream.sendError = new ApiError(400, "INVALID_INPUT", "Datos inválidos");
  await engine.syncNow();
  assert.equal((await f.store.read("a")).operations[0]?.status, "blocked");
});
