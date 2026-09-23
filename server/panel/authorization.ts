import type { AssignmentGroup, AssignmentWork, ChecklistStep } from "../../src/domain/models";
import { assignedGroup, AssignmentAuthorization, ownedStep } from "../assignments/authorization";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { positiveId, type RangeQuery } from "../validation";
import type { PanelRequest } from "./validation";

export interface PanelScope {
  token: string;
  range: RangeQuery;
  group: AssignmentGroup;
  work: AssignmentWork | null;
  step: ChecklistStep | null;
}

export class PanelAuthorization {
  private readonly assignments: AssignmentAuthorization;

  constructor(upstream: Upstream) { this.assignments = new AssignmentAuthorization(upstream); }

  async resolve(input: PanelRequest): Promise<PanelScope> {
    if (input.target !== "group") {
      const scope = await this.assignments.work(input.canonical, false);
      return { ...scope, step: input.stepId ? ownedStep(scope, input.stepId) : null };
    }
    const { token, range, data } = await this.assignments.snapshot(input.canonical);
    const group = assignedGroup(data.groups, input.groupId);
    let work: AssignmentWork | null = null;
    if (group.type === "direct_assignment") {
      work = group.works.find((candidate) => positiveId.safeParse(candidate.id).success && group.works.filter((item) => item.id === candidate.id).length === 1) ?? null;
      if (!work) throw new GatewayError(400, "GROUP_HAS_NO_OT");
    }
    return { token, range, group, work, step: null };
  }

  async refresh(input: PanelRequest, previous: PanelScope): Promise<PanelScope> {
    const scope = await this.resolve(input);
    if (scope.group.type !== previous.group.type || scope.work?.id !== previous.work?.id) {
      throw new GatewayError(409, "ASSIGNMENT_CHANGED");
    }
    return scope;
  }
}