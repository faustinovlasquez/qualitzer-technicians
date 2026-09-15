/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import type { AndroidNativeProps } from "@react-native-community/datetimepicker";
import { clockFromPickerDate, clockPickerDate, dayOffsetLabel, formatClock, parseClock, parseSelectionNumber } from "../src/ui/time/timeValues";
import { createAndroidTimeDialog, TIME_PICKER_BUSY, TIME_PICKER_UNAVAILABLE } from "../src/ui/time/androidTimeDialog";
import { creationPayload, emptyCreationForm, validateCreationForm } from "../src/screens/creation/creationForm";
import { creationInputSchema } from "../src/domain/creation";
import { notificationPreferencesSchema } from "../src/domain/notifications";
import { manualCompletion } from "../src/screens/workDetail/detailRules";
import { deliveryDraftErrors, deliveryInput, type DeliveryDraft } from "../src/screens/orders/lifecycle/lifecycleRules";
import { loadSource } from "./helpers/tenant-challenge";

for (const [hours, minutes, expected] of [[0, 0, "00:00"], [8, 7, "08:07"], [23, 59, "23:59"]] as const) {
  test(`clock selection pads and preserves ${expected}`, () => {
    assert.equal(formatClock(hours, minutes), expected);
    assert.deepEqual(parseClock(expected), { hours, minutes });
    assert.equal(clockFromPickerDate(clockPickerDate(expected)), expected);
  });
}

