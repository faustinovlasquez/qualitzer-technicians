/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactElement, ReactNode } from "react";
import * as jsx from "react/jsx-runtime";
import type { AndroidNativeProps, IOSNativeProps } from "@react-native-community/datetimepicker";
import type { DeviceSecurityUi } from "../src/security/DeviceSecurityContext";
import type { StatusInput } from "../src/domain/models";
import type { CompletionDialogProps } from "../src/screens/workDetail/CompletionDialog";
import type { TimeFieldProps } from "../src/ui/time/TimeField";
import type { TimePickerPanelProps } from "../src/ui/time/TimePickerPanel";
import type { NumericSelectFieldProps } from "../src/ui/time/NumericSelectField";
import type { SelectionFieldProps, SelectionSession } from "../src/ui/time/useSelectionSession";
import * as values from "../src/ui/time/timeValues";
import * as androidDialog from "../src/ui/time/androidTimeDialog";
import { work } from "../server/tests/fixtures";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";
import { action, elements, uiModule } from "./helpers/durable-ui";
import { unlockedProvider } from "./helpers/trusted-native-picker";

interface ModalActions { children?: ReactNode; canConfirm?: boolean; onConfirm(): void; onCancel(): void; }
interface Chip { label: string; selected: boolean; onPress(): void; }
interface Trigger { value: string; disabled: boolean; error?: string; onPress(): void; }

function selectionFixture(security: DeviceSecurityUi | null) {
  const hooks = reactFixture();
  const changes: string[] = [];
  const control = { security, props: { value: "08:07", scopeKey: "session-1/work-1", disabled: false, onChange: (value: string) => { changes.push(value); } } };
  const react = { ...hooks.react, useContext: () => control.security };
  const sessionModule = loadSource<typeof import("../src/ui/time/useSelectionSession")>("ui/time/useSelectionSession.ts", id => {
    if (id === "react") return react;
    if (id === "../../security/DeviceSecurityContext") return { DeviceSecurityContext: {} };
    throw new Error(`UNEXPECTED_TIME_SESSION_IMPORT:${id}`);
  });
  function render(flush = true) {
    const result = hooks.render(() => sessionModule.useSelectionSession(control.props));
    if (flush) hooks.flush();
    return result;
  }
  render();
  return { hooks, changes, control, render, close: hooks.unmount, open() { render().open(); const session = render().session; assert.ok(session); return session; } };
}

test("shared session double-tap opens once; cancel/mount never emits a value", async t => {
  const p = await unlockedProvider(); t.after(p.close);
  const f = selectionFixture(p.security); t.after(f.close);
  assert.deepEqual(f.changes, []);
  const open = f.render().open; open(); open();
  const first = f.render().session; assert.ok(first); assert.equal(first.id, 1);
  let disposed = 0; first.bindCleanup(() => { disposed += 1; });
  first.cancel(); first.commit("23:59");
  assert.deepEqual(f.changes, []); assert.equal(disposed, 1);
  const second = f.open(); second.commit("00:07"); second.commit("23:59");
  assert.deepEqual(f.changes, ["00:07"]);
});

test("security lock dismisses synchronously and Home still requires normal authentication", async t => {
  const p = await unlockedProvider(); t.after(p.close);
  const f = selectionFixture(p.security); t.after(f.close);
  const selected = f.open(); let disposed = 0;
  selected.bindCleanup(() => { disposed += 1; });
  assert.equal(p.controller.getSnapshot().nativeInteractionPending, undefined);
  p.emit(false);
  assert.equal(disposed, 1, "native dismiss happens in controller subscription, before React rerender");
  selected.commit("23:59"); assert.deepEqual(f.changes, []);
  p.emit(true); await p.settle();
  assert.equal(p.security.isUnlocked(), false);
  assert.equal(p.adapter.prompts.length, 2, "clock is not a trusted camera/Activity exemption");
  f.control.security = p.security; f.render().open(); assert.equal(f.render().session, null);
  p.adapter.prompts[1].resolve({ success: true }); await p.settle();
  f.control.security = p.security; f.render(); selected.commit("00:00");
  assert.deepEqual(f.changes, []);
});

