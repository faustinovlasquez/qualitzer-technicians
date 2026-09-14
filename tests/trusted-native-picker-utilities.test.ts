/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type * as ImagePicker from "expo-image-picker";
import type * as DocumentPicker from "expo-document-picker";
import type { TrustedNativePicker } from "../src/security/contracts";
import * as cameraErrors from "../src/domain/cameraErrors";
import { loadSource } from "./helpers/tenant-challenge";
import { unlockedProvider } from "./helpers/trusted-native-picker";

function utilitiesFixture(options: { os?: "android" | "web"; permission?: boolean; canceled?: boolean; onNative?: (name: string) => void } = {}) {
  const calls: Array<{ name: string; options?: ImagePicker.ImagePickerOptions | DocumentPicker.DocumentPickerOptions }> = [];
  const image: ImagePicker.ImagePickerAsset = { uri: "file:///fixture/photo.jpg", width: 20, height: 20, fileName: "photo.jpg", fileSize: 120, mimeType: "image/jpeg" };
  const document: DocumentPicker.DocumentPickerAsset = { uri: "file:///fixture/file.pdf", name: "file.pdf", size: 100, mimeType: "application/pdf", lastModified: 1 };
  const imageResult = (): ImagePicker.ImagePickerResult => options.canceled ? { canceled: true, assets: null } : { canceled: false, assets: [image] };
  const sdk = {
    UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
    getCameraPermissionsAsync: async () => ({ granted: false, canAskAgain: true, status: "denied", expires: "never" }),
    requestCameraPermissionsAsync: async () => {
      calls.push({ name: "permission" }); options.onNative?.("permission");
      return { granted: options.permission ?? true, canAskAgain: true };
    },
    launchCameraAsync: async (pickerOptions: ImagePicker.ImagePickerOptions) => {
      calls.push({ name: "camera", options: pickerOptions }); options.onNative?.("camera"); return imageResult();
    },
    launchImageLibraryAsync: async (pickerOptions: ImagePicker.ImagePickerOptions) => {
      calls.push({ name: "library", options: pickerOptions }); options.onNative?.("library"); return imageResult();
    },
  };
  const filesystem = {
    File: class { constructor() { throw new Error("FILE_PERSISTENCE_OUTSIDE_PICKER"); } },
    Directory: class { constructor() { throw new Error("DIRECTORY_OUTSIDE_PICKER"); } },
    Paths: {},
  };
  const rules = { errorMessage: (error: unknown) => error instanceof Error ? error.message : "error", httpUrl: () => null };
  const native = { Platform: { OS: options.os ?? "android" } };
  const photos = loadSource<typeof import("../src/screens/workDetail/localPhotos")>("screens/workDetail/localPhotos.ts", id => {
    if (id === "expo-file-system") return filesystem;
    if (id === "expo-image-picker") return sdk;
    if (id === "react-native") return native;
    if (id === "./detailRules") return rules;
    if (id === "../../domain/cameraErrors") return cameraErrors;
    throw new Error(`UNEXPECTED_PHOTO_IMPORT:${id}`);
  });
  const fileRules = loadSource<typeof import("../src/screens/workDetail/files/fileRules")>("screens/workDetail/files/fileRules.ts", id => {
    if (id === "expo-file-system") return filesystem;
    if (id === "react-native") return native;
    if (id === "../localPhotos") return photos;
    if (id === "../detailRules") return rules;
    throw new Error(`UNEXPECTED_RULES_IMPORT:${id}`);
  });
  const files = loadSource<typeof import("../src/screens/workDetail/files/filePicker")>("screens/workDetail/files/filePicker.ts", id => {
    if (id === "../localPhotos") return photos;
    if (id === "./fileRules") return fileRules;
    if (id === "expo-document-picker") return {
      getDocumentAsync: async (pickerOptions: DocumentPicker.DocumentPickerOptions): Promise<DocumentPicker.DocumentPickerResult> => {
        calls.push({ name: "document", options: pickerOptions }); options.onNative?.("document");
        return options.canceled ? { canceled: true, assets: null } : { canceled: false, assets: [document] };
      },
    };
    throw new Error(`UNEXPECTED_FILES_IMPORT:${id}`);
  });
  return { photos, files, fileRules, calls, image, document };
}

