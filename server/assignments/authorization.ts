import type { Request } from "express";
import type { AssignmentGroup, Assignments, AssignmentWork, ChecklistStep, User } from "../../src/domain/models";
import { isExecutionFinalization } from "../../src/domain/workExecution";
import { assertBranch, bearer, currentUser } from "../auth";
import { assignmentsSchema, parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { positiveId, rangeQuerySchema, resourceParamsSchema, type RangeQuery } from "../validation";

export interface OwnedWork {
  token: string;
  user: User;
  range: RangeQuery;
  group: AssignmentGroup;
  work: AssignmentWork;
  workId: number;
  maintenanceId: number | null;
  allowEditExecutionTime: boolean;
  supportsWorkedDates?: boolean;
  generatedAt: string;
}

function validateSource(group: AssignmentGroup): void {
  const prefix = group.type === "internal_maintenance" ? "maintenance-" : group.type === "external_ot" ? "external-" : "direct-";
  const suffix = group.id.startsWith(prefix) ? group.id.slice(prefix.length).replace(/^np-/, group.type === "direct_assignment" ? "" : "np-") : "";
  if (!positiveId.safeParse(suffix).success) throw new GatewayError(502, "UPSTREAM_INVALID_SOURCE");
}

export class AssignmentAuthorization {
  constructor(private readonly upstream: Upstream) {}

  async snapshot(req: Request, executionDate?: string): Promise<{ token: string; user: User; range: RangeQuery; data: Assignments }> {
    const token = bearer(req);
    const requestedRange = rangeQuerySchema.parse(req.query);
    const range = executionDate === undefined ? requestedRange : rangeQuerySchema.parse({
      startDate: executionDate, endDate: executionDate, companyBranchId: String(requestedRange.companyBranchId),
    });
    const user = await currentUser(this.upstream, token);
    assertBranch(user, range.companyBranchId);
    if (user.workerId === null) throw new GatewayError(403, "WORKER_REQUIRED");
    const query = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate, companyBranchId: String(range.companyBranchId) });
    const data = parseUpstream(assignmentsSchema, await this.upstream.request("/technician-dashboard/assignments", { token, query }));
    if (data.technician.id !== user.workerId) throw new GatewayError(403, "WORKER_MISMATCH");
    data.groups.forEach(validateSource);
    return { token, user, range, data };
  }

  async list(req: Request): Promise<Assignments> {
    const { data } = await this.snapshot(req);
    const groups = data.groups.map((group) => {
      const works = group.works.map((work) => ({ ...work, canEditDefinition: false }));
      return {
        ...group, works, canManage: false,
        products: group.type === "internal_maintenance" ? works.flatMap((work) => work.materials) : group.products,
        plannedMinutes: works.reduce((total, work) => total + work.plannedMinutes, 0),
        isOverdue: works.some((work) => work.isOverdue),
      };
    });
    const works = groups.flatMap((group) => group.works);
    return {
      generatedAt: data.generatedAt, technician: data.technician, groups,
      summary: {
        totalGroups: groups.length, totalWorks: works.length,
        activeWorks: works.filter((work) => work.status === "in_progress" || work.status === "paused").length,
        overdueWorks: works.filter((work) => work.isOverdue).length,
        plannedMinutes: works.reduce((total, work) => total + work.plannedMinutes, 0),
      },
    };
  }

  async work(req: Request, mutation = false, executionDate?: string): Promise<OwnedWork> {
    bearer(req);
    const params = resourceParamsSchema.parse(req.params);
    const { token, user, range, data } = await this.snapshot(req, executionDate);
    const groups = data.groups.filter((group) => group.id === params.groupId);
    const group = groups[0];
    const works = group?.works.filter((work) => work.id === params.workId) ?? [];
    const work = works[0];
    if (groups.length !== 1 || works.length !== 1 || !group || !work) {
      throw new GatewayError(404, "ASSIGNMENT_NOT_FOUND");
    }
    if (mutation && isExecutionFinalization(work.status)) {
      throw new GatewayError(409, "WORK_READ_ONLY");
    }
    return {
      token, user, range, group, work, workId: Number(work.id),
      maintenanceId: group.type === "internal_maintenance" ? Number(group.id.slice("maintenance-".length)) : null,
      allowEditExecutionTime: data.technician.allowEditExecutionTime,
      supportsWorkedDates: data.technician.supportsWorkedDates,
      generatedAt: data.generatedAt,
    };
  }

  async plannedWorks(req: Request, initial: OwnedWork, dates: string[]): Promise<OwnedWork[]> {
    const scopes: OwnedWork[] = [];
    for (const date of dates) {
      const scope = await this.work(req, true, date);
      if (scope.token !== initial.token || scope.user.id !== initial.user.id || scope.user.workerId !== initial.user.workerId ||
        scope.range.companyBranchId !== initial.range.companyBranchId || scope.group.type !== initial.group.type ||
        scope.workId !== initial.workId || scope.maintenanceId !== null) throw new GatewayError(403, "EXECUTION_SCOPE_CHANGED");
      if (scope.work.scheduledDate !== date || !scope.work.plannedDates?.includes(date)) {
        throw new GatewayError(403, "EXECUTION_DATE_NOT_ASSIGNED", "La fecha no corresponde a un día planificado visible de este trabajo; una asignación atrasada no autoriza otros días.");
      }
      scopes.push(scope);
    }
    return scopes;
  }
}

export function ownedStep(scope: OwnedWork, stepId: string): ChecklistStep {
  const steps = scope.work.checklists.flatMap((checklist) => checklist.steps).filter((step) => String(step.stepId) === stepId);
  if (steps.length !== 1 || !steps[0]) throw new GatewayError(404, "CHECKLIST_STEP_NOT_FOUND");
  return steps[0];
}