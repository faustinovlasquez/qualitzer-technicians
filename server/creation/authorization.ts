import type { Request } from "express";
import { assertBranch, bearer, currentUser } from "../auth";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

export async function mobileActor(upstream: Upstream, req: Request, branch: number) {
  const token = bearer(req);
  const user = await currentUser(upstream, token);
  assertBranch(user, branch);
  if (!Number.isSafeInteger(user.workerId) || user.workerId === null || user.workerId <= 0) throw new GatewayError(403, "WORKER_REQUIRED");
  return { token, user };
}