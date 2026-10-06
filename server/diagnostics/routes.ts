import { Router } from "express";
import { appErrorBatchSchema, appErrorResultSchema } from "../../src/domain/diagnostics";
import { bearer, currentUser } from "../auth";
import { emptySchema } from "../validation";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

/** Errores de la app de técnicos hacia el log del backend (MOBILE_APP_ERROR). Requiere sesión válida. */
export function createDiagnosticsRouter(upstream: Upstream): Router {
  const router = Router();
  router.post("/errors", async (req, res) => {
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = appErrorBatchSchema.parse(req.body);
    const token = bearer(req);
    await currentUser(upstream, token);
    const result = appErrorResultSchema.safeParse(await upstream.request("/mobile-diagnostics/errors", { token, method: "POST", json: input }));
    if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.status(202).json(result.data);
  });
  return router;
}
