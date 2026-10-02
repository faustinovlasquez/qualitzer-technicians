import { json, Router, type Request, type RequestHandler } from "express";
import { ownAvatarInputSchema, ownProfileInputSchema } from "../../src/domain/ownProfile";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { UserProfileService, type ProfileScope } from "./service";

export function createUserProfileRouter(upstream: Upstream): Router {
  const router = Router();
  const service = new UserProfileService(upstream);
  const scopes = new WeakMap<Request, ProfileScope>();
  const authorize: RequestHandler = async (req, res, next) => {
    emptySchema.parse(req.query);
    scopes.set(req, await service.authorize(req));
    res.set("Cache-Control", "no-store");
    next();
  };
  const scope = (req: Request): ProfileScope => {
    const current = scopes.get(req);
    if (!current) throw new GatewayError(401, "UNAUTHORIZED");
    return current;
  };
  const requireJson: RequestHandler = (req, _res, next) => {
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    next();
  };
  router.get("/", authorize, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json(await service.read(scope(req)));
  });
  router.put("/", authorize, requireJson, async (req, res) => {
    const body: unknown = req.body;
    req.body = undefined;
    res.json(await service.save(scope(req), ownProfileInputSchema.parse(body)));
  });
  router.put("/avatar", authorize, requireJson, json({ limit: "5mb", strict: true, inflate: false }), async (req, res) => {
    const body: unknown = req.body;
    req.body = undefined;
    res.json(await service.saveAvatar(scope(req), ownAvatarInputSchema.parse(body)));
  });
  router.delete("/avatar", authorize, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json(await service.removeAvatar(scope(req)));
  });
  return router;
}
