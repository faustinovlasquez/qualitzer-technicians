/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import * as jsx from "react/jsx-runtime";
import type { ReactNode } from "react";
import type * as ImagePicker from "expo-image-picker";
import type { TrustedNativePicker } from "../src/security/contracts";
import * as cameraErrors from "../src/domain/cameraErrors";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";
import { action, deferred, durableReactFixture, elements, renderWrapped, settle, uiModule, type Wrapped } from "./helpers/durable-ui";
import type { FileWorkspaceProps } from "../src/screens/workDetail/FileWorkspace";
import type { CameraPermissionGuideController } from "../src/screens/workDetail/files/useCameraPermissionGuide";
import { unlockedProvider } from "./helpers/trusted-native-picker";

const granted: ImagePicker.CameraPermissionResponse = { granted: true, canAskAgain: true, status: "granted" as ImagePicker.PermissionStatus, expires: "never" };
const denied: ImagePicker.CameraPermissionResponse = { granted: false, canAskAgain: true, status: "denied" as ImagePicker.PermissionStatus, expires: "never" };
const blocked = { ...denied, canAskAgain: false };

function pickerFixture(options: { os?: "android" | "web"; read?: () => Promise<ImagePicker.CameraPermissionResponse>; request?: () => Promise<ImagePicker.CameraPermissionResponse>; launch?: () => Promise<ImagePicker.ImagePickerResult> } = {}) {
  const calls: string[] = [];
  const sdk = {
    UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
    getCameraPermissionsAsync: async () => { calls.push("read"); return options.read ? options.read() : granted; },
    requestCameraPermissionsAsync: async () => { calls.push("request"); return options.request ? options.request() : granted; },
    launchCameraAsync: async (settings: ImagePicker.ImagePickerOptions) => {
      calls.push("camera");
      assert.equal(settings.quality, 1); assert.equal(settings.allowsEditing, false);
      assert.equal(settings.preferredAssetRepresentationMode, "current");
      return options.launch ? options.launch() : { canceled: true, assets: null };
    },
    launchImageLibraryAsync: async () => { calls.push("library"); return { canceled: true, assets: null }; },
  };
  const photos = loadSource<typeof import("../src/screens/workDetail/localPhotos")>("screens/workDetail/localPhotos.ts", id => {
    if (id === "expo-image-picker") return sdk;
    if (id === "expo-file-system") return {};
    if (id === "react-native") return { Platform: { OS: options.os ?? "android" } };
    if (id === "../../domain/cameraErrors") return cameraErrors;
    if (id === "./detailRules") return { errorMessage: (error: unknown) => error instanceof Error ? error.message : "error" };
    throw new Error(`UNEXPECTED_PICKER_IMPORT:${id}`);
  });
  return { calls, photos };
}

test("granted camera reads first, skips request and opens exactly one trusted operation", async () => {
  const f = pickerFixture(); let leases = 0;
  const run: TrustedNativePicker = operation => { leases += 1; return operation(); };
  await f.photos.pickPhotos("camera", 1, run);
  assert.deepEqual(f.calls, ["read", "camera"]); assert.equal(leases, 1);
});

test("blocked permission never requests, launches or opens settings", async () => {
  const f = pickerFixture({ read: async () => blocked }); let leases = 0;
  await assert.rejects(f.photos.pickPhotos("camera", 1, operation => { leases += 1; return operation(); }), (error: unknown) => error instanceof cameraErrors.CameraPermissionError && !error.canAskAgain);
  assert.deepEqual(f.calls, ["read"]); assert.equal(leases, 0);
});

test("first request is prompted only after read and launches only after granted response", async () => {
  const gate = deferred<ImagePicker.CameraPermissionResponse>();
  const f = pickerFixture({ read: async () => ({ ...denied, status: "undetermined" as ImagePicker.PermissionStatus }), request: () => gate.promise });
  let leases = 0;
  const result = f.photos.pickPhotos("camera", 1, operation => { leases += 1; return operation(); });
  await settle(); assert.deepEqual(f.calls, ["read", "request"]);
  gate.resolve(granted); await result;
  assert.deepEqual(f.calls, ["read", "request", "camera"]); assert.equal(leases, 2);
});

