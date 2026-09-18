import type { Request } from "express";
import type { User } from "../../src/domain/models";
import { ownSignatureOptions, type UserSignatureInput, type UserSignatureOptions } from "../../src/domain/userSignatures";
import { assertBranch, bearer, currentUser } from "../auth";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { branchQuerySchema } from "../validation";

export interface SignatureScope { token: string; user: User; companyBranchId: number; }

export class UserSignatureService {
  private readonly mutations = new Set<number>();
  constructor(private readonly upstream: Upstream) {}

  async authorize(req: Request): Promise<SignatureScope> {
    const token = bearer(req);
    const { companyBranchId } = branchQuerySchema.parse(req.query);
    if (companyBranchId === undefined) throw new GatewayError(400, "BRANCH_REQUIRED");
    const user = await currentUser(this.upstream, token);
    assertBranch(user, companyBranchId);
    return { token, user, companyBranchId };
  }

  private query(scope: SignatureScope): URLSearchParams {
    return new URLSearchParams({ companyBranchId: String(scope.companyBranchId) });
  }

  private result(data: unknown, scope: SignatureScope): UserSignatureOptions {
    try { return ownSignatureOptions(data, scope.user.id, scope.companyBranchId); }
    catch { throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE"); }
  }

  async read(scope: SignatureScope): Promise<UserSignatureOptions> {
    return this.result(await this.upstream.request("/user_signatures/me", { token: scope.token, query: this.query(scope) }), scope);
  }

  private async mutate(scope: SignatureScope, action: () => Promise<UserSignatureOptions>): Promise<UserSignatureOptions> {
    if (this.mutations.has(scope.user.id)) throw new GatewayError(409, "USER_SIGNATURE_BUSY");
    this.mutations.add(scope.user.id);
    try { return await action(); }
    finally { this.mutations.delete(scope.user.id); }
  }

  save(scope: SignatureScope, input: UserSignatureInput): Promise<UserSignatureOptions> {
    for (const branchId of input.branchIds) assertBranch(scope.user, branchId);
    return this.mutate(scope, async () => {
      if (input.id !== undefined && !(await this.read(scope)).options.some(signature => signature.id === input.id)) throw new GatewayError(404, "USER_SIGNATURE_NOT_FOUND");
      const result = await this.upstream.request("/user_signatures/me", { method: "PUT", token: scope.token, query: this.query(scope), json: input });
      return this.result(result, scope);
    });
  }

  remove(scope: SignatureScope, signatureId: number): Promise<UserSignatureOptions> {
    return this.mutate(scope, async () => {
      if (!(await this.read(scope)).options.some(signature => signature.id === signatureId)) throw new GatewayError(404, "USER_SIGNATURE_NOT_FOUND");
      await this.upstream.request(`/user_signatures/me/${signatureId}`, { method: "DELETE", token: scope.token, query: this.query(scope) });
      return this.read(scope);
    });
  }
}