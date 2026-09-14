/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactNode } from "react";
import type { OfflineController, OfflineOperation, OfflineSnapshot } from "../src/domain/offline";
import type { OfflineStatusBarProps } from "../src/screens/offline/OfflineStatusBar";
import type { OfflineCenterScreenProps } from "../src/screens/offline/OfflineCenterScreen";
import { action, durableReactFixture, elements, settle, uiModule, uiOperation, uiScope, uiSnapshot, type UiAction } from "./helpers/durable-ui";

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (!isValidElement<{ children?: ReactNode; message?: string; title?: string }>(node)) return "";
  return [node.props.message, node.props.title, text(node.props.children)].filter(Boolean).join(" ");
}
const pending: OfflineOperation[] = Array.from({ length: 9 }, (_, index) => ({ ...uiOperation, id: String(index), kind: "comment", text: `Pending ${index}` }));
const initial = (): OfflineSnapshot => ({ ...uiSnapshot(pending), online: true });
const partial = (): OfflineSnapshot => ({ ...uiSnapshot(pending.map((entry, index) => index < 2 ? { ...entry, status: "applied" } : entry)),
  lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE", awaitingDeploymentByKind: { create: 0, comment: 2, answer: 1, document: 1, timer: 2, checklist: 1 } });

test("actual center uses manual API, presents partial results once, and drops the old result on automatic queue progress", async () => {
  const hooks = durableReactFixture();
  const { OfflineCenterScreen } = uiModule<typeof import("../src/screens/offline/OfflineCenterScreen")>("screens/offline/OfflineCenterScreen.tsx", hooks, {
    "../workDetail/files/fileRules": { fileSizeLabel: () => "0 B" },
  });
  let snapshot = initial(); let manual = 0; let legacy = 0;
  const controller: OfflineController = {
    getSnapshot: () => snapshot, subscribe: () => () => {}, start: () => {}, stop: () => {}, setForeground: () => {},
    requestSync: async () => { manual++; snapshot = partial(); }, syncNow: async () => { legacy++; },
    retry: async () => {}, hasPendingChanges: async () => snapshot.pending > 0, prepareWeek: async () => {}, readLocalFile: async () => { throw new Error("UNEXPECTED_READ"); },
  };
  const props: OfflineCenterScreenProps = { controller, snapshot, range: uiScope, branchId: 1, onBack: () => {} };
  const render = () => { props.snapshot = snapshot; const tree = hooks.render(() => OfflineCenterScreen(props)); hooks.flush(); return tree; };
  try {
    action(render(), "Sincronizar ahora").onPress(); await settle();
    let tree = render();
    assert.equal(manual, 1); assert.equal(legacy, 0);
    assert.match(text(tree), /Se enviaron 2 cambios; quedan 7 pendientes/);
    assert.equal(text(tree).match(/7 cambios requieren actualizar el servicio/g)?.length, 1);
    assert.doesNotMatch(text(tree), /MOBILE_SYNC_ACTIONS_UNAVAILABLE/);
    snapshot = { ...uiSnapshot(pending.map((entry) => ({ ...entry, status: "applied" }))), online: true };
    tree = render(); assert.doesNotMatch(text(tree), /Se enviaron 2 cambios|requieren actualizar el servicio/);
    snapshot = partial(); tree = render(); assert.doesNotMatch(text(tree), /Se enviaron 2 cambios/);
    action(tree, "Ver detalles técnicos de sincronización").onPress();
    assert.match(text(render()), /MOBILE_SYNC_ACTIONS_UNAVAILABLE/);
  } finally { hooks.unmount(); }
});

test("actual compact bar captures post-render snapshots, stays at two lines and retires failures on automatic updates", async () => {
  const hooks = durableReactFixture();
  const { OfflineStatusBar } = uiModule<typeof import("../src/screens/offline/OfflineStatusBar")>("screens/offline/OfflineStatusBar.tsx", hooks, {
    "react-native": { ActivityIndicator: "ActivityIndicator", View: "View", Text: "Text", TouchableOpacity: "TouchableOpacity", StyleSheet: { create: (value: object) => value } },
  });
  let fail = false; let calls = 0;
  const props: OfflineStatusBarProps = { snapshot: initial(), onOpen: () => {}, onSync: async () => {
    calls++; if (fail) throw new Error("OFFLINE_STORAGE_FULL"); props.snapshot = partial();
  } };
  const render = () => { const tree = hooks.render(() => OfflineStatusBar(props)); hooks.flush(); return tree; };
  const press = () => {
    const button = elements<UiAction>(render(), "TouchableOpacity").find(({ props: entry }) => entry.accessibilityLabel === "Sincronizar ahora");
    assert.ok(button); button.props.onPress();
  };
  try {
    press(); await settle(); render(); let tree = render();
    assert.equal(calls, 1); assert.match(text(tree), /Se enviaron 2 cambios; quedan 7 pendientes/);
    const lines = elements<{ numberOfLines: number }>(tree, "Text");
    assert.equal(lines.length, 2); assert.ok(lines.every((line) => line.props.numberOfLines === 1));
    assert.doesNotMatch(text(tree), /MOBILE_|OFFLINE_/);
    props.snapshot = { ...initial(), lastSyncedAt: 2 }; render();
    fail = true; press(); await settle(); render(); tree = render();
    assert.match(text(tree), /almacenamiento local está lleno/);
    props.snapshot = { ...initial(), lastSyncedAt: 3 }; tree = render();
    assert.doesNotMatch(text(tree), /almacenamiento local está lleno|No se pudo completar/);
  } finally { hooks.unmount(); }
});

test("actual center legacy fixture keeps unknown queue out of success and retains a disk failure below the manual button", async () => {
  const hooks = durableReactFixture();
  const { OfflineCenterScreen } = uiModule<typeof import("../src/screens/offline/OfflineCenterScreen")>("screens/offline/OfflineCenterScreen.tsx", hooks, {
    "../workDetail/files/fileRules": { fileSizeLabel: () => "0 B" },
  });
  const snapshot = { ...uiSnapshot(), online: false }; let fail = false; let calls = 0;
  const controller: OfflineController = {
    getSnapshot: () => snapshot, subscribe: () => () => {}, start: () => {}, stop: () => {}, setForeground: () => {},
    syncNow: async () => { calls++; if (fail) throw new Error("OFFLINE_STORAGE_FULL"); }, retry: async () => {},
    hasPendingChanges: async () => false, prepareWeek: async () => {}, readLocalFile: async () => { throw new Error("UNEXPECTED_READ"); },
  };
  const props: OfflineCenterScreenProps = { controller, snapshot, range: uiScope, branchId: 1, onBack: () => {} };
  const render = () => { const tree = hooks.render(() => OfflineCenterScreen(props)); hooks.flush(); return tree; };
  try {
    action(render(), "Sincronizar ahora").onPress(); await settle();
    assert.match(text(render()), /No se pudo confirmar el estado/); assert.equal(calls, 1);
    fail = true; action(render(), "Sincronizar ahora").onPress(); await settle();
    assert.match(text(render()), /No se pudo completar el envío.*almacenamiento local está lleno/);
    assert.equal(calls, 2);
  } finally { hooks.unmount(); }
});