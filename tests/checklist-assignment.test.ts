import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistAssignmentInputSchema, checklistAssociationBlocked, checklistCatalogPageSchema, checklistCatalogQuerySchema } from "../src/domain/checklistAssignment";
import { DemoChecklistAssignments } from "../src/infrastructure/checklistAssignmentDemo";
import { group, step, work } from "../server/tests/fixtures";

test("association input accepts only a positive master ID, never responses, template or financial data", () => {
  assert.deepEqual(checklistAssignmentInputSchema.parse({ checklistId: 8 }), { checklistId: 8 });
  for (const input of [{ checklistId: "8" }, { checklistId: 0 }, { checklistId: 8, steps: [] }, { checklistId: 8, cost: 9 }, { checklistId: 8, workId: 4 }]) {
    assert.equal(checklistAssignmentInputSchema.safeParse(input).success, false);
  }
});

test("catalog has bounded pages, explicit metadata, no financial output and no duplicate IDs", () => {
  assert.deepEqual(checklistCatalogQuerySchema.parse({}), { search: "", page: 0 });
  assert.equal(checklistCatalogQuerySchema.safeParse({ page: 1001 }).success, false);
  assert.equal(checklistCatalogQuerySchema.safeParse({ search: "\nsecret" }).success, false);
  const item = { id: 5, name: "Prueba", code: null, description: null, alreadyAssigned: false, cost: 80 };
  const result = checklistCatalogPageSchema.parse({ items: [item], page: 0, pageSize: 20, hasMore: false, price: 30 });
  assert.equal("cost" in result.items[0]!, false);
  assert.equal("price" in result, false);
  assert.equal(checklistCatalogPageSchema.safeParse({ ...result, items: [item, item] }).success, false);
});

test("child status and pending local work gate association; cached offline selection and parent definition permissions do not lock it", () => {
  const child = work({ canExecute: false, canEditDefinition: false, checklists: [] });
  const parent = group({ status: "completed", works: [child] });
  assert.equal(checklistAssociationBlocked(parent, child, true), null);
  assert.equal(checklistAssociationBlocked(parent, child, false), null);
  assert.match(checklistAssociationBlocked(parent, child, true, true)!, /Sincroniza/);
  assert.match(checklistAssociationBlocked(parent, work({ id: "local-123" }), true)!, /Sincroniza/);
  assert.match(checklistAssociationBlocked(parent, work({ status: "delivered" }), true)!, /finalizado/);
});

test("demo additive attach resets six answer types and evidence while preserving existing work responses", () => {
  const types = ["validation", "text", "number", "select", "multiselect", "approval"] as const;
  const master = { checklistId: 81, name: "Empresa", code: "A", required: true, steps: types.map((type, index) => step({
    type, stepId: 900 + index, isCompleted: true, responseValue: "respuesta", comment: "original", selectValue: "approved",
    optionsSelectValue: [{ label: "A", value: "a" }], attachments: [{ id: 1, name: "foto", url: "https://invalid.test/photo" }],
  })) };
  const store = new DemoChecklistAssignments([master]);
  const child = work();
  const before = structuredClone(child.checklists);
  assert.deepEqual(store.attach(child, 81), { checklistId: 81, alreadyAssigned: false });
  assert.deepEqual(child.checklists[0], before[0]);
  const added = child.checklists[1]!;
  assert.equal(added.required, false);
  for (const item of added.steps) {
    assert.equal(item.isCompleted, null); assert.equal(item.responseValue, ""); assert.equal(item.comment, "");
    assert.deepEqual(item.attachments, []); assert.deepEqual(item.optionsSelectValue, []);
    assert.equal(item.selectValue, ""); assert.ok(!master.steps.some((source) => source.stepId === item.stepId));
  }
  added.steps[0]!.comment = "nuevo borrador";
  assert.deepEqual(store.attach(child, 81), { checklistId: 81, alreadyAssigned: true });
  assert.equal(added.steps[0]!.comment, "nuevo borrador");
  assert.equal(child.checklists.length, 2);
});

test("demo searches and pages actual supplied definitions without defaulting to the first option", () => {
  const masters = Array.from({ length: 25 }, (_, index) => ({ checklistId: index + 1, name: `Catálogo ${String(index).padStart(2, "0")}`, code: "EMP", steps: [step()] }));
  const store = new DemoChecklistAssignments(masters);
  const child = work({ checklists: [] });
  assert.equal(store.options(child, {}).items.length, 20);
  assert.equal(store.options(child, { page: 1 }).items.length, 5);
  assert.equal(store.options(child, { search: "24" }).items[0]?.id, 25);
  assert.equal(child.checklists.length, 0);
  assert.throws(() => store.attach(child, 100));
  assert.throws(() => store.attach(work({ status: "completed" }), 1));
});