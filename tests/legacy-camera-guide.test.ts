/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactNode } from "react";
import type * as ImagePicker from "expo-image-picker";
import type { AssignmentGroup, LocalPhoto } from "../src/domain/models";
import type { TrustedNativePicker } from "../src/security/contracts";
import type { WorkDetailScreenProps } from "../src/screens/WorkDetailScreen";
import type { WorkDraft } from "../src/screens/workDetail/useWorkDraft";
import type { FileWorkspaceProps } from "../src/screens/workDetail/FileWorkspace";
import type { CameraPermissionGuideController } from "../src/screens/workDetail/files/useCameraPermissionGuide";
import * as cameraErrors from "../src/domain/cameraErrors";
import { group, work } from "../server/tests/fixtures";
import { deferred, durableReactFixture, elements, renderWrapped, settle, uiModule, uiScope, uiSnapshot, type Wrapped } from "./helpers/durable-ui";

const granted: ImagePicker.CameraPermissionResponse = { granted: true, canAskAgain: true, status: "granted" as ImagePicker.PermissionStatus, expires: "never" };
const denied: ImagePicker.CameraPermissionResponse = { ...granted, granted: false, status: "denied" as ImagePicker.PermissionStatus };
const canceled: ImagePicker.ImagePickerResult = { canceled: true, assets: null };
const selected: ImagePicker.ImagePickerResult = { canceled: false, assets: [{ uri: "file:///camera/new.jpg", width: 20, height: 20, fileName: "new.jpg", mimeType: "image/jpeg", fileSize: 120 }] };
const newPhoto: LocalPhoto = { id: "new", uri: "file:///draft/new.jpg", name: "new.jpg", mimeType: "image/jpeg", size: 120 };

interface LegacyEvidence {
  photos: WorkDraft["photos"];
  preparing: boolean;
  disabled: boolean;
  onPick(source: "camera" | "library"): Promise<void>;
  onTarget(target?: string): void;
}

