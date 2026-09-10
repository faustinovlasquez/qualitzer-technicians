import type { Request } from "express";
import { checklistAssignmentResultSchema, checklistCatalogPageSchema, type ChecklistCatalogQuery } from "../../src/domain/checklistAssignment";
import { AssignmentAuthorization, type OwnedWork } from "../assignments/authorization";
import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

export class ChecklistAssignmentService {
  private readonly authorization: AssignmentAuthorization;
  constructor(private readonly upstream: Upstream) { this.authorization = new AssignmentAuthorization(upstream); }

  private query(scope: OwnedWork): URLSearchParams {
    return new URLSearchParams({ startDate: scope.range.startDate, endDate: scope.range.endDate, companyBranchId: String(scope.range.companyBranchId), groupType: scope.group.type });
  }

  async options(req: Request, input: ChecklistCatalogQuery) {
    const scope = await this.authorization.work(req);
    const query = this.query(scope);
    query.set("search", input.search ?? "");
    query.set("page", String(input.page ?? 0));
    const result = parseUpstream(checklistCatalogPageSchema, await this.upstream.request(`/technician-dashboard/panel/${scope.group.id}/works/${scope.workId}/checklists/options`, { token: scope.token, query }));
    if (result.page !== (input.page ?? 0)) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    return result;
  }

  async attach(req: Request, checklistId: number) {
    const scope = await this.authorization.work(req, true);
    const result = parseUpstream(checklistAssignmentResultSchema, await this.upstream.request(`/technician-dashboard/panel/${scope.group.id}/works/${scope.workId}/checklists`, {
      method: "POST", token: scope.token, query: this.query(scope), json: { checklistId },
    }));
    if (result.checklistId !== checklistId) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    return result;
  }
}