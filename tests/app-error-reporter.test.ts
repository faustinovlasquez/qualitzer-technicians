import assert from "node:assert/strict";
import { test } from "node:test";
import * as diagnostics from "../src/domain/diagnostics";
import { loadSource } from "./helpers/tenant-challenge";

function reporter() {
  const stored = new Map<string, string>();
  const module = loadSource<typeof import("../src/diagnostics/errorReporter")>("diagnostics/errorReporter.ts", id => {
    if (id === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: async (key: string) => stored.get(key) ?? null, setItem: async (key: string, value: string) => { stored.set(key, value); } } };
    if (id === "expo-constants") return { __esModule: true, default: { expoConfig: { version: "1.0.86" } } };
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "../domain/diagnostics") return diagnostics;
    throw new Error(id);
  });
  module.resetAppErrorReporterForTests();
  return { module, stored };
}

test("oculta correos, tokens y números largos del mensaje y del stack", () => {
  const { module } = reporter();
  const entry = module.appErrorEntry(new TypeError("fallo para ana@empresa.cl con token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc y rut 123456789"), "global", true, new Date("2026-10-06T15:00:00.000Z"));
  assert.ok(entry);
  assert.equal(entry.message, "TypeError: fallo para [correo] con token [token] y rut [número]");
  assert.equal(entry.fatal, true);
  assert.equal(entry.appVersion, "1.0.86");
  assert.equal(entry.platform, "android");
  assert.equal(diagnostics.appErrorSchema.safeParse(entry).success, true);
});

test("guarda en el teléfono, no repite el mismo error en bucle y envía en lotes de 10", async () => {
  const { module, stored } = reporter();
  module.setAppErrorScreen("materials");
  await module.recordAppError(new Error("igual"), "render");
  await module.recordAppError(new Error("igual"), "render");
  for (let index = 0; index < 11; index++) await module.recordAppError(new Error(`error ${index}`), "promise");
  assert.equal(JSON.parse(stored.get("qualitzer:app-errors:v1")!).length, 12);
  const sent: number[] = [];
  await module.flushAppErrors({ reportAppErrors: async errors => { sent.push(errors.length); assert.equal(errors[0].screen, "materials"); return { accepted: errors.length }; } });
  assert.deepEqual(sent, [10, 2]);
  assert.equal(JSON.parse(stored.get("qualitzer:app-errors:v1")!).length, 0);
});

test("si el envío falla conserva la cola para el próximo intento", async () => {
  const { module, stored } = reporter();
  await module.recordAppError(new Error("sin red"), "global");
  await module.flushAppErrors({ reportAppErrors: async () => { throw new Error("NETWORK"); } });
  assert.equal(JSON.parse(stored.get("qualitzer:app-errors:v1")!).length, 1);
  let sent = 0;
  await module.flushAppErrors({ reportAppErrors: async errors => { sent += errors.length; return { accepted: errors.length }; } });
  assert.equal(sent, 1);
});

test("el contrato del gateway rechaza campos extra y lotes vacíos o grandes", () => {
  const entry = { message: "x", stack: null, source: "global", fatal: false, screen: null, appVersion: "1.0.86", platform: "android", occurredAt: "2026-10-06T15:00:00.000Z" };
  assert.equal(diagnostics.appErrorBatchSchema.safeParse({ errors: [entry] }).success, true);
  assert.equal(diagnostics.appErrorBatchSchema.safeParse({ errors: [] }).success, false);
  assert.equal(diagnostics.appErrorBatchSchema.safeParse({ errors: Array(11).fill(entry) }).success, false);
  assert.equal(diagnostics.appErrorBatchSchema.safeParse({ errors: [{ ...entry, userEmail: "a@b.cl" }] }).success, false);
});