function legacyFixture() {
  const base = durableReactFixture();
  const security = { blocked: false, state: { nativeInteractionPending: false }, isUnlocked: () => !security.blocked };
  const control: { security: typeof security | null; permission: ImagePicker.CameraPermissionResponse; hydrated: boolean } = { security, permission: granted, hydrated: true };
  const hooks = { ...base, react: { ...base.react, useContext: () => control.security, createContext: () => ({}) } };
  const calls = { reads: 0, requests: 0, cameras: 0, galleries: 0, copies: 0, additions: 0, flushes: 0, uploads: 0, settings: 0 };
  const deleted: LocalPhoto[] = [];
  const ports = {
    read: async (): Promise<ImagePicker.CameraPermissionResponse> => control.permission,
    request: async (): Promise<ImagePicker.CameraPermissionResponse> => control.permission,
    camera: async (): Promise<ImagePicker.ImagePickerResult> => canceled,
    library: async (): Promise<ImagePicker.ImagePickerResult> => canceled,
    prepare: async (): Promise<LocalPhoto[]> => [newPhoto],
    flush: async (): Promise<void> => {},
  };
  const run: TrustedNativePicker = operation => operation();
  const data: WorkDraft = { version: 1, report: "Reporte conservado", savedReport: null, answers: {}, photos: [{ photo: { ...newPhoto, id: "retained", uri: "file:///draft/retained.jpg", name: "retained.jpg" }, uploaded: false }] };
  const store = {
    getSnapshot: () => ({ data }),
    flush: async () => { calls.flushes += 1; await ports.flush(); },
    addPhotos: (photos: LocalPhoto[], stepId?: string) => { calls.additions += 1; data.photos = [...data.photos, ...photos.map(photo => ({ photo, stepId, uploaded: false }))]; },
  };
  const picker = uiModule<typeof import("../src/screens/workDetail/localPhotos")>("screens/workDetail/localPhotos.ts", hooks, {
    "expo-file-system": {},
    "react-native": { Platform: { OS: "android" } },
    "../../domain/cameraErrors": cameraErrors,
    "expo-image-picker": {
      UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
      getCameraPermissionsAsync: async () => { calls.reads += 1; return ports.read(); },
      requestCameraPermissionsAsync: async () => { calls.requests += 1; return ports.request(); },
      launchCameraAsync: async () => { calls.cameras += 1; return ports.camera(); },
      launchImageLibraryAsync: async () => { calls.galleries += 1; return ports.library(); },
    },
  });
  const guideModule = uiModule<typeof import("../src/screens/workDetail/files/useCameraPermissionGuide")>("screens/workDetail/files/useCameraPermissionGuide.ts", hooks, {
    "react-native": { Linking: { openSettings: async () => { calls.settings += 1; } } },
    "../../../security/DeviceSecurityContext": { DeviceSecurityContext: {} },
    "../../../domain/cameraErrors": cameraErrors,
  });
  const privacy = uiModule<typeof import("../src/security/DeviceSecurityContext")>("security/DeviceSecurityContext.tsx", hooks, {
    "react-native": { Modal: "Modal", View: "View" },
  });
  const guideUi = uiModule<typeof import("../src/screens/workDetail/files/CameraPermissionGuide")>("screens/workDetail/files/CameraPermissionGuide.tsx", hooks, {
    "../../../security/DeviceSecurityContext": { PrivateModal: "PrivateModal" },
  });
  const module = uiModule<{ WorkDetailScreen: Wrapped<WorkDetailScreenProps> }>("screens/WorkDetailScreen.tsx", hooks, {
    "react-native": { Platform: { OS: "android" }, BackHandler: { addEventListener: () => ({ remove: () => {} }) }, View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", RefreshControl: "RefreshControl", KeyboardAvoidingView: "KeyboardAvoidingView" },
    "../security/DeviceSecurityContext": { DeviceSecurityContext: {} },
    "../security/useTrustedNativePicker": { useTrustedNativePicker: () => run },
    "../domain/cameraErrors": cameraErrors,
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" },
    "./workDetail/ChecklistTab": { ChecklistTab: "ChecklistTab" },
    "./workDetail/CompletionDialog": { CompletionDialog: "CompletionDialog" },
    "./workDetail/EvidenceTab": { EvidenceTab: "EvidenceTab" },
    "./workDetail/localPhotos": { ...picker, preparePhotos: async () => { calls.copies += 1; return ports.prepare(); }, deleteLocalPhoto: (_key: string, photo: LocalPhoto) => { deleted.push(photo); } },
    "./workDetail/useAttachmentFiles": { useAttachmentFiles: () => ({ files: [], error: null, loading: false, load: async () => {} }) },
    "./workDetail/useWorkDraft": {
      workDetailDraftKey: (key: string, mode: string, current: Pick<AssignmentGroup, "type" | "id">, workId: string) => JSON.stringify([key, mode, current.type, current.id, workId]),
      useWorkDraft: () => ({ data, hydrated: control.hydrated, saving: false, error: null, store }),
    },
    "./workDetail/WorkInformation": { EquipmentTab: "EquipmentTab", WorkTab: "WorkTab" },
    "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" },
    "./workDetail/CommentsTab": { CommentsTab: "CommentsTab" },
    "./offline/QueuedNotice": { QueuedNotice: "QueuedNotice" },
    "./workDetail/checklist/ChecklistAssociationPanel": { ChecklistAssociationPanel: "ChecklistAssociationPanel" },
    "./workDetail/files/useCameraPermissionGuide": guideModule,
    "./workDetail/files/CameraPermissionGuide": { CameraPermissionGuide: "CameraPermissionGuide" },
  });
  const candidate = work({ status: "pending" });
  const props: WorkDetailScreenProps = {
    tenant: { id: "legacy", name: "Legacy", portalOrigin: "https://legacy.example.com", environment: "development" },
    branchName: "Legacy", group: group({ works: [candidate] }), work: candidate, generatedAt: "2026-09-01T10:00:00Z", mode: "demo", range: { startDate: uiScope.startDate, endDate: uiScope.endDate },
    busy: false, error: null, storageKey: "legacy", initialTab: "evidence", allowEditExecutionTime: false, companyBranchId: 1, offline: uiSnapshot(),
    onBack: () => {}, onRefresh: async () => {}, onStatus: async () => {}, onSaveStep: async () => {},
    onLoadChecklistOptions: async () => ({ page: 0, pageSize: 20, hasMore: false, items: [] }),
    onAttachChecklist: async () => { throw new Error("UNEXPECTED_ATTACH"); }, onLoadFiles: async () => [], onLoadStepFiles: async () => [],
    onUpload: async () => { calls.uploads += 1; }, onReport: async () => {}, onUploadDocuments: async () => { calls.uploads += 1; }, onDeleteFile: async () => {},
    onLoadComments: async () => ({ data: [], page: 0, pageSize: 20, totalRows: 0, totalPages: 0 }), onAddComment: async () => {},
  };
  const render = () => renderWrapped(hooks, module.WorkDetailScreen, props);
  const guide = () => elements<{ guide: CameraPermissionGuideController }>(render(), "CameraPermissionGuide")[0].props.guide;
  const evidence = (): LegacyEvidence => {
    const workspace = elements<FileWorkspaceProps>(render(), "FileWorkspace")[0];
    return elements<LegacyEvidence>(workspace.props.listFooter, "EvidenceTab")[0].props;
  };
  function modal() {
    const tree = guideUi.CameraPermissionGuide({ guide: guide() });
    return privacy.PrivateModal(elements<{ visible: boolean; children: ReactNode }>(tree, "PrivateModal")[0].props);
  }
  render();
  return { props, control, security, calls, ports, data, deleted, render, evidence, guide, modal, close: hooks.unmount };
}

