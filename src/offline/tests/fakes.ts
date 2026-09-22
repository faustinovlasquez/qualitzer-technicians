import { createHash } from "node:crypto";
import type { CreationInput, CreationResult } from "../../domain/creation";
import type { Assignments, ChecklistStep, LocalPhoto, User } from "../../domain/models";
import type { OfflineCommand, OfflineDocumentMetadata, OfflineFile, OfflineReceipt } from "../../domain/offline";
import type { Connectivity, DurableFileStore, DurableStore, EngineDependencies, OfflineState, OfflineUpstream } from "../contracts";
import { cloneState, emptyState, validateQuota } from "../state";
import { overlayCreations } from "../overlay";

export class MemoryStore implements DurableStore {
  rows = new Map<string, OfflineState>();
  failWrites = false;
  conflicts = 0;
  async read(namespace: string): Promise<OfflineState> { return cloneState(this.rows.get(namespace) ?? emptyState()); }
  async compareAndSwap(namespace: string, revision: number, next: OfflineState): Promise<boolean> {
    if (this.failWrites) throw new Error("DISK_FULL");
    if (this.conflicts > 0) { this.conflicts--; return false; }
    if ((this.rows.get(namespace)?.revision ?? 0) !== revision) return false;
    this.rows.set(namespace, cloneState(next));
    return true;
  }
  async namespaces(): Promise<string[]> { return [...this.rows.keys()]; }
}
export class MemoryFiles implements DurableFileStore {
  files = new Map<string, OfflineFile>();
  sources = new Map<string, Uint8Array | null>();
  contents = new Map<string, Uint8Array>();
  removes: string[] = [];
  sequence = 0;
  used = 0;
  async ownText(namespace: string, text: string, name: string): Promise<OfflineFile> {
    const uri = `report:${++this.sequence}`;
    this.sources.set(uri, new TextEncoder().encode(text));
    return this.own(namespace, { id: uri, uri, name, mimeType: "text/plain" });
  }
  failOn = 0;
  async fingerprint(photo: LocalPhoto): Promise<Pick<OfflineFile, "size" | "sha256"> | null> {
    const bytes = photo.uri.startsWith("memory:") ? this.contents.get(photo.uri.slice(7)) : this.sources.get(photo.uri);
    if (bytes === null) return null;
    return bytes ? { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } : { size: photo.size ?? 10, sha256: "a".repeat(64) };
  }
  async own(namespace: string, photo: LocalPhoto): Promise<OfflineFile> {
    const sequence = ++this.sequence;
    if (sequence === this.failOn) throw new Error("COPY_FAILED");
    const fingerprint = await this.fingerprint(photo);
    if (!fingerprint) throw new Error("OFFLINE_SOURCE_FILE_MISSING");
    const { size, sha256 } = fingerprint;
    validateQuota(size, this.used);
    const file: OfflineFile = { id: uuid(sequence + 100), namespace, name: photo.name, mimeType: photo.mimeType, size, sha256 };
    this.files.set(file.id, file);
    const bytes = this.sources.get(photo.uri);
    if (bytes) this.contents.set(file.id, bytes.slice());
    this.used += size;
    return file;
  }
  async resolveURI(file: OfflineFile): Promise<string> {
    if (!this.files.has(file.id)) throw new Error("MISSING_FILE");
    return `memory:${file.id}`;
  }
  async remove(file: OfflineFile): Promise<void> { this.removes.push(file.id); this.files.delete(file.id); this.contents.delete(file.id); this.used -= file.size; }
  releaseURLs(): void {}
}
export const user: User = { id: 1, workerId: 7, name: "Técnico", lastnames: "Prueba", email: "", role: { name: "Técnico", isTechnician: true }, system: { name: "Test", timezone: "America/Santiago" }, accessBranchs: [{ id: 1, name: "Sucursal", main: true }], tenant: { id: "test", name: "Test", portalOrigin: "https://test.invalid", environment: "development" } };
export function uuid(value: number): string { return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`; }
export function creation(value = 1): CreationInput { return { kind: "work", companyBranchId: 1, clientRequestId: uuid(value), schedule: { date: "2026-09-08", startTime: "09:00", endTime: "10:00" }, work: { title: "Trabajo local", summary: "Revisar", priority: "medium" } }; }
export function result(input: CreationInput): CreationResult { return { kind: input.kind, groupId: input.kind === "maintenance" ? "maintenance-80" : input.kind === "non_productive" ? "direct-np-80" : "direct-80", workId: 80, companyBranchId: input.companyBranchId, schedule: { ...input.schedule, plannedMinutes: 60, timezone: "America/Santiago" } }; }
export function assignmentsWithStep(type: ChecklistStep["type"] = "text"): Assignments {
  const input = creation();
  const data = overlayCreations({ generatedAt: "2026-09-08T00:00:00Z", technician: { id: 7, name: "Test", allowEditExecutionTime: false },
    summary: { totalGroups: 0, totalWorks: 0, activeWorks: 0, overdueWorks: 0, plannedMinutes: 0 }, groups: [] }, input.schedule.date,
  [{ id: uuid(1), kind: "create", input, localGroupId: "local-test", localWorkId: "local-test", status: "applied", createdAt: 100, attempts: 0, nextAttemptAt: 0, result: result(input) }],
  { token: "test", user, branchId: 1, mode: "live", tenant: user.tenant! });
  const step: ChecklistStep = { stepId: 9, type, order: 1, title: "Check", description: "", tag: "", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    isFilesRequired: false, isCompleted: null, selectValue: "", optionsSelectValue: [], responseValue: "", comment: "Original", executionStatus: null, attachments: [] };
  data.groups[0]!.works[0]!.checklists = [{ checklistId: 5, name: "Checklist", code: "CK", steps: [step] }];
  return data;
}
export class FakeUpstream implements OfflineUpstream {
  verifyCount = 0;
  identity = structuredClone(user);
  verifyError?: Error;
  sendError?: Error;
  receiptError?: Error;
  afterCreate?: () => void;
  duringVerify?: () => Promise<void>;
  duringReceipt?: () => void;
  receiptState: OfflineReceipt["state"] = "applied";
  failAfterApply = false;
  creates: CreationInput[] = [];
  commands: OfflineCommand[] = [];
  documents: OfflineDocumentMetadata[] = [];
  receipts = new Map<string, OfflineReceipt>();
  created = new Map<string, CreationResult>();
  async me(): Promise<User> { this.verifyCount++; await this.duringVerify?.(); if (this.verifyError) throw this.verifyError; return this.identity; }
  async createRecord(input: CreationInput): Promise<CreationResult> {
    this.creates.push(input);
    if (this.sendError) throw this.sendError;
    const value = this.created.get(input.clientRequestId) ?? result(input);
    this.created.set(input.clientRequestId, value);
    this.afterCreate?.();
    if (this.failAfterApply) throw new Error("RESPONSE_LOST");
    return value;
  }
  async offlineReceipt(id: string): Promise<OfflineReceipt | null> { this.duringReceipt?.(); if (this.receiptError) throw this.receiptError; return this.receipts.get(id) ?? null; }
  async offlineCommand(command: OfflineCommand): Promise<OfflineReceipt> {
    this.commands.push(command);
    if (this.sendError) throw this.sendError;
    const receipt: OfflineReceipt = { operationId: command.operationId, state: this.receiptState };
    this.receipts.set(command.operationId, receipt);
    if (this.failAfterApply) throw new Error("RESPONSE_LOST");
    return receipt;
  }
  async offlineDocument(metadata: OfflineDocumentMetadata): Promise<OfflineReceipt> {
    this.documents.push(metadata);
    if (this.sendError) throw this.sendError;
    const receipt: OfflineReceipt = { operationId: metadata.operationId, state: this.receiptState, fileId: Number(metadata.operationId.slice(-12)) + 100 };
    this.receipts.set(metadata.operationId, receipt);
    if (this.failAfterApply) throw new Error("RESPONSE_LOST");
    return receipt;
  }
}
export function fixture(namespace = "a", store = new MemoryStore()) {
  let time = 1_000;
  let sequence = 1_000;
  let connected = true;
  const upstream = new FakeUpstream();
  const files = new MemoryFiles();
  const connectivity: Connectivity = { current: async () => connected, subscribe: () => () => undefined };
  const dependencies: EngineDependencies = { store, fileStore: files, connectivity, upstream, namespace, branchId: 1, user, now: () => time, uuid: () => uuid(++sequence) };
  return { dependencies, store, files, upstream, advance: (amount = 300_000) => { time += amount; }, connect: (value: boolean) => { connected = value; } };
}