for (const response of [denied, blocked]) test(`request denied canAskAgain=${response.canAskAgain}: typed error occurs after provider lease settles without relock`, async t => {
  const p = await unlockedProvider(); t.after(p.close);
  const f = pickerFixture({ read: async () => denied, request: async () => { p.emit(false); p.emit(true); return response; } });
  await assert.rejects(f.photos.pickPhotos("camera", 1, p.security.runTrustedNativePicker, () => p.security.isUnlocked()), (error: unknown) => error instanceof cameraErrors.CameraPermissionError && error.canAskAgain === response.canAskAgain);
  assert.deepEqual(f.calls, ["read", "request"]);
  assert.equal(p.security.isUnlocked(), true);
  assert.equal(p.controller.getSnapshot().nativeInteractionPending, false);
  assert.equal(p.adapter.prompts.length, 1); assert.deepEqual(p.adapter.writes, []);
});

test("normal permission read followed by a revoked context cannot request or launch", async () => {
  const gate = deferred<ImagePicker.CameraPermissionResponse>(); let allowed = true;
  const f = pickerFixture({ read: () => gate.promise }); let leases = 0;
  const result = f.photos.pickPhotos("camera", 1, operation => { leases += 1; return operation(); }, () => allowed);
  const rejection = assert.rejects(result, cameraErrors.NativeSelectionError);
  allowed = false; gate.resolve(denied); await rejection;
  assert.deepEqual(f.calls, ["read"]); assert.equal(leases, 0);
});

for (const stage of ["read", "request", "camera"] as const) test(`${stage} failure does not claim permission denial`, async () => {
  const failure = new Error("TRUSTED_NATIVE_INTERACTION_EXPIRED");
  const f = pickerFixture({
    read: async () => { if (stage === "read") throw failure; return stage === "request" ? denied : granted; },
    request: async () => { throw failure; },
    launch: async () => { throw failure; },
  });
  await assert.rejects(f.photos.pickPhotos("camera", 1), (error: unknown) => error instanceof cameraErrors.NativeSelectionError && !/permis|ajustes/i.test(error.message));
  assert.equal(f.calls.includes("camera"), stage === "camera");
});

test("provider timeout during native prompt launches no camera and does not invent denied permission", async t => {
  const p = await unlockedProvider(); t.after(p.close);
  const gate = deferred<ImagePicker.CameraPermissionResponse>();
  const f = pickerFixture({ read: async () => denied, request: () => gate.promise });
  const result = f.photos.pickPhotos("camera", 1, p.security.runTrustedNativePicker);
  const rejection = assert.rejects(result, cameraErrors.NativeSelectionError);
  await settle(); p.clock.advance(6 * 60 * 1000); await p.settle(); await rejection;
  gate.resolve(blocked); await p.settle();
  assert.deepEqual(f.calls, ["read", "request"]);
});

test("native camera unavailable has a separate concrete error; SDK permission revocation is not guessed", async () => {
  for (const code of ["ERR_MISSING_ACTIVITY_TO_HANDLE_INTENT", "ERR_CAMERA_UNAVAILABLE", "ERR_MISSING_CAMERA_PERMISSION"]) {
    const f = pickerFixture({ launch: async () => { throw Object.assign(new Error("native failure"), { code }); } });
    await assert.rejects(f.photos.pickPhotos("camera", 1), code === "ERR_MISSING_CAMERA_PERMISSION" ? cameraErrors.NativeSelectionError : cameraErrors.NativeCameraUnavailableError);
  }
});

test("web activation stays synchronous; cancellation returns unchanged; capacity invokes no SDK", async () => {
  const f = pickerFixture({ os: "web" });
  const result = f.photos.pickPhotos("camera", 1);
  assert.deepEqual(f.calls, ["camera"]);
  assert.equal((await result).canceled, true);
  await assert.rejects(f.photos.pickPhotos("camera", 0), /4/);
  assert.deepEqual(f.calls, ["camera"]);
});

