/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { cloneElement, isValidElement, type ReactNode } from "react";
import type { Attachment, ChecklistStep, StepAnswer } from "../src/domain/models";
import type { OfflineController, OfflineOperation, OfflineSnapshot } from "../src/domain/offline";
import type { WorkDetailScreenProps } from "../src/screens/WorkDetailScreen";
import type { AssignmentWorkCardProps } from "../src/screens/orders/AssignmentWorkCard";
import type { ChecklistTabProps } from "../src/screens/workDetail/ChecklistTab";
import type { CommentsTabProps } from "../src/screens/workDetail/CommentsTab";
import type { FileWorkspaceProps } from "../src/screens/workDetail/FileWorkspace";
import type { OfflineCenterScreenProps } from "../src/screens/offline/OfflineCenterScreen";
import type { PendingAnswer, PendingComment, PendingDocument, PendingTimer } from "../src/screens/offline/offlineUi";
import { operationErrorReason } from "../src/screens/offline/offlineUi";
import { syncUserError, userActionError, workActionError } from "../src/screens/offline/syncUserPresentation";
import { group, work } from "../server/tests/fixtures";
import { action, durableReactFixture, elements, memoryDraftStorage, queued, settle, uiModule, uiOperation, uiScope, uiSnapshot, type UiAction } from "./helpers/durable-ui";

interface RenderProps {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  label?: string;
  message?: string;
  value?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  visible?: boolean;
}

function componentVm() {
  let current = durableReactFixture();
  const hooks = { ...current, react: new Proxy(current.react, { get: (_target, property) => Reflect.get(current.react, property) }) };
  const instances = new Map<string, ReturnType<typeof durableReactFixture>>();
  function render(node: ReactNode, path = "root"): ReactNode {
    if (Array.isArray(node)) return node.map((child, index) => render(child, `${path}/${isValidElement(child) && child.key !== null ? child.key : index}`));
    if (!isValidElement<RenderProps>(node)) return node;
    if (typeof node.type === "function") {
      const component = node.type as (props: RenderProps) => ReactNode;
      const key = `${path}/${component.name}/${node.key ?? ""}`;
      const state = instances.get(key) ?? durableReactFixture();
      instances.set(key, state); current = state;
      const output = state.render(() => component(node.props));
      state.flush();
      return render(output, `${key}/render`);
    }
    if (node.type === "Modal" && !node.props.visible) return null;
    return cloneElement(node, undefined, render(node.props.children, `${path}/children`));
  }
  return {
    load: <T,>(relative: string, overrides: { [name: string]: unknown } = {}) => uiModule<T>(relative, hooks, overrides),
    render,
    unmount: () => { for (const state of instances.values()) state.unmount(); },
  };
}

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (!isValidElement<RenderProps>(node)) return "";
  const { children, title, subtitle, label, message, value, accessibilityLabel, accessibilityHint } = node.props;
  return `${[title, subtitle, label, message, value, accessibilityLabel, accessibilityHint, visibleText(children)].filter(Boolean).join(" ")}\n`;
}

function assertQuiet(node: ReactNode): void {
  assert.doesNotMatch(visibleText(node), /Sin conexión verificada|En cola · tiempo pendiente|No se pudo verificar (?:la )?conexión|\bMOBILE_[A-Z0-9_]+\b|\bOFFLINE_[A-Z0-9_]+\b/);
}

const connectionNotice = "No se pudo verificar la conexión con Qualitzer. Los pendientes siguen guardados en el dispositivo.";
const timer: PendingTimer = { ...uiOperation, kind: "timer", payload: { status: "in_progress", baseStatus: "pending" } };
const comment: PendingComment = { ...uiOperation, id: "comment", kind: "comment", text: "Observación pendiente" };
const answer: StepAnswer = { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: "" };
const answerOperation: PendingAnswer = { ...uiOperation, id: "answer", kind: "answer", stepId: "1", answer, base: { ...answer, responseValue: null, isCompleted: false } };
const file: PendingDocument = { ...uiOperation, id: "document", kind: "document", file: { id: "local-file", namespace: "isolated-ui", name: "evidence.txt", mimeType: "text/plain", size: 4, sha256: "a".repeat(64) } };

