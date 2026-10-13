import assert from "node:assert/strict";
import test from "node:test";
import { isProductsContainerWork, withoutProductContainers } from "../src/domain/productContainers";

test("hides only the exact web product containers, like the technician web view", () => {
  for (const title of ["Productos (supervisor)", " Productos (supervisor)\t", "Productos utilizados", "\nProductos utilizados "]) {
    assert.equal(isProductsContainerWork({ title }), true, title);
  }
  for (const title of ["PRODUCTOS (SUPERVISOR)", "productos utilizados", "Productos  utilizados", "Revisar Productos (supervisor)", "Productos", ""]) {
    assert.equal(isProductsContainerWork({ title }), false, title);
  }
  assert.deepEqual(withoutProductContainers([{ title: "Instalación de panel" }, { title: "Productos (supervisor)" }]).map((work) => work.title), ["Instalación de panel"]);
});
