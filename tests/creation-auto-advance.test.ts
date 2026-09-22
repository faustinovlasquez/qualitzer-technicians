import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactNode } from "react";
import type { CreationInput, CreationOptions, CreationResult } from "../src/domain/creation";
import { OfflineQueuedError, type OfflineQueuedOutcome, type OfflineSnapshot, type OfflineOperationStatus } from "../src/domain/offline";
import type { CreationScreenProps } from "../src/screens/creation/CreationScreen";
import type { TimeFieldProps } from "../src/ui/time/TimeField";
import { creationDraftSchema, creationPayload, emptyCreationForm, queuedCreationState, type CreationDraft, type CreationForm } from "../src/screens/creation/creationForm";
import { user } from "../server/tests/fixtures";
import { reactFixture, tenant } from "./helpers/tenant-challenge";
import { action, deferred, elements, memoryDraftStorage, settle, uiModule, type Wrapped } from "./helpers/durable-ui";

const requestId = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
const date = "2026-09-14";
const form = { ...emptyCreationForm(date), title: "Trabajo local", summary: "Revisión", startTime: "09:00", endTime: "10:30" };
const input = creationPayload("work", form, 1, requestId);
const result: CreationResult = { kind: "work", groupId: "direct-71", workId: 71, companyBranchId: 1,
  schedule: { ...input.schedule, plannedMinutes: 90, timezone: "America/Santiago" } };
const outcome: Extract<CreationDraft, { phase: "queued" }>["outcome"] = { kind: "create", operationId: requestId, operationIds: [requestId], date,
  localGroupId: `local-${requestId}`, localWorkId: `local-${requestId}`, ownsFiles: false };
const options: CreationOptions = { companyBranchId: 1, userId: 9, workerId: 42, timezone: "America/Santiago",
  priorities: ["low", "medium", "high"], nonProductiveReasons: [{ value: "waiting_parts", label: "Espera de repuestos" }], maintenanceTypes: [{ value: "correctivo", enabled: true, instruction: null }], schedule: { sameDayOnly: true, conflictPolicy: "warning" } };

const savedQueued: Extract<CreationDraft, { phase: "queued" }> = { version: 1, kind: "work", phase: "queued", form, input, outcome };
function snapshot(status: OfflineOperationStatus = "pending"): OfflineSnapshot {
  return { online: true, preparing: false, syncing: false, authBlocked: false, pending: status === "applied" ? 0 : 1, conflicts: 0, lastSyncedAt: null, lastError: null, coverage: [],
    operations: [{ id: requestId, kind: "create", status, attempts: 0, createdAt: 1, nextAttemptAt: 0, input, localGroupId: outcome.localGroupId, localWorkId: outcome.localWorkId, ...(status === "applied" ? { result } : {}) }] };
}

function stableHooks() {
  const hooks = reactFixture();
  function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T {
    const ref = hooks.react.useRef<{ dependencies: readonly unknown[]; value: T } | null>(null) as {
      current: { dependencies: readonly unknown[]; value: T } | null;
    };
    if (!ref.current || dependencies.length !== ref.current.dependencies.length || dependencies.some((value, index) => !Object.is(value, ref.current?.dependencies[index]))) {
      ref.current = { dependencies: [...dependencies], value: factory() };
    }
    return ref.current.value;
  }
  return { hooks, react: { ...hooks.react, useMemo } };
}

