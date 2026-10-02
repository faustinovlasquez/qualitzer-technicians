import type { Request } from "express";
import type { User } from "../../src/domain/models";
import { ownProfileFor, type OwnAvatarInput, type OwnProfile, type OwnProfileInput } from "../../src/domain/ownProfile";
import { bearer, currentUser } from "../auth";
import { GatewayError } from "../errors";
import { detectPhoto } from "../files/uploads";
import type { Upstream } from "../upstream";

export interface ProfileScope { token: string; user: User; }

export class UserProfileService {
  private readonly mutations = new Set<number>();
  constructor(private readonly upstream: Upstream) {}

  async authorize(req: Request): Promise<ProfileScope> {
    const token = bearer(req);
    return { token, user: await currentUser(this.upstream, token) };
  }

  private result(data: unknown, scope: ProfileScope): OwnProfile {
    try { return ownProfileFor(data, scope.user.id); }
    catch { throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE"); }
  }

  private async mutate(scope: ProfileScope, action: () => Promise<unknown>): Promise<OwnProfile> {
    if (this.mutations.has(scope.user.id)) throw new GatewayError(409, "OWN_PROFILE_BUSY", "Ya hay un cambio de perfil en curso. Espera a que termine.");
    this.mutations.add(scope.user.id);
    try { return this.result(await action(), scope); }
    finally { this.mutations.delete(scope.user.id); }
  }

  async read(scope: ProfileScope): Promise<OwnProfile> {
    return this.result(await this.upstream.request("/profiles/me", { token: scope.token }), scope);
  }

  save(scope: ProfileScope, input: OwnProfileInput): Promise<OwnProfile> {
    return this.mutate(scope, () => this.upstream.request("/profiles/me", { method: "PUT", token: scope.token, json: input }));
  }

  saveAvatar(scope: ProfileScope, input: OwnAvatarInput): Promise<OwnProfile> {
    const bytes = Buffer.from(input.image.slice(input.image.indexOf(",") + 1), "base64");
    if (detectPhoto(bytes).mime !== "image/jpeg") throw new GatewayError(400, "OWN_PROFILE_AVATAR_INVALID", "La foto debe ser una imagen JPEG válida.");
    return this.mutate(scope, () => this.upstream.request("/profiles/me/avatar", { method: "PUT", token: scope.token, json: input }));
  }

  removeAvatar(scope: ProfileScope): Promise<OwnProfile> {
    return this.mutate(scope, () => this.upstream.request("/profiles/me/avatar", { method: "DELETE", token: scope.token }));
  }
}
