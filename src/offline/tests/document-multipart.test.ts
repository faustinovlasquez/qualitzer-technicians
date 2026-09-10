import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { LocalPhoto } from "../../domain/models";
import { OfflineUnavailableError } from "../../domain/offline";

const root = resolve(__dirname, "../../..");
const data = new Uint8Array([0, 1, 255, 2]);
const photo: LocalPhoto = { id: "draft", uri: "file:///sandbox/offline/00000000-0000-4000-8000-000000000001", name: "evidencia original.pdf", mimeType: "application/pdf", size: data.length };

function load<T>(path: string, imports: (id: string) => unknown): T {
  const exports = {};
  const module = { exports };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports, require: imports, Blob, Uint8Array, Object, Error, TypeError, TextEncoder });
  return module.exports as T;
}

class NativeFile {
  constructor(readonly uri: string) {}
  get name(): string { return this.uri.split("/").at(-1)!; }
  get type(): string | null { return null; }
  async bytes(): Promise<Uint8Array> { return data.slice(); }
}

function nativeForm() {
  class RNForm { _parts: Array<[string, unknown]> = []; }
  const patch = load<{ installFormDataPatch(base: typeof RNForm): new () => FormData }>(resolve(root, "node_modules/expo/src/winter/FormData.ts"), () => { throw new Error("UNEXPECTED_IMPORT"); });
  const Patched = patch.installFormDataPatch(RNForm);
  return new Patched();
}

const converter = load<{ convertFormDataAsync(form: FormData, boundary: string): Promise<{ body: Uint8Array }> }>(
  resolve(root, "node_modules/expo/src/winter/fetch/convertFormData.ts"),
  (id) => {
    assert.equal(id, "../../utils/blobUtils");
    return { blobToArrayBufferAsync: async () => { throw new Error("MUST_USE_EXPO_FILE_BYTES"); } };
  });

function photos(File: typeof NativeFile = NativeFile) {
  return load<{ appendPhoto(form: FormData, photo: LocalPhoto): Promise<void> }>(resolve(root, "src/infrastructure/photos.ts"), (id) => {
    if (id === "expo-file-system") return { File };
    if (id === "expo/fetch") return { fetch: () => { throw new Error("NO_NETWORK_ALLOWED"); } };
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "../domain/offline") return { OfflineUnavailableError };
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  });
}

test("installed Expo 57 sources reproduce ignored filename argument and absent MIME for extensionless native File", async () => {
  assert.match(JSON.parse(readFileSync(resolve(root, "node_modules/expo/package.json"), "utf8")).version, /^57\./);
  const form = nativeForm();
  Reflect.apply(form.append, form, ["files", new NativeFile(photo.uri), photo.name]);
  const body = new TextDecoder().decode((await converter.convertFormDataAsync(form, "test-boundary")).body);
  assert.ok(body.includes('filename="00000000-0000-4000-8000-000000000001"'));
  assert.ok(!body.includes("application/pdf"));
  assert.ok(!body.includes("evidencia"));
});

test("native multipart preserves persisted name, MIME and all bytes without renaming the owned file", async () => {
  const form = nativeForm();
  await photos().appendPhoto(form, photo);
  const payload = (await converter.convertFormDataAsync(form, "test-boundary")).body;
  const start = new TextEncoder().encode(`--test-boundary\r\ncontent-disposition: form-data; name="files"; filename="${encodeURIComponent(photo.name)}"\r\ncontent-type: application/pdf\r\n\r\n`);
  const end = new TextEncoder().encode("\r\n--test-boundary--\r\n");
  assert.deepEqual(payload, new Uint8Array([...start, ...data, ...end]));
  const entry = form.get("files");
  assert.ok(entry instanceof NativeFile);
  assert.equal(entry.uri, photo.uri);
  assert.equal(entry.name, photo.name); assert.equal(entry.type, photo.mimeType);
  assert.equal(new NativeFile(photo.uri).name, photo.uri.split("/").at(-1));
});

test("MIME metadata bypasses extension-based native getter without reading it", async () => {
  class UnavailableType extends NativeFile {
    override get type(): string { throw new Error("private native MIME failure"); }
  }
  const form = nativeForm(); await photos(UnavailableType).appendPhoto(form, photo);
  await converter.convertFormDataAsync(form, "test-boundary");
});

test("native construction and append failures become specific sanitized diagnostics before transport", async () => {
  class FailingFile extends NativeFile {
    constructor(uri: string) { super(uri); throw new Error("file:///private secret"); }
  }
  await assert.rejects(photos(FailingFile).appendPhoto(nativeForm(), photo), (error: unknown) =>
    error instanceof OfflineUnavailableError && error.code === "OFFLINE_DOCUMENT_MULTIPART_PREPARATION_FAILED" && !error.message.includes("secret"));
  const form = nativeForm(); form.append = () => { throw new TypeError("private FormData detail"); };
  await assert.rejects(photos().appendPhoto(form, photo), /OFFLINE_DOCUMENT_MULTIPART_PREPARATION_FAILED/);
});