test("clock values stay exact across device timezones without converting business dates", () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ["UTC", "America/Santiago", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kathmandu"]) {
      process.env.TZ = timezone;
      for (const clock of ["00:00", "00:07", "12:59", "23:59"]) {
        const date = clockPickerDate(clock);
        assert.equal(date.getFullYear(), 2000);
        assert.equal(date.getMonth(), 0);
        assert.equal(date.getDate(), 15);
        assert.equal(clockFromPickerDate(date), clock);
      }
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("invalid historic clocks are rejected, not trimmed or silently padded", () => {
  for (const value of ["", "8:07", "08:7", "24:00", "23:60", "-1:00", "08:07 ", " 08:07", "08:07:00", "08:07Z"]) assert.equal(parseClock(value), null, value);
  for (const pair of [[24, 0], [0, 60], [1.5, 0], [0, -1], [NaN, 0]]) assert.equal(formatClock(pair[0], pair[1]), null);
  assert.equal(clockFromPickerDate(new Date(NaN)), null);
  assert.equal(clockFromPickerDate(clockPickerDate("bad")), "12:00", "fallback is only a local picker seed");
});

test("duration and day-offset choices retain explicit zero, legacy 1 and all bounds", () => {
  assert.equal(parseSelectionNumber("00", 99), 0);
  assert.equal(parseSelectionNumber("07", 59), 7);
  assert.equal(parseSelectionNumber("99", 99), 99);
  assert.equal(parseSelectionNumber("59", 59), 59);
  assert.equal(parseSelectionNumber("30", 30), 30);
  for (const value of ["", "100", "-1", "1.5", "1 ", "NaN"]) assert.equal(parseSelectionNumber(value, 99), null);
  assert.equal(parseSelectionNumber("60", 59), null);
  assert.equal(parseSelectionNumber("31", 30), null);
  assert.equal(dayOffsetLabel(0), "Mismo día");
  assert.equal(dayOffsetLabel(1), "Día siguiente");
  assert.equal(dayOffsetLabel(30), "30 días después");
});

function nativeFixture(open = createAndroidTimeDialog()) {
  const options: AndroidNativeProps[] = [];
  const selected: string[] = [];
  const errors: string[] = [];
  let valid = true;
  let canceled = 0;
  let dismissed = 0;
  let resolveDismiss!: (result: boolean) => void;
  const dismissPromise = new Promise<boolean>(done => { resolveDismiss = done; });
  const port = { open: (settings: AndroidNativeProps) => { options.push(settings); }, dismiss: (_mode: "time") => { dismissed += 1; return dismissPromise; } };
  const request = { value: "08:07", isCurrent: () => valid, onConfirm: (value: string) => selected.push(value), onCancel: () => { canceled += 1; }, onError: (error: string) => errors.push(error) };
  return { open, port, request, options, selected, errors, resolveDismiss, invalidate: () => { valid = false; },
    get canceled() { return canceled; }, get dismissed() { return dismissed; } };
}

function select(options: AndroidNativeProps, value: string): void {
  const date = clockPickerDate(value);
  options.onValueChange?.({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } }, date);
}

test("Android imperative clock uses spinner, 24 hours and minute precision one", () => {
  const f = nativeFixture();
  const cleanup = f.open(f.port, f.request);
  const options = f.options[0];
  assert.equal(options.mode, "time"); assert.equal(options.display, "spinner");
  assert.equal(options.is24Hour, true); assert.equal(options.minuteInterval, 1);
  assert.equal(options.timeZoneName, undefined);
  assert.equal(clockFromPickerDate(options.value), "08:07");
  select(options, "23:59"); cleanup(); select(options, "00:00");
  assert.deepEqual(f.selected, ["23:59"]);
  assert.equal(f.dismissed, 0);
});

test("native cancel emits no change and rejects retained selection callbacks", () => {
  const f = nativeFixture(); const cleanup = f.open(f.port, f.request);
  f.options[0].onDismiss?.();
  select(f.options[0], "00:07"); cleanup();
  assert.equal(f.canceled, 1); assert.deepEqual(f.selected, []);
  assert.equal(f.dismissed, 0);
});

test("second field cannot replace a live singleton or close it with its cleanup", async () => {
  const open = createAndroidTimeDialog();
  const first = nativeFixture(open); const second = nativeFixture(open);
  const cancelFirst = open(first.port, first.request);
  const cancelSecond = open(second.port, second.request);
  assert.equal(second.options.length, 0); assert.deepEqual(second.errors, [TIME_PICKER_BUSY]);
  cancelSecond(); assert.equal(first.dismissed, 0);
  cancelFirst(); assert.equal(first.dismissed, 1);
  open(second.port, second.request); assert.equal(second.options.length, 0, "hold ownership until dismiss settles");
  select(first.options[0], "23:59"); assert.deepEqual(first.selected, []);
  open(second.port, second.request); assert.equal(second.options.length, 0, "terminal callback cannot race an outstanding native dismiss");
  first.resolveDismiss(true); await Promise.resolve();
  const finalCleanup = open(second.port, second.request);
  assert.equal(second.options.length, 1);
  cancelFirst(); select(first.options[0], "00:00");
  assert.equal(second.dismissed, 0, "old owner cannot dismiss a newer dialog");
  select(second.options[0], "00:07"); finalCleanup();
  assert.deepEqual(second.selected, ["00:07"]);
});

test("invalidated device/scope results dismiss exactly once and never update fields", async () => {
  const f = nativeFixture(); const cleanup = f.open(f.port, f.request);
  f.invalidate(); select(f.options[0], "23:59"); cleanup();
  assert.equal(f.dismissed, 1); assert.deepEqual(f.selected, []);
  f.resolveDismiss(true); await Promise.resolve();
  const denied = nativeFixture(); denied.invalidate(); denied.open(denied.port, denied.request);
  assert.equal(denied.options.length, 0);
});

test("native missing-Activity, synchronous errors and timeout return bounded friendly messages", async () => {
  for (const synchronous of [false, true]) {
    const f = nativeFixture();
    if (synchronous) f.port.open = () => { throw new Error("SECRET_ACTIVITY_DETAILS"); };
    const cleanup = f.open(f.port, f.request);
    if (!synchronous) f.options[0].onError?.(new Error("SECRET_ACTIVITY_DETAILS"));
    assert.deepEqual(f.errors, [TIME_PICKER_UNAVAILABLE]); assert.equal(f.dismissed, 0);
    cleanup(); f.resolveDismiss(true); await Promise.resolve();
  }
  let expire: (() => void) | undefined;
  let interval = 0;
  const timed = loadSource<typeof import("../src/ui/time/androidTimeDialog")>("ui/time/androidTimeDialog.ts", id => {
    assert.equal(id, "./timeValues"); return { clockPickerDate, clockFromPickerDate };
  }, { setTimeout: (callback: () => void, milliseconds: number) => { expire = callback; interval = milliseconds; return 1; }, clearTimeout: () => {} });
  const f = nativeFixture(timed.createAndroidTimeDialog()); f.open(f.port, f.request);
  assert.equal(interval, 300000); assert.ok(expire); expire();
  assert.deepEqual(f.errors, [TIME_PICKER_UNAVAILABLE]); assert.equal(f.dismissed, 1);
  select(f.options[0], "23:59"); assert.deepEqual(f.selected, []);
  f.resolveDismiss(true); await Promise.resolve();
});

test("dismiss rejection cannot hand uncertain native ownership to another field", async () => {
  const open = createAndroidTimeDialog(); const first = nativeFixture(open); const second = nativeFixture(open);
  first.port.dismiss = () => Promise.reject(new Error("NATIVE_DISMISS_UNAVAILABLE"));
  const cleanup = open(first.port, first.request); cleanup(); await Promise.resolve();
  open(second.port, second.request); assert.equal(second.options.length, 0);
  assert.deepEqual(second.errors, [TIME_PICKER_BUSY]);
  first.options[0].onDismiss?.();
  open(second.port, second.request); assert.equal(second.options.length, 1);
  select(second.options[0], "00:07"); assert.deepEqual(second.selected, ["00:07"]);
});

test("clock selections preserve strict creation, notification, completion and duration payloads", () => {
  const date = "2026-09-14";
  const id = "00000000-0000-4000-8000-000000000007";
  const form = { ...emptyCreationForm(date), title: "Trabajo", summary: "Resumen", startTime: "08:07", endTime: "23:59" };
  assert.deepEqual(validateCreationForm("work", form), {});
  const created = creationPayload("work", form, 1, id);
  assert.deepEqual(created, { kind: "work", companyBranchId: 1, clientRequestId: id,
    schedule: { date, startTime: "08:07", endTime: "23:59" }, work: { title: "Trabajo", summary: "Resumen", priority: "medium" } });
  assert.equal(creationInputSchema.safeParse({ ...created, pickerDate: clockPickerDate("08:07") }).success, false);
  assert.ok(validateCreationForm("work", { ...form, endTime: "00:07" }).endTime);
  const preferences = { assignments: true, timers: true, remindAfterMinutes: 30, repeatEveryMinutes: 120, quietHoursStart: "23:59", quietHoursEnd: "00:07" };
  assert.deepEqual(notificationPreferencesSchema.parse(preferences), preferences);
  assert.equal(notificationPreferencesSchema.safeParse({ ...preferences, date }).success, false);
  assert.equal(notificationPreferencesSchema.safeParse({ ...preferences, quietHoursStart: "8:07" }).success, false);
  const range = { startDate: date, endDate: date };
  assert.equal(manualCompletion(date, "23:59", "00:07", 0, range).input, null, "no implicit next day");
  assert.deepEqual(manualCompletion(date, "23:59", "00:07", 1, range).input,
    { status: "delivered", executionDates: [date], executionStartTime: "23:59", executionEndTime: "00:07", endDateOffset: 1, isManual: true });
  assert.equal(manualCompletion(date, "23:59", "00:07", 31, range).input, null);
  const draft: DeliveryDraft = { hours: "99", minutes: "59", note: " Nota ", faultType: null, receivedByName: "", technicianStrokes: [], clientStrokes: [] };
  assert.deepEqual(deliveryInput(draft, false, "png", null), { note: "Nota", durationMinutes: 5999, faultType: null, receivedByName: null, technicianSignature: "png", clientSignature: null });
  assert.equal(deliveryInput({ ...draft, hours: "0", minutes: "0" }, false, "png", null).durationMinutes, null);
  assert.ok(deliveryDraftErrors({ ...draft, hours: "100" }, false).duration);
  assert.ok(deliveryDraftErrors({ ...draft, minutes: "60" }, false).duration);
});

function source(relative: string) {
  const path = resolve(__dirname, "../src", relative);
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

test("AST inventory: all four input locations use selectors and automatic time remains a read-only summary", () => {
  const inventory = [
    { path: "screens/workDetail/CompletionDialog.tsx", times: ["start", "end"], numbers: ["offset"] },
    { path: "screens/creation/CreationScreen.tsx", times: ["form.startTime", "form.endTime"], numbers: [] },
    { path: "screens/notifications/NotificationSettingsScreen.tsx", times: ["preferences.quietHoursStart", "preferences.quietHoursEnd"], numbers: [] },
    { path: "screens/orders/lifecycle/MaintenanceDeliveryDialog.tsx", times: [], numbers: ["draft.hours", "draft.minutes"] },
  ];
  for (const item of inventory) {
    const file = source(item.path);
    const found = new Map<string, string>();
    let readOnly = 0;
    function visit(node: ts.Node): void {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(file);
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
        const attribute = (name: string) => attributes.find(entry => entry.name.getText(file) === name)?.initializer;
        const value = attribute("value");
        const expression = value && ts.isJsxExpression(value) ? value.expression?.getText(file) : undefined;
        if (expression && [...item.times, ...item.numbers].includes(expression)) {
          assert.equal(tag, item.times.includes(expression) ? "TimeField" : expression === "offset" ? "DayOffsetField" : "NumericSelectField");
          assert.ok(attribute("onChange")); assert.ok(attribute("disabled")); assert.ok(attribute("scopeKey"));
          assert.equal(attribute("onChangeText"), undefined); assert.equal(attribute("keyboardType"), undefined);
          found.set(expression, tag);
        }
        if (tag === "Field" && expression?.startsWith("timing?.execution")) {
          assert.equal(attribute("editable")?.getText(file), "{false}");
          assert.equal(attribute("onChangeText"), undefined); readOnly += 1;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.equal(found.size, item.times.length + item.numbers.length, item.path);
    if (item.path.includes("CompletionDialog")) {
      assert.equal(readOnly, 0);
      assert.match(file.text, /Tiempo trabajado/);
      assert.match(file.text, /clock\(elapsed\)/);
    }
  }
});

test("web time UI has no native runtime import, keyboard input or timezone conversion", () => {
  for (const path of ["ui/time/TimeField.tsx", "ui/time/TimePickerPanel.tsx", "ui/time/SelectorUi.tsx", "ui/time/timeValues.ts"]) {
    const file = source(path);
    assert.doesNotMatch(file.text, /TextInput|toISOString|Date\.UTC|getUTC|setUTC|runTrustedNativePicker/);
    for (const node of file.statements) if (ts.isImportDeclaration(node)) assert.doesNotMatch(node.moduleSpecifier.getText(file), /datetimepicker/);
  }
  const native = source("ui/time/TimePickerPanel.native.tsx");
  assert.doesNotMatch(native.text, /runTrustedNativePicker|useTrustedNativePicker|setForeground|unlock\(/);
  assert.match(native.text, /session\.bindCleanup\(cancel\)/);
});