async function creationFixture(initial?: CreationDraft) {
  const { hooks, react } = stableHooks();
  const memory = memoryDraftStorage();
  const submit = deferred<CreationResult>();
  const writes: CreationDraft[] = [];
  const submitted: CreationInput[] = [];
  const queued: OfflineQueuedOutcome[] = [];
  const created: CreationResult[] = [];
  const events: string[] = [];
  const security = { unlocked: true };
  let generatedIds = 0;
  const controls: { hold?: CreationDraft["phase"]; gate?: ReturnType<typeof deferred<void>>; fail?: CreationDraft["phase"] } = {};
  const storage = { ...memory.storage, setItem: async (key: string, value: string) => {
    const draft = creationDraftSchema.parse(JSON.parse(value));
    writes.push(draft);
    if (controls.hold === draft.phase) await controls.gate?.promise;
    if (controls.fail === draft.phase) throw new Error("DISK_FULL");
    await memory.storage.setItem(key, value);
    events.push(`stored:${draft.phase}`);
  } };
  const drafts = uiModule<typeof import("../src/screens/creation/creationDrafts")>("screens/creation/creationDrafts.ts", hooks, {
    "@react-native-async-storage/async-storage": storage,
  });
  const module = uiModule<{ CreationScreen: Wrapped<CreationScreenProps> }>("screens/creation/CreationScreen.tsx", hooks, {
    react,
    "react-native": { Platform: { OS: "web" }, StyleSheet: { create: (styles: object) => styles }, BackHandler: { addEventListener: () => ({ remove: () => {} }) },
      View: "View", Text: "Text", ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView", ActivityIndicator: "ActivityIndicator" },
    "expo-crypto": { randomUUID: () => ++generatedIds === 1 && (!initial || initial.phase === "editing") ? requestId : `52b5201d-4ea9-4dad-9f9d-${String(generatedIds).padStart(12, "0")}` },
    "../../security/DeviceSecurityContext": { useDeviceSecurity: () => ({ isUnlocked: () => security.unlocked }) },
    "./creationDrafts": drafts,
    "./CreationCatalogSelector": { CreationCatalogSelector: "CreationCatalogSelector" },
    "./CreationDatePicker": { CreationDatePicker: "CreationDatePicker" },
    "./CreationEquipmentLookup": { CreationEquipmentLookup: "CreationEquipmentLookup" },
    "./CreationFields": { CreationFields: "CreationFields", creationLabels: { work: "Trabajo", maintenance: "Mantenimiento", non_productive: "Tiempo no productivo" }, priorityLabels: { medium: "Media" } },
    "./CreationModal": { CreationModal: "CreationModal" },
  });
  let backs = 0;
  const props: CreationScreenProps = { kind: initial?.kind ?? "work", user: user(), tenant, companyBranchId: 1, initialDate: date, data: null,
    mode: "live", storageKey: "creation-isolated", onBack: () => { backs++; }, onLoadOptions: async () => options,
    onSubmit: async (value) => { submitted.push(value); return submit.promise; },
    onQueued: async (value) => { events.push("open:queued"); queued.push(value); },
    onCreated: async (value) => { events.push("open:confirmed"); created.push(value); } };
  const key = () => drafts.creationDraftKey(props.storageKey, props.tenant.id, props.user.id, props.companyBranchId, props.kind, props.mode);
  memory.values.set(key(), JSON.stringify(initial ?? { version: 1, kind: "work", phase: "editing", form }));
  let renderedKey: string | null = null;
  const render = (): ReactNode => {
    const root = module.CreationScreen(props);
    const scope = key();
    if (renderedKey !== null && renderedKey !== scope) hooks.unmount();
    renderedKey = scope;
    const tree = hooks.render(() => root.type(root.props));
    hooks.flush();
    return tree;
  };
  render(); await settle(); render();
  function review(): void {
    action(render(), "Continuar a horario").onPress();
    action(render(), "Revisar solicitud").onPress();
  }
  return { hooks, props, memory, drafts, key, security, controls, submit, writes, submitted, queued, created, events, render, review, backs: () => backs };
}

for (const kind of ["work", "maintenance", "non_productive"] as const) test(`${kind}: can create multiple distinct requests after queue handoff without deleting the original`, async t => {
  const previousForm = { ...form, motive: "Revisar motor", equipment: { id: 4, label: "Camion" } };
  const previousInput = creationPayload(kind, previousForm, 1, requestId);
  const saved: CreationDraft = { ...savedQueued, kind, form: previousForm, input: previousInput };
  const fixture = await creationFixture(saved); t.after(() => fixture.hooks.unmount());
  const queuedInputs = [structuredClone(previousInput)];
  fixture.props.initialDate = "2026-09-18";
  fixture.props.onSubmit = async next => {
    fixture.submitted.push(next); queuedInputs.push(structuredClone(next));
    throw new OfflineQueuedError({ ...outcome, operationId: next.clientRequestId, operationIds: [next.clientRequestId], date: next.schedule.date, localGroupId: `local-${next.clientRequestId}`, localWorkId: `local-${next.clientRequestId}` });
  };
  for (let index = 1; index <= 2; index++) {
    const createAnother = action(fixture.render(), "Crear otro"); createAnother.onPress(); createAnother.onPress(); await settle();
    const store = fixture.drafts.openCreationDraftStore(fixture.key(), kind, 1);
    assert.deepEqual((await store.read())?.form, emptyCreationForm("2026-09-18"));
    assert.equal(fixture.submitted.length, index - 1);
    const fields = elements<{ form: CreationForm; onChange: (field: keyof CreationForm, value: CreationForm[keyof CreationForm]) => void }>(fixture.render(), "CreationFields")[0].props;
    fields.onChange("title", `Trabajo distinto ${index}`); fields.onChange("summary", "Alcance nuevo"); fields.onChange("motive", "Motivo nuevo"); fields.onChange("equipment", { id: 4, label: "Camion" });
    action(fixture.render(), "Continuar a horario").onPress();
    const times = elements<TimeFieldProps>(fixture.render(), "TimeField");
    times[0].props.onChange("11:00"); times[1].props.onChange("12:00");
    action(fixture.render(), "Revisar solicitud").onPress();
    assert.equal(fixture.submitted.length, index - 1);
    const confirm = action(fixture.render(), "Confirmar y crear"); confirm.onPress(); confirm.onPress(); await settle();
    assert.equal((await store.read())?.phase, "queued");
    assert.equal(fixture.submitted.length, index);
  }
  assert.equal(new Set(queuedInputs.map(entry => entry.clientRequestId)).size, 3);
  assert.deepEqual(queuedInputs[0], previousInput);
  fixture.hooks.unmount(); fixture.render(); await settle();
  assert.ok(action(fixture.render(), "Crear otro"));
  assert.equal(fixture.submitted.length, 2);
});

for (const phase of ["queued", "confirmed"] as const) test(`${phase}: failure saving a fresh form preserves the original persistent and in-memory draft`, async t => {
  const saved: CreationDraft = phase === "queued" ? savedQueued : { version: 1, kind: "work", phase, form, input, result };
  const fixture = await creationFixture(saved); t.after(() => fixture.hooks.unmount());
  const store = fixture.drafts.openCreationDraftStore(fixture.key(), "work", 1);
  await store.write(saved);
  fixture.controls.fail = "editing";
  action(fixture.render(), "Crear otro").onPress(); await settle();
  assert.deepEqual(await store.read(), saved);
  assert.deepEqual(JSON.parse(fixture.memory.values.get(fixture.key())!), saved);
  assert.equal(fixture.submitted.length, 0);
  fixture.controls.fail = undefined;
  action(fixture.render(), "Crear otro").onPress(); await settle();
  assert.equal((await store.read())?.phase, "editing");
  fixture.hooks.unmount(); fixture.render(); await settle();
  assert.ok(action(fixture.render(), "Continuar a horario"));
  assert.equal(fixture.submitted.length, 0);
});

test("queued screen follows confirmed operation without auto-navigation or resubmission", async t => {
  const fixture = await creationFixture(savedQueued); t.after(() => fixture.hooks.unmount());
  fixture.props.offline = snapshot(); fixture.render();
  const previous = JSON.stringify(fixture.props.offline);
  fixture.props.offline = snapshot("applied"); fixture.render(); await settle();
  assert.ok(action(fixture.render(), "Gestionar trabajo"));
  assert.equal(fixture.created.length + fixture.queued.length + fixture.submitted.length, 0);
  const store = fixture.drafts.openCreationDraftStore(fixture.key(), "work", 1);
  assert.equal((await store.read())?.phase, "confirmed");
  assert.equal(JSON.stringify(snapshot()), previous);
  action(fixture.render(), "Gestionar trabajo").onPress(); await settle();
  assert.deepEqual(fixture.created, [result]);
  assert.equal(fixture.submitted.length, 0);
});

test("zero pending is not confirmation: exact queued identity, body and valid result are required", () => {
  for (const status of ["pending", "syncing", "applied", "blocked", "needs_review", "conflict", "auth_required"] as const) {
    const current = snapshot(status); current.pending = 0;
    assert.equal(queuedCreationState(savedQueued, current).status, status === "applied" ? "confirmed" : ["blocked", "needs_review", "conflict"].includes(status) ? "review" : status);
  }
  assert.equal(queuedCreationState(savedQueued, null).status, "unavailable");
  const missing = snapshot("applied"); missing.operations = [];
  assert.equal(queuedCreationState(savedQueued, missing).status, "unavailable");
  for (const tamper of ["id", "local", "branch", "body", "result", "missing-result"] as const) {
    const current = snapshot("applied"); const operation = current.operations[0];
    if (operation.kind !== "create") throw new Error("INVALID_FIXTURE");
    if (tamper === "id") operation.id = "another-operation";
    if (tamper === "local") operation.localGroupId = "another-group";
    if (tamper === "branch") operation.input = { ...operation.input, companyBranchId: 2 };
    if (tamper === "body") operation.input = { ...input, schedule: { ...input.schedule, endTime: "11:30" } };
    if (tamper === "result") operation.result = { ...result, companyBranchId: 2 };
    if (tamper === "missing-result") operation.result = undefined;
    assert.equal(queuedCreationState(savedQueued, current).status, "unavailable", tamper);
  }
});

test("new request action ignores stale callbacks when locked or busy", async t => {
  const fixture = await creationFixture(savedQueued); t.after(() => fixture.hooks.unmount());
  const createAnother = action(fixture.render(), "Crear otro");
  fixture.props.busy = true; fixture.render(); createAnother.onPress(); await settle();
  fixture.props.busy = false; fixture.security.unlocked = false; fixture.render(); createAnother.onPress(); await settle();
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.submitted.length, 0);
});

