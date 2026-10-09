import assert from "node:assert/strict";
import { test } from "node:test";
import { activeTimerKey, withoutLocallyPaused } from "../src/domain/assignmentSchedule";

const timer = (workId: number) => ({ groupType: "work", groupId: workId, workId });

test("un cronómetro recién pausado no vuelve al aviso aunque el servidor aún lo informe", () => {
  const paused = new Map([[activeTimerKey(timer(3020)), 1_000]]);
  const visible = withoutLocallyPaused([timer(3020), timer(3021)], paused, 60_000);
  assert.deepEqual(visible.map((item) => item.workId), [3021]);
});

test("se olvida cuando el servidor deja de informarlo o pasan 10 minutos", () => {
  const paused = new Map([[activeTimerKey(timer(3020)), 1_000], [activeTimerKey(timer(3034)), 1_000]]);
  withoutLocallyPaused([timer(3034)], paused, 60_000);
  assert.equal(paused.has(activeTimerKey(timer(3020))), false);
  const visible = withoutLocallyPaused([timer(3034)], paused, 1_000 + 11 * 60_000);
  assert.deepEqual(visible.map((item) => item.workId), [3034]);
});