for (const canAskAgain of [true, false]) test(`legacy denial canAskAgain=${canAskAgain} releases action before guide and preserves existing drafts`, async t => {
  const f = legacyFixture(); t.after(f.close);
  f.control.permission = { ...denied, canAskAgain };
  await f.evidence().onPick("camera");
  assert.equal(f.guide().visible, true); assert.equal(f.guide().canAskAgain, canAskAgain);
  assert.equal(f.evidence().preparing, false); assert.equal(f.evidence().disabled, false);
  assert.equal(f.calls.cameras, 0); assert.equal(f.calls.copies, 0); assert.equal(f.calls.uploads, 0); assert.equal(f.calls.flushes, 0);
  assert.equal(f.calls.requests, canAskAgain ? 1 : 0);
  assert.equal(f.data.photos[0].photo.id, "retained"); assert.equal(f.data.report, "Reporte conservado");
  f.guide().cancel(); assert.equal(f.guide().visible, false); assert.equal(f.data.photos.length, 1);
});

test("legacy retry can launch with its guide mounted, hides private modal while native pending, then accepts the actual result", async t => {
  const f = legacyFixture(); t.after(f.close);
  f.control.permission = { ...denied, canAskAgain: false };
  await f.evidence().onPick("camera");
  const native = deferred<ImagePicker.ImagePickerResult>();
  f.control.permission = granted;
  f.ports.camera = () => { f.security.state.nativeInteractionPending = true; f.security.blocked = true; return native.promise; };
  const retry = f.guide().retry(); await settle();
  assert.equal(f.calls.cameras, 1); assert.equal(f.guide().busy, true);
  const hidden = f.modal(); assert.equal(hidden.props.visible, false); assert.equal(hidden.props.animationType, "none");
  assert.equal(elements<{ pointerEvents: string }>(hidden, "View")[0].props.pointerEvents, "none");
  await f.guide().retry(); assert.equal(f.calls.cameras, 1);
  f.security.state.nativeInteractionPending = false; f.security.blocked = false;
  native.resolve(selected); await retry;
  assert.equal(f.calls.additions, 1); assert.equal(f.calls.flushes, 1); assert.equal(f.data.photos.length, 2);
  assert.equal(f.data.photos[1].photo, newPhoto); assert.equal(f.guide().visible, false); assert.equal(f.calls.uploads, 0);
});

test("legacy retry repeated denial replaces the guide only after its action is released", async t => {
  const f = legacyFixture(); t.after(f.close);
  f.control.permission = denied; await f.evidence().onPick("camera");
  f.ports.request = async () => ({ ...denied, canAskAgain: false });
  await f.guide().retry();
  assert.equal(f.guide().visible, true); assert.equal(f.guide().canAskAgain, false); assert.equal(f.guide().busy, false);
  assert.equal(f.evidence().preparing, false); assert.equal(f.calls.cameras, 0); assert.equal(f.calls.copies, 0);
});