function alerts(tree: ReactNode): string {
  return elements<{ accessibilityRole?: string; children?: ReactNode }>(tree, "Text")
    .filter(({ props }) => props.accessibilityRole === "alert").map(({ props }) => String(props.children)).join(" ");
}

test("header back traverses creation steps while list exit retains the draft guard", async t => {
  const fixture = await creationFixture(); t.after(() => fixture.hooks.unmount());
  fixture.review();
  action(fixture.render(), "Volver conservando borrador").onPress();
  assert.ok(action(fixture.render(), "Revisar solicitud"));
  assert.equal(fixture.backs(), 0);
  action(fixture.render(), "Volver conservando borrador").onPress();
  assert.ok(action(fixture.render(), "Continuar a horario"));
  assert.equal(fixture.backs(), 0);
  action(fixture.render(), "Volver a mis asignaciones").onPress();
  assert.equal(elements(fixture.render(), "CreationModal").length > 0, true);
  assert.equal(fixture.backs(), 0);
  assert.deepEqual(fixture.submitted, []);
});

for (const phase of ["queued", "confirmed"] as const) {
  const label = phase === "queued" ? "Ver trabajo local" : "Gestionar trabajo";
  const complete = (f: Awaited<ReturnType<typeof creationFixture>>): void => {
    if (phase === "queued") f.submit.reject(new OfflineQueuedError(outcome));
    else f.submit.resolve(result);
  };

  test(`${phase}: auto-opens only after the durable screen marker, with no duplicate send on double press`, async (t) => {
    const f = await creationFixture(); t.after(() => f.hooks.unmount());
    f.controls.hold = phase; f.controls.gate = deferred<void>();
    f.review();
    const save = action(f.render(), "Confirmar y crear");
    save.onPress(); save.onPress(); await settle();
    assert.equal(f.submitted.length, 1);
    complete(f); await settle();
    assert.equal(f.queued.length + f.created.length, 0);
    const fallback = action(f.render(), label);
    fallback.onPress(); fallback.onPress();
    assert.equal(f.writes.filter((entry) => entry.phase === phase).length, 1);
    f.controls.gate.resolve(); await settle();
    assert.equal(f.queued.length + f.created.length, 1);
    assert.ok(f.events.indexOf(`stored:${phase}`) < f.events.indexOf(`open:${phase}`));
    assert.equal(creationDraftSchema.parse(JSON.parse(f.memory.values.get(f.key()) ?? "null")).phase, phase);
    save.onPress(); await settle();
    assert.equal(f.submitted.length, 1);
    assert.deepEqual(f.submitted[0], input);
    assert.equal(f.backs(), 0);
  });

  test(`${phase}: delayed marker failure keeps recovery available without resending`, async (t) => {
    const f = await creationFixture(); t.after(() => f.hooks.unmount());
    f.controls.hold = phase; f.controls.gate = deferred<void>();
    f.review(); const save = action(f.render(), "Confirmar y crear"); save.onPress(); await settle();
    complete(f); await settle();
    f.controls.gate.reject(new Error("DISK_FULL")); await settle();
    assert.equal(f.queued.length + f.created.length, 0);
    assert.match(alerts(f.render()), /No vuelvas a crearla/);
    save.onPress(); assert.equal(f.submitted.length, 1);
    f.controls.hold = undefined;
    const fallback = action(f.render(), label); fallback.onPress(); fallback.onPress(); await settle();
    assert.equal(f.queued.length + f.created.length, 1);
    assert.equal(f.submitted.length, 1);
  });

  test(`${phase}: rejected navigation remains terminal and retries navigation only`, async (t) => {
    const f = await creationFixture(); t.after(() => f.hooks.unmount());
    const navigation = deferred<void>(); let attempts = 0;
    const open = async () => { attempts++; await navigation.promise; };
    if (phase === "queued") f.props.onQueued = open; else f.props.onCreated = open;
    f.review(); const save = action(f.render(), "Confirmar y crear"); save.onPress(); await settle();
    complete(f); await settle();
    action(f.render(), label).onPress(); assert.equal(attempts, 1);
    navigation.reject(new Error("NAVIGATION_FAILED")); await settle();
    assert.match(alerts(f.render()), phase === "queued" ? /sigue guardado en la cola local/ : /está confirmada/);
    assert.doesNotMatch(alerts(f.render()), /No se confirmó|no se envió/);
    save.onPress(); assert.equal(f.submitted.length, 1);
    if (phase === "queued") f.props.onQueued = async () => { attempts++; }; else f.props.onCreated = async () => { attempts++; };
    action(f.render(), label).onPress(); await settle();
    assert.equal(attempts, 2); assert.equal(f.submitted.length, 1);
  });

  test(`${phase}: unmounted completion still persists the outcome without navigating`, async () => {
    const f = await creationFixture(); f.review();
    const save = action(f.render(), "Confirmar y crear"); save.onPress(); await settle();
    f.hooks.unmount(); complete(f); await settle(); save.onPress(); await settle();
    assert.equal(f.queued.length + f.created.length, 0);
    assert.equal(f.submitted.length, 1);
    assert.equal(creationDraftSchema.parse(JSON.parse(f.memory.values.get(f.key()) ?? "null")).phase, phase);
  });

  test(`${phase}: device lock during persistence prevents auto-navigation and allows explicit recovery after unlock`, async (t) => {
    const f = await creationFixture(); t.after(() => f.hooks.unmount());
    f.controls.hold = phase; f.controls.gate = deferred<void>(); f.review();
    action(f.render(), "Confirmar y crear").onPress(); await settle(); complete(f); await settle();
    const fallback = action(f.render(), label);
    f.security.unlocked = false; f.controls.gate.resolve(); await settle();
    fallback.onPress(); await settle(); assert.equal(f.queued.length + f.created.length, 0);
    f.security.unlocked = true; f.controls.hold = undefined;
    action(f.render(), label).onPress(); await settle();
    assert.equal(f.queued.length + f.created.length, 1); assert.equal(f.submitted.length, 1);
  });

  test(`${phase}: restoring a terminal draft retains the explicit recovery button without auto-replay`, async (t) => {
    const saved: CreationDraft = phase === "queued" ? { version: 1, kind: "work", phase, form, input, outcome }
      : { version: 1, kind: "work", phase, form, input, result };
    const f = await creationFixture(saved); t.after(() => f.hooks.unmount());
    assert.equal(f.queued.length + f.created.length, 0); assert.equal(f.submitted.length, 0);
    action(f.render(), label).onPress(); await settle();
    assert.equal(f.queued.length + f.created.length, 1); assert.equal(f.submitted.length, 0);
  });
}