for (const changed of ["value", "scope", "disabled", "privacy", "provider", "unmount"] as const) {
  test(`${changed} invalidates retained session results and native cleanup`, async t => {
    const p = await unlockedProvider(); t.after(p.close);
    const f = selectionFixture(p.security); t.after(f.close);
    const session = f.open(); let cleanup = 0; session.bindCleanup(() => { cleanup += 1; });
    if (changed === "value") f.control.props.value = "23:59";
    if (changed === "scope") f.control.props.scopeKey = "session-2/work-1";
    if (changed === "disabled") f.control.props.disabled = true;
    if (changed === "privacy") f.control.security = { ...p.security, blocked: true, isUnlocked: () => false };
    if (changed === "provider") f.control.security = null;
    if (changed === "unmount") f.close(); else f.render();
    session.commit("00:07"); session.cancel();
    assert.deepEqual(f.changes, []); assert.equal(cleanup, 1);
  });
}

test("scope ABA and invalidation before passive cleanup cannot admit an old result", async t => {
  const p = await unlockedProvider(); t.after(p.close);
  const f = selectionFixture(p.security); t.after(f.close);
  const session = f.open();
  f.control.props = { ...f.control.props, scopeKey: "other-session" }; f.render(false);
  f.control.props = { ...f.control.props, scopeKey: "session-1/work-1" }; f.render(false);
  session.commit("23:59"); assert.deepEqual(f.changes, []);
  f.hooks.flush();
});

test("no security provider fails closed instead of opening a native dialog", () => {
  const f = selectionFixture(null);
  try { f.render().open(); assert.equal(f.render().session, null); assert.equal(f.render().disabled, true); }
  finally { f.close(); }
});

function localSession() {
  const changes: string[] = [];
  let active = true;
  let cleanup = () => {};
  const session: SelectionSession = { id: 1, isCurrent: () => active,
    cancel: () => { if (active) { active = false; cleanup(); } },
    commit: value => { if (active) { active = false; cleanup(); changes.push(value); } },
    bindCleanup: callback => { if (active) cleanup = callback; else callback(); },
  };
  return { changes, session };
}

function uiImports(hooks: ReturnType<typeof reactFixture>, id: string): unknown {
  if (id === "react") return hooks.react;
  if (id === "react/jsx-runtime") return jsx;
  if (id === "react-native") return { View: "View", Text: "Text" };
  if (id === "../components") return { Button: "Button", IconButton: "IconButton" };
  if (id === "./SelectorUi") return { SelectorTrigger: "SelectorTrigger", SelectionModal: "SelectionModal", SelectionChip: "SelectionChip", timeStyles: {} };
  if (id === "./timeValues") return values;
  throw new Error(`UNEXPECTED_TIME_UI_IMPORT:${id}`);
}

test("web grid offers every minute; staged 23:59 is applied only by explicit confirmation", t => {
  const hooks = reactFixture(); t.after(hooks.unmount);
  const f = localSession();
  const module = loadSource<typeof import("../src/ui/time/TimePickerPanel")>("ui/time/TimePickerPanel.tsx", id => uiImports(hooks, id));
  const render = () => hooks.render(() => module.TimePickerPanel({ label: "Inicio", value: "bad", session: f.session, onConfirm: f.session.commit, onError: () => assert.fail("unexpected error") }));
  let tree = render();
  const chips = elements<Chip>(tree, "SelectionChip"); assert.equal(chips.length, 84);
  for (const label of ["00 min", "07 min", "59 min"]) assert.ok(chips.some(chip => chip.props.label === label));
  assert.deepEqual(f.changes, []);
  chips.find(chip => chip.props.label === "23 h")!.props.onPress();
  chips.find(chip => chip.props.label === "59 min")!.props.onPress();
  tree = render(); assert.deepEqual(f.changes, []);
  elements<ModalActions>(tree, "SelectionModal")[0].props.onConfirm();
  elements<ModalActions>(tree, "SelectionModal")[0].props.onConfirm();
  assert.deepEqual(f.changes, ["23:59"]);
});

