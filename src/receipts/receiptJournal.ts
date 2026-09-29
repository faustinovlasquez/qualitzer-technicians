import { materialReceiptInputSchema, type MaterialReceiptInput } from "../domain/materialReceipts";

interface ReceiptStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
const tails = new Map<string, Promise<void>>();
async function exclusive<Result>(key: string, action: () => Promise<Result>): Promise<Result> {
  const previous = tails.get(key) ?? Promise.resolve();
  const result = previous.then(action, action);
  const tail = result.then(() => {}, () => {});
  tails.set(key, tail);
  try { return await result; } finally { if (tails.get(key) === tail) tails.delete(key); }
}

export function prepareReceipt(storage: ReceiptStorage, key: string, branchId: number, create: () => Promise<MaterialReceiptInput>): Promise<MaterialReceiptInput> {
  return exclusive(key, async () => {
    const stored = await storage.getItem(key);
    const command = materialReceiptInputSchema.parse(stored === null ? await create() : JSON.parse(stored));
    if (command.companyBranchId !== branchId || command.client !== "MOBILE") throw new Error("MATERIAL_RECEIPT_SCOPE_MISMATCH");
    const encoded = JSON.stringify(command);
    if (stored === null) await storage.setItem(key, encoded);
    if (await storage.getItem(key) !== (stored ?? encoded)) throw new Error("MATERIAL_RECEIPT_STORAGE_FAILED");
    return command;
  });
}

export function settleReceipt(storage: ReceiptStorage, key: string, command: MaterialReceiptInput): Promise<boolean> {
  return exclusive(key, async () => {
    const stored = await storage.getItem(key);
    if (stored === null) return true;
    const saved = materialReceiptInputSchema.parse(JSON.parse(stored));
    if (JSON.stringify(saved) !== JSON.stringify(materialReceiptInputSchema.parse(command))) return false;
    await storage.removeItem(key);
    return true;
  });
}