function centerFixture(operations: OfflineOperation[], lastError: string | null = null) {
  const vm = componentVm();
  const { OfflineCenterScreen } = vm.load<typeof import("../src/screens/offline/OfflineCenterScreen")>("screens/offline/OfflineCenterScreen.tsx", {
    "../workDetail/files/fileRules": vm.load("screens/workDetail/files/fileRules.ts", {
      "expo-file-system": {}, "../localPhotos": { MAX_PHOTO_BYTES: 25 * 1024 * 1024, MAX_TOTAL_BYTES: 40 * 1024 * 1024 },
    }),
  });
  const snapshot = { ...uiSnapshot(operations), lastError, conflicts: operations.filter((entry) => entry.status === "conflict" || entry.status === "needs_review").length };
  const calls: string[] = [];
  const controller: OfflineController = {
    getSnapshot: () => snapshot, subscribe: () => () => {}, start: () => {}, stop: () => {}, setForeground: () => {},
    syncNow: async () => { calls.push("sync"); }, retry: async (id) => { calls.push(id); }, hasPendingChanges: async () => snapshot.pending > 0,
    prepareWeek: async () => {}, readLocalFile: async () => { throw new Error("UNEXPECTED_FILE_READ"); },
  };
  const props: OfflineCenterScreenProps = { controller, snapshot, range: uiScope, branchId: 1, branchName: "Prueba", onBack: () => {} };
  return { vm, props, calls, render: () => vm.render(<OfflineCenterScreen {...props} />) };
}

