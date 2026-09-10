import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import type { MaintenanceDeliveryContext } from "../src/domain/orderLifecycle";
import { makeDemoData } from "../src/infrastructure/demoData";
import { clearOrderLifecycleDrafts, deleteLifecycleDraft, readLifecycleDraft, saveLifecycleDraft } from "../src/screens/orders/lifecycle/lifecycleDrafts";
import { deliveryDraftErrors, deliveryInput, incompleteDeliveryChecklists, initialDeliveryDraft, requiresClientSignature, suggestedDurationMinutes } from "../src/screens/orders/lifecycle/lifecycleRules";
import { appendSignaturePoint, hasSignature, requireSignaturePng, SIGNATURE_MAX_POINTS, SIGNATURE_MAX_BYTES, signaturePoint, signaturePointCount, type SignatureStrokes } from "../src/screens/orders/lifecycle/signatureGeometry";

const context: MaintenanceDeliveryContext = {
  groupId: "maintenance-101", status: "in_progress", maintenanceType: "correctivo", finalizationNote: null, damageType: null,
  durationMinutes: null, startedAt: null, finalizedAt: null, incompleteChecklists: [],
};
const strokes: SignatureStrokes = [[{ x: 10, y: 40 }, { x: 40, y: 10 }, { x: 70, y: 40 }]];

test("only canonical corrective and detention types require client receipt", () => {
  for (const type of ["correctivo", "detencion", "CORRECTIVO"]) assert.equal(requiresClientSignature(type), true);
  for (const type of ["preventivo", "rutinario", "checklist", null, undefined]) assert.equal(requiresClientSignature(type), false);
});

test("duration mirrors maintenance web totals without double counting sessions or product containers", () => {
  const group = makeDemoData().groups[0];
  const base = group.works[0];
  group.works = [
    { ...base, status: "in_progress", executedMinutes: 30, elapsedSeconds: 3600 },
    { ...base, status: "paused", totalExecutedMinutes: 40, elapsedSeconds: 600 },
    { ...base, status: "completed", executedMinutes: 20, elapsedSeconds: 9000 },
    { ...base, status: "pending", executedMinutes: 500 },
    { ...base, title: "Productos utilizados", executedMinutes: 1000, elapsedSeconds: 90000 },
  ];
  assert.equal(suggestedDurationMinutes(group), 120);
  assert.equal(initialDeliveryDraft(group, { ...context, durationMinutes: 95 }).hours, "1");
  assert.equal(initialDeliveryDraft(group, { ...context, durationMinutes: 95 }).minutes, "35");
});

test("prefill preserves canonical note and failure classification", () => {
  const draft = initialDeliveryDraft(makeDemoData().groups[0], { ...context, finalizationNote: "Revisión pendiente", damageType: "operacional", suggestedDurationMinutes: 125 });
  assert.equal(draft.note, "Revisión pendiente");
  assert.equal(draft.faultType, "operative");
  assert.equal(draft.hours, "2");
  assert.equal(draft.minutes, "5");
  assert.deepEqual(draft.technicianStrokes, []);
});

test("delivery requires real strokes and the two fixed failure options for receipt", () => {
  const draft = initialDeliveryDraft(makeDemoData().groups[0], context);
  assert.ok(deliveryDraftErrors(draft, true).technicianSignature);
  assert.ok(deliveryDraftErrors(draft, true).clientSignature);
  assert.ok(deliveryDraftErrors(draft, true).receivedByName);
  assert.ok(deliveryDraftErrors({ ...draft, faultType: "undetermined" }, true).faultType);
  assert.deepEqual(deliveryDraftErrors({ ...draft, technicianStrokes: strokes }, false), {});
  assert.deepEqual(deliveryDraftErrors({ ...draft, technicianStrokes: strokes, clientStrokes: strokes, faultType: "wear", receivedByName: "María Soto" }, true), {});
});

test("duration rejects negative, fractional, excessive and overflow values", () => {
  const draft = { ...initialDeliveryDraft(makeDemoData().groups[0], context), technicianStrokes: strokes };
  for (const hours of ["-1", "1.5", "100", "NaN"]) assert.ok(deliveryDraftErrors({ ...draft, hours }, false).duration);
  for (const minutes of ["-1", "1.5", "60", "100"]) assert.ok(deliveryDraftErrors({ ...draft, minutes }, false).duration);
  assert.equal(deliveryDraftErrors({ ...draft, hours: "", minutes: "" }, false).duration, undefined);
});

