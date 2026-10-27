import assert from "node:assert/strict";
import { test } from "node:test";
import { driveChildren, driveListQuerySchema, drivePath, driveRoute, type DriveFolder } from "../src/domain/fileDrive";

const folders: DriveFolder[] = [
  { id: "maintenance_work_7", name: "Trabajo 1 · Cambio de sello", fileCount: 3, parentId: null, readOnly: true },
  { id: "maintenance_work_7_checklist", name: "Lista de chequeo", fileCount: 1, parentId: "maintenance_work_7", readOnly: true },
  { id: 4, name: "Informes", fileCount: 0, parentId: null, readOnly: false },
  { id: 2, name: "Fotos", fileCount: 5, parentId: null, readOnly: false }
];

test("las carpetas de un nivel salen ordenadas y la ruta llega hasta la raíz", () => {
  assert.deepEqual(driveChildren(folders, null).map((folder) => folder.name), ["Fotos", "Informes", "Trabajo 1 · Cambio de sello"]);
  assert.deepEqual(driveChildren(folders, "maintenance_work_7").map((folder) => folder.id), ["maintenance_work_7_checklist"]);
  assert.deepEqual(drivePath(folders, "maintenance_work_7_checklist").map((folder) => folder.name), ["Trabajo 1 · Cambio de sello", "Lista de chequeo"]);
  assert.deepEqual(drivePath(folders, null), []);
});

test("cada origen apunta a su ruta del intermediario con la sucursal o el rango", () => {
  assert.equal(String(driveRoute({ kind: "entry", companyBranchId: 1, entryId: 12 }).path), "/api/workshop/drive/entries/12");
  assert.equal(driveRoute({ kind: "order", companyBranchId: 1, entryId: 12, orderId: 82 }).path, "/api/workshop/drive/entries/12/orders/82");
  const work = driveRoute({ kind: "assignment", groupId: "maintenance-50", workId: "11", range: { startDate: "2026-10-26", endDate: "2026-10-26", companyBranchId: 1 } });
  assert.equal(work.path, "/api/assignments/maintenance-50/works/11/drive");
  assert.equal(work.query.toString(), "startDate=2026-10-26&endDate=2026-10-26&companyBranchId=1");
  assert.throws(() => driveRoute({ kind: "assignment", groupId: "../x", range: { startDate: "2026-10-26", endDate: "2026-10-26", companyBranchId: 1 } }));
});

test("la carpeta de la consulta acepta números o carpetas del sistema, nunca rutas", () => {
  assert.equal(driveListQuerySchema.parse({ folderId: "4" }).folderId, 4);
  assert.equal(driveListQuerySchema.parse({ folderId: "work_7_photos" }).folderId, "work_7_photos");
  assert.equal(driveListQuerySchema.parse({}).folderId, null);
  assert.equal(driveListQuerySchema.safeParse({ folderId: "../../files" }).success, false);
});