test("actual center hides deployment/raw diagnostics until opt-in and retains pending/review counts and retry gates", () => {
  const pending: PendingTimer = { ...timer, lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE", nextAttemptAt: Date.now() + 60000 };
  const conflict: PendingComment = { ...comment, status: "conflict", lastError: "MOBILE_SYNC_OPERATION_REUSED" };
  const child: PendingDocument = { ...file, dependencyId: conflict.id };
  const f = centerFixture([pending, conflict, child], "MOBILE_SYNC_ACTIONS_UNAVAILABLE");
  try {
    const before = JSON.stringify(f.props.snapshot);
    const tree = f.render(); assertQuiet(tree);
    assert.match(visibleText(tree), /3 operación\(es\) pendientes · 1 requieren atención/);
    assert.match(visibleText(tree), /Hay cambios pendientes de enviar/);
    assert.match(visibleText(tree), /requiere actualizar el servicio\. Contacta a soporte\./);
    assert.match(visibleText(tree), /Conflicto/);
    assert.doesNotMatch(visibleText(tree), /Requiere actualizar el servidor|mismo identificador/);
    assert.equal(elements<UiAction>(tree, "Button").filter(({ props }) => props.title === "Reintentar misma operación" || props.title === "Reintentar operación anterior").length, 0);
    action(tree, "Ver detalles técnicos de sincronización").onPress();
    assert.match(visibleText(f.render()), /MOBILE_SYNC_ACTIONS_UNAVAILABLE/);
    action(f.render(), "Ocultar diagnóstico de sincronización").onPress(); assertQuiet(f.render());
    action(f.render(), "Ver detalles de la operación anterior").onPress();
    assert.match(visibleText(f.render()), /MOBILE_SYNC_OPERATION_REUSED/);
    action(f.render(), "Ocultar detalles").onPress(); assertQuiet(f.render());
    const details = elements<UiAction>(f.render(), "Button").filter(({ props }) => props.title === "Ver detalles técnicos");
    assert.equal(details.length, 3); details[0].props.onPress();
    assert.match(visibleText(f.render()), /MOBILE_SYNC_ACTIONS_UNAVAILABLE/);
    assert.equal(JSON.stringify(f.props.snapshot), before); assert.deepEqual(f.calls, []);
  } finally { f.vm.unmount(); }
});

test("center keeps disk-full and unknown failures visible without raw codes or a saved-success claim", () => {
  const f = centerFixture([{ ...comment, status: "needs_review", lastError: "MOBILE_UNKNOWN_FAILURE" }], "OFFLINE_STORAGE_FULL");
  try {
    const tree = f.render(); assertQuiet(tree);
    assert.match(visibleText(tree), /No se pudo guardar: el almacenamiento local está lleno/);
    assert.match(visibleText(tree), /Requiere revisión/);
    assert.match(visibleText(tree), /1 operación\(es\) pendientes · 1 requieren atención/);
    assert.doesNotMatch(visibleText(tree), /Guardado en el teléfono|Guardado\. Se reintentará/);
  } finally { f.vm.unmount(); }
  assert.equal(workActionError(connectionNotice), null);
  assert.equal(workActionError(`${connectionNotice} No se guardó el archivo.`), `${connectionNotice} No se guardó el archivo.`);
  assert.equal(workActionError("ENOSPC: disk full"), "ENOSPC: disk full");
  assert.match(userActionError(new Error("OFFLINE_STORAGE_FULL")), /almacenamiento local está lleno/);
  assert.match(syncUserError("MOBILE_UNKNOWN_FAILURE_"), /Requiere revisión/);
  assert.equal(operationErrorReason("MOBILE_UNKNOWN_FAILURE"), "MOBILE_UNKNOWN_FAILURE", "diagnostic function remains intact");
});

async function detailFixture(initialTab: WorkDetailScreenProps["initialTab"] = "work") {
  const vm = componentVm(); const memory = memoryDraftStorage();
  const drafts = vm.load<typeof import("../src/screens/workDetail/useWorkDraft")>("screens/workDetail/useWorkDraft.ts", {
    "@react-native-async-storage/async-storage": memory.storage, "./localPhotos": {},
  });
  const notices = vm.load<typeof import("../src/screens/offline/QueuedNotice")>("screens/offline/QueuedNotice.tsx");
  const { WorkDetailScreen } = vm.load<typeof import("../src/screens/WorkDetailScreen")>("screens/WorkDetailScreen.tsx", {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" },
    "./workDetail/ChecklistTab": { ChecklistTab: (props: ChecklistTabProps) => <>{props.notices}{props.catalogHeader}</> },
    "./workDetail/CompletionDialog": { CompletionDialog: "CompletionDialog" }, "./workDetail/EvidenceTab": { EvidenceTab: "EvidenceTab" },
    "./workDetail/localPhotos": { openLocalPhotoScope: () => {} }, "./workDetail/useWorkDraft": drafts,
    "./workDetail/useAttachmentFiles": { useAttachmentFiles: () => ({ files: [], error: null, loading: false, load: async () => {} }) },
    "./workDetail/WorkInformation": { WorkTab: "WorkTab", EquipmentTab: "EquipmentTab" }, "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" },
    "./workDetail/CommentsTab": { CommentsTab: "CommentsTab" }, "./offline/QueuedNotice": notices,
    "./workDetail/checklist/ChecklistAssociationPanel": vm.load("screens/workDetail/checklist/ChecklistAssociationPanel.tsx"),
  });
  let calls = 0;
  const unused = async (): Promise<never> => { throw new Error("UNEXPECTED_ACTION"); };
  const candidate = work({ status: "pending", elapsedSeconds: 45 });
  const props: WorkDetailScreenProps = {
    tenant: { id: "ui", name: "UI", portalOrigin: "https://ui.example.com", environment: "development" }, branchName: "UI",
    group: group({ works: [candidate] }), work: candidate, generatedAt: "2026-09-01T10:00:00Z", mode: "live", range: uiScope, busy: false,
    error: connectionNotice, onBack: () => {}, onRefresh: unused, onStatus: async () => { calls++; throw queued("timer"); }, onSaveStep: unused,
    onLoadChecklistOptions: async () => ({ items: [], page: 0, pageSize: 20, hasMore: false }), onAttachChecklist: unused,
    onLoadFiles: async () => [], onLoadStepFiles: async () => [], onUpload: unused, onReport: unused, onUploadDocuments: unused, onDeleteFile: unused,
    onLoadComments: async () => ({ data: [], page: 0, pageSize: 20, totalRows: 0, totalPages: 0 }), onAddComment: unused,
    storageKey: `quiet-detail-${initialTab}`, initialTab, allowEditExecutionTime: false, offline: uiSnapshot([timer, answerOperation]), companyBranchId: 1,
  };
  const render = () => vm.render(<WorkDetailScreen {...props} />);
  render(); await settle(); render();
  return { vm, props, memory, render, calls: () => calls };
}