test("pending persistence failure never submits and retry preserves the original UUID and payload", async (t) => {
  const f = await creationFixture(); t.after(() => f.hooks.unmount());
  f.controls.hold = "pending"; f.controls.gate = deferred<void>(); f.review();
  action(f.render(), "Confirmar y crear").onPress(); await settle();
  f.controls.gate.reject(new Error("DISK_FULL")); await settle();
  assert.equal(f.submitted.length, 0); assert.equal(f.queued.length, 0);
  f.controls.hold = undefined;
  action(f.render(), "Reintentar misma solicitud").onPress(); await settle();
  assert.equal(f.submitted.length, 1); assert.deepEqual(f.submitted[0], input);
  f.submit.reject(new OfflineQueuedError(outcome)); await settle();
  assert.equal(f.queued.length, 1);
});

test("a security lock before pending persistence finishes prevents even the submit callback", async (t) => {
  const f = await creationFixture(); t.after(() => f.hooks.unmount());
  f.controls.hold = "pending"; f.controls.gate = deferred<void>(); f.review();
  const save = action(f.render(), "Confirmar y crear"); save.onPress(); await settle();
  f.security.unlocked = false; f.controls.gate.resolve(); await settle(); save.onPress();
  assert.equal(f.submitted.length, 0); assert.equal(f.queued.length, 0);
});