function guideFixture(isUnlocked?: () => boolean) {
  const hooks = reactFixture();
  const control = { unlocked: true, allowed: true, scope: "work-1", settingsCalls: 0, retryCalls: 0, galleryCalls: 0 };
  const ports = { settings: async () => {}, retry: async (_isCurrent: () => boolean) => {}, gallery: async (_isCurrent: () => boolean) => {} };
  const security = { isUnlocked: () => isUnlocked?.() ?? control.unlocked, blocked: false };
  const react = { ...hooks.react, useContext: () => security, createContext: () => ({}) };
  const module = loadSource<typeof import("../src/screens/workDetail/files/useCameraPermissionGuide")>("screens/workDetail/files/useCameraPermissionGuide.ts", id => {
    if (id === "react") return react;
    if (id === "react-native") return { Linking: { openSettings: async () => { control.settingsCalls += 1; await ports.settings(); } } };
    if (id === "../../../security/DeviceSecurityContext") return { DeviceSecurityContext: {} };
    if (id === "../../../domain/cameraErrors") return cameraErrors;
    throw new Error(`UNEXPECTED_GUIDE_IMPORT:${id}`);
  });
  const privacy = loadSource<typeof import("../src/security/DeviceSecurityContext")>("security/DeviceSecurityContext.tsx", id => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react-native") return { Modal: "Modal", View: "View" };
    throw new Error(`UNEXPECTED_PRIVACY_IMPORT:${id}`);
  });
  const component = loadSource<typeof import("../src/screens/workDetail/files/CameraPermissionGuide")>("screens/workDetail/files/CameraPermissionGuide.tsx", id => {
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react-native") return { ScrollView: "ScrollView", View: "View" };
    if (id === "../../../security/DeviceSecurityContext") return { PrivateModal: "PrivateModal" };
    if (id === "../../../ui/components") return { BodyText: "BodyText", Button: "Button", SectionTitle: "SectionTitle" };
    if (id === "../DetailUi") return { Notice: "Notice" };
    if (id === "../detailStyles") return { styles: {} };
    throw new Error(`UNEXPECTED_GUIDE_UI_IMPORT:${id}`);
  });
  const actions = {
    onRetry: async (isCurrent: () => boolean) => { control.retryCalls += 1; await ports.retry(isCurrent); },
    onGallery: async (isCurrent: () => boolean) => { control.galleryCalls += 1; await ports.gallery(isCurrent); },
  };
  function render() { const guide = hooks.render(() => module.useCameraPermissionGuide(control.scope, () => control.allowed)); hooks.flush(); return guide; }
  render();
  return { control, ports, actions, render, close: hooks.unmount,
    show(canAskAgain = false) { render().handleError(new cameraErrors.CameraPermissionError(canAskAgain), actions); return render(); },
    tree() { return component.CameraPermissionGuide({ guide: render() }); },
    modal() {
      const tree = component.CameraPermissionGuide({ guide: render() });
      const props = elements<{ visible: boolean; children: ReactNode }>(tree, "PrivateModal")[0].props;
      security.blocked = !security.isUnlocked();
      return privacy.PrivateModal(props);
    },
  };
}

test("actual guide labels offer retry or explicit settings; cancel does not trigger actions", async t => {
  const f = guideFixture(); t.after(f.close);
  f.show(true);
  assert.ok(action(f.tree(), "Reintentar permiso"));
  assert.equal(elements<{ title: string }>(f.tree(), "Button").some(button => button.props.title === "Abrir ajustes"), false);
  await f.render().openSettings(); assert.equal(f.control.settingsCalls, 0);
  f.show(false); assert.ok(action(f.tree(), "Abrir ajustes")); assert.ok(action(f.tree(), "Volver a intentar"));
  action(f.tree(), "Cancelar").onPress(); assert.equal(f.render().visible, false);
  assert.equal(f.control.retryCalls, 0);
  f.show(false); await f.render().pickGallery(); assert.equal(f.control.galleryCalls, 1); assert.equal(f.render().visible, false);
});

