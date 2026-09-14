import assert from "node:assert/strict";
import { test } from "node:test";
import type { NotificationData } from "../src/domain/notifications";
import { NotificationPresentationDedupe } from "../src/notifications/notificationPresentationDedupe";

function payload(index = 1): NotificationData {
  return { tenantOrigin: "https://tenant.example", companyBranchId: 2,
    eventId: `a1ecc4bb-c526-4607-980e-${index.toString(16).padStart(12, "0")}`,
    kind: "WORK_TECHNICIAN_ASSIGNED", groupType: "work", groupId: 82, workId: 82, date: "2026-09-12" };
}

test("presentation remembers accepted events by tenant, branch and event, not resource or object identity", () => {
  const dedupe = new NotificationPresentationDedupe();
  const data = payload();
  assert.equal(dedupe.accept(data), true);
  assert.equal(dedupe.accept({ ...data }), false);
  assert.equal(dedupe.accept({ ...data, workId: 99 }), false);
  assert.equal(dedupe.accept({ ...data, tenantOrigin: "https://other.example" }), true);
  assert.equal(dedupe.accept({ ...data, companyBranchId: 3 }), true);
  assert.equal(dedupe.accept(payload(2)), true);
  assert.equal(dedupe.accept(data), false);
});

test("invalid payloads are rejected without remembering an unaccepted event", () => {
  const dedupe = new NotificationPresentationDedupe();
  const data = payload();
  for (const value of [null, undefined, [], {}, { ...data, eventId: "bad" }, { ...data, eventId: "" },
    { ...data, companyBranchId: 0 }, { ...data, companyBranchId: -1 }, { ...data, workId: -1 },
    { ...data, tenantOrigin: "https://tenant.example/" }, { ...data, tenantOrigin: "https://tenant.example\n" },
    { ...data, date: "2026-02-30" }, { ...data, kind: "OPEN_URL" }]) {
    assert.equal(dedupe.accept(value), false);
  }
  assert.equal(dedupe.accept(data), true);
  assert.equal(dedupe.accept(data), false);
});

test("presentation capacity retains exactly 512 accepted keys and invalid attempts cannot evict them", () => {
  const dedupe = new NotificationPresentationDedupe(() => 1000);
  for (let index = 1; index <= 512; index += 1) assert.equal(dedupe.accept(payload(index)), true);
  for (let index = 1; index <= 600; index += 1) assert.equal(dedupe.accept({ ...payload(index), eventId: `invalid-${index}` }), false);
  for (let index = 1; index <= 512; index += 1) assert.equal(dedupe.accept(payload(index)), false);
  assert.equal(dedupe.accept(payload(513)), true);
  assert.equal(dedupe.accept(payload(2)), false);
  assert.equal(dedupe.accept(payload(512)), false);
  assert.equal(dedupe.accept(payload(1)), true);
  assert.equal(dedupe.accept(payload(2)), true);
});

test("accepted presentation expires after one day without extending TTL on duplicate delivery", () => {
  let now = 1000;
  const dedupe = new NotificationPresentationDedupe(() => now);
  assert.equal(dedupe.accept(payload()), true);
  now += 86400000 - 1;
  assert.equal(dedupe.accept(payload()), false);
  assert.equal(dedupe.accept(payload(2)), true);
  now += 1;
  assert.equal(dedupe.accept(payload()), true);
  assert.equal(dedupe.accept(payload(2)), false);
  now += 86400000;
  assert.equal(dedupe.accept(payload()), true);
  assert.equal(dedupe.accept(payload(2)), true);
});