test("actual detail and catalog omit duplicate connection/timer blocks and preserve action failure, counts and delivery guards", async () => {
  for (const tab of ["work", "checklist"] as const) {
    const f = await detailFixture(tab);
    try {
      const before = JSON.stringify(f.props.work);
      let tree = f.render(); assertQuiet(tree);
      assert.doesNotMatch(visibleText(tree), /solicitado:|Estado recibido:/);
      if (tab === "work") {
        assert.equal(action(tree, "Pausar trabajo").disabled, false);
        assert.equal(action(tree, "Entregar trabajo").disabled, false);
        action(tree, "Entregar trabajo").onPress();
        assert.equal(elements(f.render(), "CompletionDialog").length, 1);
        assert.equal(elements<{ canSubmit: boolean }>(f.render(), "CompletionDialog")[0].props.canSubmit, false);
      } else assert.match(visibleText(tree), /1 respuesta\(s\) pendientes/);
      f.props.error = "ENOSPC: disk full"; f.render(); tree = f.render();
      assert.match(visibleText(tree), /ENOSPC: disk full/);
      assert.equal(JSON.stringify(f.props.work), before); assert.equal(f.calls(), 0);
    } finally { f.vm.unmount(); }
  }
});

test("actual card uses compact pending label without canonical progress or delivery changes, review never reads as saved", () => {
  const vm = componentVm();
  const { AssignmentWorkCard } = vm.load<typeof import("../src/screens/orders/AssignmentWorkCard")>("screens/orders/AssignmentWorkCard.tsx", {
    "./AssignmentMetadataRow": { AssignmentMetadataRow: "AssignmentMetadataRow" },
  });
  let mutations = 0; let deliveries = 0;
  const candidate = work({ status: "pending", elapsedSeconds: 45, checklistDone: 0, checklistTotal: 3 });
  const props: AssignmentWorkCardProps = { group: group({ works: [candidate] }), work: candidate, offline: uiSnapshot([timer]), online: false,
    onWorkStatus: async () => { mutations++; }, onOpenWork: (_group, _work, options) => { if (options?.action) deliveries++; } };
  const render = () => vm.render(<AssignmentWorkCard {...props} />);
  try {
    let tree = render(); assertQuiet(tree);
    assert.equal(action(tree, "Pausar").title, "Pausar · Guardando…");
    assert.equal(action(tree, "Entregar").disabled, false); action(tree, "Entregar").onPress();
    assert.ok(elements<{ label: string }>(tree, "Badge").some(({ props }) => props.label === "Pendiente"));
    assert.match(visibleText(tree), /0\/3/); assert.match(visibleText(tree), /Último tiempo recibido/);
    assert.equal(candidate.elapsedSeconds, 45); assert.equal(candidate.checklistDone, 0);
    const retained = action(tree, "Pausar");
    props.offline = uiSnapshot([{ ...timer, status: "conflict", lastError: "MOBILE_SYNC_OPERATION_REUSED" }]);
    tree = render(); assertQuiet(tree); assert.match(visibleText(tree), /Conflicto/);
    assert.doesNotMatch(visibleText(tree), /Guardando…|Guardado en el teléfono/);
    assert.equal(action(tree, "Pausar").disabled, true); retained.onPress(); action(tree, "Entregar").onPress();
    assert.equal(mutations, 0); assert.equal(deliveries, 2, "both clicks only open delivery review");
  } finally { vm.unmount(); }
});

