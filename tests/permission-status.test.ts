import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionAction, permissionLabels, permissionState } from "../src/screens/permissions/permissionStatus";

test("estado del permiso como en Ajustes de Android", () => {
  assert.equal(permissionState(null), "unknown");
  assert.equal(permissionState({ granted: true, canAskAgain: true, status: "granted" }), "granted");
  assert.equal(permissionState({ granted: false, canAskAgain: true, status: "undetermined" }), "undetermined");
  assert.equal(permissionState({ granted: false, canAskAgain: true, status: "denied" }), "denied");
  assert.equal(permissionState({ granted: false, canAskAgain: false, status: "denied" }), "blocked");
  assert.equal(permissionLabels.blocked, "Bloqueado");
});

test("acción: pedir si se puede, abrir Ajustes si está bloqueado, y Quitar abre Ajustes", () => {
  assert.equal(permissionAction("undetermined"), "request");
  assert.equal(permissionAction("denied"), "request");
  assert.equal(permissionAction("blocked"), "settings");
  assert.equal(permissionAction("granted"), "revoke");
  assert.equal(permissionAction("unknown"), null);
});
