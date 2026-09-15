/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import type { Attachment, LocalPhoto, Session, WorkScope } from "../src/domain/models";
import { OfflineQueuedError } from "../src/domain/offline";
import { OfflineTechnicianRepository } from "../src/offline/OfflineTechnicianRepository";
import { fixture, uuid } from "../src/offline/tests/fakes";
import { isConfirmedAttachment, offlineAttachment, pendingDocumentAttachment, type PendingDocument } from "../src/screens/offline/offlineUi";
import * as offlineUi from "../src/screens/offline/offlineUi";
import type { FileWorkspaceProps } from "../src/screens/workDetail/FileWorkspace";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";
import { uiModule } from "./helpers/durable-ui";

const remote: Attachment = { id: 41, name: "synthetic.pdf", url: "https://files.example.com/41" };
const pending: PendingDocument = {
  id: uuid(1), kind: "document", status: "needs_review", attempts: 1, createdAt: 1000, nextAttemptAt: 0,
  scope: { companyBranchId: 1, groupId: "direct-80", workId: "80", startDate: "2026-09-11", endDate: "2026-09-11" },
  file: { id: uuid(2), namespace: "synthetic", name: "synthetic.pdf", mimeType: "application/pdf", size: 10, sha256: "a".repeat(64) },
};

test("pending factory owns its metadata and never counts as confirmed, including after serialization", () => {
  const file = pendingDocumentAttachment(pending);
  assert.equal(Object.getPrototypeOf(file), Object.prototype);
  assert.equal(Object.hasOwn(file, "offline"), true);
  assert.equal(Object.hasOwn(file.offline, "confirmed"), true);
  assert.equal(offlineAttachment(file), file);
  assert.equal(isConfirmedAttachment(file), false);
  assert.equal(isConfirmedAttachment(JSON.parse(JSON.stringify(file))), false);
  assert.equal(isConfirmedAttachment(remote), true);
  assert.equal(isConfirmedAttachment({ ...file, id: 41 }), false);
});

test("malformed offline metadata cannot fall back to a numeric remote ID", () => {
  for (const offline of [null, undefined, false, "confirmed", {}, { confirmed: false }, { confirmed: "false", downloaded: true }, { confirmed: true, downloaded: "true" }]) {
    const file = { ...remote, offline };
    assert.equal(offlineAttachment(file), null);
    assert.equal(isConfirmedAttachment(file), false, JSON.stringify(offline));
  }
});

test("inherited offline flags and array metadata cannot forge confirmed evidence", () => {
  const inherited: Attachment = { ...remote };
  Object.setPrototypeOf(inherited, { offline: { confirmed: true, downloaded: true } });
  const flags: object = {};
  Object.setPrototypeOf(flags, { confirmed: true, downloaded: true });
  const files = [inherited, { ...remote, offline: flags }, { ...remote, offline: Object.assign([], { confirmed: true, downloaded: true }) }];
  for (const file of files) {
    assert.equal(offlineAttachment(file), null);
    assert.equal(isConfirmedAttachment(file), false);
  }
  const valid = { ...remote, offline: { confirmed: true, downloaded: false } };
  assert.equal(offlineAttachment(valid), valid);
  assert.equal(isConfirmedAttachment(valid), true);
});

