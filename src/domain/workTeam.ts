import { z } from "zod";
import type { WorkScope } from "./models";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const link = z.string().nullish().transform(value => {
  if (!value) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : null; } catch { return null; }
});

/** Técnico del equipo de un trabajo (o candidato para sumarse). */
export const workTeamMemberSchema = z.object({
  id, name: z.string().trim().min(1).max(200), avatarColor: z.string().max(40).nullish().transform(value => value ?? null),
  avatarThumbnail: link, isCurrentUser: z.boolean(),
});
export type WorkTeamMember = z.infer<typeof workTeamMemberSchema>;

export const workTeamSchema = z.object({
  members: z.array(workTeamMemberSchema).max(1000),
  candidates: z.array(workTeamMemberSchema).max(1000),
});
export type WorkTeam = z.infer<typeof workTeamSchema>;

export const workTeamAddInputSchema = z.object({ workerId: id }).strict();

export interface WorkTeamPort {
  workTeam(scope: WorkScope): Promise<WorkTeam>;
  addWorkTeamMember(scope: WorkScope, workerId: number): Promise<WorkTeam>;
  removeWorkTeamMember(scope: WorkScope, workerId: number): Promise<WorkTeam>;
}

/** Candidatos que aún no están en el equipo, filtrados por nombre (sin tildes ni mayúsculas). */
export function availableTeamCandidates(team: WorkTeam, search: string): WorkTeamMember[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const members = new Set(team.members.map(member => member.id));
  const query = normalize(search);
  return team.candidates.filter(candidate => !members.has(candidate.id) && (query === "" || normalize(candidate.name).includes(query)));
}

/** El trabajo nunca queda sin responsables: con un solo integrante no se puede quitar. */
export const canRemoveTeamMember = (team: WorkTeam): boolean => team.members.length > 1;