test("web Cancel preserves invalid historic value and blocked retained confirmation emits nothing", t => {
  const hooks = reactFixture(); t.after(hooks.unmount);
  const f = localSession();
  const module = loadSource<typeof import("../src/ui/time/TimePickerPanel")>("ui/time/TimePickerPanel.tsx", id => uiImports(hooks, id));
  const tree = hooks.render(() => module.TimePickerPanel({ label: "Inicio", value: "8:7", session: f.session, onConfirm: f.session.commit, onError: () => {} }));
  const modal = elements<ModalActions>(tree, "SelectionModal")[0].props;
  modal.onCancel(); modal.onConfirm();
  assert.deepEqual(f.changes, []);
});

test("TimeField mount preserves invalid data, opens by trigger and keeps hints/errors without typing", t => {
  const hooks = reactFixture(); t.after(hooks.unmount);
  const f = localSession(); let opens = 0;
  const module = loadSource<typeof import("../src/ui/time/TimeField")>("ui/time/TimeField.tsx", id => {
    if (id === "./useSelectionSession") return { useSelectionSession: (_props: SelectionFieldProps) => ({ session: f.session, disabled: false, open: () => { opens += 1; } }) };
    if (id === "./TimePickerPanel") return { TimePickerPanel: "TimePickerPanel" };
    return uiImports(hooks, id);
  });
  const props: TimeFieldProps = { label: "Hora", value: "8:7", scopeKey: "work-1", hint: "Hora de sucursal", onChange: f.session.commit };
  const tree = hooks.render(() => module.TimeField(props));
  assert.deepEqual(f.changes, []);
  const trigger = elements<Trigger>(tree, "SelectorTrigger")[0].props;
  assert.equal(trigger.value, "8:7"); trigger.onPress(); assert.equal(opens, 1);
  const picker = elements<TimePickerPanelProps>(tree, "TimePickerPanel")[0].props;
  picker.onConfirm("8:07"); assert.deepEqual(f.changes, []);
  picker.onError("No se pudo abrir el selector");
  const errorTree = hooks.render(() => module.TimeField(props));
  assert.equal(elements<Trigger>(errorTree, "SelectorTrigger")[0].props.error, "No se pudo abrir el selector");
  picker.onConfirm("23:59"); assert.deepEqual(f.changes, []);
});

function numericFixture(value: string, max: 30 | 59 | 99, dayOffset = false) {
  const hooks = reactFixture();
  const f = localSession();
  const module = loadSource<typeof import("../src/ui/time/NumericSelectField")>("ui/time/NumericSelectField.tsx", id => {
    if (id === "./useSelectionSession") return { useSelectionSession: () => ({ session: f.session, disabled: false, open: () => {} }) };
    return uiImports(hooks, id);
  });
  const props: NumericSelectFieldProps = { label: "Cantidad", value, max, dayOffset, scopeKey: "order-1", onChange: f.session.commit };
  const root = module.NumericSelectField(props);
  const children = root.props.children as ReactElement<NumericSelectFieldProps & { session: SelectionSession }>[];
  const panel = children[1];
  assert.equal(typeof panel.type, "function");
  const component = panel.type as (props: NumericSelectFieldProps & { session: SelectionSession }) => ReactNode;
  const render = () => hooks.render(() => component(panel.props));
  return { ...f, root, render, close: hooks.unmount };
}

