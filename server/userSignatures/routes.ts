import { json, Router, type Request, type RequestHandler } from "express";
import { userSignatureInputSchema } from "../../src/domain/userSignatures";
import { GatewayError } from "../errors";
import { signatureSchema } from "../orders/validation";
import type { Upstream } from "../upstream";
import { emptySchema, positiveId } from "../validation";
import { UserSignatureService, type SignatureScope } from "./service";

const inputSchema = userSignatureInputSchema.extend({ signatureImage: signatureSchema.nullable().optional() });

export function createUserSignatureRouter(upstream: Upstream): Router {
  const router = Router();
  const service = new UserSignatureService(upstream);
  const scopes = new WeakMap<Request, SignatureScope>();
  const authorize: RequestHandler = async (req, res, next) => {
    scopes.set(req, await service.authorize(req));
    res.set("Cache-Control", "no-store");
    next();
  };
  const scope = (req: Request): SignatureScope => {
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
  router.put("/", authorize, requireJson, json({ limit: "2mb", strict: true, inflate: false }), async (req, res) => {
    const body: unknown = req.body;
    req.body = undefined;
    res.json(await service.save(scope(req), inputSchema.parse(body)));
  });
  router.delete("/:id", authorize, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const signatureId = Number(positiveId.parse(req.params.id));
    res.json(await service.remove(scope(req), signatureId));
  });
  return router;
}