for (const scope of ["tenant", "user", "branch", "kind", "storage"] as const) {
  test(`changing ${scope} while the queued marker writes cannot navigate the new creation screen`, async (t) => {
    const f = await creationFixture(); t.after(() => f.hooks.unmount());
    f.controls.hold = "queued"; f.controls.gate = deferred<void>(); f.review();
    action(f.render(), "Confirmar y crear").onPress(); await settle();
    f.submit.reject(new OfflineQueuedError(outcome)); await settle(); const oldKey = f.key();
    if (scope === "tenant") f.props.tenant = { ...tenant, id: "tenant-2" };
    if (scope === "user") f.props.user = { ...user(), id: 10 };
    if (scope === "branch") f.props.companyBranchId = 2;
    if (scope === "kind") f.props.kind = "maintenance";
    if (scope === "storage") f.props.storageKey = "another-session";
    f.render(); await settle();
    f.controls.gate.resolve(); await settle();
    assert.equal(f.queued.length, 0); assert.equal(f.created.length, 0);
    assert.equal(f.memory.values.has(f.key()), false);
    assert.equal(creationDraftSchema.parse(JSON.parse(f.memory.values.get(oldKey) ?? "null")).phase, "queued");
    assert.equal(f.submitted.length, 1);
  });
}

test("a foreign queued outcome cannot advance or overwrite the pending draft", async (t) => {
  const f = await creationFixture(); t.after(() => f.hooks.unmount()); f.review();
  action(f.render(), "Confirmar y crear").onPress(); await settle();
  f.submit.reject(new OfflineQueuedError({ ...outcome, operationId: "52b5201d-4ea9-4dad-9f9d-191d11ea8462" })); await settle();
  assert.equal(f.queued.length, 0);
  assert.match(alerts(f.render()), /no corresponde/);
  assert.equal(f.writes.some((entry) => entry.phase === "queued"), false);
});

