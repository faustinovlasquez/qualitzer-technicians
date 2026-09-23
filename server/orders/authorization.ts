import type { Request } from "express";
import type { AssignmentGroup, User } from "../../src/domain/models";
import { assignedGroup, AssignmentAuthorization } from "../assignments/authorization";
import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import type { RangeQuery } from "../validation";
import { maintenanceDetailSchema, type MaintenanceDetail } from "./contracts";
import { orderRequest } from "./validation";
import { maintenanceStatus } from "./rules";

export interface OrderScope {
  token: string;
  user: User;
  range: RangeQuery;
  group: AssignmentGroup;
  maintenanceId: number;
  detail: MaintenanceDetail;
  generatedAt: string;
}

export class OrderAuthorization {
  private readonly assignments: AssignmentAuthorization;

  constructor(private readonly upstream: Upstream) { this.assignments = new AssignmentAuthorization(upstream); }

  async resolve(req: Request): Promise<OrderScope> {
    const groupId = orderRequest(req);
    const { token, user, range, data } = await this.assignments.snapshot(req);
    const group = assignedGroup(data.groups, groupId);
    if (group.type !== "internal_maintenance") throw new GatewayError(400, "ORDER_SOURCE_UNSUPPORTED");
    const maintenanceId = Number(group.id.slice("maintenance-".length));
    const detail = parseUpstream(maintenanceDetailSchema, await this.upstream.request(`/maintenances/${maintenanceId}`, { token }));
    if (detail.id !== maintenanceId) throw new GatewayError(502, "UPSTREAM_INVALID_SOURCE");
    if (detail.companyBranchId !== range.companyBranchId) throw new GatewayError(403, "BRANCH_FORBIDDEN");
    if (maintenanceStatus(detail.status) !== group.status || (group.maintenanceType != null && group.maintenanceType !== detail.type)) {
      throw new GatewayError(409, "ASSIGNMENT_CHANGED");
    }
    const workIds = new Set<number>();
    const stepIds = new Set<number>();
    for (const work of detail.works) {
      if (work.maintenanceId !== maintenanceId || workIds.has(work.id)) throw new GatewayError(502, "UPSTREAM_INVALID_SOURCE");
      workIds.add(work.id);
      const checklistIds = new Set<number | null>();
      for (const checklist of work.checklists) {
        if (checklistIds.has(checklist.checklistId)) throw new GatewayError(502, "UPSTREAM_INVALID_SOURCE");
        checklistIds.add(checklist.checklistId);
        for (const step of checklist.steps) {
          if (step.maintenanceWorkId !== work.id || step.checklistId !== checklist.checklistId || stepIds.has(step.id)) throw new GatewayError(502, "UPSTREAM_INVALID_SOURCE");
          stepIds.add(step.id);
        }
      }
    }
    if (new Set(group.works.map((work) => work.id)).size !== group.works.length || group.works.some((work) => !workIds.has(Number(work.id)))) {
      throw new GatewayError(409, "ASSIGNMENT_CHANGED");
    }
    if (detail.signatures.some((signature) => signature.maintenanceId !== maintenanceId)) throw new GatewayError(502, "UPSTREAM_INVALID_SOURCE");
    return { token, user, range, group, maintenanceId, detail, generatedAt: data.generatedAt };
  }

  async refresh(req: Request, previous: OrderScope): Promise<OrderScope> {
    const scope = await this.resolve(req);
    if (scope.user.id !== previous.user.id || scope.user.workerId !== previous.user.workerId || scope.token !== previous.token) {
      throw new GatewayError(401, "SESSION_CHANGED");
    }
    return scope;
  }
}