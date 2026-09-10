import { json, Router, type RequestHandler } from "express";
import { bearer } from "../auth";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { OrderService } from "./service";
import { deliveryInputSchema, ORDER_DELIVERY_JSON_LIMIT_BYTES, orderRequest } from "./validation";

export function createOrderRouter(upstream: Upstream): Router {
  const router = Router();
  const service = new OrderService(upstream);
  const scoped: RequestHandler = (req, res, next) => {
    bearer(req);
    orderRequest(req);
    res.set("Cache-Control", "no-store");
    next();
  };
  const requireJson: RequestHandler = (req, _res, next) => {
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    next();
  };
  router.get("/:groupId/maintenance-delivery", scoped, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json(await service.details(req));
  });
  router.post("/:groupId/start", scoped, requireJson, json({ limit: "1kb", strict: true, inflate: false }), async (req, res) => {
    emptySchema.parse(req.body);
    await service.start(req);
    res.json({ success: true });
  });
  router.post("/:groupId/deliver", scoped, requireJson, json({ limit: ORDER_DELIVERY_JSON_LIMIT_BYTES, strict: true, inflate: false }), async (req, res) => {
    const body: unknown = req.body;
    req.body = undefined;
    const input = deliveryInputSchema.parse(body);
    await service.deliver(req, input);
    res.json({ success: true });
  });
  return router;
}