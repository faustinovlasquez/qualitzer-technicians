import { Router } from "express";
import { checklistAssignmentInputSchema } from "../../src/domain/checklistAssignment";
import { bearer } from "../auth";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { ChecklistAssignmentService } from "./service";
import { checklistRequest } from "./validation";

export function createChecklistRouter(upstream: Upstream): Router {
  const router = Router();
  const service = new ChecklistAssignmentService(upstream);
  const path = "/:groupId/works/:workId/checklists";
  router.get(`${path}/options`, async (req, res) => {
    bearer(req);
    emptySchema.parse(req.body ?? {});
    const input = checklistRequest(req, true);
    res.set("Cache-Control", "no-store").json(await service.options(input.canonical, input.options));
  });
  router.post(path, async (req, res) => {
    bearer(req);
    if (!req.is("application/json")) throw new GatewayError(400, "INVALID_INPUT");
    const input = checklistRequest(req, false);
    const { checklistId } = checklistAssignmentInputSchema.parse(req.body);
    const result = await service.attach(input.canonical, checklistId);
    res.set("Cache-Control", "no-store").status(result.alreadyAssigned ? 200 : 201).json(result);
  });
  return router;
}