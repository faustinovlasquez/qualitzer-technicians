import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentsSchema } from "../contracts";
import { cachedAssignmentsSchema } from "../../src/offline/cacheSchemas";
import { assignments, group, work } from "./fixtures";

test("work break time reaches the app through the gateway contract and the offline cache", () => {
  const payload = assignments([group({ works: [work({ hasBreakTime: true, breakStartTime: "13:00", breakEndTime: "14:00" })] })]);
  const parsed = assignmentsSchema.parse(payload);
  assert.deepEqual(
    { hasBreakTime: parsed.groups[0]?.works[0]?.hasBreakTime, start: parsed.groups[0]?.works[0]?.breakStartTime, end: parsed.groups[0]?.works[0]?.breakEndTime },
    { hasBreakTime: true, start: "13:00", end: "14:00" },
  );
  const cached = cachedAssignmentsSchema.parse(JSON.parse(JSON.stringify(parsed)));
  assert.equal(cached.groups[0]?.works[0]?.breakEndTime, "14:00");
});

test("payloads without break time stay valid for older backends", () => {
  const parsed = assignmentsSchema.parse(assignments());
  assert.equal(parsed.groups[0]?.works[0]?.hasBreakTime, undefined);
});
