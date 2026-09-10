import type { LocalPhoto } from "../domain/models";
import type { OfflineCommand, OfflineDocumentMetadata, OfflineReceipt } from "../domain/offline";
import { syncCommandSchema, syncDocumentSchema, syncOperationIdSchema, syncPositiveIdSchema, type SyncCommand, type SyncDocument } from "../domain/offlineProtocol";
import { ApiError } from "./errors";

interface DemoOfflineDependencies {
  branchId: number;
  hash(bytes: Uint8Array): Promise<string>;
  readFile(file: LocalPhoto): Promise<{ bytes: Uint8Array; uri: string }>;
  command(input: SyncCommand): Promise<OfflineReceipt | void>;
  document(input: SyncDocument, file: LocalPhoto): Promise<{ fileId?: number } | void>;
}
interface DemoReceiptEntry { digest: string; branchId: number; receipt: OfflineReceipt | null; }

export class DemoOfflineStore {
  private receipts = new Map<string, DemoReceiptEntry>();
  constructor(private readonly dependencies: DemoOfflineDependencies) {}
  private branch(branchId: number): void {
    if (branchId !== this.dependencies.branchId) throw new ApiError(403, "BRANCH_FORBIDDEN", "Sucursal no autorizada.");
  }
  private read(entry: DemoReceiptEntry): OfflineReceipt {
    if (!entry.receipt) throw new ApiError(409, "MOBILE_SYNC_IN_PROGRESS", "Operación en curso.");
    return structuredClone(entry.receipt);
  }
  async receipt(operationId: string, companyBranchId: number): Promise<OfflineReceipt | null> {
    this.branch(syncPositiveIdSchema.parse(companyBranchId));
    const entry = this.receipts.get(syncOperationIdSchema.parse(operationId));
    return entry && entry.branchId === companyBranchId ? this.read(entry) : null;
  }
  private async apply(operationId: string, branchId: number, content: object, effect: () => Promise<OfflineReceipt | { fileId?: number } | void>): Promise<OfflineReceipt> {
    this.branch(branchId);
    const digest = await this.dependencies.hash(new TextEncoder().encode(JSON.stringify(content)));
    const previous = this.receipts.get(operationId);
    if (previous) {
      if (previous.digest !== digest) return { operationId, state: "needs_review", error: "MOBILE_SYNC_OPERATION_REUSED" };
      return this.read(previous);
    }
    const entry: DemoReceiptEntry = { digest, branchId, receipt: null };
    this.receipts.set(operationId, entry);
    try {
      const result = await effect();
      entry.receipt = result && "state" in result ? { ...result, operationId } : { operationId, state: "applied", ...(result?.fileId === undefined ? {} : { fileId: result.fileId }) };
    } catch {
      entry.receipt = { operationId, state: "needs_review", error: "MOBILE_SYNC_REQUIRES_REVIEW" };
    }
    return this.read(entry);
  }
  async command(input: OfflineCommand): Promise<OfflineReceipt> {
    const command = syncCommandSchema.parse(input);
    return this.apply(command.operationId, command.scope.companyBranchId, command, () => this.dependencies.command(command));
  }
  async document(input: OfflineDocumentMetadata, file: LocalPhoto): Promise<OfflineReceipt> {
    const metadata = syncDocumentSchema.parse(input);
    this.branch(metadata.scope.companyBranchId);
    const snapshot = await this.dependencies.readFile(file);
    if (!snapshot.bytes.length || snapshot.bytes.length > 25 * 1024 * 1024) throw new ApiError(413, "DOCUMENT_TOO_LARGE", "Límite de 25 MiB.");
    const sha256 = await this.dependencies.hash(snapshot.bytes);
    if (sha256 !== metadata.sha256) throw new ApiError(400, "OFFLINE_DOCUMENT_DIGEST_MISMATCH", "El archivo cambió; se conserva para revisión.");
    const captured = { ...file, uri: snapshot.uri, size: snapshot.bytes.length };
    return this.apply(metadata.operationId, metadata.scope.companyBranchId, { metadata, file: { name: file.name, mimeType: file.mimeType, size: snapshot.bytes.length, sha256 } }, () => this.dependencies.document(metadata, captured));
  }
}