test("actual utilities wrap permission and camera separately with two successful provider leases", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  const u = utilitiesFixture({ onNative: () => {
    assert.equal(f.security.isUnlocked(), false);
    assert.equal(f.controller.getSnapshot().nativeInteractionPending, true);
    f.emit(false); f.emit(true);
  } });
  const run = f.security.runTrustedNativePicker;
  assert.ok(run);
  let leases = 0;
  const runner: TrustedNativePicker = operation => { leases += 1; assert.equal(f.security.isUnlocked(), true); return run(operation); };
  const selected = await u.files.pickWorkspaceFiles("camera", 50, runner);
  assert.equal(leases, 2);
  assert.deepEqual(u.calls.map(call => call.name), ["permission", "camera"]);
  assert.equal(selected[0].uri, u.image.uri);
  assert.equal(selected[0].size, 120);
  assert.equal(f.security.isUnlocked(), true);
  assert.equal(f.adapter.prompts.length, 1);
  assert.deepEqual(f.adapter.writes, []);
});

for (const source of ["library", "pdf", "document"] as const) {
  test(`${source}: one SDK call only, original limits/options and selection mapping preserved`, async () => {
    const u = utilitiesFixture();
    let leases = 0;
    const runner: TrustedNativePicker = operation => { leases += 1; return operation(); };
    const result = await u.files.pickWorkspaceFiles(source, 73, runner);
    assert.equal(leases, 1);
    assert.equal(u.calls.length, 1);
    assert.equal(result.length, 1);
    if (source === "library") {
      const pickerOptions = u.calls[0].options as ImagePicker.ImagePickerOptions;
      assert.equal(pickerOptions.selectionLimit, 73);
      assert.equal(pickerOptions.allowsMultipleSelection, true);
      assert.equal(pickerOptions.quality, 1);
      assert.equal(pickerOptions.allowsEditing, false);
    } else {
      const pickerOptions = u.calls[0].options as DocumentPicker.DocumentPickerOptions;
      assert.equal(pickerOptions.copyToCacheDirectory, true);
      assert.equal(pickerOptions.multiple, true);
      assert.equal(pickerOptions.base64, false);
      if (source === "pdf") assert.equal(pickerOptions.type, "application/pdf");
      else assert.equal(pickerOptions.type, u.fileRules.DOCUMENT_MIME_TYPES);
    }
    assert.equal(u.photos.MAX_PHOTOS, 4);
    assert.equal(u.fileRules.MAX_FILES, 100);
    assert.equal(u.photos.MAX_PHOTO_BYTES, 25 * 1024 * 1024);
    assert.equal(u.photos.MAX_TOTAL_BYTES, 40 * 1024 * 1024);
  });
}

test("permission denied completes its own lease but never launches camera", async t => {
  const f = await unlockedProvider();
  t.after(() => f.close());
  const u = utilitiesFixture({ permission: false, onNative: () => { f.emit(false); f.emit(true); } });
  await assert.rejects(u.photos.pickPhotos("camera", 1, f.security.runTrustedNativePicker), cameraErrors.CameraPermissionError);
  assert.deepEqual(u.calls.map(call => call.name), ["permission"]);
  assert.equal(f.security.isUnlocked(), true);
});

for (const source of ["camera", "library", "document"] as const) {
  test(`${source} cancellation returns no selection and optional runner preserves existing direct callers`, async () => {
    const u = utilitiesFixture({ canceled: true });
    const result = await u.files.pickWorkspaceFiles(source, 4);
    assert.equal(result.length, 0);
    assert.equal(u.calls.length, source === "camera" ? 2 : 1);
  });
}

test("web camera still opens synchronously from user activation with no permission request", async () => {
  const u = utilitiesFixture({ os: "web" });
  const result = u.photos.pickPhotos("camera", 1);
  assert.deepEqual(u.calls.map(call => call.name), ["camera"]);
  assert.equal((await result).canceled, false);
});

test("full destination and rejecting runner never invoke SDK or file persistence", async () => {
  const u = utilitiesFixture();
  const denied: TrustedNativePicker = async () => { throw new Error("TRUSTED_NATIVE_INTERACTION_NOT_ALLOWED"); };
  await assert.rejects(u.files.pickWorkspaceFiles("camera", 0, denied), /100/);
  await assert.rejects(u.photos.pickPhotos("camera", 0, denied), /4/);
  await assert.rejects(u.files.pickWorkspaceFiles("document", 1, denied), /NOT_ALLOWED/);
  assert.equal(u.calls.length, 0);
});