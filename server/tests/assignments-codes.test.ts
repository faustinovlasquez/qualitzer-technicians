import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentCodes, assignmentNegotiationCode, assignmentWorkCode, assignmentWorkOrderCode, matchesAssignmentSearch } from "../../src/domain/assignmentCodes";
import { group, work } from "./fixtures";

test("work codes use exactly TR and five digits without truncating large IDs", () => {
  assert.equal(assignmentWorkCode(work()), "TR-00011");
  assert.equal(assignmentWorkCode(work({ id: "123456" })), "TR-123456");
  for (const id of ["", "0", "-1", "1e3", "1.5", "not-an-id", "9007199254740992"]) assert.equal(assignmentWorkCode(work({ id })), null);
});

test("maintenance codes recognize Spanish and English types, always using the maintenance ID", () => {
  for (const [type, prefix] of [
    ["preventivo", "PRE"], ["preventive", "PRE"], ["correctivo", "COR"], ["corrective", "COR"],
    ["rutinario", "RUT"], ["routine", "RUT"], ["detención", "DET"], ["detention", "DET"], ["checklist", "CHK"],
  ]) {
    const codes = assignmentCodes(group({ id: "maintenance-50", type: "internal_maintenance", maintenanceType: type?.toUpperCase() }), work({ id: "713" }));
    assert.equal(codes.workCode, "TR-00713");
    assert.equal(codes.workOrderCode, `OT-${prefix}-0050`);
    assert.equal(codes.negotiationCode, null);
  }
  assert.equal(assignmentWorkOrderCode(group({ id: "maintenance-50", type: "internal_maintenance", maintenanceType: "unknown", code: "REAL-0050" })), "REAL-0050");
  assert.equal(assignmentWorkOrderCode(group({ id: "maintenance-50", type: "internal_maintenance", maintenanceType: "unknown", code: "" })), null);
  assert.equal(assignmentWorkOrderCode(group({ type: "internal_maintenance", code: "OT-PRE-50" })), "OT-PRE-0050");
});

test("external and internal OTs and negotiation codes remain independent", () => {
  const external = group({ id: "external-300", type: "external_ot", code: "81", workOrderNumber: 81, workOrderInternalNumber: 7, isWorkOrderInternal: false, businessModality: "FORMAL_QUOTE", businessTypeName: "service", negotiationCorrelative: 17 });
  assert.deepEqual(assignmentCodes(external, work()), { workCode: "TR-00011", workOrderCode: "OT-00081", negotiationCode: "COT-SER-0017" });
  assert.equal(assignmentWorkOrderCode({ ...external, isWorkOrderInternal: true }), "OT-INT-0007");
  assert.equal(assignmentWorkOrderCode({ ...external, workOrderNumber: 123456 }), "OT-123456");
  assert.equal(assignmentWorkOrderCode(group()), null);
  assert.equal(assignmentWorkOrderCode({ ...external, workOrderNumber: null, code: "CUSTOM-81" }), "CUSTOM-81");
  assert.equal(assignmentWorkOrderCode({ ...external, workOrderNumber: null, code: "<b>OT-81</b>" }), null);
});

test("negotiations prefer actual safe codes and only construct verified web mappings", () => {
  const metadata = group({ businessModality: "FORMAL_QUOTE", businessTypeName: "service", negotiationCorrelative: 17 });
  assert.equal(assignmentNegotiationCode({ ...metadata, negotiationCode: " REAL-CODE-017 " }), "REAL-CODE-017");
  for (const [type, expected] of [["service", "SER"], ["periodic_services", "SER"], ["rental", "ARR"], ["rental_service", "SER"], ["products", "PRO"], ["project", "PRO"]]) {
    assert.equal(assignmentNegotiationCode({ ...metadata, businessTypeName: type }), `COT-${expected}-0017`);
    assert.equal(assignmentNegotiationCode({ ...metadata, businessTypeName: type, businessModality: "DIRECT_AGREEMENT" }), `VEN-${expected}-0017`);
  }
  for (const businessTypeName of ["transport", "invented", "rental_mystery", "", null]) assert.equal(assignmentNegotiationCode({ ...metadata, businessTypeName }), null);
  for (const businessModality of ["invented", "", null]) assert.equal(assignmentNegotiationCode({ ...metadata, businessModality }), null);
  assert.equal(assignmentNegotiationCode({ ...metadata, businessTypeName: "invented", negotiationCode: "COT-NEW-0017" }), "COT-NEW-0017");
  assert.equal(assignmentNegotiationCode({ ...metadata, negotiationCode: "17" }), "COT-SER-0017");
  assert.equal(assignmentNegotiationCode({ ...metadata, businessTypeName: "unknown", negotiationCode: "<script>17</script>" }), null);
});

test("dashboard search includes every displayed code plus exact group and work identifiers", () => {
  const assigned = group({ id: "external-300", type: "external_ot", code: "81", workOrderNumber: 81, businessModality: "FORMAL_QUOTE", businessTypeName: "service", negotiationCorrelative: 17 });
  for (const query of ["TR-00011", "ot-00081", "cot-ser-0017", "external-300", "11", "inspeccion", "M-1", "taller", "cliente"]) assert.equal(matchesAssignmentSearch(assigned, work(), query), true, query);
  assert.equal(matchesAssignmentSearch(assigned, work(), "OT-99999"), false);
  assert.equal(matchesAssignmentSearch(assigned, work(), "  "), true);
});