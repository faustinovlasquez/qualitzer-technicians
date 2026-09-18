/// <reference types="node" />
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve, relative } from "node:path";
import { test } from "node:test";
import type * as ImagePicker from "expo-image-picker";
import type { LocalPhoto, Session } from "../src/domain/models";
import type { DeviceAuthenticationResult } from "../src/security/contracts";
import { group, user, work } from "../server/tests/fixtures";
import { loadSource } from "./helpers/tenant-challenge";
import { deferred, memoryDraftStorage, uiOperation, uiScope, uiSnapshot } from "./helpers/durable-ui";
import { cameraRootRenderer, treeNodes, treeText, type Tree } from "./helpers/camera-root-renderer";

const granted: ImagePicker.CameraPermissionResponse = { granted: true, canAskAgain: true, status: "granted" as ImagePicker.PermissionStatus, expires: "never" };
const denied: ImagePicker.CameraPermissionResponse = { ...granted, granted: false, status: "denied" as ImagePicker.PermissionStatus };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=", "base64");
const selected: ImagePicker.ImagePickerResult = { canceled: false, assets: [{ uri: "file:///camera/photo.png", fileName: "photo.png", fileSize: png.length, mimeType: "image/png", width: 1, height: 1 }] };

function fixture() {
  const view = cameraRootRenderer();
  const storage = memoryDraftStorage();
  const bytes = new Map<string, Buffer>([["file:///camera/photo.png", png]]);
  const directories = new Set<string>();
  const deleted: string[] = [];
  const events: string[] = [];
  const prompts: ReturnType<typeof deferred<DeviceAuthenticationResult>>[] = [];
  const listeners = new Set<(state: string) => void>();
  const control = { captureBlocked: false, copied: 0, uploads: 0, permissionReads: 0, permissionRequests: 0, cameraCalls: 0,
    permission: denied, result: selected, cameraFailure: false, copyFailure: false, holdCamera: true };
  let camera = deferred<ImagePicker.ImagePickerResult>();
  let copy = deferred<void>();
  const uri = (parts: (string | { uri: string })[]) => parts.map(part => typeof part === "string" ? part : part.uri).reduce((base, part) => `${base.replace(/\/$/, "")}/${part.replace(/^\//, "")}`);
  class Directory {
    readonly uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = uri(parts); }
    get exists() { return directories.has(this.uri); }
    create() { directories.add(this.uri); }
  }
  class File {
    readonly uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = uri(parts); }
    get exists() { return bytes.has(this.uri); }
    get size() { return bytes.get(this.uri)?.length ?? 0; }
    get type() { return "image/png"; }
    async copy(destination: File) {
      control.copied++; events.push("copy:start");
      await copy.promise;
      if (control.copyFailure) throw new Error("COPY_FAILED_FIXTURE");
      const source = bytes.get(this.uri); assert.ok(source);
      bytes.set(destination.uri, Buffer.from(source)); events.push("copy:complete");
    }
    delete() { deleted.push(this.uri); bytes.delete(this.uri); }
  }
  const native = {
    Platform: { OS: "android", Version: 36 },
    StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: {} },
    View: "View", Text: "Text", Modal: "NativeModal", Image: "Image", ScrollView: "ScrollView", Pressable: "Pressable",
    ActivityIndicator: "ActivityIndicator", RefreshControl: "RefreshControl", KeyboardAvoidingView: "KeyboardAvoidingView",
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Keyboard: { dismiss() {} }, BackHandler: { addEventListener: () => ({ remove() {} }) },
    Linking: { openSettings: async () => { throw new Error("UNEXPECTED_SETTINGS"); } },
    AppState: { currentState: "active", addEventListener: (_name: string, listener: (state: string) => void) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } },
  };
  function emit(state: string) { events.push(state); native.AppState.currentState = state; for (const listener of [...listeners]) listener(state); }
  const session: Session = { mode: "live", token: "camera-test-session", user: user(), branchId: 1,
    tenant: { id: "camera-root", name: "Camera test", portalOrigin: "https://camera.example.com", environment: "development" } };
  const candidate = work();
  const existingReview = { ...uiOperation, id: "retained-review", kind: "document" as const, status: "needs_review" as const,
    lastError: "OFFLINE_DOCUMENT_FILE_ID_INVALID", file: { id: "retained-file", namespace: "camera-test", name: "retained.png", mimeType: "image/png", size: png.length, sha256: "a".repeat(64) } };
  const model = { session, storageKey: "camera-root-test", tab: "today", liveVerified: false, busy: false, loading: false,
    restoring: false, finalizingSession: false, forcePassword: false, selected: { initialTab: "evidence" }, selectedOrder: null,
    selectedCreationKind: null, selectedOffline: false, notifications: { client: null },
    offline: uiSnapshot([existingReview]), offlineController: { readLocalFile: async () => { throw new Error("UNEXPECTED_QUEUE_READ"); } },
    canonicalDetailGroup: group({ works: [candidate] }), canonicalDetailWork: candidate, data: { technician: { allowEditExecutionTime: false } },
    detailGeneratedAt: "2026-09-01T10:00:00Z", detailRange: { startDate: uiScope.startDate, endDate: uiScope.endDate },
    range: { startDate: uiScope.startDate, endDate: uiScope.endDate }, error: null,
    closeOffline() {}, loadFiles: async () => [], loadStepFiles: async () => [],
    uploadDocuments: async () => { control.uploads++; throw new Error("UNEXPECTED_UPLOAD"); },
    loadComments: async () => ({ data: [], totalRows: 0, totalPages: 0 }),
  };
  const access: { allowed: boolean; isAllowed(): boolean }[] = [];
  const ui = Object.fromEntries(["BodyText", "Brand", "Button", "Card", "EmptyState", "IconButton", "SectionTitle", "Badge", "Field"].map(name => [name, name]));
  const mocks: { [name: string]: unknown } = {
    "react": view.react, "react/jsx-runtime": view.jsx, "react-native": native,
    "@react-native-async-storage/async-storage": storage.storage,
    "expo-file-system": { File, Directory, Paths: { document: "file:///documents", cache: "file:///cache" } },
    "expo-image-picker": {
      UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
      getCameraPermissionsAsync: async () => { control.permissionReads++; events.push("permission:read"); return control.permission; },
      requestCameraPermissionsAsync: async () => {
        assert.equal(control.captureBlocked, true); assert.equal(view.security.isUnlocked(), false);
        control.permissionRequests++; events.push("permission:request"); emit("background"); emit("active"); return granted;
      },
      launchCameraAsync: () => {
        assert.equal(control.captureBlocked, true); assert.equal(view.security.isUnlocked(), false);
        control.cameraCalls++; events.push("camera:launch"); emit("background"); emit("active"); emit("background");
        return control.holdCamera ? camera.promise : control.cameraFailure ? Promise.reject(new Error("CAMERA_FAILED_FIXTURE")) : Promise.resolve(control.result);
      },
      launchImageLibraryAsync: async () => { throw new Error("UNEXPECTED_GALLERY"); },
    },
    "expo-document-picker": { getDocumentAsync: async () => { throw new Error("UNEXPECTED_DOCUMENT"); } },
    "expo-secure-store": { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, getItemAsync: async () => "enabled", setItemAsync: async () => { throw new Error("UNEXPECTED_SECURITY_WRITE"); } },
    "expo-local-authentication": { SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
      getEnrolledLevelAsync: async () => 1, authenticateAsync: () => { const result = deferred<DeviceAuthenticationResult>(); prompts.push(result); return result.promise; }, cancelAuthenticate: async () => {} },
    "expo-screen-capture": { preventScreenCaptureAsync: async () => { control.captureBlocked = true; events.push("privacy:prevent"); }, allowScreenCaptureAsync: async () => { control.captureBlocked = false; events.push("privacy:allow"); } },
    "@expo/vector-icons": { Ionicons: "Ionicons" }, "expo-linear-gradient": { LinearGradient: "LinearGradient" }, "expo-status-bar": { StatusBar: "StatusBar" },
    "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    "application/useTechnicianApp": { useTechnicianApp: (gate: { allowed: boolean; isAllowed(): boolean }) => { access.push(gate); return model; } },
    "ui/components": ui, "ui/SessionContextBar": { SessionContextBar: "SessionContextBar" }, "ui/DevelopmentQrPanel": {},
    "branding/useCompanyBranding": { useCompanyBranding: () => ({}) }, "branding/companyBrandingContext": { companyBrandingContext: () => ({ input: null, automaticPinEligible: false }) },
    "infrastructure/gatewayConfig": { gatewayConfiguration: { locked: true } },
    "screens/workDetail/DetailUi": { Notice: "Notice", AttachmentList: "AttachmentList" },
    "screens/workDetail/WorkInformation": { WorkTab: "WorkTab", EquipmentTab: "EquipmentTab" },
    "screens/workDetail/files/WorkspaceFileList": { PendingFileList: "PendingFileList", SavedFileList: "SavedFileList" },
    "screens/workDetail/ChecklistTab": { ChecklistTab: "ChecklistTab" }, "screens/workDetail/CompletionDialog": { CompletionDialog: "CompletionDialog" },
    "screens/workDetail/CommentsTab": { CommentsTab: "CommentsTab" }, "screens/workDetail/EvidenceTab": { EvidenceTab: "EvidenceTab" },
    "screens/workDetail/checklist/ChecklistAssociationPanel": { ChecklistAssociationPanel: "ChecklistAssociationPanel" },
    "screens/offline/QueuedNotice": { QueuedNotice: "QueuedNotice" }, "screens/offline/OfflineFileCard": { OfflineFileCard: "OfflineFileCard" },
    "screens/offline/OfflineStatusBar": { OfflineStatusBar: "OfflineStatusBar" }, "screens/offline/OfflineCenterScreen": { OfflineCenterScreen: "OfflineCenterScreen" },
    "screens/creation": {}, "notifications": {}, "screens/notifications/NotificationSettingsScreen": {},
  };
  for (const name of ["LoginScreen", "TenantSelectionScreen", "DashboardScreen", "OrderDetailScreen", "ProfileScreen", "ForcedPasswordScreen", "SessionSetupScreen"]) mocks[`screens/${name}`] = { [name]: name };
  const src = resolve(__dirname, "../src");
  const modules = new Map<string, unknown>();
  function load(file: string): unknown {
    if (modules.has(file)) return modules.get(file);
    const filename = resolve(src, file);
    const require = createRequire(filename);
    const module = loadSource<unknown>(file, id => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (!id.startsWith(".")) { assert.equal(id, "zod", `UNEXPECTED_EXTERNAL:${id}`); return require(id); }
      const resolved = require.resolve(resolve(dirname(filename), id));
      const target = relative(src, resolved).replace(/\\/g, "/");
      const key = target.replace(/\.tsx?$/, "").replace(/\/index$/, "");
      return Object.hasOwn(mocks, key) ? mocks[key] : load(target);
    }, { __DEV__: false, URL, setInterval, clearInterval, performance });
    modules.set(file, module);
    return module;
  }
  const app = load("../App.tsx") as { default: () => unknown };
  let tree: Tree[] = [];
  const render = () => { tree = view.render(view.element(app.default)); return tree; };
  const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise<void>(done => setImmediate(done)); render(); } };
  const button = (title: string) => {
    const node = treeNodes(tree, "Button").find(node => node.props.title === title);
    assert.ok(node, `MISSING_BUTTON:${title}`); assert.equal(typeof node.props.onPress, "function");
    return { disabled: node.props.disabled, press: node.props.onPress as () => void };
  };
  const drafts = () => { const node = treeNodes(tree, "PendingFileList")[0]; assert.ok(node); return node.props.files as LocalPhoto[]; };
  render();
  return { view, storage, bytes, deleted, events, prompts, control, model, access, emit, settle, render, button, drafts,
    get tree() { return tree; }, resolveCamera: () => camera.resolve(control.result), rejectCamera: () => camera.reject(new Error("CAMERA_FAILED_FIXTURE")),
    resolveCopy: () => copy.resolve(), resetSelection: () => { camera = deferred<ImagePicker.ImagePickerResult>(); copy = deferred<void>(); },
    close() { view.unmount(); },
  };
}

