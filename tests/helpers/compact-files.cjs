const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");

function fileHarness(platform = "web") {
  const cache = new Map();
  const storage = new Map();
  const disk = new Map();
  const revoked = [];
  const pickerCalls = [];
  const control = { failWrite: false, failCopy: false, result: { canceled: true, assets: null } };
  let sequence = 0;
  class File {
    constructor(...parts) { this.uri = parts.map((part) => typeof part === "string" ? part : part.uri).join("/"); }
    get exists() { return disk.has(this.uri); }
    get size() { return disk.get(this.uri)?.size ?? 0; }
    get type() { return disk.get(this.uri)?.type ?? ""; }
    create() { disk.set(this.uri, { size: 0, type: "" }); }
    write(text) { disk.set(this.uri, { size: text.length, type: "text/plain" }); }
    delete() { disk.delete(this.uri); }
    async copy(destination) { if (control.failCopy) throw new Error("COPY_FAILED"); disk.set(destination.uri, { ...disk.get(this.uri) }); }
  }
  const mocks = {
    "react-native": { Platform: { OS: platform } },
    react: {},
    "expo-file-system": { File, Directory: File, Paths: { document: "file:///owned" } },
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { if (control.failWrite) throw new Error("STORAGE_FAILED"); storage.set(key, value); },
      removeItem: async (key) => storage.delete(key),
    },
    "expo-document-picker": { getDocumentAsync: async (options) => { pickerCalls.push({ source: "document", options }); return control.result; } },
    "expo-image-picker": {
      UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
      requestCameraPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async (options) => { pickerCalls.push({ source: "camera", options }); return control.result; },
      launchImageLibraryAsync: async (options) => { pickerCalls.push({ source: "library", options }); return control.result; },
    },
  };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const localRequire = (name) => {
      if (mocks[name]) return mocks[name];
      if (!name.startsWith(".")) return require(name);
      const resolved = path.resolve(path.dirname(filename), name);
      return load(fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : resolved);
    };
    const urls = { createObjectURL: () => `blob:fixture-${++sequence}`, revokeObjectURL: (uri) => revoked.push(uri) };
    vm.runInThisContext(`(function(require,module,exports,URL){${source}\n})`, { filename })(localRequire, module, module.exports, urls);
    return module.exports;
  }
  const storeModule = load("src/screens/workDetail/files/WorkspaceDraftStore.ts");
  const batch = load("src/screens/workDetail/files/saveFileBatch.ts");
  const picker = load("src/screens/workDetail/files/filePicker.ts");
  const offline = load("src/domain/offline.ts");
  const rules = load("src/screens/workDetail/files/fileRules.ts");
  function asset(name, size = 100, mimeType = name.endsWith("pdf") ? "application/pdf" : "image/png") {
    const uri = `file:///picked/${++sequence}-${name}`;
    disk.set(uri, { size, type: mimeType });
    return { uri, name, size, mimeType, blob: { size, type: mimeType } };
  }
  async function store(scope = "tenant:branch:work:step") { const result = new storeModule.WorkspaceDraftStore(scope, "live"); await result.flush(); return result; }
  const save = (store, upload, extra = {}) => batch.saveFileBatch({ store, upload, canContinue: () => true, requireSource: true, onProgress: () => {}, ...extra });
  return { ...rules, ...picker, ...offline, store, save, asset, control, storage, disk, revoked, pickerCalls };
}
module.exports = { fileHarness };