import assert from "node:assert/strict";
import { test } from "node:test";
import { assignments, group, RANGE, work } from "./fixtures";
import { gatewayToken, harness, jsonRequest } from "./mock-upstream";

const listPath = `/api/assignments?${RANGE}`;

async function readWithRevision(baseUrl: string, revision: string) {
  const response = await fetch(`${baseUrl}${listPath}`, { headers: { Authorization: gatewayToken(baseUrl), "X-Qualitzer-Known-Revision": revision } });
  return { response, data: await response.json() as { unchanged?: boolean; revision?: string; groups?: unknown[] } };
}

test("la agenda trae su huella y, si el teléfono ya la tiene, solo responde que no cambió", async (t) => {
  const { baseUrl, state } = await harness(t);
  state.assignments = assignments([group({ works: [work({ id: "11", title: "Revisar bomba" })] })]);
  const first = await jsonRequest(baseUrl, listPath);
  const revision = (first.data as { revision?: string }).revision;
  assert.match(revision ?? "", /^[a-f0-9]{64}$/);

  // Solo cambia la hora de generación: sigue siendo la misma agenda.
  state.assignments = { ...state.assignments, generatedAt: "2026-09-21T15:00:00.000Z" };
  const same = await readWithRevision(baseUrl, revision!);
  assert.equal(same.response.status, 200);
  assert.deepEqual(same.data, { unchanged: true, revision });

  // Un cambio real devuelve la agenda completa con otra huella.
  state.assignments = assignments([group({ works: [work({ id: "11", title: "Revisar bomba y válvulas" })] })]);
  const changed = await readWithRevision(baseUrl, revision!);
  assert.equal(changed.data.unchanged, undefined);
  assert.equal(changed.data.groups?.length, 1);
  assert.notEqual(changed.data.revision, revision);

  // Una huella malformada se ignora y se entrega la agenda completa.
  const invalid = await readWithRevision(baseUrl, "no-es-una-huella");
  assert.equal(invalid.data.unchanged, undefined);
  assert.equal(invalid.data.groups?.length, 1);
});

test("el navegador puede enviar la huella: el permiso CORS la incluye", async (t) => {
  const { baseUrl } = await harness(t, { login: false });
  const preflight = await fetch(`${baseUrl}/api/assignments`, { method: "OPTIONS", headers: {
    Origin: "http://localhost:8081", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,x-qualitzer-known-revision",
  } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /X-Qualitzer-Known-Revision/i);
});