async function unlocked() {
  const f = fixture(); await f.settle(); assert.equal(f.prompts.length, 1);
  f.prompts[0].resolve({ success: true }); await f.settle();
  assert.equal(f.view.security.isUnlocked(), true); assert.equal(f.button("Cámara").disabled, false);
  return f;
}

function assertNeutral(f: ReturnType<typeof fixture>) {
  assert.equal(f.view.security.isUnlocked(), false);
  assert.equal(f.view.security.state.nativeInteractionPending, true);
  assert.equal(f.access.at(-1)?.isAllowed(), false);
  assert.equal(f.prompts.length, 1);
  assert.ok(treeNodes(f.tree, "View").some(node => node.props.pointerEvents === "none" && node.props.accessibilityElementsHidden === true));
  for (const modal of treeNodes(f.tree, "NativeModal")) assert.equal(modal.props.visible, false);
  assert.match(treeText(f.tree), /Esperando selección/);
}

test("full App + real provider, permission logic, WorkDetail and FileWorkspace: denied read then permission bounce and repeated camera bounce copies once before one durable draft", async t => {
  const f = await unlocked(); t.after(f.close);
  const beforeReview = JSON.stringify(f.model.offline.operations);
  const retainedPress = f.button("Cámara").press;
  retainedPress(); retainedPress(); await f.settle();
  assert.equal(f.control.permissionReads, 1); assert.equal(f.control.permissionRequests, 1); assert.equal(f.control.cameraCalls, 1);
  assertNeutral(f); assert.equal(f.control.copied, 0); assert.equal(f.drafts().length, 0);
  f.emit("active"); await f.settle(); assertNeutral(f);
  f.resolveCamera(); await f.settle();
  assert.equal(f.view.security.isUnlocked(), true); assert.equal(f.control.copied, 1, treeText(f.tree));
  assert.equal(f.drafts().length, 0, "no draft before asynchronous native copy completion");
  assert.equal([...f.storage.values.keys()].filter(key => key.endsWith("/files")).length, 0);
  f.resolveCopy(); await f.settle();
  assert.equal(f.drafts().length, 1); const draft = f.drafts()[0];
  assert.deepEqual(f.bytes.get(draft.uri), png); assert.notEqual(draft.uri, "file:///camera/photo.png");
  assert.equal([...f.storage.values.entries()].filter(([key, value]) => key.endsWith("/files") && JSON.parse(value).length === 1).length, 1);
  assert.equal(f.control.uploads, 0); assert.equal(f.prompts.length, 1); assert.equal(JSON.stringify(f.model.offline.operations), beforeReview);
  assert.deepEqual(f.events.filter(event => ["permission:read", "permission:request", "camera:launch", "copy:start", "copy:complete"].includes(event)), ["permission:read", "permission:request", "camera:launch", "copy:start", "copy:complete"]);
  f.emit("background"); f.emit("active"); await f.settle();
  assert.equal(f.prompts.length, 1); assert.equal(f.view.security.isUnlocked(), true);
  assert.equal(f.drafts()[0].id, draft.id); assert.deepEqual(f.bytes.get(draft.uri), png);
});

