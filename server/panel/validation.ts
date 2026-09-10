import type { Request } from "express";
import { z } from "zod";
import { positiveId, rangeQuerySchema, resourceParamsSchema } from "../validation";

export type PanelTarget = "group" | "work" | "step";
export interface PanelRequest {
  canonical: Request;
  target: PanelTarget;
  groupId: string;
  workId?: string;
  stepId?: string;
  fileId?: string;
  page: number;
}

const commentsQuerySchema = rangeQuerySchema.safeExtend({
  page: z.string().regex(/^(?:0|[1-9]\d{0,3})$/).transform(Number).refine((page) => page <= 1000).optional(),
});
export const commentInputSchema = z.object({ text: z.string().trim().min(1).max(10000) }).strict();

export function panelRequest(req: Request, target: PanelTarget, options: { deleting?: boolean; comments?: boolean } = {}): PanelRequest {
  const params = z.object({
    groupId: resourceParamsSchema.shape.groupId.refine((id) => positiveId.safeParse(id.slice(id.lastIndexOf("-") + 1)).success),
    ...(target !== "group" ? { workId: positiveId } : {}),
    ...(target === "step" ? { stepId: positiveId } : {}),
    ...(options.deleting ? { fileId: positiveId } : {}),
  }).strict().parse(req.params);
  const query = options.comments ? commentsQuerySchema.parse(req.query) : rangeQuerySchema.parse(req.query);
  const canonical: Request = Object.create(req, {
    params: { value: { groupId: params.groupId, ...(params.workId ? { workId: params.workId } : {}), ...(params.stepId ? { stepId: params.stepId } : {}) } },
    query: { value: { startDate: query.startDate, endDate: query.endDate, companyBranchId: String(query.companyBranchId) } },
  });
  return {
    canonical, target, groupId: params.groupId,
    workId: typeof params.workId === "string" ? params.workId : undefined,
    stepId: typeof params.stepId === "string" ? params.stepId : undefined,
    fileId: typeof params.fileId === "string" ? params.fileId : undefined,
    page: "page" in query && typeof query.page === "number" ? query.page : 0,
  };
}