test("actual queued answer list is compact and preserves attention while step guards keep queued answers unconfirmed", () => {
  const vm = componentVm();
  const { QueuedNotice } = vm.load<typeof import("../src/screens/offline/QueuedNotice")>("screens/offline/QueuedNotice.tsx");
  const { StepEditor } = vm.load<typeof import("../src/screens/workDetail/checklist/StepEditor")>("screens/workDetail/checklist/StepEditor.tsx", {
    "../useWorkDraft": { displayedAnswer: (_step: ChecklistStep, entry?: { answer: StepAnswer }) => entry?.answer ?? answer },
    "./ResponseInput": { ResponseInput: "ResponseInput" }, "./styles": { checklistStyles: {} },
  });
  const step = { ...work().checklists[0].steps[0], stepId: "1", comment: "", isCompleted: null };
  let saves = 0;
  const context: ChecklistTabProps = { work: work(), draft: { version: 1, answers: { "1": { answer, saved: false, baseline: "" } }, photos: [], report: "", savedReport: "" },
    maintenance: false, disabled: false, readOnly: false, mode: "live", savingStep: null, onChange: () => {}, onDiscard: () => {},
    onSave: async () => { saves++; }, onEvidence: () => {}, storageKey: "quiet-step", isAnswerQueued: () => true };
  try {
    const tree = vm.render(<StepEditor step={step} context={context} notices={<QueuedNotice answers={[answerOperation]} count={2} />} />);
    assertQuiet(tree); assert.match(visibleText(tree), /2 respuesta\(s\) pendientes/);
    assert.match(visibleText(tree), /Respuesta registrada en el teléfono/);
    assert.doesNotMatch(visibleText(tree), /Esta versión ya está registrada|responseValue|isCompleted/);
    assert.equal(action(tree, "Respuesta ya registrada en cola").disabled, true);
    action(tree, "Respuesta ya registrada en cola").onPress(); assert.equal(saves, 0);
    assert.equal(context.draft.answers["1"].saved, false);
    const conflict = vm.render(<QueuedNotice answers={[{ ...answerOperation, status: "needs_review", lastError: "OFFLINE_STORAGE_FULL" }]} />);
    assertQuiet(conflict); assert.match(visibleText(conflict), /Requiere revisión/);
    assert.match(visibleText(conflict), /almacenamiento local está lleno/);
    assert.doesNotMatch(visibleText(conflict), /Guardado en el teléfono/);
  } finally { vm.unmount(); }
});

async function workspaceFixture() {
  const vm = componentVm(); const memory = memoryDraftStorage();
  const drafts = vm.load<typeof import("../src/screens/workDetail/files/WorkspaceDraftStore")>("screens/workDetail/files/WorkspaceDraftStore.ts", {
    "@react-native-async-storage/async-storage": memory.storage, "expo-file-system": {},
  });
  const store = new drafts.WorkspaceDraftStore("quiet-files-comments", "live"); await settle();
  const override = { ...drafts, useWorkspaceDraft: () => ({ ...store.getSnapshot(), store }) };
  const { CommentsTab } = vm.load<typeof import("../src/screens/workDetail/CommentsTab")>("screens/workDetail/CommentsTab.tsx", { "./files/WorkspaceDraftStore": override });
  const { FileWorkspace } = vm.load<typeof import("../src/screens/workDetail/FileWorkspace")>("screens/workDetail/FileWorkspace.tsx", {
    "./files/WorkspaceDraftStore": override, "./files/filePicker": {}, "./files/WorkspaceFileList": { PendingFileList: "PendingFileList", SavedFileList: "SavedFileList" },
  });
  return { vm, store, memory, CommentsTab, FileWorkspace };
}

test("actual comments translate load and operation codes, keep draft disk failure visible and never publish on failed local flush", async () => {
  const f = await workspaceFixture(); let submitted = 0;
  const props: CommentsTabProps = { scopeKey: "quiet-comments", mode: "live", busy: false, offlineReady: true,
    pending: [{ ...comment, status: "conflict", lastError: "MOBILE_SYNC_OPERATION_REUSED" }],
    onLoad: async () => { throw new Error("MOBILE_SYNC_ACTIONS_UNAVAILABLE"); }, onSubmit: async () => { submitted++; } };
  const render = () => f.vm.render(<f.CommentsTab {...props} />);
  try {
    render(); await settle(); let tree = render(); assertQuiet(tree);
    assert.match(visibleText(tree), /Conflicto/); assert.match(visibleText(tree), /Sincronización no disponible/);
    assert.equal(elements(tree, "Notice").length > 0, true);
    await f.store.setText("Texto que no debe perderse"); f.memory.control.fail = true;
    await assert.rejects(f.store.setText("Texto conservado tras fallo"));
    tree = render(); assert.match(visibleText(tree), /LOCAL_STORAGE_FAILED/);
    assert.equal(action(tree, "Guardar comentario · sincronizar").disabled, true);
    action(tree, "Guardar comentario · sincronizar").onPress(); await settle();
    assert.equal(submitted, 0); assert.equal(f.store.getSnapshot().text, "Texto conservado tras fallo");
  } finally { f.vm.unmount(); }
});