test("actual FileWorkspace labels demo listings separately, retains review copies and leaves live counts unchanged", async () => {
  const hooks = reactFixture();
  const localRequire = createRequire(resolve(__dirname, "../src/screens/workDetail/FileWorkspace.tsx"));
  const jsx = (type: unknown, props: object): unknown => typeof type === "function" ? type(props) : { type, props };
  const store = {};
  const module = loadSource<typeof import("../src/screens/workDetail/FileWorkspace")>("screens/workDetail/FileWorkspace.tsx", (id) => {
    if (id === "react") return { ...hooks.react, useContext: () => null };
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react-native") return { Platform: { OS: "android" }, ActivityIndicator: "ActivityIndicator", Modal: "Modal", ScrollView: "ScrollView", Text: "Text", View: "View" };
    if (id === "../../security/DeviceSecurityContext") return { PrivateModal: "Modal", DeviceSecurityContext: {} };
    if (id === "./files/CameraPermissionGuide") return { CameraPermissionGuide: "CameraPermissionGuide" };
    if (id === "./files/useCameraPermissionGuide") return uiModule("screens/workDetail/files/useCameraPermissionGuide.ts", hooks);
    if (id === "../../security/useTrustedNativePicker") return { useTrustedNativePicker: () => <T>(operation: () => Promise<T>) => operation() };
    if (id === "../offline/offlineUi") return offlineUi;
    if (id === "../offline/OfflineFileCard") return { OfflineFileCard: "OfflineFileCard" };
    if (id === "../../ui/components") return { BodyText: "BodyText", Button: "Button", IconButton: "IconButton", SectionTitle: "SectionTitle" };
    if (id === "./DetailUi") return { Notice: "Notice" };
    if (id === "./detailStyles") return { styles: {} };
    if (id === "./files/workspaceStyles") return { workspaceStyles: {} };
    if (id === "./files/fileRules") return { MAX_FILES: 100, fileSizeLabel: () => "0 MiB" };
    if (id === "./files/filePicker" || id === "./files/saveFileBatch") return {};
    if (id === "./files/WorkspaceFileList") return { PendingFileList: "PendingFileList", SavedFileList: "SavedFileList" };
    if (id === "./files/WorkspaceDraftStore") return { useWorkspaceDraft: () => ({ store, files: [], hydrated: true, closed: false, error: null }) };
    return localRequire(id);
  });
  const operations: PendingDocument[] = [pending, { ...pending, id: uuid(3), file: { ...pending.file, id: uuid(4) } }];
  const confirmedCopy = { ...remote, id: 43, name: "confirmed.jpg", type: "image/jpeg", offline: { confirmed: true, downloaded: true, localFileId: "copy-43" } };
  const listed: Attachment[] = [remote, { ...remote, id: 42 }, confirmedCopy, ...operations.map(pendingDocumentAttachment)];
  const props: FileWorkspaceProps = { scopeKey: "synthetic", mode: "demo", readOnly: false, pending: operations, onLoad: async () => listed, onUpload: async () => { throw new Error("NO_WRITE"); } };
  const render = () => hooks.render(() => module.FileWorkspace(props));
  render(); hooks.flush();
  await new Promise<void>((done) => setImmediate(done));
  const demo = JSON.stringify(render());
  assert.ok(demo.includes('[3," en listado demo"," · ",2," en cola"]'));
  assert.ok(demo.includes("El listado demo no confirma los envíos en cola."));
  assert.equal((demo.match(/"type":"OfflineFileCard"/g) ?? []).length, 2);
  assert.equal((demo.match(/"status":"needs_review"/g) ?? []).length, 2);
  props.mode = "live";
  const live = JSON.stringify(render());
  assert.ok(live.includes('[3," confirmados"," · ",2," en cola"]'));
  assert.equal((live.match(/"type":"OfflineFileCard"/g) ?? []).length, 2, "only pending copies use the offline card");
  assert.equal((live.match(/"type":"SavedFileList"/g) ?? []).length, 1);
  assert.equal((live.match(/"name":"confirmed.jpg"/g) ?? []).length, 1, "confirmed copy is shown once in the normal list");
  assert.ok(!live.includes("El listado demo no confirma los envíos en cola."));
  hooks.unmount();
});