test("missing optional callbacks retain manual back navigation after durable storage", async (t) => {
  const f = await creationFixture(); t.after(() => f.hooks.unmount()); f.props.onQueued = undefined; f.review();
  action(f.render(), "Confirmar y crear").onPress(); await settle();
  f.submit.reject(new OfflineQueuedError(outcome)); await settle();
  assert.equal(f.backs(), 0); action(f.render(), "Ver trabajo local").onPress(); await settle();
  assert.equal(f.backs(), 1); assert.equal(f.submitted.length, 1);
});

test("a synchronous callback failure remains a queued navigation error, not a submission failure", async (t) => {
  const f = await creationFixture(); t.after(() => f.hooks.unmount());
  f.props.onQueued = () => { throw new Error("NAVIGATION_FAILED"); }; f.review();
  const save = action(f.render(), "Confirmar y crear"); save.onPress(); await settle();
  f.submit.reject(new OfflineQueuedError(outcome)); await settle();
  assert.match(alerts(f.render()), /sigue guardado en la cola local/);
  assert.doesNotMatch(alerts(f.render()), /No se confirmó|no se envió/);
  save.onPress(); assert.equal(f.submitted.length, 1);
  assert.ok(action(f.render(), "Ver trabajo local"));
});

test("a retained submit callback observes the latest busy gate before writing or submitting", async (t) => {
  const f = await creationFixture(); t.after(() => f.hooks.unmount()); f.review();
  const save = action(f.render(), "Confirmar y crear");
  f.props.busy = true; f.render(); save.onPress(); await settle();
  assert.equal(f.submitted.length, 0); assert.equal(f.writes.some((entry) => entry.phase === "pending"), false);
});

