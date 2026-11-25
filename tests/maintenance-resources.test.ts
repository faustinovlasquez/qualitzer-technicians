import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceResourcesSchema, resourceAddInputSchema, resourceCatalogPageSchema, resourceCatalogQuerySchema, resourceErrorMessage, resourceQuantityInputSchema } from "../src/domain/maintenanceResources";

test("recursos: cantidades enteras entre 1 y 100.000, sin campos extra", () => {
  assert.equal(resourceAddInputSchema.safeParse({ productId: 5, quantity: 2 }).success, true);
  for (const quantity of [0, -1, 1.5, 100001]) assert.equal(resourceAddInputSchema.safeParse({ productId: 5, quantity }).success, false);
  assert.equal(resourceAddInputSchema.safeParse({ productId: 5, quantity: 1, costPrice: 10 }).success, false, "el teléfono nunca manda precios");
  assert.equal(resourceQuantityInputSchema.safeParse({ quantity: 3 }).success, true);
  assert.equal(resourceQuantityInputSchema.safeParse({ quantity: 0 }).success, false);
});

test("recursos: la lista no acepta filas repetidas y el catálogo limpia la búsqueda", () => {
  const item = { id: 1, productId: 9, code: "REP-1", name: "Filtro", quantity: 2, workTitle: "Productos (supervisor)" };
  assert.equal(maintenanceResourcesSchema.safeParse({ maintenanceId: 3, canEdit: true, items: [item] }).success, true);
  assert.equal(maintenanceResourcesSchema.safeParse({ maintenanceId: 3, canEdit: true, items: [item, item] }).success, false);
  assert.deepEqual(resourceCatalogQuerySchema.parse({ search: "  filtro " }), { search: "filtro", page: 0 });
  assert.equal(resourceCatalogQuerySchema.safeParse({ search: "a\u0000b" }).success, false);
  assert.equal(resourceCatalogPageSchema.safeParse({ items: [], page: 0, hasMore: false }).success, true);
});

test("recursos: cada error del servidor tiene un mensaje claro", () => {
  for (const code of ["PANEL_RESOURCE_READ_ONLY", "PANEL_RESOURCE_PRODUCT_NOT_FOUND", "PANEL_RESOURCE_NOT_FOUND", "PANEL_RESOURCE_INVALID_QUANTITY", "PANEL_RESOURCE_NOT_AVAILABLE"]) {
    assert.notEqual(resourceErrorMessage(code), resourceErrorMessage("OTRO"), code);
  }
});
