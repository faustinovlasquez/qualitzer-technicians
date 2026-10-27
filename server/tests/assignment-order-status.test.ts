import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedAssignmentsSchema } from "../../src/offline/cacheSchemas";
import { assignmentsSchema } from "../contracts";
import { assignments, group } from "./fixtures";

test("la OT conserva su sucursal y el estado de la web (nombre y color) en la pasarela y sin conexión", () => {
  const payload = assignments([group({ id: "external-82", type: "external_ot", customerBranchName: "Planta Norte", statusName: "Por coordinar", statusColor: "#1E88E5" })]);
  const parsed = assignmentsSchema.parse(payload);
  assert.deepEqual([parsed.groups[0]?.customerBranchName, parsed.groups[0]?.statusName, parsed.groups[0]?.statusColor], ["Planta Norte", "Por coordinar", "#1E88E5"]);
  const cached = cachedAssignmentsSchema.parse(parsed);
  assert.deepEqual([cached.groups[0]?.customerBranchName, cached.groups[0]?.statusName, cached.groups[0]?.statusColor], ["Planta Norte", "Por coordinar", "#1E88E5"]);
});

test("un color de estado que no es #RRGGBB se descarta y un servidor anterior sin estos datos sigue funcionando", () => {
  for (const statusColor of ["red", "url(javascript:alert(1))", "#12345", ""]) {
    const parsed = assignmentsSchema.parse(assignments([group({ statusColor })]));
    assert.equal(parsed.groups[0]?.statusColor, null);
  }
  const legacy = assignmentsSchema.parse(assignments([group()]));
  assert.equal(legacy.groups[0]?.statusColor, undefined);
  assert.equal(legacy.groups[0]?.customerBranchName, undefined);
});
