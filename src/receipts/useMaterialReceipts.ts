import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import { materialDispositionInputSchema, materialReceiptInputSchema, verifyMaterialDispositionResult, verifyMaterialReceiptResult, type MaterialDispositionInput, type MaterialReceipt,
  type MaterialReceiptInput, type MaterialReceiptPort, type MaterialReceipts } from "../domain/materialReceipts";
import { captureMaterialReceiptLocation, waitForActiveApp } from "./receiptLocation";
import { ApiError } from "../infrastructure/errors";
import { prepareReceipt, settleReceipt } from "./receiptJournal";

export function useMaterialReceipts(port: Partial<MaterialReceiptPort> | null, userId: number, branchId: number, storageKey: string, sessionIdentity: string, enabled: boolean, isAllowed: () => boolean) {
  const key = `material-receipts:${storageKey}:${userId}:${branchId}`;
  const [data, setData] = useState<MaterialReceipts | null>(null);
  const [pending, setPending] = useState<MaterialReceiptInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  // Entregas confirmadas en esta sesión: la línea de tiempo las muestra como recibidas hasta cambiar de sesión o sucursal.
  const [recent, setRecent] = useState<Array<{ item: MaterialReceipts["items"][number]; confirmedAt: string }>>([]);
  const current = useRef({ key, sessionIdentity, enabled, isAllowed, port });
  current.current = { key, sessionIdentity, enabled, isAllowed, port };
  const mounted = useRef(true);
  const lock = useRef<symbol | null>(null);
  const readRevision = useRef(0);
  const [history, setHistory] = useState<MaterialReceipts | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [disposingId, setDisposingId] = useState<number | null>(null);
  const disposing = useRef<symbol | null>(null);
  const historyRevision = useRef(0);
  const sameScope = () => mounted.current && current.current.key === key && current.current.sessionIdentity === sessionIdentity && current.current.port === port;
  const valid = () => sameScope() && current.current.enabled && current.current.isAllowed() && AppState.currentState === "active";
  // Para confirmar basta la misma sesión, el teléfono desbloqueado y la app en primer plano: "enabled" también se apaga
  // mientras la app hace otras tareas (por ejemplo, actualizar la agenda) y eso no debe cancelar la recepción.
  const blocker = (): string | null => !sameScope() ? "MATERIAL_RECEIPT_SESSION_CHANGED" : !current.current.isAllowed() ? "MATERIAL_RECEIPT_DEVICE_LOCKED"
    : AppState.currentState !== "active" ? "MATERIAL_RECEIPT_APP_BACKGROUND" : null;
  async function ensureReady(timeoutMs = 8000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const reason = blocker();
      if (!reason || reason === "MATERIAL_RECEIPT_SESSION_CHANGED" || Date.now() >= deadline) return reason;
      if (reason === "MATERIAL_RECEIPT_APP_BACKGROUND") await waitForActiveApp(Math.max(0, deadline - Date.now()));
      else await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  async function refresh() {
    if (!valid() || !port?.materialReceipts || lock.current) return;
    const revision = ++readRevision.current;
    try { const result = await port.materialReceipts(branchId); if (valid() && revision === readRevision.current && !lock.current) { setData(result); setError(""); } }
    catch { if (valid() && revision === readRevision.current && !lock.current) setError("No se pudieron cargar los materiales. Revisa tu conexion."); }
    void refreshHistory();
  }
  // Historial de confirmadas: se lee aparte para que un servidor sin historial no impida confirmar lo pendiente.
  async function refreshHistory() {
    if (!valid() || !port?.materialReceipts || disposing.current) return;
    const revision = ++historyRevision.current;
    try {
      const result = await port.materialReceipts(branchId, "CONFIRMED");
      if (valid() && revision === historyRevision.current && !disposing.current) { setHistory({ ...result, items: result.items.filter(item => item.receiptStatus === "CONFIRMED") }); setHistoryError(""); }
    } catch { if (valid() && revision === historyRevision.current && !disposing.current) setHistoryError("No se pudo cargar el historial de materiales confirmados."); }
  }
  useEffect(() => {
    let active = true;
    setData(null); setPending(null); setRecent([]); setReady(false); setBusy(false); lock.current = null; readRevision.current++;
    setHistory(null); setHistoryError(""); setDisposingId(null); disposing.current = null; historyRevision.current++;
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
    if (!ready || lock.current || !port?.confirmMaterialReceipts || items.length === 0 && !pending) return;
    const startBlocked = await ensureReady();
    if (startBlocked) { if (sameScope()) setError(`No se pudo confirmar. Desbloquea el teléfono y vuelve a intentarlo. (código: ${startBlocked})`); return; }
    const operation = Symbol();
    lock.current = operation; readRevision.current++; setBusy(true); setError("");
    let command: MaterialReceiptInput | null = null;
    let reload = false;
    try {
      command = await prepareReceipt(AsyncStorage, key, branchId, async () => {
        const location = await captureMaterialReceiptLocation(() => ensureReady());
        const after = await ensureReady();
        if (after) throw new Error(after);
        return materialReceiptInputSchema.parse({ companyBranchId: branchId, requestId: Crypto.randomUUID(), client: "MOBILE",
          deliveries: items.map(({ id, version }) => ({ id, version })).sort((left, right) => left.id - right.id), location });
      });
      const beforeSend = await ensureReady();
      if (beforeSend) throw new Error(beforeSend);
      setPending(command);
      const result = await port.confirmMaterialReceipts(command);
      verifyMaterialReceiptResult(command, result, userId);
      await settleReceipt(AsyncStorage, key, command);
      if (sameScope()) {
        setRecent(previous => [...result.receipts.flatMap(receipt => { const item = items.find(entry => entry.id === receipt.id); return item ? [{ item: { ...item, version: receipt.version, receiptStatus: "CONFIRMED" as const, acknowledgement: receipt.acknowledgement }, confirmedAt: receipt.acknowledgement.confirmedAt }] : []; }), ...previous].slice(0, 50));
        setPending(null); setData(previous => previous ? { ...previous, items: previous.items.filter(item => !result.receipts.some(receipt => receipt.id === item.id)) } : null); }
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
      // El código ayuda a soporte a distinguir conexión, sesión, permisos o un error del servidor sin exponer detalles internos.
      const code = failure instanceof ApiError ? failure.code : failure instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(failure.message) ? failure.message : "";
      if (sameScope()) setError(rejected ? `${failure instanceof ApiError && failure.code === "CONSUMPTION_RECEIPT_LOCATION_EXPIRED"
        ? "La ubicación del teléfono no estaba actualizada. Vuelve a confirmar."
        : "La entrega cambió. Revisa los materiales y confirma nuevamente."}${code ? ` (código: ${code})` : ""}`
        : `No se pudo confirmar. Reintenta la misma recepción cuando tengas conexión.${code ? ` (código: ${code})` : ""}`);
    } finally { if (lock.current === operation) { lock.current = null; if (sameScope()) setBusy(false); if (reload && valid()) void refresh(); } }
  }
  /** Utilizado / Devolver por material. Requiere conexión: la respuesta del servidor reemplaza la entrega en el historial. */
  async function dispose(item: MaterialReceipt, lines: MaterialDispositionInput["lines"]): Promise<boolean> {
    if (!ready || disposing.current || !port?.materialDispositions || lines.length === 0) return false;
    if (!sameScope() || !current.current.isAllowed()) return false;
    const operation = Symbol();
    disposing.current = operation; historyRevision.current++; setDisposingId(item.id); setHistoryError("");
    try {
      const input = materialDispositionInputSchema.parse({ companyBranchId: branchId, id: item.id, version: item.version, lines });
      const result = await port.materialDispositions(input);
      verifyMaterialDispositionResult(input, result);
      if (sameScope()) setHistory(previous => previous ? { ...previous, items: previous.items.map(entry => entry.id === result.id ? result : entry) } : { hasMore: false, items: [result] });
      return true;
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      if (sameScope()) setHistoryError(code === "CONSUMPTION_DISPOSITION_CLOSED" ? "El plazo de 7 días terminó: los materiales quedaron como utilizados."
        : code === "CONSUMPTION_DISPOSITION_RETURN_PROCESSED" ? "Bodega ya registró la devolución de ese material."
          : code === "CONSUMPTION_VERSION_CONFLICT" ? "La entrega cambió. Actualizamos la lista; vuelve a marcar el material."
            : `No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.${code ? ` (código: ${code})` : ""}`);
      return false;
    } finally {
      if (disposing.current === operation) { disposing.current = null; if (sameScope()) setDisposingId(null); if (valid()) void refreshHistory(); }
    }
  }
  // Las confirmadas en esta sesión se muestran aunque el servidor todavía no entregue historial.
  const confirmed = [...(history?.items ?? []), ...recent.map(entry => entry.item).filter(item => !(history?.items ?? []).some(entry => entry.id === item.id))];
  return { data, pending, busy, error, ready, recent, refresh, confirm, history, historyError, confirmed, disposingId, refreshHistory, dispose };
}