test("actual file workspace preserves confirmed/queued/unsaved counts and bytes after disk-full failure without raw codes", async () => {
  const f = await workspaceFixture();
  await f.store.addFiles([{ uri: "memory:proof", name: "draft.txt", blob: new Blob(["test"], { type: "text/plain" }) }]);
  const original = f.store.getSnapshot().files[0]; let uploads = 0;
  const confirmed: Attachment = { id: 7, name: "server.txt", url: "https://ui.example.com/server.txt" };
  const props: FileWorkspaceProps = { scopeKey: "quiet-files", mode: "live", readOnly: false, offline: uiSnapshot([file]), pending: [file],
    onLoad: async () => [confirmed], onUpload: async () => { uploads++; throw new Error("OFFLINE_STORAGE_FULL"); }, onDelete: async () => { throw new Error("UNEXPECTED_DELETE"); } };
  const render = () => f.vm.render(<f.FileWorkspace {...props} />);
  try {
    render(); await settle(); let tree = render(); assertQuiet(tree);
    assert.match(visibleText(tree), /1 sin guardar/); assert.match(visibleText(tree), /1 confirmados · 1 en cola/);
    assert.equal(action(tree, "Eliminar archivo").disabled, true);
    action(tree, "Guardar archivos · 1").onPress(); await settle(); tree = render(); assertQuiet(tree);
    assert.match(visibleText(tree), /almacenamiento local está lleno/);
    assert.match(visibleText(tree), /1 sin guardar/); assert.match(visibleText(tree), /1 confirmados · 1 en cola/);
    assert.equal(uploads, 1); assert.equal(f.store.getSnapshot().files[0].id, original.id);
    assert.equal(f.store.getSnapshot().files[0].uri, original.uri); assert.equal(f.store.getSnapshot().files[0].uploaded, false);
    props.pending = [{ ...file, status: "needs_review", lastError: "MOBILE_UNKNOWN_FAILURE" }];
    tree = render(); assertQuiet(tree); assert.match(visibleText(tree), /Requiere revisión/);
  } finally { f.vm.unmount(); await f.store.removeFile(original.id); }
});

test("actual global status keeps pending counts and exposes a friendly failure in accessibility text", async () => {
  const vm = componentVm();
  const { OfflineStatusBar } = vm.load<typeof import("../src/screens/offline/OfflineStatusBar")>("screens/offline/OfflineStatusBar.tsx", {
    "react-native": { StyleSheet: { create: (styles: object) => styles }, ActivityIndicator: "ActivityIndicator", Text: "Text", View: "View", TouchableOpacity: "TouchableOpacity" },
  });
  const snapshot: OfflineSnapshot = { ...uiSnapshot([timer]), pending: 7, conflicts: 2,
    connection: { status: "service_error", networkConnected: true, foreground: true, checkedAt: 1, errorCode: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" } };
  const render = () => vm.render(<OfflineStatusBar snapshot={snapshot} onOpen={() => {}} onSync={async () => { throw new Error("MOBILE_SYNC_ACTIONS_UNAVAILABLE"); }} />);
  try {
    let tree = render(); assertQuiet(tree); assert.match(visibleText(tree), /7 pendientes · 2 por revisar/);
    const sync = elements<UiAction>(tree, "TouchableOpacity").find(({ props }) => props.accessibilityLabel === "Sincronizar ahora");
    assert.ok(sync); assert.equal(sync.props.disabled, false); sync.props.onPress(); await settle();
    render(); tree = render(); assertQuiet(tree); assert.match(visibleText(tree), /Contacta a soporte/);
    assert.match(visibleText(tree), /7 pendientes · 2 por revisar/);
  } finally { vm.unmount(); }
});