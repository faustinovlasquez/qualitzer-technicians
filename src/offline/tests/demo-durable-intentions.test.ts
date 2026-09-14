/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import type { OfflineCommand } from "../../domain/offline";
import type { WorkScope } from "../../domain/models";
import { loadSource } from "../../../tests/helpers/tenant-challenge";
import { uuid } from "./fakes";

async function demoFixture() {
  const requireDemo = createRequire(resolve(__dirname, "../../infrastructure/DemoTechnicianRepository.ts"));
  const module = loadSource<typeof import("../../infrastructure/DemoTechnicianRepository")>("infrastructure/DemoTechnicianRepository.ts", (id) => {
    if (id === "./photos") return { photoDataUri: () => { throw new Error("FILES_NOT_USED"); }, photoSnapshot: () => { throw new Error("FILES_NOT_USED"); } };
    if (id === "expo-crypto") return { CryptoDigestAlgorithm: { SHA256: "sha256" }, digest: async (_algorithm: string, bytes: Uint8Array) => createHash("sha256").update(bytes).digest() };
    return requireDemo(id);
  }, { structuredClone, Uint8Array });
  const demo = new module.DemoTechnicianRepository();
  const data = await demo.assignments({ startDate: "2000-01-01", endDate: "2100-01-01" });
  const group = data.groups.find((item) => item.works.some((work) => work.status === "pending" && !work.checklists.length));
  assert.ok(group);
  const work = group.works.find((item) => item.status === "pending" && !item.checklists.length);
  assert.ok(work);
  const scope: WorkScope = { companyBranchId: 1, groupId: group.id, workId: work.id, startDate: work.scheduledDate, endDate: work.scheduledDate };
  return { demo, scope };
}

test("actual demo timer replay uses its original receipt without reapplying a stale status", async () => {
  const { demo, scope } = await demoFixture();
  const start: OfflineCommand = { operationId: uuid(31), kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" } };
  const receipt = await demo.offlineCommand(start);
  assert.equal(receipt.state, "applied");
  const pause: OfflineCommand = { operationId: uuid(32), kind: "timer", scope, payload: { status: "paused", baseStatus: "in_progress" } };
  assert.equal((await demo.offlineCommand(pause)).state, "applied");
  assert.deepEqual(await demo.offlineCommand(start), receipt);
  assert.deepEqual(await demo.offlineReceipt(start.operationId, scope.companyBranchId), receipt);
  const data = await demo.assignments(scope);
  assert.equal(data.groups.find((group) => group.id === scope.groupId)?.works.find((work) => work.id === scope.workId)?.status, "paused");
  const conflict = await demo.offlineCommand({ ...start, operationId: uuid(33) });
  assert.equal(conflict.state, "conflict"); assert.equal(conflict.error, "MOBILE_SYNC_STATUS_CONFLICT");
  const collision = await demo.offlineCommand({ ...start, payload: { status: "paused", baseStatus: "in_progress" } });
  assert.equal(collision.state, "needs_review"); assert.equal(collision.error, "MOBILE_SYNC_OPERATION_REUSED");
});

test("actual demo checklist receipt replay does not duplicate blank steps or overwrite an answer", async () => {
  const { demo, scope } = await demoFixture();
  const options = await demo.checklistOptions(scope, {});
  const option = options.items.find((item) => !item.alreadyAssigned); assert.ok(option);
  const command: OfflineCommand = { operationId: uuid(40), kind: "checklist", scope, payload: { checklistId: option.id } };
  const receipt = await demo.offlineCommand(command); assert.equal(receipt.state, "applied");
  const first = await demo.assignments(scope);
  const work = first.groups.find((group) => group.id === scope.groupId)?.works.find((work) => work.id === scope.workId);
  assert.ok(work); assert.equal(work.checklists.length, 1);
  const step = work.checklists[0]!.steps[0]!;
  await demo.answer(scope, String(step.stepId), { responseValue: true, isCompleted: true, executionStatus: "completed", comment: "Keep" });
  assert.deepEqual(await demo.offlineCommand(command), receipt);
  const second = await demo.assignments(scope);
  const current = second.groups.find((group) => group.id === scope.groupId)?.works.find((work) => work.id === scope.workId);
  assert.ok(current); assert.equal(current.checklists.length, 1);
  assert.deepEqual(current.checklists[0]!.steps.map((item) => item.stepId), work.checklists[0]!.steps.map((item) => item.stepId));
  assert.equal(current.checklists[0]!.steps[0]!.comment, "Keep");
  const collision = await demo.offlineCommand({ ...command, payload: { checklistId: option.id + 1 } });
  assert.equal(collision.state, "needs_review"); assert.equal(collision.error, "MOBILE_SYNC_OPERATION_REUSED");
});