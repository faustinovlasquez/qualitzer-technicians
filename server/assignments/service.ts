import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { filesSchema, parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import { photoForm } from "../files/uploads";
import { reportSchema, resourceParamsSchema, statusInputSchema, stepAnswerSchema } from "../validation";
import type { Upstream } from "../upstream";
import { AssignmentAuthorization, ownedStep } from "./authorization";
import { validateAnswer, validateStatus, validateStatusScope } from "./rules";

export class AssignmentService {
  readonly authorization: AssignmentAuthorization;
  private readonly mutations = new Set<string>();

  constructor(private readonly upstream: Upstream) {
    this.authorization = new AssignmentAuthorization(upstream);
  }

  async mutate(req: Request, operation: () => Promise<void>): Promise<void> {
    const scope = await this.authorization.work(req, true);
    const key = `${scope.maintenanceId === null ? "work" : "maintenance"}:${scope.workId}`;
    if (this.mutations.has(key)) throw new GatewayError(409, "WORK_MUTATION_IN_PROGRESS");
    this.mutations.add(key);
    try { await operation(); } finally { this.mutations.delete(key); }
  }

  async files(req: Request) {
    const scope = await this.authorization.work(req);
    const filters = {
      companyBranchId: scope.range.companyBranchId,
      ...(scope.maintenanceId === null ? {} : { folderId: `maintenance_work_${scope.workId}` }),
    };
    const query = new URLSearchParams({
      companyBranchId: String(scope.range.companyBranchId),
      filters: JSON.stringify(filters), pagination: JSON.stringify({ page: 0, limit: 1000 }),
    });
    const path = scope.maintenanceId === null ? `/work_files/${scope.workId}` as const : `/maintenance_files/${scope.maintenanceId}` as const;
    return parseUpstream(filesSchema, await this.upstream.request(path, { token: scope.token, query }));
  }

  async status(req: Request): Promise<void> {
    const input = statusInputSchema.parse(req.body);
    let scope = await this.authorization.work(req, true);
    if ((input.executionDates?.length ?? 0) > 1) {
      const normalized = validateStatusScope(scope, input);
      const dates = normalized.executionDates!;
      const preliminary = await this.authorization.plannedWorks(req, scope, dates);
      preliminary.forEach((owned) => validateStatusScope(owned, normalized));
      const files = await this.files(req);
      const current = await this.authorization.plannedWorks(req, scope, dates);
      const anchor = current[0]!;
      const execution = validateStatus(anchor, normalized);
      for (const owned of current) {
        validateStatusScope(owned, execution);
        if (owned.work.isFilesRequired && files.totalRows === 0) throw new GatewayError(400, "WORK_FILES_REQUIRED");
      }
      if (!execution.isManual && current.slice(1).some((owned) => owned.work.elapsedSeconds > 0)) {
        throw new GatewayError(400, "MULTI_DATE_TIMERS_REQUIRE_SEPARATE_DELIVERY", "Hay cronómetros en otros días. Entrega cada fecha por separado para conservar su tiempo.");
      }
      await this.upstream.request("/technician-dashboard/update-work-status", {
        method: "POST", token: anchor.token, json: { ...execution, workId: anchor.workId, sourceType: "work" },
      });
      return;
    }
    let execution = validateStatus(scope, input);
    const selectedDate = execution.executionDates?.[0];
    const queryDate = selectedDate !== scope.range.startDate ? selectedDate : undefined;
    if (input.status === "completed" || input.status === "delivered") {
      if (queryDate !== undefined) {
        scope = await this.authorization.work(req, true, queryDate);
        validateStatus(scope, input);
      }
      const files = await this.files(req);
      scope = await this.authorization.work(req, true, queryDate);
      execution = validateStatus(scope, input);
      if (scope.work.isFilesRequired && files.totalRows === 0) throw new GatewayError(400, "WORK_FILES_REQUIRED");
    }
    const json = scope.maintenanceId === null ? {
      ...execution, workId: scope.workId, sourceType: "work",
    } : {
      workId: scope.workId, sourceType: "maintenance", maintenanceWorkId: scope.workId, status: input.status,
      ...(input.status === "completed" || input.status === "delivered" ? execution : {}),
    };
    await this.upstream.request("/technician-dashboard/update-work-status", { method: "POST", token: scope.token, json });
  }

  async step(req: Request): Promise<void> {
    const input = stepAnswerSchema.parse(req.body);
    const scope = await this.authorization.work(req, true);
    const { stepId } = resourceParamsSchema.parse(req.params);
    if (!stepId) throw new GatewayError(400, "STEP_ID_REQUIRED");
    const answer = validateAnswer(ownedStep(scope, stepId), input);
    const isMaintenance = scope.maintenanceId !== null;
    const path = isMaintenance ? `/maintenances/works/steps/${Number(stepId)}/response` as const : `/works/activity-checklist-steps/${Number(stepId)}` as const;
    await this.upstream.request(path, {
      method: "PATCH", token: scope.token,
      json: { ...answer, companyBranchId: scope.range.companyBranchId, ...(isMaintenance ? { workId: scope.workId } : { activityId: scope.workId }) },
    });
  }

  async upload(req: Request, files: Express.Multer.File[]): Promise<void> {
    const scope = await this.authorization.work(req, true);
    const { stepId } = resourceParamsSchema.parse(req.params);
    if (stepId) {
      ownedStep(scope, stepId);
      if (scope.maintenanceId === null) throw new GatewayError(400, "STANDARD_STEP_UPLOAD_UNSUPPORTED", "El backend no admite archivos por paso en trabajos estándar; use los archivos del trabajo.");
    }
    const path = scope.maintenanceId === null ? `/work_files/${scope.workId}` as const : stepId ?
      `/maintenances/works/steps/${Number(stepId)}/files` as const : `/maintenances/works/${scope.workId}/files` as const;
    const form = photoForm(files, scope.maintenanceId === null ? "attachments" : "files", scope.range.companyBranchId, stepId ? scope.workId : undefined);
    await this.upstream.request(path, { method: "POST", token: scope.token, form });
  }

  async report(req: Request): Promise<void> {
    const { note } = reportSchema.parse(req.body);
    const scope = await this.authorization.work(req, true);
    if (scope.maintenanceId !== null) {
      const currentScope = await this.authorization.work(req, true);
      const createdAt = new Date().toISOString();
      const content = [
        "Reporte técnico de mantenimiento",
        `OT: ${currentScope.group.code}`,
        `Trabajo: ${currentScope.work.title}`,
        `Autor: ${currentScope.user.name}`,
        `Fecha: ${createdAt}`,
        "", "Nota:", note, "",
      ].join("\n");
      const form = new FormData();
      form.set("companyBranchId", String(currentScope.range.companyBranchId));
      form.append("files", new Blob([content], { type: "text/plain; charset=utf-8" }), `reporte-tecnico-${createdAt.slice(0, 10)}-${randomUUID()}.txt`);
      await this.upstream.request(`/maintenances/works/${currentScope.workId}/files`, { method: "POST", token: currentScope.token, form });
      return;
    }
    const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    await this.upstream.request(`/works/comments/${scope.workId}`, {
      method: "POST", token: scope.token, query: new URLSearchParams({ isTechnical: "true" }),
      json: { comment: `<p>${escape(note).replace(/\r?\n/g, "<br>")}</p>`, companyBranchId: scope.range.companyBranchId },
    });
  }
}