for (const source of ["camera", "library"] as const) test(`legacy guide ${source} cancellation never copies, flushes or transfers an asset`, async t => {
  const f = legacyFixture(); t.after(f.close);
  f.control.permission = { ...denied, canAskAgain: false }; await f.evidence().onPick("camera");
  f.control.permission = granted;
  await (source === "camera" ? f.guide().retry() : f.guide().pickGallery());
  assert.equal(f.calls.cameras, source === "camera" ? 1 : 0); assert.equal(f.calls.galleries, source === "library" ? 1 : 0);
  assert.equal(f.guide().visible, false); assert.equal(f.data.photos.length, 1);
  assert.equal(f.calls.copies, 0); assert.equal(f.calls.flushes, 0); assert.equal(f.calls.uploads, 0);
});

test("legacy cancel while retry reads permission prevents late request and asset transfer", async t => {
  const f = legacyFixture(); t.after(f.close);
  f.control.permission = { ...denied, canAskAgain: false }; await f.evidence().onPick("camera");
  const read = deferred<ImagePicker.CameraPermissionResponse>(); f.ports.read = () => read.promise;
  const retry = f.guide().retry(); f.guide().cancel(); read.resolve(denied); await retry;
  assert.equal(f.guide().visible, false); assert.equal(f.calls.requests, 0); assert.equal(f.calls.cameras, 0);
  assert.equal(f.calls.copies, 0); assert.equal(f.calls.uploads, 0); assert.equal(f.data.photos.length, 1);
});

test("legacy resource change during permission read cannot request permission or open an obsolete guide", async t => {
  const f = legacyFixture(); t.after(f.close);
  const read = deferred<ImagePicker.CameraPermissionResponse>(); f.ports.read = () => read.promise;
  const selection = f.evidence().onPick("camera");
  f.props.companyBranchId = 2; f.render(); read.resolve(denied); await selection;
  assert.equal(f.calls.requests, 0); assert.equal(f.calls.cameras, 0); assert.equal(f.guide().visible, false);
  assert.equal(f.calls.copies, 0); assert.equal(f.calls.uploads, 0);
});

for (const change of ["lock", "provider-removed", "resource"] as const) test(`legacy ${change} after native launch rejects its asset before copying`, async t => {
  const f = legacyFixture(); t.after(f.close);
  const native = deferred<ImagePicker.ImagePickerResult>(); f.ports.camera = () => native.promise;
  const selection = f.evidence().onPick("camera"); await settle(); assert.equal(f.calls.cameras, 1);
  if (change === "lock") f.security.blocked = true;
  if (change === "provider-removed") f.control.security = null;
  if (change === "resource") f.props.companyBranchId = 2;
  f.render(); native.resolve(selected); await selection;
  assert.equal(f.calls.copies, 0); assert.equal(f.calls.additions, 0); assert.equal(f.calls.flushes, 0); assert.equal(f.calls.uploads, 0);
  assert.equal(f.data.photos.length, 1); assert.equal(f.deleted.length, 0);
});

test("legacy guide callbacks cannot retarget another resource or an ABA destination", async t => {
  const f = legacyFixture(); t.after(f.close);
  f.control.permission = { ...denied, canAskAgain: false }; await f.evidence().onPick("camera");
  const retained = f.guide();
  f.props.companyBranchId = 2; f.render();
  await retained.retry(); await retained.pickGallery(); assert.equal(f.calls.reads, 1); assert.equal(f.calls.galleries, 0);
  f.props.companyBranchId = 1; f.render();
  await retained.retry(); await retained.pickGallery(); assert.equal(f.calls.reads, 1); assert.equal(f.calls.galleries, 0);
  assert.equal(f.guide().visible, false); assert.equal(f.data.photos.length, 1);
});

test("legacy empty successful picker result adds and flushes nothing", async t => {
  const f = legacyFixture(); t.after(f.close);
  f.ports.camera = async () => ({ canceled: false, assets: [] });
  await f.evidence().onPick("camera");
  assert.equal(f.calls.copies, 0); assert.equal(f.calls.additions, 0); assert.equal(f.calls.flushes, 0); assert.equal(f.calls.uploads, 0);
  assert.equal(f.data.photos.length, 1);
});

