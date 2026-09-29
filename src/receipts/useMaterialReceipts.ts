import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import { materialReceiptInputSchema, verifyMaterialReceiptResult, type MaterialReceiptInput, type MaterialReceiptPort, type MaterialReceipts } from "../domain/materialReceipts";
import { captureMaterialReceiptLocation } from "./receiptLocation";
import { ApiError } from "../infrastructure/errors";
import { prepareReceipt, settleReceipt } from "./receiptJournal";

export function useMaterialReceipts(port: Partial<MaterialReceiptPort> | null, userId: number, branchId: number, storageKey: string, sessionIdentity: string, enabled: boolean, isAllowed: () => boolean) {
  const key = `material-receipts:${storageKey}:${userId}:${branchId}`;
  const [data, setData] = useState<MaterialReceipts | null>(null);
  const [pending, setPending] = useState<MaterialReceiptInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const current = useRef({ key, sessionIdentity, enabled, isAllowed, port });
  current.current = { key, sessionIdentity, enabled, isAllowed, port };
  const mounted = useRef(true);
  const lock = useRef<symbol | null>(null);
  const readRevision = useRef(0);
  const sameScope = () => mounted.current && current.current.key === key && current.current.sessionIdentity === sessionIdentity && current.current.port === port;
  const valid = () => sameScope() && current.current.enabled && current.current.isAllowed() && AppState.currentState === "active";
  async function refresh() {
    if (!valid() || !port?.materialReceipts || lock.current) return;
    const revision = ++readRevision.current;
    try { const result = await port.materialReceipts(branchId); if (valid() && revision === readRevision.current && !lock.current) { setData(result); setError(""); } }
    catch { if (valid() && revision === readRevision.current && !lock.current) setError("No se pudieron cargar los materiales. Revisa tu conexion."); }
  }
  useEffect(() => {
    let active = true;
    setData(null); setPending(null); setReady(false); setBusy(false); lock.current = null; readRevision.current++;
    void AsyncStorage.getItem(key).then(raw => {
      if (!active) return;
      if (raw) {
        const stored = materialReceiptInputSchema.parse(JSON.parse(raw));
        if (stored.companyBranchId !== branchId) throw new Error("MATERIAL_RECEIPT_SCOPE_MISMATCH");
        setPending(stored);
      }
      setReady(true);
    }).catch(() => { if (active) setError("No se pudo recuperar la confirmacion pendiente."); });
    return () => { active = false; };
  }, [key, sessionIdentity]);
  useEffect(() => {
    if (!ready || !enabled) return;
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => { clearInterval(interval); subscription.remove(); };
  }, [key, sessionIdentity, ready, enabled, port]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function confirm(items: MaterialReceipts["items"]) {
    if (!valid() || !ready || lock.current || !port?.confirmMaterialReceipts || items.length === 0 && !pending) return;
    const operation = Symbol();
    lock.current = operation; readRevision.current++; setBusy(true); setError("");
    let command: MaterialReceiptInput | null = null;
    let reload = false;
    try {
      command = await prepareReceipt(AsyncStorage, key, branchId, async () => {
        if (!valid()) throw new Error("MATERIAL_RECEIPT_SESSION_CHANGED");
        const location = await captureMaterialReceiptLocation(valid);
        if (!valid()) throw new Error("MATERIAL_RECEIPT_SESSION_CHANGED");
        return materialReceiptInputSchema.parse({ companyBranchId: branchId, requestId: Crypto.randomUUID(), client: "MOBILE",
          deliveries: items.map(({ id, version }) => ({ id, version })).sort((left, right) => left.id - right.id), location });
      });
      if (!valid()) return;
      setPending(command);
      const result = await port.confirmMaterialReceipts(command);
      verifyMaterialReceiptResult(command, result, userId);
      await settleReceipt(AsyncStorage, key, command);
      if (sameScope()) { setPending(null); setData(previous => previous ? { ...previous, items: previous.items.filter(item => !result.receipts.some(receipt => receipt.id === item.id)) } : null); }
      reload = true;
    } catch (failure) {
      const rejected = failure instanceof ApiError && [404, 409].includes(failure.status) && ["CONSUMPTION_NOT_FOUND", "CONSUMPTION_VERSION_CONFLICT", "CONSUMPTION_RECEIPT_NOT_PENDING", "CONSUMPTION_RECEIPT_LOCATION_EXPIRED"].includes(failure.code);
      if (rejected && command !== null) {
        try {
          await settleReceipt(AsyncStorage, key, command);
          if (sameScope()) setPending(null);
          reload = true;
        } catch { if (sameScope()) setError("No se pudo recuperar el intento. Reintenta la misma confirmacion."); return; }
      }
      if (sameScope()) setError(rejected ? "La entrega o la ubicacion cambio. Revisa los materiales y confirma nuevamente." : "No se pudo confirmar. Reintenta la misma recepcion cuando tengas conexion.");
    } finally { if (lock.current === operation) { lock.current = null; if (sameScope()) setBusy(false); if (reload && valid()) void refresh(); } }
  }
  return { data, pending, busy, error, ready, refresh, confirm };
}