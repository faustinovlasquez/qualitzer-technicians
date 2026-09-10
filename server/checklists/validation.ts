import type { Request } from "express";
import { z } from "zod";
import { checklistCatalogQuerySchema } from "../../src/domain/checklistAssignment";
import { positiveId, rangeQuerySchema, resourceParamsSchema } from "../validation";

const catalogQuerySchema = rangeQuerySchema.safeExtend({
  search: z.string().max(120).optional(),
  page: z.string().regex(/^(?:0|[1-9]\d{0,3})$/).transform(Number).refine((value) => value <= 1000).optional(),
});
export function checklistRequest(req: Request, catalog: boolean) {
  const params = resourceParamsSchema.omit({ stepId: true }).parse(req.params);
  positiveId.parse(params.groupId.slice(params.groupId.lastIndexOf("-") + 1));
  const query = catalog ? catalogQuerySchema.parse(req.query) : rangeQuerySchema.parse(req.query);
  const options = checklistCatalogQuerySchema.parse({
    search: "search" in query ? query.search : undefined, page: "page" in query ? query.page : undefined,
  });
  const canonical: Request = Object.create(req, {
    params: { value: params },
    query: { value: { startDate: query.startDate, endDate: query.endDate, companyBranchId: String(query.companyBranchId) } },
  });
  return { canonical, options };
}