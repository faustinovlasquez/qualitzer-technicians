import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import * as resume from "../src/domain/checklistResume";
import type { Checklist } from "../src/domain/models";
import { step } from "../server/tests/fixtures";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";

const scope = JSON.stringify(["tenant-A/branch-1/work-81", "live", true, "81"]);
const keyFor = (value: string): string => `@qualitzer/checklist-navigation/v1/${encodeURIComponent(value)}`;
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
function checklist(id = 501, confirmed = 20): Checklist {
  return { checklistId: id, name: "Checklist", code: "RESUME", steps: Array.from({ length: 47 }, (_, index) =>
    step({ stepId: `${id}-${index + 1}`, order: index + 1, selectValue: index < confirmed ? "approved" : "" })) };
}

function fixture(raw?: string, read?: () => Promise<string | null>, failWrite = false) {
  const hooks = reactFixture();
  const storage = new Map<string, string>(raw ? [[keyFor(scope), raw]] : []);
  const writes: Array<{ key: string; value: string }> = [];
  const module = loadSource<typeof import("../src/screens/workDetail/checklist/useChecklistNavigation")>("screens/workDetail/checklist/useChecklistNavigation.ts", (id) => {
    if (id === "react") return hooks.react;
    if (id === "zod") return { z };
    if (id === "../../../domain/checklistResume") return resume;
    if (id === "@react-native-async-storage/async-storage") return { getItem: async (key: string) => read ? read() : storage.get(key) ?? null,
      setItem: async (key: string, value: string) => { if (failWrite) throw new Error("WRITE_FAILED"); writes.push({ key, value }); storage.set(key, value); } };
    throw new Error(`UNEXPECTED_IMPORT ${id}`);
  });
  const render = (lists: Checklist[], namespace = scope) => {
    const result = hooks.render(() => module.useChecklistNavigation(namespace, lists));
    hooks.flush();
    return result;
  };
  return { render, hooks, storage, writes };
}

test("cold saved selection auto-opens its checklist at 21 instead of the legacy saved step 1", async () => {
  const list = checklist();
  const f = fixture(JSON.stringify({ checklistId: 501, stepIds: { 501: "501-1" } }));
  assert.equal(f.render([list]).restoring, true);
  await tick();
  assert.equal(f.render([list]).restoring, true);
  const nav = f.render([list]);
  assert.equal(nav.selection.checklistId, 501);
  assert.equal(nav.selection.stepIds["501"], "501-21");
  assert.equal(nav.restoring, false);
  await tick();
  assert.ok(f.writes.every((write) => write.key === keyFor(scope)));
});

test("catalog open ignores last visited position and recalculates the first hole every explicit open", async () => {
  const list = checklist();
  const f = fixture();
  f.render([list]); await tick();
  f.render([list]).open(list);
  f.render([list]).jump(501, "501-40");
  f.render([list]).catalog();
  list.steps[4].selectValue = "";
  f.render([list]).open(list);
  assert.equal(f.render([list]).selection.stepIds["501"], "501-5");
});

test("all complete including a persisted old step opens summary with no bogus missing-step selection", async () => {
  const list = checklist(501, 47);
  const f = fixture(JSON.stringify({ checklistId: 501, stepIds: { 501: "501-1", 502: "502-9" } }));
  f.render([list]); await tick(); f.render([list]);
  const nav = f.render([list]);
  assert.equal(nav.selection.checklistId, 501);
  assert.equal(nav.selection.stepIds["501"], undefined);
  assert.equal(nav.selection.stepIds["502"], "502-9");
  nav.jump(501, "501-3");
  assert.equal(f.render([list]).selection.stepIds["501"], "501-3");
});

test("refresh after answering or a new earlier hole never jumps the active selection", async () => {
  const list = checklist();
  const f = fixture();
  f.render([list]); await tick(); f.render([list]).open(list);
  list.steps[20].selectValue = "approved";
  assert.equal(f.render([structuredClone(list)]).selection.stepIds["501"], "501-21");
  list.steps[0].selectValue = "";
  assert.equal(f.render([structuredClone(list)]).selection.stepIds["501"], "501-21");
});