test("numeric selector does not clamp historic 100 on mount/cancel; zero requires explicit selection and confirmation", t => {
  const f = numericFixture("100", 99); t.after(f.close);
  assert.equal(elements<Trigger>(f.root, "SelectorTrigger")[0].props.value, "100");
  let tree = f.render(); assert.deepEqual(f.changes, []);
  assert.equal(elements<ModalActions>(tree, "SelectionModal")[0].props.canConfirm, false);
  elements<ModalActions>(tree, "SelectionModal")[0].props.onConfirm(); assert.deepEqual(f.changes, []);
  action(tree, "Elegir cero").onPress(); tree = f.render(); assert.deepEqual(f.changes, []);
  elements<ModalActions>(tree, "SelectionModal")[0].props.onConfirm(); assert.deepEqual(f.changes, ["0"]);
  const canceled = numericFixture("100", 99); t.after(canceled.close);
  elements<ModalActions>(canceled.render(), "SelectionModal")[0].props.onCancel(); assert.deepEqual(canceled.changes, []);
});

for (const max of [30, 59, 99] as const) test(`bounded stepper ${max} cannot overflow, even through retained handlers`, t => {
  const f = numericFixture(String(max), max); t.after(f.close);
  const first = f.render(); const increase = action(first, "Aumentar Cantidad");
  assert.equal(increase.disabled, true); increase.onPress();
  elements<ModalActions>(f.render(), "SelectionModal")[0].props.onConfirm();
  assert.deepEqual(f.changes, [String(max)]);
});

test("day offset preserves previous 1, labels same/next day, and never treats offset as a clock", t => {
  const f = numericFixture("1", 30, true); t.after(f.close);
  assert.equal(elements<Trigger>(f.root, "SelectorTrigger")[0].props.value, "Día siguiente");
  let tree = f.render();
  const chips = elements<Chip>(tree, "SelectionChip");
  assert.equal(chips.length, 2); assert.equal(chips[1].props.selected, true);
  chips[0].props.onPress(); tree = f.render(); assert.deepEqual(f.changes, []);
  elements<ModalActions>(tree, "SelectionModal")[0].props.onConfirm(); assert.deepEqual(f.changes, ["0"]);
});

for (const platform of ["android", "ios"] as const) test(`${platform} actual platform component stages/cancels without a trusted-picker exemption`, t => {
  const hooks = reactFixture(); t.after(hooks.unmount);
  const f = localSession(); const opens: AndroidNativeProps[] = []; let dismisses = 0;
  const module = loadSource<typeof import("../src/ui/time/TimePickerPanel.native")>("ui/time/TimePickerPanel.native.tsx", id => {
    if (id === "react-native") return { Platform: { OS: platform }, Text: "Text" };
    if (id === "@react-native-community/datetimepicker") return { __esModule: true, default: "NativeDateTimePicker", DateTimePickerAndroid: { open: (props: AndroidNativeProps) => opens.push(props), dismiss: async () => { dismisses += 1; return true; } } };
    if (id === "./androidTimeDialog") return androidDialog;
    return uiImports(hooks, id);
  });
  const props: TimePickerPanelProps = { label: "Hora", value: "08:07", session: f.session, onConfirm: f.session.commit, onError: () => assert.fail("unexpected error") };
  const wrapped = module.TimePickerPanel(props);
  const Component = wrapped.type as (props: TimePickerPanelProps) => ReactNode;
  const render = () => { const tree = hooks.render(() => Component(wrapped.props)); hooks.flush(); return tree; };
  const tree = render(); assert.deepEqual(f.changes, []);
  if (platform === "android") {
    assert.equal(opens.length, 1); assert.equal(tree, null);
    f.session.cancel(); assert.equal(dismisses, 1);
    const date = values.clockPickerDate("23:59");
    opens[0].onValueChange?.({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } }, date);
    assert.deepEqual(f.changes, []);
  } else {
    const picker = elements<IOSNativeProps>(tree, "NativeDateTimePicker")[0].props;
    assert.equal(picker.mode, "time"); assert.equal(picker.display, "spinner"); assert.equal(picker.minuteInterval, 1);
    const date = values.clockPickerDate("23:59");
    picker.onValueChange?.({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } }, date);
    assert.deepEqual(f.changes, []);
    elements<ModalActions>(render(), "SelectionModal")[0].props.onConfirm();
    assert.deepEqual(f.changes, ["23:59"]); assert.equal(opens.length, 0);
  }
});

