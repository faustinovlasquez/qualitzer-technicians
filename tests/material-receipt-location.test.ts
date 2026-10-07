import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "./helpers/tenant-challenge";

type Point = { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number };
function module(points: Point[]) {
  const calls: number[] = [];
  const loaded = loadSource<typeof import("../src/receipts/receiptLocation")>("receipts/receiptLocation.ts", id => {
    if (id === "expo-location") return {
      Accuracy: { Balanced: 3, High: 4 },
      getForegroundPermissionsAsync: async () => ({ granted: true, status: "granted", canAskAgain: true }),
      requestForegroundPermissionsAsync: async () => ({ granted: true, status: "granted", canAskAgain: true }),
      getCurrentPositionAsync: async (options: { accuracy: number }) => { calls.push(options.accuracy); return points.shift()!; },
    };
    if (id === "react-native") return { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } };
    throw new Error(id);
  }, { setTimeout, clearTimeout, Date });
  return { loaded, calls };
}
const point = (ageMs: number): Point => ({ coords: { latitude: -33.4, longitude: -70.6, accuracy: 12 }, timestamp: Date.now() - ageMs });

test("solo se acepta una lectura de los últimos 2 minutos y no del futuro", () => {
  const { loaded } = module([]);
  const now = Date.parse("2026-10-06T17:00:00Z");
  assert.equal(loaded.freshReceiptFix(now - 60_000, now), true);
  assert.equal(loaded.freshReceiptFix(now - 11 * 60_000, now), false);
  assert.equal(loaded.freshReceiptFix(now + 5 * 60_000, now), false);
});

test("si Android entrega una lectura vieja se pide otra al GPS", async () => {
  const { loaded, calls } = module([point(15 * 60_000), point(1_000)]);
  const location = await loaded.captureMaterialReceiptLocation(async () => null);
  assert.equal(location.status, "AVAILABLE");
  assert.equal(calls.join(","), "3,4");
});

test("si tampoco consigue una lectura reciente, confirma sin ubicación en vez de fallar en el servidor", async () => {
  const { loaded } = module([point(15 * 60_000), point(20 * 60_000)]);
  const location = await loaded.captureMaterialReceiptLocation(async () => null);
  assert.equal(location.status, "UNAVAILABLE");
  assert.equal(location.status === "UNAVAILABLE" ? location.reason : null, "TIMEOUT");
});
