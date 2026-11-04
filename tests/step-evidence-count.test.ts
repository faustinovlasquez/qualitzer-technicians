import assert from "node:assert/strict";
import { test } from "node:test";
import type { OfflineOperation } from "../src/domain/offline";
import { locallySavedWork } from "../src/screens/offline/offlineUi";
import { step, work } from "../server/tests/fixtures";

const document = (id: string, status: "pending" | "applied", fileId?: number) => ({
  id, kind: "document", status, stepId: "5", createdAt: 1, attempts: 0, nextAttemptAt: 0,
  scope: { groupId: "maintenance-80", workId: "1145", companyBranchId: 1, startDate: "2026-11-04", endDate: "2026-11-04" },
  file: { id: `file-${id}`, namespace: "n", name: `${id}.jpg`, mimeType: "image/jpeg", size: 10, sha256: "a" },
  ...(fileId === undefined ? {} : { receipt: { operationId: id, state: "applied", fileId } }),
}) as unknown as OfflineOperation;

const attachments = (operations: OfflineOperation[]) => {
  const evidence = step({ stepId: 5, attachments: [{ id: 91, name: "a.jpg", url: "https://files.example.invalid/a.jpg" }] });
  return locallySavedWork(work({ checklists: [{ checklistId: 1, name: "L", code: "L", steps: [evidence] }] }), operations).checklists[0]!.steps[0]!.attachments;
};

test("una foto ya enviada que el servidor lista no se cuenta dos veces", () => {
  assert.deepEqual(attachments([document("a", "applied", 91)]).map((file) => file.id), [91]);
});

test("lo pendiente, y lo enviado que el servidor aún no lista, siguen a la vista", () => {
  assert.equal(attachments([document("b", "pending")]).length, 2);
  assert.equal(attachments([document("c", "applied", 92)]).length, 2);
});