test("CompletionDialog shows an automatic summary and manual interval selectors emit the unchanged payload once", t => {
  const hooks = reactFixture(); t.after(hooks.unmount);
  const outputs: StatusInput[] = [];
  const module = uiModule<typeof import("../src/screens/workDetail/CompletionDialog")>("screens/workDetail/CompletionDialog.tsx", hooks, {
    "../../ui/time/TimeField": { TimeField: "TimeField" }, "../../ui/time/NumericSelectField": { DayOffsetField: "DayOffsetField", NumericSelectField: "NumericSelectField" },
    "./DetailUi": { ChoiceButton: "ChoiceButton", Notice: "Notice" },
  });
  const date = "2026-09-14";
  const props: CompletionDialogProps = { maintenance: false, work: work({ status: "paused", elapsedSeconds: 1200, scheduledDate: date, plannedDates: [date], missingRequiredInfo: [] }),
    allowEditExecutionTime: true, generatedAt: "2026-09-14T12:00:00Z", initialDate: date, range: { startDate: date, endDate: date }, reasons: [], canSubmit: true,
    error: null, busy: false, mode: "live", onClose: () => {}, onSubmit: input => outputs.push(input) };
  const render = () => { const tree = hooks.render(() => module.CompletionDialog(props)); hooks.flush(); return tree; };
  let tree = render(); assert.equal(elements<TimeFieldProps>(tree, "TimeField").length, 0);
  assert.equal(elements(tree, "NumericSelectField").length, 0);
  assert.ok(JSON.stringify(tree).includes("Tiempo trabajado"));
  elements<Chip>(tree, "ChoiceButton").find(chip => chip.props.label === "Editar horas de ejecución manualmente")!.props.onPress();
  tree = render();
  elements<Chip>(tree, "ChoiceButton").find(chip => chip.props.label === "Inicio y término")!.props.onPress();
  tree = render(); const fields = elements<TimeFieldProps>(tree, "TimeField"); assert.equal(fields.length, 2);
  fields[0].props.onChange("23:59"); fields[1].props.onChange("00:07");
  elements<SelectionFieldProps>(tree, "DayOffsetField")[0].props.onChange("1");
  tree = render(); action(tree, "Confirmar y entregar").onPress(); action(tree, "Confirmar y entregar").onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(outputs)), [{ status: "delivered", executionDates: [date], executionStartTime: "23:59", executionEndTime: "00:07", endDateOffset: 1, isManual: true }]);
});

for (const platform of ["android", "ios"] as const) test(`${platform} missing native module is bounded to a friendly error after opening`, t => {
  const hooks = reactFixture(); t.after(hooks.unmount);
  const f = localSession(); const errors: string[] = []; let loads = 0;
  const module = loadSource<typeof import("../src/ui/time/TimePickerPanel.native")>("ui/time/TimePickerPanel.native.tsx", id => {
    if (id === "react-native") return { Platform: { OS: platform }, Text: "Text" };
    if (id === "@react-native-community/datetimepicker") { loads += 1; throw new Error("RNCTimePicker is missing with internal native details"); }
    if (id === "./androidTimeDialog") return androidDialog;
    return uiImports(hooks, id);
  });
  assert.equal(loads, 0, "module must not load with the application graph");
  const props: TimePickerPanelProps = { label: "Hora", value: "08:07", session: f.session, onConfirm: f.session.commit,
    onError: error => { errors.push(error); f.session.cancel(); } };
  const wrapped = module.TimePickerPanel(props);
  const Component = wrapped.type as (props: TimePickerPanelProps) => ReactNode;
  hooks.render(() => Component(wrapped.props)); hooks.flush();
  assert.equal(loads, 1); assert.deepEqual(errors, [androidDialog.TIME_PICKER_UNAVAILABLE]); assert.deepEqual(f.changes, []);
});

