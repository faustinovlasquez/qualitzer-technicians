import assert from "node:assert/strict";
import { test } from "node:test";
import { fileSavePresentation } from "../src/screens/workDetail/files/fileSavePresentation";

test("online storage support does not label the save button as offline", () => {
  const result = fileSavePresentation("live", 2, { online: true, authBlocked: false });
  assert.equal(result.title, "Guardar archivos · 2");
  assert.match(result.description, /^Con conexión:/);
  assert.match(result.description, /copia local/);
  assert.match(result.description, /automáticamente con la app abierta/);
});

test("offline uses the same save action and explains automatic reconnection", () => {
  const result = fileSavePresentation("live", 1, { online: false, authBlocked: false });
  assert.equal(result.title, "Guardar archivos · 1");
  assert.match(result.description, /^Sin conexión:/);
  assert.match(result.description, /automáticamente al recuperar la conexión, con la app abierta/);
});

test("an unverified session does not promise automatic upload", () => {
  for (const online of [false, true]) {
    const result = fileSavePresentation("live", 1, { online, authBlocked: true });
    assert.match(result.description, /Verifica tu sesión/);
    assert.doesNotMatch(result.description, /Se sincronizarán automáticamente/);
  }
});

test("restoration does not imply that a connection is available", () => {
  const result = fileSavePresentation("live", 0, null);
  assert.equal(result.title, "Guardar archivos · 0");
  assert.match(result.description, /^Recuperando/);
});

test("demo remains clearly separate from real uploads even with a queue", () => {
  const result = fileSavePresentation("demo", 3, { online: true, authBlocked: false });
  assert.equal(result.title, "Guardar 3 archivo(s) en demo");
  assert.match(result.description, /no se enviarán archivos a Qualitzer/);
});

test("legacy upload does not claim durable storage or automatic retry", () => {
  const result = fileSavePresentation("live", 1, undefined);
  assert.equal(result.title, "Subir 1 archivo(s)");
  assert.doesNotMatch(result.description, /local|automática/);
});

test("server errors are not presented as missing internet", () => {
  for (const status of ["service_error", "unreachable"] as const) {
    const result = fileSavePresentation("live", 1, { online: false, authBlocked: false, connection: { status, networkConnected: true, foreground: true, checkedAt: 1 } });
    assert.match(result.description, /Qualitzer no está disponible/);
    assert.doesNotMatch(result.description, /^Sin conexión:/);
  }
});

test("background pause does not masquerade as missing network", () => {
  const result = fileSavePresentation("live", 1, { online: true, authBlocked: false, connection: { status: "ready", networkConnected: true, foreground: false, checkedAt: 1 } });
  assert.match(result.description, /pausada en segundo plano/);
});

test("checking access does not claim either successful delivery or offline mode", () => {
  const result = fileSavePresentation("live", 1, { online: false, authBlocked: false, connection: { status: "checking", networkConnected: null, foreground: true, checkedAt: null } });
  assert.match(result.description, /^Comprobando/);
});