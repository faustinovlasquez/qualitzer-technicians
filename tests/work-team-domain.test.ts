import assert from "node:assert/strict";
import { test } from "node:test";
import { availableTeamCandidates, canRemoveTeamMember, workTeamSchema } from "../src/domain/workTeam";

const member = (id: number, name: string, isCurrentUser = false) => ({ id, name, avatarColor: null, avatarThumbnail: null, isCurrentUser });

test("los candidatos excluyen al equipo y se filtran por nombre sin tildes", () => {
  const team = workTeamSchema.parse({ members: [member(1, "Ana Pérez", true)], candidates: [member(1, "Ana Pérez", true), member(2, "José Núñez"), member(3, "Luis Soto")] });
  assert.deepEqual(availableTeamCandidates(team, "").map(person => person.id), [2, 3]);
  assert.deepEqual(availableTeamCandidates(team, "NUNEZ").map(person => person.id), [2]);
  assert.equal(canRemoveTeamMember(team), false);
  assert.equal(canRemoveTeamMember({ ...team, members: [...team.members, member(2, "José Núñez")] }), true);
});

test("el esquema rechaza técnicos sin identificador válido y limpia avatares inseguros", () => {
  assert.equal(workTeamSchema.safeParse({ members: [{ ...member(1, "Ana"), id: 0 }], candidates: [] }).success, false);
  const parsed = workTeamSchema.parse({ members: [{ ...member(1, "Ana"), avatarThumbnail: "javascript:alert(1)" }], candidates: [] });
  assert.equal(parsed.members[0]!.avatarThumbnail, null);
});
