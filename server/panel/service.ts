import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import { detectDocument, documentForm } from "../files/documents";
import type { Upstream } from "../upstream";
import { PanelAuthorization, type PanelScope } from "./authorization";
import { panelCommentsSchema, panelFilesSchema } from "./contracts";
import type { PanelRequest } from "./validation";

interface FileDestination {
  path: `/work_files/${number}` | `/maintenance_files/${number}` | `/negotiation_files/${number}`;
  folderId?: string;
}

function fileDestination(scope: PanelScope): FileDestination {
  if (scope.group.type === "internal_maintenance") {
    return { path: `/maintenance_files/${Number(scope.group.id.slice("maintenance-".length))}`, ...(scope.work ? { folderId: `maintenance_work_${scope.work.id}` } : {}) };
  }
  if (scope.work) return { path: `/work_files/${Number(scope.work.id)}` };
  return { path: `/negotiation_files/${Number(scope.group.id.slice("external-".length))}` };
}

function panelQuery(scope: PanelScope): URLSearchParams {
  return new URLSearchParams({
    startDate: scope.range.startDate, endDate: scope.range.endDate,
    companyBranchId: String(scope.range.companyBranchId), groupType: scope.group.type,
  });
}

function workBase(scope: PanelScope): `/technician-dashboard/panel/${string}/works/${number}` {
  if (!scope.work) throw new GatewayError(404, "ASSIGNMENT_NOT_FOUND");
  return `/technician-dashboard/panel/${scope.group.id}/works/${Number(scope.work.id)}`;
}

export class PanelService {
  private readonly authorization: PanelAuthorization;
  private readonly mutations = new Set<string>();

  constructor(private readonly upstream: Upstream) { this.authorization = new PanelAuthorization(upstream); }

  async mutate(input: PanelRequest, operation: (scope: PanelScope) => Promise<void>): Promise<void> {
    const scope = await this.authorization.resolve(input);
    const key = scope.work ? `${scope.group.type === "internal_maintenance" ? "maintenance" : "work"}:${scope.work.id}` : `group:${scope.group.id}`;
    if (this.mutations.has(key)) throw new GatewayError(409, "WORK_MUTATION_IN_PROGRESS");
    this.mutations.add(key);
    try { await operation(scope); } finally { this.mutations.delete(key); }
  }

  async files(input: PanelRequest) {
    const scope = await this.authorization.resolve(input);
    if (scope.step) return { data: scope.step.attachments, totalRows: scope.step.attachments.length, totalPages: scope.step.attachments.length > 0 ? 1 : 0 };
    return this.listFiles(scope);
  }

  private async listFiles(scope: PanelScope, page = 0) {
    const destination = fileDestination(scope);
    const query = new URLSearchParams({
      companyBranchId: String(scope.range.companyBranchId),
      filters: JSON.stringify({ companyBranchId: scope.range.companyBranchId, ...(destination.folderId ? { folderId: destination.folderId } : {}) }),
      pagination: JSON.stringify({ page, limit: 1000 }),
    });
    return parseUpstream(panelFilesSchema, await this.upstream.request(destination.path, { token: scope.token, query }));
  }

  async comments(input: PanelRequest) {
    const scope = await this.authorization.resolve(input);
    const query = panelQuery(scope);
    query.set("page", String(input.page));
    query.set("limit", "30");
    return parseUpstream(panelCommentsSchema, await this.upstream.request(`${workBase(scope)}/comments`, { token: scope.token, query }));
  }

  async addComment(input: PanelRequest, previous: PanelScope, text: string): Promise<void> {
    const scope = await this.authorization.refresh(input, previous);
    await this.upstream.request(`${workBase(scope)}/comments`, { method: "POST", token: scope.token, query: panelQuery(scope), json: { text } });
  }

  async upload(input: PanelRequest, previous: PanelScope, files: Express.Multer.File[]): Promise<void> {
    const scope = await this.authorization.refresh(input, previous);
    if (scope.step) {
      if (files.some((file) => detectDocument(file.buffer, file.originalname).mime === "image/heic")) {
        throw new GatewayError(415, "HEIC_STEP_DOCUMENT_UNSUPPORTED", "El backend no admite HEIC en pasos; convierta la imagen a JPEG o PNG.");
      }
      await this.upstream.request(`${workBase(scope)}/steps/${Number(scope.step.stepId)}/files`, {
        method: "POST", token: scope.token, query: panelQuery(scope), form: documentForm(files, "files"),
      });
      return;
    }
    const destination = fileDestination(scope);
    const form = documentForm(files, "attachments", scope.range.companyBranchId);
    if (destination.folderId) form.set("folderId", destination.folderId);
    await this.upstream.request(destination.path, { method: "POST", token: scope.token, form });
  }

  private async assertFileMembership(scope: PanelScope, fileId: string): Promise<void> {
    for (let page = 0; page < 100; page++) {
      const result = await this.listFiles(scope, page);
      const matches = result.data.filter((file) => String(file.id) === fileId);
      if (matches.length === 1) return;
      if (matches.length > 1 || page + 1 >= result.totalPages || result.data.length === 0) throw new GatewayError(404, "FILE_NOT_FOUND");
    }
    throw new GatewayError(502, "UPSTREAM_FILE_LIST_TOO_LARGE");
  }

  async deleteFile(input: PanelRequest, previous: PanelScope): Promise<void> {
    if (!input.fileId) throw new GatewayError(400, "FILE_ID_REQUIRED");
    if (!previous.step) await this.assertFileMembership(previous, input.fileId);
    const scope = await this.authorization.refresh(input, previous);
    if (scope.step && scope.step.attachments.filter((file) => String(file.id) === input.fileId).length !== 1) throw new GatewayError(404, "FILE_NOT_FOUND");
    await this.upstream.request(`/files/${Number(input.fileId)}`, {
      method: "DELETE", token: scope.token, query: new URLSearchParams({ companyBranchId: String(scope.range.companyBranchId) }),
    });
  }
}