test("iOS staged spinner cancel and security revocation never apply a changed wheel value", t => {
  const hooks = reactFixture(); t.after(hooks.unmount);
  const f = localSession();
  const module = loadSource<typeof import("../src/ui/time/TimePickerPanel.native")>("ui/time/TimePickerPanel.native.tsx", id => {
    if (id === "react-native") return { Platform: { OS: "ios" }, Text: "Text" };
    if (id === "@react-native-community/datetimepicker") return { default: "NativeDateTimePicker" };
    if (id === "./androidTimeDialog") return androidDialog;
    return uiImports(hooks, id);
  });
  const props: TimePickerPanelProps = { label: "Hora", value: "08:07", session: f.session, onConfirm: f.session.commit, onError: () => {} };
  const wrapped = module.TimePickerPanel(props);
  const Component = wrapped.type as (props: TimePickerPanelProps) => ReactNode;
  const render = () => { const tree = hooks.render(() => Component(wrapped.props)); hooks.flush(); return tree; };
  const tree = render();
  const picker = elements<IOSNativeProps>(tree, "NativeDateTimePicker")[0].props;
  const date = values.clockPickerDate("23:59");
  picker.onValueChange?.({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } }, date);
  const modal = elements<ModalActions>(render(), "SelectionModal")[0].props;
  modal.onCancel(); modal.onConfirm();
  picker.onValueChange?.({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } }, date);
  assert.deepEqual(f.changes, []);
});

test("opening Android clock beneath PrivateModal keeps its parent visible and authentication untouched", async t => {
  const p = await unlockedProvider(); t.after(p.close);
  const f = selectionFixture(p.security); t.after(f.close);
  const nativeHooks = reactFixture(); t.after(nativeHooks.unmount);
  const options: AndroidNativeProps[] = []; let dismissed = 0;
  const module = loadSource<typeof import("../src/ui/time/TimePickerPanel.native")>("ui/time/TimePickerPanel.native.tsx", id => {
    if (id === "react-native") return { Platform: { OS: "android" }, Text: "Text" };
    if (id === "@react-native-community/datetimepicker") return { DateTimePickerAndroid: { open: (props: AndroidNativeProps) => options.push(props), dismiss: async () => { dismissed += 1; return true; } } };
    if (id === "./androidTimeDialog") return androidDialog;
    return uiImports(nativeHooks, id);
  });
  const privacy = loadSource<typeof import("../src/security/DeviceSecurityContext")>("security/DeviceSecurityContext.tsx", id => {
    if (id === "react") return { createContext: () => ({}), useContext: () => p.security };
    if (id === "react-native") return { Modal: "NativeModal", View: "View" };
    if (id === "react/jsx-runtime") return jsx;
    throw new Error(`UNEXPECTED_MODAL_IMPORT:${id}`);
  });
  const session = f.open();
  const props: TimePickerPanelProps = { label: "Inicio", value: "08:07", session, onConfirm: session.commit, onError: () => assert.fail("unexpected error") };
  const wrapped = module.TimePickerPanel(props);
  const Component = wrapped.type as (props: TimePickerPanelProps) => ReactNode;
  nativeHooks.render(() => Component(wrapped.props)); nativeHooks.flush();
  assert.equal(options.length, 1);
  assert.equal(privacy.PrivateModal({ visible: true, children: "private form" }).props.visible, true);
  assert.equal(p.security.blocked, false); assert.equal(p.adapter.prompts.length, 1);
  p.emit(false);
  assert.equal(dismissed, 1);
  await p.settle();
  assert.equal(privacy.PrivateModal({ visible: true, children: "private form" }).props.visible, false);
  assert.deepEqual(f.changes, []);
});