test("back from files remount preserves the same step even after its evidence is confirmed", async () => {
  const list = checklist();
  list.steps[3].isFilesRequired = true;
  const f = fixture();
  f.render([list]); await tick(); f.render([list]).open(list);
  assert.equal(f.render([list]).selection.stepIds["501"], "501-4");
  f.hooks.unmount();
  list.steps[3].attachments = [{ id: 9, name: "photo.png", url: "https://example.com/photo.png" }];
  assert.equal(f.render([structuredClone(list)]).selection.stepIds["501"], "501-4");
  assert.equal(f.render([list]).restoring, false);
});

test("switching checklists resumes each from its own first pending and retains other positions", async () => {
  const a = checklist(); const b = checklist(502, 7);
  const f = fixture();
  f.render([a, b]); await tick(); f.render([a, b]).open(a);
  f.render([a, b]).jump(501, "501-32");
  f.render([a, b]).open(b);
  assert.equal(f.render([a, b]).selection.stepIds["502"], "502-8");
  assert.equal(f.render([a, b]).selection.stepIds["501"], "501-32");
  f.render([a, b]).open(a);
  assert.equal(f.render([a, b]).selection.stepIds["501"], "501-21");
});

test("tenant and work namespaces do not share navigation even with identical checklist IDs", async () => {
  const list = checklist();
  const f = fixture();
  f.render([list]); await tick(); f.render([list]).open(list);
  for (const other of [scope.replace("tenant-A", "tenant-B"), scope.replaceAll("81", "82")]) {
    assert.equal(f.render([list], other).selection.checklistId, null);
    await tick();
    f.render([list], other).open(list);
    f.render([list], other).jump(501, "501-35");
  }
  assert.equal(f.render([list]).selection.stepIds["501"], "501-21");
});

test("unknown saved step is repaired on cold restore but missing checklist is not replaced by another", async () => {
  const list = checklist();
  const f = fixture(JSON.stringify({ checklistId: 501, stepIds: { 501: "removed-step" } }));
  f.render([checklist(502)]); await tick(); f.render([checklist(502)]);
  assert.equal(f.render([checklist(502)]).selection.checklistId, 501);
  assert.equal(f.writes.length, 0);
  f.render([list]);
  assert.equal(f.render([list]).selection.stepIds["501"], "501-21");
});

test("invalid stored fields report recovery error without overwriting the invalid storage", async () => {
  for (const raw of ['{"checklistId":"wrong","stepIds":{}}', '{"checklistId":501,"stepIds":{"501":42}}', "{"]) {
    const list = checklist(); const f = fixture(raw);
    f.render([list]); await tick();
    const nav = f.render([list]);
    assert.match(nav.error ?? "", /No se pudo recuperar/);
    assert.equal(nav.restoring, false);
    nav.open(list); await tick();
    assert.equal(f.render([list]).selection.stepIds["501"], "501-21");
    assert.equal(f.storage.get(keyFor(scope)), raw);
    assert.equal(f.writes.length, 0);
  }
});

test("late hydration cannot override explicit navigation", async () => {
  let release: (raw: string | null) => void = () => {};
  const list = checklist();
  const f = fixture(undefined, () => new Promise((resolve) => { release = resolve; }));
  f.render([list]).open(list);
  f.render([list]).jump(501, "501-30");
  release(JSON.stringify({ checklistId: 501, stepIds: { 501: "501-1" } }));
  await tick();
  assert.equal(f.render([list]).selection.stepIds["501"], "501-30");
});

test("failed position write retains in-session navigation and reports the failure", async () => {
  const list = checklist(); const f = fixture(undefined, undefined, true);
  f.render([list]); await tick(); f.render([list]).open(list); await tick();
  assert.equal(f.render([list]).selection.stepIds["501"], "501-21");
  assert.match(f.render([list]).error ?? "", /no pudo guardarse/);
});

test("saved catalog stays catalog on cold restore instead of implicitly opening the first checklist", async () => {
  const list = checklist(); const f = fixture(JSON.stringify({ checklistId: null, stepIds: { 501: "501-1" } }));
  f.render([list]); await tick();
  assert.equal(f.render([list]).selection.checklistId, null);
  assert.equal(f.render([list]).restoring, false);
});