test("settings is explicit, single flight, fails friendly and never automatically retries on return", async t => {
  const f = guideFixture(); t.after(f.close); const gate = deferred<void>(); f.ports.settings = () => gate.promise;
  f.show(false); assert.equal(f.control.settingsCalls, 0);
  const settings = f.render().openSettings(); await f.render().openSettings(); await f.render().retry();
  assert.equal(f.control.settingsCalls, 1); assert.equal(f.control.retryCalls, 0);
  gate.reject(new Error("private native details")); await settings;
  assert.match(f.render().message ?? "", /No se pudieron abrir los ajustes/);
  assert.doesNotMatch(f.render().message ?? "", /private native details/);
  f.ports.settings = async () => {}; await f.render().openSettings();
  f.control.unlocked = false;
  assert.equal(f.render().visible, false); assert.equal(f.modal().props.visible, false);
  await f.render().retry(); assert.equal(f.control.retryCalls, 0);
  f.control.unlocked = true; f.render(); assert.equal(f.control.retryCalls, 0);
  assert.equal(f.render().visible, true); assert.equal(f.modal().props.visible, true);
  await f.render().retry(); assert.equal(f.control.retryCalls, 1);
});

test("retry is single flight, repeated denial updates guide, cancellation ignores late errors", async t => {
  const f = guideFixture(); t.after(f.close); const gate = deferred<void>(); f.ports.retry = () => gate.promise;
  f.show(true); const retry = f.render().retry(); await f.render().retry(); await f.render().openSettings();
  assert.equal(f.control.retryCalls, 1); assert.equal(f.control.settingsCalls, 0);
  gate.reject(new cameraErrors.CameraPermissionError(false)); await retry;
  assert.equal(f.render().canAskAgain, false); assert.equal(f.render().busy, false);
  const settingsGate = deferred<void>(); f.ports.settings = () => settingsGate.promise;
  const settings = f.render().openSettings(); f.render().cancel();
  settingsGate.reject(new Error("late")); await settings;
  assert.equal(f.render().visible, false); assert.equal(f.render().message, null);
});

test("changed scope, ABA scope and unmount discard retained guide callbacks and late results", async () => {
  const f = guideFixture(); const gate = deferred<void>(); f.ports.settings = () => gate.promise;
  const old = f.show(false); const pending = old.openSettings();
  f.control.scope = "work-2"; f.render();
  await old.retry(); await old.openSettings();
  assert.equal(f.control.retryCalls, 0); assert.equal(f.render().visible, false);
  f.control.scope = "work-1"; f.render(); await old.retry(); assert.equal(f.control.retryCalls, 0);
  f.show(false); f.close(); gate.reject(new Error("late")); await pending;
  await old.retry(); assert.equal(f.control.retryCalls, 0); assert.equal(f.control.settingsCalls, 1);
});

test("cancel during retry invalidates its pending read before another native prompt or camera launch", async t => {
  const f = guideFixture(); t.after(f.close);
  const gate = deferred<ImagePicker.CameraPermissionResponse>();
  const picker = pickerFixture({ read: () => gate.promise });
  f.ports.retry = async isCurrent => { await picker.photos.pickPhotos("camera", 1, operation => operation(), isCurrent); };
  f.show(true); const retry = f.render().retry();
  assert.deepEqual(picker.calls, ["read"]);
  f.render().cancel(); gate.resolve(denied); await retry;
  assert.deepEqual(picker.calls, ["read"]); assert.equal(f.render().visible, false); assert.equal(f.render().message, null);
});