test("wizard Next still validates synchronously and never calls submission", async (t) => {
  const f = await creationFixture({ version: 1, kind: "work", phase: "editing", form: emptyCreationForm(date) });
  t.after(() => f.hooks.unmount());
  action(f.render(), "Continuar a horario").onPress();
  assert.match(alerts(f.render()), /Revisa los campos/);
  assert.ok(action(f.render(), "Continuar a horario")); assert.equal(f.submitted.length, 0);
});

test("clock onChange edits the creation draft only; invalid end time still blocks review and valid times require explicit create", async t => {
  const f = await creationFixture(); t.after(() => f.hooks.unmount());
  action(f.render(), "Continuar a horario").onPress();
  let fields = elements<TimeFieldProps>(f.render(), "TimeField");
  assert.equal(fields.length, 2);
  assert.equal(fields[0].props.value, "09:00");
  fields[0].props.onChange("23:00"); fields[1].props.onChange("00:07");
  assert.equal(f.submitted.length, 0); assert.equal(f.queued.length + f.created.length, 0);
  action(f.render(), "Revisar solicitud").onPress();
  assert.match(alerts(f.render()), /Revisa los campos/);
  fields = elements<TimeFieldProps>(f.render(), "TimeField");
  assert.equal(fields.length, 2); assert.equal(fields[1].props.value, "00:07");
  fields[1].props.onChange("23:59");
  action(f.render(), "Revisar solicitud").onPress();
  assert.equal(f.submitted.length, 0);
  const confirm = action(f.render(), "Confirmar y crear"); confirm.onPress(); confirm.onPress(); await settle();
  assert.equal(f.submitted.length, 1);
  assert.deepEqual(f.submitted[0], { ...input, schedule: { date, startTime: "23:00", endTime: "23:59" } });
  f.submit.reject(new OfflineQueuedError(outcome)); await settle();
  assert.equal(f.queued.length, 1);
});