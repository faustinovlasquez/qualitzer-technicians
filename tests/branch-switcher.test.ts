import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import type { BranchSwitcherProps } from "../src/ui/BranchSwitcher";
import type { Session } from "../src/domain/models";
import { durableReactFixture, elements, renderWrapped, uiModule, type Wrapped } from "./helpers/durable-ui";

const session = (branchId: number): Session => ({
  token: "t", mode: "live", branchId,
  tenant: { id: "t", name: "Empresa Demo", portalOrigin: "https://demo.example", environment: "production" },
  user: { id: 1, workerId: 7, name: "Ana", lastnames: "Soto", email: "a@b.cl", role: { name: "Técnico" }, system: { name: "Q", timezone: "America/Santiago" },
    accessBranchs: [{ id: 1, name: "Casa matriz", main: true }, { id: 2, name: "Taller norte", main: false, logoUrl: "https://cdn.example/norte.png" }, { id: 3, name: "Cerrada", main: false, isEnabled: false }] },
} as Session);

function text(node: ReactNode): string {
  return JSON.stringify(node, (_key, value) => typeof value === "function" ? undefined : value);
}

test("branch logo opens the active branch, switches to another and confirms with a success message", () => {
  const hooks = durableReactFixture();
  const module = uiModule<{ BranchSwitcher: (props: BranchSwitcherProps) => ReactNode }>("ui/BranchSwitcher.tsx", hooks, { "./components": { CompanyMark: "CompanyMark" } });
  const wrapped: Wrapped<BranchSwitcherProps> = (props) => ({ type: module.BranchSwitcher, props }) as ReturnType<Wrapped<BranchSwitcherProps>>;
  const selected: number[] = [];
  const props: BranchSwitcherProps = { session: session(1), busy: false, error: null, blockedReason: null, onSelect: (id) => { selected.push(id); } };
  try {
    let tree = renderWrapped(hooks, wrapped, props);
    const trigger = elements<{ testID?: string; accessibilityLabel?: string; onPress(): void }>(tree, "Pressable").find(item => item.props.testID === "branch-switcher")!;
    assert.match(trigger.props.accessibilityLabel ?? "", /Casa matriz\. Cambiar sucursal/);
    trigger.props.onPress();
    tree = renderWrapped(hooks, wrapped, props);
    assert.match(text(tree), /SUCURSAL ACTIVA/);
    assert.doesNotMatch(text(tree), /Cerrada/, "disabled branches are not offered");
    const option = elements<{ accessibilityLabel?: string; onPress(): void }>(tree, "Pressable").find(item => item.props.accessibilityLabel === "Cambiar a Taller norte")!;
    option.props.onPress();
    assert.deepEqual(selected, [2]);
    renderWrapped(hooks, wrapped, { ...props, busy: true });
    renderWrapped(hooks, wrapped, { ...props, session: session(2), busy: false });
    tree = renderWrapped(hooks, wrapped, { ...props, session: session(2), busy: false });
    assert.match(text(tree), /Ahora trabajas en Taller norte/);
    assert.equal(elements<{ visible?: boolean }>(tree, "Modal")[0]?.props.visible, false, "the dialog closes after a successful switch");
  } finally { hooks.unmount(); }
});

test("switching is blocked offline or with pending changes, and failures are shown", () => {
  const hooks = durableReactFixture();
  const module = uiModule<{ BranchSwitcher: (props: BranchSwitcherProps) => ReactNode }>("ui/BranchSwitcher.tsx", hooks, { "./components": { CompanyMark: "CompanyMark" } });
  const wrapped: Wrapped<BranchSwitcherProps> = (props) => ({ type: module.BranchSwitcher, props }) as ReturnType<Wrapped<BranchSwitcherProps>>;
  const selected: number[] = [];
  const props: BranchSwitcherProps = { session: session(1), busy: false, error: null, blockedReason: "Necesitas conexión para cambiar de sucursal.", onSelect: (id) => { selected.push(id); } };
  try {
    let tree = renderWrapped(hooks, wrapped, props);
    elements<{ testID?: string; onPress(): void }>(tree, "Pressable").find(item => item.props.testID === "branch-switcher")!.props.onPress();
    tree = renderWrapped(hooks, wrapped, props);
    assert.match(text(tree), /Necesitas conexión/);
    const option = elements<{ accessibilityLabel?: string; disabled?: boolean; onPress(): void }>(tree, "Pressable").find(item => item.props.accessibilityLabel === "Cambiar a Taller norte")!;
    assert.equal(option.props.disabled, true);
    option.props.onPress();
    assert.deepEqual(selected, []);
    tree = renderWrapped(hooks, wrapped, { ...props, blockedReason: null, error: "La sucursal ya no está habilitada para esta cuenta." });
    assert.match(text(tree), /ya no está habilitada/);
  } finally { hooks.unmount(); }
  void createElement;
});
