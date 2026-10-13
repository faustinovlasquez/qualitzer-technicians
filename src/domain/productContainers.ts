/**
 * Trabajos internos que crea la web para guardar los repuestos de un mantenimiento u OT ("Productos (supervisor)",
 * "Productos utilizados"). No son trabajos del técnico: la web los oculta con la misma regla (título exacto, sin espacios
 * al borde), y los repuestos se muestran desde la orden en la pestaña Repuestos.
 */
const PRODUCT_CONTAINER_TITLES = new Set(["Productos (supervisor)", "Productos utilizados"]);

export function isProductsContainerWork(work: { title: string }): boolean {
  return PRODUCT_CONTAINER_TITLES.has(work.title.trim());
}

export function withoutProductContainers<T extends { title: string }>(works: readonly T[]): T[] {
  return works.filter((work) => !isProductsContainerWork(work));
}