for (const failure of ["camera-error", "copy-error", "cancel"] as const) test(`full App ${failure} preserves existing draft bytes, review operation and safe error state`, async t => {
  const f = await unlocked(); t.after(f.close);
  f.button("Cámara").press(); await f.settle(); f.emit("active"); f.resolveCamera(); f.resolveCopy(); await f.settle();
  assert.equal(f.drafts().length, 1, treeText(f.tree));
  const original = f.drafts()[0]; const storedBefore = [...f.storage.values.entries()].filter(([key]) => key.endsWith("/files"));
  const beforeReview = JSON.stringify(f.model.offline.operations);
  f.resetSelection(); f.control.permission = granted; f.control.copyFailure = failure === "copy-error";
  f.control.result = failure === "cancel" ? { canceled: true, assets: null } : selected;
  f.button("Cámara").press(); await f.settle(); assertNeutral(f); f.emit("active");
  if (failure === "camera-error") f.rejectCamera(); else f.resolveCamera();
  f.resolveCopy(); await f.settle();
  if (failure === "camera-error") {
    assert.equal(f.prompts.length, 2); assert.equal(f.view.security.isUnlocked(), false);
    f.prompts[1].resolve({ success: true }); await f.settle();
  } else assert.equal(f.prompts.length, 1);
  assert.equal(f.drafts().length, 1); assert.equal(f.drafts()[0].id, original.id);
  assert.deepEqual(f.bytes.get(original.uri), png); assert.equal(f.deleted.includes(original.uri), false);
  assert.deepEqual([...f.storage.values.entries()].filter(([key]) => key.endsWith("/files")), storedBefore);
  assert.equal(JSON.stringify(f.model.offline.operations), beforeReview); assert.equal(f.control.uploads, 0);
  assert.equal(f.control.permissionRequests, 1); assert.equal(f.control.cameraCalls, 2);
  if (failure === "copy-error") assert.match(treeText(f.tree), /COPY_FAILED_FIXTURE/);
  if (failure === "camera-error") { assert.match(treeText(f.tree), /No se pudo completar la selección/); assert.doesNotMatch(treeText(f.tree), /CAMERA_FAILED_FIXTURE|TRUSTED_NATIVE_INTERACTION/); }
});