test("settings uses normal provider background lock and requires biometrics plus explicit camera retry", async t => {
  const p = await unlockedProvider(); t.after(p.close);
  const f = guideFixture(() => p.security.isUnlocked()); t.after(f.close);
  f.ports.settings = async () => { p.emit(false); };
  f.show(false); await f.render().openSettings(); await p.settle();
  assert.equal(p.controller.getSnapshot().nativeInteractionPending ?? false, false);
  assert.equal(p.security.isUnlocked(), false); assert.equal(f.modal().props.visible, false);
  p.emit(true); await p.settle();
  assert.equal(p.adapter.prompts.length, 2); assert.equal(f.control.retryCalls, 0);
  p.adapter.prompts[1].resolve({ success: true }); await p.settle();
  assert.equal(f.render().visible, true); assert.equal(f.control.retryCalls, 0);
  await f.render().retry(); assert.equal(f.control.retryCalls, 1); assert.deepEqual(p.adapter.writes, []);
});

test("actual FileWorkspace settles denial before guide, deduplicates selection and preserves draft on cancel", async t => {
  const base = durableReactFixture();
  const security = { isUnlocked: () => true };
  const hooks = { ...base, react: { ...base.react, useContext: () => security } };
  t.after(hooks.unmount);
  let lease: symbol | null = null; let reads = 0; let copies = 0; let uploads = 0;
  const existing = { id: "retained", uri: "file:///draft/retained.jpg", name: "retained.jpg", size: 120, mimeType: "image/jpeg", uploaded: false };
  const files = [existing];
  const store = {
    beginFiles: () => { if (lease) return null; lease = Symbol(); return lease; },
    endFiles: (token: symbol) => { if (lease === token) lease = null; },
    getSnapshot: () => ({ files }),
    addFiles: async () => { copies += 1; },
  };
  const gate = deferred<void>();
  const guideModule = uiModule<typeof import("../src/screens/workDetail/files/useCameraPermissionGuide")>("screens/workDetail/files/useCameraPermissionGuide.ts", hooks, {
    "react-native": { Linking: { openSettings: async () => { throw new Error("SETTINGS_NOT_REQUESTED"); } } },
    "../../../security/DeviceSecurityContext": { DeviceSecurityContext: {} },
    "../../../domain/cameraErrors": cameraErrors,
  });
  const module = uiModule<{ FileWorkspace: Wrapped<FileWorkspaceProps> }>("screens/workDetail/FileWorkspace.tsx", hooks, {
    "../../security/DeviceSecurityContext": { PrivateModal: "Modal", DeviceSecurityContext: {} },
    "../../domain/cameraErrors": cameraErrors,
    "./files/useCameraPermissionGuide": guideModule,
    "./files/CameraPermissionGuide": { CameraPermissionGuide: "CameraPermissionGuide" },
    "./files/WorkspaceDraftStore": { useWorkspaceDraft: () => ({ files, hydrated: true, closed: false, fileBusy: lease !== null, error: null, saving: false, store }) },
    "./files/WorkspaceFileList": { PendingFileList: "PendingFileList", SavedFileList: "SavedFileList" },
    "./files/filePicker": { pickWorkspaceFiles: async () => { reads += 1; await gate.promise; throw new cameraErrors.CameraPermissionError(false); } },
  });
  const props: FileWorkspaceProps = { scopeKey: "camera-work", resourceKey: "direct-1", mode: "demo", readOnly: false, onLoad: async () => [], onUpload: async () => { uploads += 1; } };
  const render = () => renderWrapped(hooks, module.FileWorkspace, props);
  render(); await settle();
  const camera = action(render(), "Cámara"); camera.onPress(); camera.onPress();
  assert.equal(reads, 1); assert.ok(lease);
  gate.resolve(); await settle();
  const tree = render();
  const guide = elements<{ guide: CameraPermissionGuideController }>(tree, "CameraPermissionGuide")[0].props.guide;
  assert.equal(lease, null); assert.equal(guide.visible, true); assert.equal(guide.canAskAgain, false);
  assert.equal(copies, 0); assert.equal(uploads, 0);
  guide.cancel();
  assert.equal(elements<{ guide: CameraPermissionGuideController }>(render(), "CameraPermissionGuide")[0].props.guide.visible, false);
  const pending = elements<{ files: typeof files }>(render(), "PendingFileList")[0].props.files;
  assert.equal(pending.length, 1); assert.equal(pending[0], existing);
  assert.equal(copies, 0); assert.equal(uploads, 0);
});