test("input uses web field names and omits client fields for other maintenance types", async () => {
  const png = `data:image/png;base64,${(await sharp(Buffer.from('<svg width="768" height="320"><path d="M10 40 L40 10 L70 40" fill="none" stroke="blue"/></svg>')).png().toBuffer()).toString("base64")}`;
  const draft = { ...initialDeliveryDraft(makeDemoData().groups[0], context), hours: "0", minutes: "0", note: "  ", technicianStrokes: strokes, clientStrokes: strokes, receivedByName: "  María  ", faultType: "wear" as const };
  assert.deepEqual(deliveryInput(draft, false, png, png), { note: null, durationMinutes: null, faultType: null, receivedByName: null, technicianSignature: png, clientSignature: null });
  assert.equal(deliveryInput(draft, true, png, png).receivedByName, "María");
  assert.equal("finalizedAt" in deliveryInput(draft, true, png, png), false);
});

test("checklist preflight never locks children based on the parent state", () => {
  const group = makeDemoData().groups[0];
  group.status = "delivered";
  assert.ok(incompleteDeliveryChecklists(group).length > 0);
  group.works = group.works.map((work) => ({ ...work, checklists: [] }));
  assert.deepEqual(incompleteDeliveryChecklists(group), []);
  assert.equal(group.works[0].status, "in_progress");
  assert.equal(group.works[0].canExecute, true);
});

test("signature coordinates are scaled and bounded; taps are not signatures", () => {
  assert.deepEqual(signaturePoint(150, 80, 300, 160), { x: 384, y: 160 });
  assert.deepEqual(signaturePoint(-30, 900, 300, 160), { x: 0, y: 320 });
  const first = appendSignaturePoint([], { x: 10, y: 10 }, true);
  assert.equal(hasSignature(first), false);
  const next = appendSignaturePoint(first, { x: 60, y: 40 });
  assert.equal(hasSignature(next), true);
  assert.equal(first[0].length, 1);
  assert.equal(next[0].length, 2);
  const full: SignatureStrokes = [Array.from({ length: SIGNATURE_MAX_POINTS }, (_, index) => ({ x: index % 768, y: index % 320 }))];
  assert.equal(appendSignaturePoint(full, { x: 10, y: 40 }, true), full);
  assert.equal(signaturePointCount(full), SIGNATURE_MAX_POINTS);
});

test("PNG validation accepts real encoders and rejects fake signatures, excessive bytes and dimensions", async () => {
  const png = await sharp({ create: { width: 768, height: 320, channels: 4, background: "white" } }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  assert.equal(requireSignaturePng(dataUrl), dataUrl);
  assert.throws(() => requireSignaturePng("data:image/png;base64,placeholder"));
  assert.throws(() => requireSignaturePng("data:image/svg+xml;base64,PHN2Zz4="));
  assert.throws(() => requireSignaturePng(`data:image/png;base64,${Buffer.concat([png, Buffer.alloc(SIGNATURE_MAX_BYTES)]).toString("base64")}`));
  const large = await sharp({ create: { width: 1025, height: 2, channels: 4, background: "white" } }).png().toBuffer();
  assert.throws(() => requireSignaturePng(`data:image/png;base64,${large.toString("base64")}`));
});

test("drafts survive remounts and remain isolated by tenant user branch mode and order", () => {
  const draft = initialDeliveryDraft(makeDemoData().groups[0], context);
  const first = "tenant-a/user-1/branch-1/live/order-lifecycle/maintenance-101";
  const second = "tenant-b/user-1/branch-1/live/order-lifecycle/maintenance-101";
  saveLifecycleDraft(first, { ...draft, technicianStrokes: strokes });
  saveLifecycleDraft(second, { ...draft, note: "Otra empresa" });
  assert.deepEqual(readLifecycleDraft(first)?.technicianStrokes, strokes);
  assert.equal(readLifecycleDraft(second)?.note, "Otra empresa");
  clearOrderLifecycleDrafts("tenant-a/user-1/branch-1/");
  assert.equal(readLifecycleDraft(first), null);
  assert.equal(readLifecycleDraft(second)?.note, "Otra empresa");
  deleteLifecycleDraft(second);
});