test("actual demo document callback creates listed files but missing receipt fileId preserves review and original UUIDs", async () => {
  const f = fixture();
  const requireDemo = createRequire(resolve(__dirname, "../src/infrastructure/DemoTechnicianRepository.ts"));
  const photos = loadSource<typeof import("../src/infrastructure/photos")>("infrastructure/photos.ts", (id) => {
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "expo/fetch") return { fetch: () => { throw new Error("NETWORK_FORBIDDEN"); } };
    if (id === "expo-file-system") return { File: class {
      constructor(private readonly uri: string) {}
      async base64(): Promise<string> {
        const bytes = f.files.contents.get(this.uri.slice("memory:".length));
        assert.ok(bytes);
        return Buffer.from(bytes).toString("base64");
      }
    } };
    return requireDemo(id);
  }, { Uint8Array, atob });
  const module = loadSource<typeof import("../src/infrastructure/DemoTechnicianRepository")>("infrastructure/DemoTechnicianRepository.ts", (id) => {
    if (id === "./photos") return photos;
    if (id === "expo-crypto") return { CryptoDigestAlgorithm: { SHA256: "sha256" }, digest: async (_algorithm: string, bytes: Uint8Array) => createHash("sha256").update(bytes).digest() };
    return requireDemo(id);
  }, { structuredClone, Uint8Array });
  const demo = new module.DemoTechnicianRepository();
  const user = await demo.me();
  const data = await demo.assignments({ startDate: "2000-01-01", endDate: "2100-01-01" });
  const group = data.groups.find((item) => item.works.some((work) => work.checklists.some((list) => list.steps.length > 0)));
  assert.ok(group);
  const work = group.works.find((item) => item.checklists.some((list) => list.steps.length > 0));
  assert.ok(work);
  const step = work.checklists.flatMap((list) => list.steps)[0];
  assert.ok(step);
  const session: Session = { mode: "demo", token: "synthetic-demo", tenant: { id: "demo", name: "Demo", portalOrigin: "https://demo.example", environment: "development" }, user, branchId: user.accessBranchs[0].id };
  const repository = new OfflineTechnicianRepository(demo, session, { ...f.dependencies, upstream: demo, user, branchId: session.branchId! });
  const scope: WorkScope = { groupId: group.id, workId: work.id, companyBranchId: session.branchId!, startDate: work.scheduledDate, endDate: work.scheduledDate };
  const inputs: LocalPhoto[] = ["synthetic.pdf", "synthetic.png"].map((name, index) => {
    const uri = `source:${index}`;
    const bytes = new TextEncoder().encode(`synthetic-content-${index}`);
    f.files.sources.set(uri, bytes);
    return { id: `draft-${index}`, uri, name, mimeType: index === 0 ? "application/pdf" : "image/png", size: bytes.length };
  });
  for (const file of inputs) await assert.rejects(repository.uploadDocuments(scope, [file], String(step.stepId)), OfflineQueuedError);
  assert.ok((await f.store.read("a")).operations.every((operation) => operation.status === "pending"));
  await repository.engine.syncNow();
  const before = await f.store.read("a");
  assert.equal(before.operations.length, 2);
  assert.ok(before.operations.every((operation) => operation.status === "needs_review" && operation.lastError === "OFFLINE_DOCUMENT_FILE_ID_INVALID"));
  const listed = await repository.stepFiles(scope, String(step.stepId));
  assert.equal(listed.filter(isConfirmedAttachment).length, 2);
  assert.equal(listed.filter((file) => !isConfirmedAttachment(file)).length, 2);
  assert.equal(listed.length, 4);
  assert.equal(repository.getSnapshot().pending, 2);
  assert.equal(repository.getSnapshot().conflicts, 2);
  assert.equal(before.attachments.length, 0);
  for (const operation of before.operations) {
    const receipt = await demo.offlineReceipt(operation.id, scope.companyBranchId);
    assert.equal(receipt?.state, "applied");
    assert.equal(receipt?.fileId, undefined);
  }
  await repository.syncNow();
  assert.deepEqual((await f.store.read("a")).operations, before.operations);
  assert.equal(f.files.files.size, 2);
  assert.equal(f.files.removes.length, 0);
});