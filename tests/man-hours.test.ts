import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentExecutedMinutes, manHours } from "../src/domain/assignmentSchedule";

test("man hours keep at most one decimal with a comma", () => {
  assert.equal(manHours(480), "8");
  assert.equal(manHours(90), "1,5");
  assert.equal(manHours(100), "1,7");
  assert.equal(manHours(0), "0");
  assert.equal(manHours(-30), "0");
});

test("reported minutes add every scheduled day and ignore invalid values", () => {
  const day = (executedMinutes: number) => ({ work: { executedMinutes } });
  assert.equal(assignmentExecutedMinutes({ executedMinutes: 45 } as never), 45);
  assert.equal(assignmentExecutedMinutes({ executedMinutes: 45, schedules: [day(60), day(30), day(Number.NaN)] } as never), 90);
});
