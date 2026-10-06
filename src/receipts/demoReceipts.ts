import type { MaterialDispositionInput, MaterialReceipt, MaterialReceiptInput, MaterialReceiptPort, MaterialReceiptResult, MaterialReceiptStatus, MaterialReceipts } from "../domain/materialReceipts";

const DISPOSITION_DAYS = 7;

/** Entregas de ejemplo para el modo demostración: viven en memoria y nunca llegan a Qualitzer. */
export function createDemoMaterialReceiptPort(userId: number, now: Date = new Date()): MaterialReceiptPort {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const deadline = (confirmedAt: string) => new Date(Date.parse(confirmedAt) + DISPOSITION_DAYS * 86_400_000).toISOString();
  const acknowledgement = (confirmedAt: string) => ({ requestId: "00000000-0000-4000-8000-000000000001", userId, confirmedAt, method: "AUTHENTICATED_RECIPIENT" as const, client: "MOBILE" as const,
    location: { status: "UNAVAILABLE" as const, reason: "UNSUPPORTED" as const } });
  let items: MaterialReceipt[] = [
    { id: 9101, version: 1, code: "CE-00009101", sourceLabel: "OT-00265 · Mantención correctiva bomba P-12", destination: "Planta Lo Espejo", deliveredAt: at(35), requestedAt: at(35),
      receiptStatus: "PENDING", requestedByName: "Carla Rojas", sourceType: "WORK_ORDER", warehouseName: "Bodega central", reasonLabel: "Consumo en OT",
      sourceCode: "OT-00265", equipmentLabel: "Bomba centrífuga P-12 · Patente HJKL-22", customerName: "Aguas Andinas",
      notes: "Retirar en mesón 2. Revisar sellos antes de instalar.", products: [
        { id: 1, productId: 501, name: "Líquido de frenos DOT 4", code: "MANT-005", quantity: 2, unit: "UN", unitCost: 8990, currencyIso: "CLP",
          description: "Líquido sintético de alto punto de ebullición, apto para sistemas ABS. Envase de 500 ml." },
        { id: 2, productId: 502, name: "Correa de distribución", code: "MANT-006", quantity: 1, unit: "UN", unitCost: 45500, currencyIso: "CLP",
          description: "Correa dentada reforzada con fibra de vidrio, 137 dientes. Reemplazar junto al tensor." },
        { id: 3, productId: 503, name: "Sello mecánico 1\"", code: "SM-100", quantity: 2, unit: "UN", unitCost: 23900, currencyIso: "CLP", description: null },
        { id: 4, productId: 504, name: "Rodamiento 6205 2RS", code: "ROD-6205", quantity: 4, unit: "UN", unitCost: 6200, currencyIso: "CLP", description: "Rodamiento rígido de bolas sellado." },
      ] },
    { id: 9102, version: 1, code: "CE-00009102", sourceLabel: "Mantenimiento 7 · Grupo electrógeno", destination: "Faena norte", deliveredAt: at(190), requestedAt: at(190),
      receiptStatus: "PENDING", requestedByName: "Luis Pérez", sourceType: "MAINTENANCE", warehouseName: "Bodega faena", reasonLabel: "Mantenimiento preventivo",
      sourceCode: "MANT-0007", equipmentLabel: "Grupo electrógeno Cummins 150 kVA", customerName: null,
      notes: null, products: [{ id: 5, productId: 505, name: "Tuerca titanio", code: "4123", quantity: 8, unit: "UN", unitCost: 1250, currencyIso: "CLP", description: "Tuerca hexagonal M10 de titanio grado 5." }] },
    { id: 9103, version: 1, code: "CE-00009103", sourceLabel: "OT-00256 · Cambio de pulsadores", destination: "Edificio corporativo", deliveredAt: at(26 * 60), requestedAt: at(26 * 60),
      receiptStatus: "INCIDENT", requestedByName: "Carla Rojas", sourceType: "WORK_ORDER", warehouseName: "Bodega central", reasonLabel: "Consumo en OT",
      sourceCode: "OT-00256", equipmentLabel: "Central de incendio MIRCOM FX-2000", customerName: "Inmobiliaria Los Andes",
      notes: "Una unidad venía con la caja dañada.", products: [{ id: 6, productId: 506, name: "Pulsador manual inteligente MIRCOM", code: "MCP545565", quantity: 3, unit: "UN", unitCost: 38900, currencyIso: "CLP" }] },
  ];
  const oldConfirmation = at(2 * 24 * 60);
  const expiredConfirmation = at(9 * 24 * 60);
  let confirmed: MaterialReceipt[] = [
    { id: 9090, version: 3, code: "CE-00009090", sourceLabel: "OT-00241 · Revisión tablero eléctrico", destination: "Planta Maipú", deliveredAt: at(2 * 24 * 60 + 40), requestedAt: at(2 * 24 * 60 + 40),
      receiptStatus: "CONFIRMED", requestedByName: "Luis Pérez", sourceType: "WORK_ORDER", warehouseName: "Bodega central", reasonLabel: "Consumo en OT",
      sourceCode: "OT-00241", equipmentLabel: "Tablero general TG-1", customerName: "Cervecería del Sur", notes: null,
      acknowledgement: acknowledgement(oldConfirmation), dispositionDeadline: deadline(oldConfirmation), dispositionClosed: false, products: [
        { id: 20, productId: 520, name: "Interruptor termomagnético 2x16A", code: "INT-216", quantity: 2, unit: "UN", unitCost: 12990, currencyIso: "CLP", disposition: "USED", dispositionAt: at(24 * 60) },
        { id: 21, productId: 521, name: "Cable THHN 2,5 mm²", code: "CAB-25", quantity: 30, unit: "M", unitCost: 590, currencyIso: "CLP", disposition: null },
        { id: 22, productId: 522, name: "Terminal de compresión", code: "TER-06", quantity: 20, unit: "UN", unitCost: 150, currencyIso: "CLP", disposition: null },
      ] },
    { id: 9080, version: 2, code: "CE-00009080", sourceLabel: "Mantenimiento 3 · Compresor", destination: "Faena norte", deliveredAt: at(9 * 24 * 60 + 60), requestedAt: at(9 * 24 * 60 + 60),
      receiptStatus: "CONFIRMED", requestedByName: "Carla Rojas", sourceType: "MAINTENANCE", warehouseName: "Bodega faena", reasonLabel: "Mantenimiento preventivo",
      sourceCode: "MANT-0003", equipmentLabel: "Compresor Atlas Copco GA30", customerName: null, notes: null,
      acknowledgement: acknowledgement(expiredConfirmation), dispositionDeadline: deadline(expiredConfirmation), dispositionClosed: true, products: [
        { id: 30, productId: 530, name: "Filtro de aceite", code: "FA-030", quantity: 1, unit: "UN", unitCost: 18900, currencyIso: "CLP", disposition: null },
      ] },
  ];
  const copy = (list: MaterialReceipt[]) => list.map(item => ({ ...item, products: item.products.map(product => ({ ...product })) }));
  return {
    async materialReceipts(_branchId: number, status: MaterialReceiptStatus = "PENDING"): Promise<MaterialReceipts> {
      return { hasMore: false, items: copy(status === "CONFIRMED" ? confirmed : items) };
    },
    async confirmMaterialReceipts(input: MaterialReceiptInput): Promise<MaterialReceiptResult> {
      const confirmedAt = new Date().toISOString();
      const receipts = input.deliveries.map(delivery => ({ id: delivery.id, version: delivery.version + 1,
        acknowledgement: { requestId: input.requestId, userId, confirmedAt, method: "AUTHENTICATED_RECIPIENT" as const, client: input.client, location: input.location } }));
      const accepted = items.filter(item => input.deliveries.some(delivery => delivery.id === item.id));
      confirmed = [...accepted.map(item => ({ ...item, version: item.version + 1, receiptStatus: "CONFIRMED" as const, acknowledgement: receipts.find(receipt => receipt.id === item.id)!.acknowledgement,
        dispositionDeadline: deadline(confirmedAt), dispositionClosed: false })), ...confirmed];
      items = items.filter(item => !input.deliveries.some(delivery => delivery.id === item.id));
      return { companyBranchId: input.companyBranchId, requestId: input.requestId, receipts };
    },
    async materialDispositions(input: MaterialDispositionInput): Promise<MaterialReceipt> {
      const target = confirmed.find(item => item.id === input.id);
      if (!target || target.version !== input.version || target.dispositionClosed) throw new Error("DEMO_DISPOSITION_REJECTED");
      const recordedAt = new Date().toISOString();
      const updated: MaterialReceipt = { ...target, version: target.version + 1, products: target.products.map(product => {
        const change = input.lines.find(line => line.lineId === product.id);
        return change ? { ...product, disposition: change.disposition, dispositionAt: recordedAt } : { ...product };
      }) };
      confirmed = confirmed.map(item => item.id === updated.id ? updated : item);
      return copy([updated])[0];
    },
  };
}