for (const change of ["resource", "date", "branch", "target", "aba", "lock", "provider-removed", "auth", "read-only", "unmount"] as const) test(`legacy ${change} during async preparation discards only new copies`, async t => {
  const f = legacyFixture(); t.after(f.close);
  f.ports.camera = async () => selected;
  const copy = deferred<LocalPhoto[]>(); f.ports.prepare = () => copy.promise;
  const selection = f.evidence().onPick("camera"); await settle(); assert.equal(f.calls.copies, 1);
  if (change === "resource") f.props.work = { ...f.props.work, id: "other-work" };
  if (change === "date") f.props.range = { startDate: "2026-09-02", endDate: "2026-09-02" };
  if (change === "branch") f.props.companyBranchId = 2;
  if (change === "target") f.evidence().onTarget(String(f.props.work.checklists[0].steps[0].stepId));
  if (change === "aba") { f.props.companyBranchId = 2; f.render(); f.props.companyBranchId = 1; }
  if (change === "lock") f.security.blocked = true;
  if (change === "provider-removed") f.control.security = null;
  if (change === "auth") f.props.offline = { ...uiSnapshot(), authBlocked: true };
  if (change === "read-only") f.props.staleReadOnly = true;
  if (change === "unmount") f.close(); else f.render();
  copy.resolve([newPhoto]); await selection;
  assert.equal(f.calls.additions, 0); assert.equal(f.calls.flushes, 0); assert.equal(f.calls.uploads, 0);
  assert.equal(f.data.photos.length, 1); assert.equal(f.data.photos[0].photo.id, "retained");
  assert.equal(f.deleted.length, 1); assert.equal(f.deleted[0], newPhoto);
});

test("legacy retained picker callbacks cannot start after resource ABA, lock or unmount", async t => {
  const f = legacyFixture(); t.after(f.close);
  const old = f.evidence().onPick;
  f.props.companyBranchId = 2; f.render(); f.props.companyBranchId = 1; f.render();
  await old("camera"); assert.equal(f.calls.reads, 0);
  const current = f.evidence().onPick; f.security.blocked = true;
  await current("camera"); assert.equal(f.calls.reads, 0);
  f.security.blocked = false; f.close(); await current("camera"); assert.equal(f.calls.reads, 0);
});

test("legacy guide uses current callbacks after rerender and keeps blocked request until unlock", async t => {
  const f = legacyFixture(); t.after(f.close);
  f.control.permission = { ...denied, canAskAgain: false }; await f.evidence().onPick("camera");
  const retained = f.guide(); f.security.blocked = true; f.render();
  await retained.retry(); await retained.pickGallery(); assert.equal(f.calls.galleries, 0); assert.equal(f.guide().visible, false);
  f.security.blocked = false; f.render(); assert.equal(f.guide().visible, true);
  f.ports.library = async () => selected;
  await retained.pickGallery();
  assert.equal(f.calls.galleries, 1); assert.equal(f.calls.additions, 1); assert.equal(f.guide().visible, false);
  assert.equal(f.data.photos[0].photo.id, "retained"); assert.equal(f.calls.uploads, 0);
});

test("legacy synchronous duplicate presses do not supersede the original selection", async t => {
  const f = legacyFixture(); t.after(f.close);
  const read = deferred<ImagePicker.CameraPermissionResponse>(); f.ports.read = () => read.promise;
  f.ports.camera = async () => selected;
  const pick = f.evidence().onPick;
  const first = pick("camera"); const second = pick("camera");
  assert.equal(f.calls.reads, 1); read.resolve(granted); await Promise.all([first, second]);
  assert.equal(f.calls.cameras, 1); assert.equal(f.calls.additions, 1); assert.equal(f.calls.flushes, 1); assert.equal(f.calls.uploads, 0);
});

test("legacy unexpected camera failure stays an action error rather than permission guidance", async t => {
  const f = legacyFixture(); t.after(f.close);
  f.ports.camera = async () => { throw new Error("TRUSTED_NATIVE_INTERACTION_EXPIRED"); };
  await f.evidence().onPick("camera");
  assert.equal(f.guide().visible, false); assert.equal(f.evidence().preparing, false); assert.equal(f.calls.copies, 0);
  const workspace = elements<FileWorkspaceProps>(f.render(), "FileWorkspace")[0];
  const notices = elements<{ message: string; tone: string }>(workspace.props.notices, "Notice");
  assert.ok(notices.some(notice => notice.props.tone === "error"));
  assert.equal(notices.some(notice => /permiso de c.mara/i.test(notice.props.message)), false);
});