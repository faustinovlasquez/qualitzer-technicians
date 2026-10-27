import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, AppState, BackHandler, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrivateModal as Modal } from "../security/DeviceSecurityContext";
import { useTrustedNativePicker } from "../security/useTrustedNativePicker";
import { CameraPermissionError } from "../domain/cameraErrors";
import { driveChildren, drivePath, type DriveApi, type DriveFile, type DriveFolder, type DriveFolderId, type DriveListing } from "../domain/fileDrive";
import { pickWorkspaceFiles } from "../screens/workDetail/files/filePicker";
import type { FileSource } from "../screens/workDetail/files/fileRules";
import { httpUrl } from "../screens/workDetail/detailRules";
import { Button, IconButton } from "../ui/components";
import { palette, radius, typography } from "../ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
type Upload = {
  id: string; name: string; uri: string; mimeType: string; size?: number; target: DriveFolderId | null;
  status: "waiting" | "uploading" | "done" | "error" | "queued"; error?: string; startedAt?: number;
};
/** Velocidad de subida supuesta (datos móviles) para estimar el avance: el envío no informa los bytes enviados. */
const UPLOAD_BYTES_PER_SECOND = 120 * 1024;
/** La lista se recarga sola cada tanto para mostrar lo que otros suben desde la web o desde otro teléfono. */
const POLL_MS = 15_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function uploadShare(upload: Upload, now: number): number {
  if (upload.status === "done") return 1;
  if (upload.status !== "uploading" || upload.startedAt === undefined) return 0;
  const expected = Math.max(1500, ((upload.size ?? 600 * 1024) / UPLOAD_BYTES_PER_SECOND) * 1000);
  // Llega al 90 % al tiempo estimado y se queda ahí hasta que el servidor confirma.
  return Math.min(0.9, ((now - upload.startedAt) / expected) * 0.9);
}
/** Sin señal antes de enviar: el archivo no llegó al servidor y se puede guardar en la cola sin riesgo de duplicarlo. */
const unsent = (failure: unknown) => failure instanceof Error && failure.name === "NetworkError" && (failure as Error & { kind?: string }).kind === "network";
type Dialog =
  | { kind: "add" } | { kind: "file"; file: DriveFile } | { kind: "folder"; folder: DriveFolder }
  | { kind: "name"; folder: DriveFolder | null } | { kind: "move"; file: DriveFile }
  | { kind: "confirm"; target: { file: DriveFile } | { folder: DriveFolder } } | { kind: "preview"; file: DriveFile };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const isImage = (file: DriveFile) => file.type?.toLowerCase().startsWith("image/") === true;
const sizeText = (size: number | null) => size === null ? null : size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const sameFolder = (left: DriveFolderId | null, right: DriveFolderId | null) => left === null || right === null ? left === right : String(left) === String(right);

function fileIcon(file: DriveFile): { icon: IconName; tone: string; soft: string; label: string } {
  const type = file.type?.toLowerCase() ?? "";
  const name = file.name.toLowerCase();
  if (type.startsWith("image/")) return { icon: "image", tone: palette.violet, soft: palette.violetSoft, label: "Imagen" };
  if (type.includes("pdf") || name.endsWith(".pdf")) return { icon: "document-text", tone: palette.danger, soft: palette.dangerSoft, label: "PDF" };
  if (type.includes("sheet") || type.includes("excel") || /\.(xlsx?|csv)$/.test(name)) return { icon: "grid", tone: palette.success, soft: palette.successSoft, label: "Planilla" };
  if (type.includes("word") || /\.docx?$/.test(name)) return { icon: "document", tone: palette.info, soft: palette.infoSoft, label: "Documento" };
  return { icon: "document-attach", tone: palette.textSecondary, soft: palette.track, label: "Archivo" };
}

function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string | null; onClose: () => void; children: ReactNode }) {
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.sheetHead}>
          <View style={styles.grow}>
            <Text style={styles.sheetTitle} accessibilityRole="header" numberOfLines={2}>{title}</Text>
            {subtitle ? <Text style={styles.hint} numberOfLines={2}>{subtitle}</Text> : null}
          </View>
          <IconButton name="close-outline" label="Cerrar" onPress={onClose} />
        </View>
        {children}
      </View>
    </View>
  </Modal>;
}

function Action({ icon, label, detail, tone = palette.primary, disabled = false, onPress }: { icon: IconName; label: string; detail?: string; tone?: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}>
    <View style={[styles.actionIcon, { backgroundColor: tone === palette.danger ? palette.dangerSoft : palette.primarySoft }]}><Ionicons name={icon} size={20} color={tone} accessible={false} /></View>
    <View style={styles.grow}>
      <Text style={[styles.actionLabel, tone === palette.danger && { color: palette.danger }]}>{label}</Text>
      {detail ? <Text style={styles.hint}>{detail}</Text> : null}
    </View>
  </Pressable>;
}

function Thumb({ file, size }: { file: DriveFile; size: number }) {
  // Miniatura y, si aún no existe (el servidor la genera después de subir), la foto original.
  const candidates = [httpUrl(file.thumbnailUrl), isImage(file) ? httpUrl(file.url) : null].filter((url, index, all): url is string => url !== null && all.indexOf(url) === index);
  const [attempt, setAttempt] = useState(0);
  const preview = candidates[attempt];
  const kind = fileIcon(file);
  if (preview) return <Image key={preview} source={{ uri: preview }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: palette.track }} onError={() => setAttempt((value) => value + 1)} accessibilityLabel={file.name} />;
  return <View style={[styles.typeIcon, { width: size, height: size, backgroundColor: kind.soft }]}><Ionicons name={kind.icon} size={Math.round(size * 0.42)} color={kind.tone} accessible={false} /></View>;
}

/** Archivo que se está subiendo: la foto del teléfono con su avance y, al terminar, el visto bueno. */
function PendingThumb({ upload, share, size }: { upload: Upload; share: number; size: number }) {
  const image = upload.mimeType.toLowerCase().startsWith("image/");
  const done = upload.status === "done";
  return <View style={[styles.pendingThumb, { width: size, height: size }]}>
    {image ? <Image source={{ uri: upload.uri }} style={{ width: size, height: size }} accessible={false} />
      : <Ionicons name="document-attach" size={Math.round(size * 0.42)} color={palette.textSecondary} accessible={false} />}
    <View style={[styles.pendingShade, done && styles.pendingShadeDone]}>
      {done ? <Ionicons name="checkmark-circle" size={size > 60 ? 30 : 20} color={palette.white} accessible={false} />
        : <ActivityIndicator size="small" color={palette.white} />}
      {size > 60 ? <Text style={styles.pendingText}>{done ? "Subida" : upload.status === "waiting" ? "En espera" : `${Math.round(share * 100)} %`}</Text> : null}
    </View>
    <View style={styles.pendingTrack}><View style={[styles.pendingFill, { width: `${Math.round(share * 100)}%` }]} /></View>
  </View>;
}

/**
 * Gestor de archivos genérico (como el de la web): carpetas con ruta, búsqueda, vista en cuadrícula o lista,
 * subir varias fotos o documentos con su avance, mover, renombrar y borrar. Sirve para ingresos, OT, trabajos y mantenimientos.
 */
export function FileDrive({ api, title, subtitle, onClose, readOnly = false, canDelete = true, embedded = false, notice, onOfflineSave, onChanged }: {
  api: DriveApi; title: string; subtitle?: string; onClose?: () => void; readOnly?: boolean; canDelete?: boolean;
  /**
   * Guarda en la cola sin conexión los archivos que no se pudieron enviar por falta de señal (van a la carpeta principal
   * y se envían solos al volver la conexión). Sin él, quedan con error para reintentar.
   */
  onOfflineSave?: (files: Array<{ id: string; uri: string; name: string; mimeType: string; size?: number }>) => Promise<void>;
  /** Avisa que cambió algo (subida, borrado, carpeta) para que la pantalla actualice lo que depende de los archivos. */
  onChanged?: () => void;
  /** Dentro de una pestaña: en la carpeta principal no hay botón atrás y la tecla atrás la maneja la pantalla. */
  embedded?: boolean;
  /** Aviso fijo arriba de la lista (por ejemplo, si la evidencia es obligatoria). */
  notice?: ReactNode;
}) {
  const [folderId, setFolderId] = useState<DriveFolderId | null>(null);
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [name, setName] = useState("");
  const picker = useTrustedNativePicker();
  const request = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;

  const folders = listing?.folders ?? [];
  const current = folderId === null ? null : folders.find((folder) => sameFolder(folder.id, folderId)) ?? null;
  const path = drivePath(folders, folderId);
  const children = search ? [] : driveChildren(folders, folderId);
  const uploading = uploads.some((upload) => upload.status === "waiting" || upload.status === "uploading");
  const canUpload = !readOnly && listing?.capabilities.upload === true && !current?.readOnly;
  const canFolders = !readOnly && listing?.capabilities.folders === true;
  const canRemove = !readOnly && canDelete && listing?.capabilities.remove === true && !current?.readOnly;
  const movable = folders.filter((folder) => !folder.readOnly && typeof folder.id === "number");

  /** `quiet`: recarga de fondo (cada tanto o al volver a la app); si falla no reemplaza la lista por un error. */
  async function load(nextFolder = folderId, nextSearch = search, quiet = false): Promise<DriveListing | null> {
    const ticket = ++request.current;
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const result = await apiRef.current.list(nextFolder, nextSearch, 0);
      if (ticket !== request.current) return null;
      setError("");
      setListing(result); setFiles(result.files);
      return result;
    } catch (failure) {
      if (ticket === request.current && !quiet) setError(failureText(failure, "No se pudieron cargar los archivos. Revisa tu conexión."));
      return null;
    } finally { if (ticket === request.current) { setLoading(false); setRefreshing(false); } }
  }
  useEffect(() => { void load(folderId, search); }, [folderId, search]);

  // Siempre al día: recarga cada 15 s y al volver a la app (lo subido desde la web u otro teléfono aparece solo).
  const quietLoad = useRef(() => undefined as unknown);
  // No se recarga si se abrió «Ver más» (volvería a la primera página) ni durante una acción.
  quietLoad.current = () => { if (!uploading && !busy && !loadingMore && dialog === null && (listing?.page ?? 0) === 0) void load(folderId, search, true); };
  useEffect(() => {
    if (typeof setInterval !== "function") return;
    const timer = setInterval(() => quietLoad.current(), POLL_MS);
    const subscription = AppState?.addEventListener?.("change", (state) => { if (state === "active") quietLoad.current(); });
    return () => { clearInterval(timer); subscription?.remove(); };
  }, []);

  // Avance estimado de la subida en curso.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!uploading || typeof setInterval !== "function") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [uploading]);

  async function loadMore() {
    if (!listing || loadingMore || listing.page + 1 >= listing.totalPages) return;
    setLoadingMore(true);
    try {
      const result = await api.list(folderId, search, listing.page + 1);
      setListing(result); setFiles((existing) => [...existing, ...result.files.filter((file) => !existing.some((item) => item.id === file.id))]);
    } catch (failure) { setMessage({ text: failureText(failure, "No se pudieron cargar más archivos."), tone: "error" }); }
    finally { setLoadingMore(false); }
  }

  function goBack(): boolean {
    if (dialog) { setDialog(null); return true; }
    if (search) { setQuery(""); setSearch(null); return true; }
    if (folderId !== null) { setFolderId(current?.parentId ?? null); return true; }
    if (embedded || !onClose) return false;
    if (!uploading) onClose();
    return true;
  }
  const back = useRef(goBack);
  back.current = goBack;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => back.current());
    return () => subscription.remove();
  }, []);

  async function run(action: () => Promise<void>, done: string) {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await action(); setDialog(null); setMessage({ text: done, tone: "success" }); onChanged?.(); await load(); }
    catch (failure) { setMessage({ text: failureText(failure, "No se pudo completar la acción."), tone: "error" }); }
    finally { setBusy(false); }
  }

  async function pick(source: FileSource) {
    setDialog(null); setMessage(null);
    let selected: Awaited<ReturnType<typeof pickWorkspaceFiles>>;
    try { selected = await pickWorkspaceFiles(source, 20, picker); }
    catch (failure) {
      setMessage({ text: failure instanceof CameraPermissionError ? "La app no tiene permiso para usar la cámara. Actívalo en los ajustes del teléfono." : failureText(failure, "No se pudo abrir el selector."), tone: "error" });
      return;
    }
    if (selected.length === 0) return;
    await send(selected.map((file) => ({ id: Crypto.randomUUID(), uri: file.uri, name: file.name, mimeType: file.mimeType ?? "application/octet-stream", size: file.size })));
  }

  // Archivos elegidos que fallaron: se pueden reintentar sin volver a elegirlos.
  const retryable = useRef(new Map<string, { id: string; uri: string; name: string; mimeType: string; size?: number }>());
  async function send(queue: Array<{ id: string; uri: string; name: string; mimeType: string; size?: number }>) {
    const target = folderId;
    const searching = search !== null;
    const before = listing?.totalFiles ?? files.length;
    setUploads(queue.map((file) => ({ ...file, target, status: "waiting" as const })));
    let failed = 0;
    let uploaded = 0;
    const offline: typeof queue = [];
    for (const file of queue) {
      setUploads((list) => list.map((item) => item.id === file.id ? { ...item, status: "uploading", startedAt: Date.now(), error: undefined } : item));
      try {
        if (file.size !== undefined && file.size > MAX_UPLOAD_BYTES) throw new Error("Supera el máximo de 25 MB.");
        // Un corte de señal antes de enviar no llegó al servidor: se reintenta solo (sin riesgo de duplicar) antes de rendirse.
        for (let attempt = 0; ; attempt++) {
          try { await apiRef.current.upload(file, target); break; }
          catch (failure) {
            // Con cola sin conexión se guarda de inmediato en el teléfono; sin ella se reintenta dos veces.
            if (!unsent(failure) || attempt >= 2 || onOfflineSave) throw failure;
            await wait(3000 * (attempt + 1));
            setUploads((list) => list.map((item) => item.id === file.id ? { ...item, startedAt: Date.now() } : item));
          }
        }
        uploaded += 1;
        retryable.current.delete(file.id);
        setUploads((list) => list.map((item) => item.id === file.id ? { ...item, status: "done" } : item));
      } catch (failure) {
        if (onOfflineSave && unsent(failure)) { offline.push(file); continue; }
        failed += 1;
        retryable.current.set(file.id, file);
        setUploads((list) => list.map((item) => item.id === file.id ? { ...item, status: "error", error: failureText(failure, "No se pudo subir.") } : item));
      }
    }
    // Sin señal: se guardan en el teléfono y se envían solos al volver la conexión (como los demás cambios sin conexión).
    if (offline.length > 0 && onOfflineSave) {
      try {
        await onOfflineSave(offline);
        for (const file of offline) retryable.current.delete(file.id);
        setUploads((list) => list.map((item) => offline.some((file) => file.id === item.id) ? { ...item, status: "queued" } : item));
      } catch (failure) {
        failed += offline.length;
        for (const file of offline) retryable.current.set(file.id, file);
        setUploads((list) => list.map((item) => offline.some((file) => file.id === item.id) ? { ...item, status: "error", error: failureText(failure, "No se pudo guardar en el teléfono.") } : item));
      }
    }
    const queued = failed === 0 ? offline.length : 0;
    setMessage(failed > 0 ? { text: `${queue.length - failed} de ${queue.length} listos. Revisa los que fallaron.`, tone: "error" }
      : queued > 0 ? { text: `Sin señal: ${queued === 1 ? "1 archivo quedó guardado" : `${queued} archivos quedaron guardados`} en el teléfono y se enviará${queued === 1 ? "" : "n"} solo${queued === 1 ? "" : "s"} al volver la conexión.`, tone: "success" }
        : { text: queue.length === 1 ? "Archivo subido." : `${queue.length} archivos subidos.`, tone: "success" });
    if (queue.length > failed) onChanged?.();
    // El servidor puede tardar unos segundos en mostrar lo recién subido: se espera a verlo en la lista antes de quitar
    // la foto con su visto bueno (así no «desaparece» y vuelve a aparecer después).
    for (let check = 0; check < 6; check++) {
      const result = await load(target, search, check > 0);
      if (uploaded === 0 || searching || !result || result.totalFiles >= before + uploaded) break;
      await wait(2500);
    }
    setUploads((list) => list.filter((item) => item.status !== "done"));
  }
  async function retryFailed() {
    const files = uploads.filter((item) => item.status === "error").flatMap((item) => retryable.current.get(item.id) ?? []);
    if (files.length > 0) await send(files);
  }

  function open(file: DriveFile) {
    if (isImage(file) && httpUrl(file.url)) { setDialog({ kind: "preview", file }); return; }
    const url = httpUrl(file.url);
    if (!url) { setMessage({ text: "El archivo aún no tiene enlace. Actualiza la lista.", tone: "error" }); return; }
    setDialog(null);
    void Linking.openURL(url).catch(() => setMessage({ text: "No se pudo abrir el archivo en este teléfono.", tone: "error" }));
  }

  const meta = (file: DriveFile) => [fileIcon(file).label, sizeText(file.size), file.createdAt, file.responsibleName].filter(Boolean).join(" · ");
  const doneCount = uploads.filter((upload) => upload.status === "done").length;
  const active = uploads.find((upload) => upload.status === "uploading");
  const overall = uploads.length === 0 ? 0 : uploads.reduce((sum, upload) => sum + (upload.status === "error" || upload.status === "queued" ? 1 : uploadShare(upload, now)), 0) / uploads.length;
  // Lo que se sube a esta carpeta se ve en la cuadrícula desde el primer momento, con su avance.
  const pending = search ? [] : uploads.filter((upload) => sameFolder(upload.target, folderId) && (upload.status === "waiting" || upload.status === "uploading" || upload.status === "done"));

  return <View style={styles.screen}>
    <View style={[styles.bar, embedded && styles.barEmbedded]}>
      {folderId !== null || search || (!embedded && onClose) ? <IconButton name="arrow-back" label={folderId !== null ? "Volver a la carpeta anterior" : "Cerrar archivos"} disabled={uploading && folderId === null && !search} onPress={() => { goBack(); }} />
        : <View style={styles.barIcon}><Ionicons name="folder-open" size={20} color={palette.amber} accessible={false} /></View>}
      <View style={styles.barText}>
        <Text style={styles.barTitle} numberOfLines={1}>{search ? "Resultados" : current?.name ?? title}</Text>
        <View style={styles.crumbs}>
          <Pressable accessibilityRole="button" accessibilityLabel="Ir al inicio de los archivos" onPress={() => { setSearch(null); setQuery(""); setFolderId(null); }} hitSlop={6}>
            <Text style={[styles.crumb, path.length > 0 && styles.crumbLink]} numberOfLines={1}>{subtitle ?? "Archivos"}</Text>
          </Pressable>
          {path.map((folder, index) => <View key={String(folder.id)} style={styles.crumbItem}>
            <Ionicons name="chevron-forward" size={12} color={palette.textMuted} accessible={false} />
            <Pressable accessibilityRole="button" disabled={index === path.length - 1} onPress={() => setFolderId(folder.id)} hitSlop={6}>
              <Text style={[styles.crumb, index < path.length - 1 && styles.crumbLink]} numberOfLines={1}>{folder.name}</Text>
            </Pressable>
          </View>)}
        </View>
      </View>
      <IconButton name={view === "grid" ? "list-outline" : "grid-outline"} label={view === "grid" ? "Ver como lista" : "Ver como cuadrícula"} onPress={() => setView(view === "grid" ? "list" : "grid")} />
    </View>

    <View style={styles.searchRow}>
      <Ionicons name="search" size={18} color={palette.textMuted} accessible={false} />
      <TextInput value={query} onChangeText={setQuery} placeholder={current ? `Buscar en ${current.name}` : "Buscar archivos"} placeholderTextColor={palette.textMuted}
        returnKeyType="search" onSubmitEditing={() => setSearch(query.trim() || null)} style={styles.searchInput} accessibilityLabel="Buscar archivos" maxLength={120} />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" hitSlop={8} onPress={() => { setQuery(""); setSearch(null); }}>
        <Ionicons name="close-circle" size={18} color={palette.textMuted} accessible={false} />
      </Pressable> : null}
    </View>

    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} enabled={!uploading} colors={[palette.primary]} tintColor={palette.primary}
        onRefresh={() => { setRefreshing(true); void load(folderId, search, true); }} />}>
      {notice}
      {message ? <View style={[styles.message, message.tone === "error" ? styles.messageError : styles.messageOk]} accessibilityLiveRegion="polite">
        <Ionicons name={message.tone === "error" ? "alert-circle" : "checkmark-circle"} size={18} color={message.tone === "error" ? palette.danger : palette.success} accessible={false} />
        <Text style={[styles.messageText, { color: message.tone === "error" ? palette.danger : palette.success }]}>{message.text}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar mensaje" hitSlop={8} onPress={() => setMessage(null)}><Ionicons name="close" size={16} color={palette.textSecondary} accessible={false} /></Pressable>
      </View> : null}
      {uploads.length > 0 ? <View style={styles.uploads}>
        <View style={styles.uploadHead}>
          {uploading ? <ActivityIndicator size="small" color={palette.primary} /> : <Ionicons name="cloud-done-outline" size={18} color={palette.primary} accessible={false} />}
          <Text style={styles.uploadTitle}>{uploading ? `Subiendo ${Math.min(doneCount + 1, uploads.length)} de ${uploads.length}`
            : uploads.some((upload) => upload.status === "done") ? "Subido. Actualizando la lista…" : "Subida terminada"}</Text>
          <Text style={styles.uploadPercent}>{Math.round(overall * 100)} %</Text>
          {!uploading && !uploads.some((upload) => upload.status === "done") ? <Pressable accessibilityRole="button" accessibilityLabel="Ocultar" onPress={() => setUploads([])} hitSlop={8}><Ionicons name="close" size={16} color={palette.textSecondary} accessible={false} /></Pressable> : null}
        </View>
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(overall * 100) }}>
          <View style={[styles.progressFill, { width: `${Math.round(overall * 100)}%` }]} />
        </View>
        {active ? <Text style={styles.hint} numberOfLines={1}>{active.name}</Text> : null}
        {uploading ? <Text style={styles.hint}>No cierres esta pantalla hasta que termine.</Text> : null}
        {uploads.filter((upload) => upload.status === "error").map((upload) => <Text key={upload.id} style={styles.uploadError} numberOfLines={2}>✕ {upload.name}: {upload.error}</Text>)}
        {uploads.filter((upload) => upload.status === "queued").map((upload) => <Text key={upload.id} style={styles.hint} numberOfLines={1}>☁ {upload.name}: guardado, se enviará al volver la señal</Text>)}
        {!uploading && uploads.some((upload) => upload.status === "error" && retryable.current.has(upload.id)) ? <Button title="Reintentar los que fallaron" icon="refresh" variant="secondary" onPress={() => void retryFailed()} /> : null}
      </View> : null}
      {current?.readOnly ? <View style={styles.readOnly}><Ionicons name="lock-closed" size={14} color={palette.textSecondary} accessible={false} /><Text style={styles.hint}>Carpeta del sistema: solo para ver.</Text></View> : null}

      {loading && !listing ? <View style={styles.center}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando archivos…</Text></View>
        : error ? <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={36} color={palette.textMuted} accessible={false} />
          <Text style={styles.emptyTitle}>{error}</Text>
          <Button title="Reintentar" icon="refresh" variant="secondary" onPress={() => void load()} />
        </View> : <>
          {children.length > 0 ? <>
            <Text style={styles.section}>Carpetas</Text>
            <View style={styles.folderGrid}>
              {children.map((folder) => <Pressable key={String(folder.id)} accessibilityRole="button" accessibilityLabel={`Carpeta ${folder.name}, ${folder.fileCount} archivos`}
                onPress={() => setFolderId(folder.id)} onLongPress={canFolders && !folder.readOnly ? () => setDialog({ kind: "folder", folder }) : undefined}
                style={({ pressed }) => [styles.folder, pressed && styles.pressed]}>
                <View style={[styles.folderIcon, folder.readOnly && styles.folderIconLocked]}>
                  <Ionicons name={folder.readOnly ? "folder" : "folder-open"} size={22} color={folder.readOnly ? palette.textSecondary : palette.amber} accessible={false} />
                  {folder.readOnly ? <View style={styles.lock}><Ionicons name="lock-closed" size={9} color={palette.white} accessible={false} /></View> : null}
                </View>
                <View style={styles.grow}>
                  <Text style={styles.folderName} numberOfLines={2}>{folder.name}</Text>
                  <Text style={styles.hint}>{folder.fileCount === 1 ? "1 archivo" : `${folder.fileCount} archivos`}</Text>
                </View>
                {canFolders && !folder.readOnly ? <Pressable accessibilityRole="button" accessibilityLabel={`Opciones de ${folder.name}`} hitSlop={10} onPress={() => setDialog({ kind: "folder", folder })}>
                  <Ionicons name="ellipsis-vertical" size={16} color={palette.textSecondary} accessible={false} />
                </Pressable> : null}
              </Pressable>)}
            </View>
          </> : null}

          {files.length > 0 || pending.length > 0 ? <>
            <Text style={styles.section}>{search ? `Archivos con «${search}»` : "Archivos"} · {listing?.totalFiles ?? files.length}</Text>
            {view === "grid" ? <View style={styles.fileGrid}>
              {pending.map((upload) => <View key={upload.id} style={styles.tile} accessible accessibilityLabel={`${upload.name}: ${upload.status === "done" ? "subido" : "subiendo"}`}>
                <PendingThumb upload={upload} share={uploadShare(upload, now)} size={96} />
                <Text style={styles.tileName} numberOfLines={2}>{upload.name}</Text>
              </View>)}
              {files.map((file) => <Pressable key={file.id} accessibilityRole="button" accessibilityLabel={`${file.name}. ${meta(file)}`} onPress={() => setDialog({ kind: "file", file })}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                <Thumb file={file} size={96} />
                <Text style={styles.tileName} numberOfLines={2}>{file.name}</Text>
              </Pressable>)}
            </View> : <View style={styles.fileList}>
              {pending.map((upload) => <View key={upload.id} style={styles.row} accessible accessibilityLabel={`${upload.name}: ${upload.status === "done" ? "subido" : "subiendo"}`}>
                <PendingThumb upload={upload} share={uploadShare(upload, now)} size={44} />
                <View style={styles.grow}>
                  <Text style={styles.rowName} numberOfLines={1}>{upload.name}</Text>
                  <Text style={[styles.hint, upload.status === "done" && { color: palette.success }]} numberOfLines={1}>
                    {upload.status === "done" ? "Subido con éxito" : upload.status === "waiting" ? "En espera" : `Subiendo… ${Math.round(uploadShare(upload, now) * 100)} %`}</Text>
                </View>
              </View>)}
              {files.map((file) => <Pressable key={file.id} accessibilityRole="button" accessibilityLabel={`${file.name}. ${meta(file)}`} onPress={() => setDialog({ kind: "file", file })}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Thumb file={file} size={44} />
                <View style={styles.grow}>
                  <Text style={styles.rowName} numberOfLines={1}>{file.name}</Text>
                  <Text style={styles.hint} numberOfLines={1}>{meta(file)}</Text>
                </View>
                <Ionicons name="ellipsis-vertical" size={16} color={palette.textSecondary} accessible={false} />
              </Pressable>)}
            </View>}
            {listing && listing.page + 1 < listing.totalPages ? <Button title="Ver más archivos" variant="ghost" loading={loadingMore} onPress={() => void loadMore()} /> : null}
          </> : null}

          {!loading && children.length === 0 && files.length === 0 && pending.length === 0 ? <View style={styles.center}>
            <View style={styles.emptyIcon}><Ionicons name={search ? "search" : "folder-open-outline"} size={34} color={palette.primary} accessible={false} /></View>
            <Text style={styles.emptyTitle}>{search ? "Sin resultados" : current ? "Esta carpeta está vacía" : "Aún no hay archivos"}</Text>
            <Text style={styles.emptyText}>{search ? "Prueba con otra palabra." : canUpload ? "Sube fotos o documentos con el botón +." : "No hay nada que mostrar aquí."}</Text>
          </View> : null}
        </>}
    </ScrollView>

    {canUpload || (canFolders && folderId === null) ? <Pressable accessibilityRole="button" accessibilityLabel="Agregar archivos o carpeta" disabled={uploading || busy} onPress={() => setDialog({ kind: "add" })}
      style={({ pressed }) => [styles.fab, (uploading || busy) && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name="add" size={28} color={palette.white} accessible={false} />
    </Pressable> : null}

    {dialog?.kind === "add" ? <Sheet title="Agregar" subtitle={current ? `En ${current.name}` : "En la carpeta principal"} onClose={() => setDialog(null)}>
      {canUpload ? <>
        <Action icon="camera" label="Tomar foto" onPress={() => void pick("camera")} />
        <Action icon="images" label="Elegir de la galería" detail="Puedes elegir varias" onPress={() => void pick("library")} />
        <Action icon="document-attach" label="Subir documento" detail="PDF, Word, Excel o texto · hasta 25 MB" onPress={() => void pick("document")} />
      </> : null}
      {canFolders && folderId === null ? <Action icon="folder-open" label="Nueva carpeta" onPress={() => { setName(""); setDialog({ kind: "name", folder: null }); }} /> : null}
    </Sheet> : null}

    {dialog?.kind === "file" ? <Sheet title={dialog.file.name} subtitle={meta(dialog.file)} onClose={() => setDialog(null)}>
      <Action icon={isImage(dialog.file) ? "expand" : "open-outline"} label={isImage(dialog.file) ? "Ver imagen" : "Abrir archivo"} onPress={() => open(dialog.file)} />
      {canFolders && !current?.readOnly && (folderId !== null || movable.length > 0) ? <Action icon="folder-outline" label="Mover a otra carpeta" onPress={() => setDialog({ kind: "move", file: dialog.file })} /> : null}
      {canRemove ? <Action icon="trash-outline" label="Eliminar" tone={palette.danger} onPress={() => setDialog({ kind: "confirm", target: { file: dialog.file } })} /> : null}
    </Sheet> : null}

    {dialog?.kind === "folder" ? <Sheet title={dialog.folder.name} subtitle={dialog.folder.fileCount === 1 ? "1 archivo" : `${dialog.folder.fileCount} archivos`} onClose={() => setDialog(null)}>
      <Action icon="create-outline" label="Cambiar nombre" onPress={() => { setName(dialog.folder.name); setDialog({ kind: "name", folder: dialog.folder }); }} />
      <Action icon="trash-outline" label="Eliminar carpeta" tone={palette.danger} disabled={dialog.folder.fileCount > 0}
        detail={dialog.folder.fileCount > 0 ? "Primero mueve o borra sus archivos." : undefined} onPress={() => setDialog({ kind: "confirm", target: { folder: dialog.folder } })} />
    </Sheet> : null}

    {dialog?.kind === "name" ? <Sheet title={dialog.folder ? "Cambiar nombre" : "Nueva carpeta"} onClose={() => setDialog(null)}>
      <TextInput value={name} onChangeText={setName} placeholder="Ej.: Fotos de recepción" placeholderTextColor={palette.textMuted} autoFocus maxLength={120}
        style={styles.input} accessibilityLabel="Nombre de la carpeta" onSubmitEditing={() => undefined} />
      <Button title={dialog.folder ? "Guardar nombre" : "Crear carpeta"} icon="checkmark" loading={busy} disabled={busy || !name.trim() || /[/\\]/.test(name)}
        onPress={() => { const folder = dialog.folder; void run(() => folder ? apiRef.current.renameFolder(folder.id, name.trim()) : apiRef.current.createFolder(name.trim()).then(() => undefined),
          folder ? "Carpeta renombrada." : "Carpeta creada."); }} />
    </Sheet> : null}

    {dialog?.kind === "move" ? <Sheet title="Mover a…" subtitle={dialog.file.name} onClose={() => setDialog(null)}>
      <ScrollView style={styles.moveList}>
        {folderId !== null ? <Action icon="home-outline" label="Carpeta principal" onPress={() => { const file = dialog.file; void run(() => apiRef.current.moveFile(file.id, folderId, null), "Archivo movido."); }} /> : null}
        {movable.filter((folder) => !sameFolder(folder.id, folderId)).map((folder) => <Action key={String(folder.id)} icon="folder" label={folder.name} disabled={busy}
          onPress={() => { const file = dialog.file; void run(() => apiRef.current.moveFile(file.id, folderId, folder.id), `Archivo movido a ${folder.name}.`); }} />)}
      </ScrollView>
    </Sheet> : null}

    {dialog?.kind === "confirm" ? <Sheet title={"file" in dialog.target ? "¿Eliminar este archivo?" : "¿Eliminar esta carpeta?"}
      subtitle={"file" in dialog.target ? dialog.target.file.name : dialog.target.folder.name} onClose={() => setDialog(null)}>
      <Text style={styles.hint}>Esta acción no se puede deshacer desde la app.</Text>
      <View style={styles.confirmRow}>
        <View style={styles.grow}><Button title="Cancelar" variant="secondary" disabled={busy} onPress={() => setDialog(null)} /></View>
        <View style={styles.grow}><Button title="Eliminar" icon="trash-outline" variant="danger" loading={busy} disabled={busy} onPress={() => {
          const target = dialog.target;
          void run(() => "file" in target ? apiRef.current.deleteFile(target.file.id, folderId) : apiRef.current.deleteFolder(target.folder.id),
            "file" in target ? "Archivo eliminado." : "Carpeta eliminada.");
        }} /></View>
      </View>
    </Sheet> : null}

    {dialog?.kind === "preview" ? <Modal visible transparent={false} animationType="fade" onRequestClose={() => setDialog(null)}>
      <View style={styles.preview}>
        <View style={styles.previewBar}>
          <Text style={styles.previewTitle} numberOfLines={1}>{dialog.file.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Abrir original" hitSlop={8} onPress={() => { const url = httpUrl(dialog.file.url); if (url) void Linking.openURL(url).catch(() => undefined); }}>
            <Ionicons name="open-outline" size={22} color={palette.white} accessible={false} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar vista previa" hitSlop={8} onPress={() => setDialog(null)}>
            <Ionicons name="close" size={26} color={palette.white} accessible={false} />
          </Pressable>
        </View>
        <Image source={{ uri: httpUrl(dialog.file.url) ?? "" }} resizeMode="contain" style={styles.previewImage} accessibilityLabel={dialog.file.name} />
      </View>
    </Modal> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  barEmbedded: { paddingHorizontal: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, marginHorizontal: 12, marginTop: 8 },
  barIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: palette.amberSoft },
  barText: { flex: 1, minWidth: 0, gap: 2 },
  barTitle: { fontSize: 17, fontWeight: "800", color: palette.heading },
  crumbs: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 2 },
  crumbItem: { flexDirection: "row", alignItems: "center", gap: 2, maxWidth: 160 },
  crumb: { ...typography.caption, color: palette.textSecondary },
  crumbLink: { color: palette.primary, fontWeight: "700" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  searchInput: { flex: 1, fontSize: 15, color: palette.text, paddingVertical: 8 },
  content: { padding: 16, paddingBottom: 110, gap: 12 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: palette.textSecondary, marginTop: 4 },
  folderGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  folder: { flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  folderIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: palette.amberSoft },
  folderIconLocked: { backgroundColor: palette.track },
  lock: { position: "absolute", right: -3, bottom: -3, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: palette.textSecondary },
  folderName: { fontSize: 14, fontWeight: "800", color: palette.heading },
  fileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: 104, gap: 6, padding: 4, borderRadius: radius.md },
  tileName: { fontSize: 12, fontWeight: "600", color: palette.text },
  fileList: { borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.track },
  rowName: { fontSize: 14, fontWeight: "700", color: palette.heading },
  typeIcon: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 48 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: palette.heading, textAlign: "center" },
  emptyText: { ...typography.body, color: palette.textSecondary, textAlign: "center" },
  message: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md },
  messageOk: { backgroundColor: palette.successSoft },
  messageError: { backgroundColor: palette.dangerSoft },
  messageText: { flex: 1, fontSize: 13, fontWeight: "700" },
  uploads: { gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  uploadHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  uploadTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: palette.heading },
  uploadError: { ...typography.caption, color: palette.danger },
  uploadPercent: { fontSize: 13, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  pendingThumb: { borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  pendingShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "rgba(15,23,42,0.45)" },
  pendingShadeDone: { backgroundColor: "rgba(22,163,74,0.55)" },
  pendingText: { fontSize: 12, fontWeight: "800", color: palette.white },
  pendingTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: "rgba(255,255,255,0.35)" },
  pendingFill: { height: 4, backgroundColor: palette.white },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: palette.surface, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: palette.primary },
  readOnly: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.track },
  fab: { position: "absolute", right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary, boxShadow: "0px 6px 18px rgba(0,126,128,0.3)" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.5)" },
  sheet: { gap: 6, padding: 16, paddingBottom: 28, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: palette.surface, maxHeight: "85%" },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: palette.heading },
  action: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.md },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 15, fontWeight: "700", color: palette.heading },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text, marginBottom: 6 },
  moveList: { maxHeight: 360 },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  preview: { flex: 1, backgroundColor: "#000000" },
  previewBar: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12 },
  previewTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: palette.white },
  previewImage: { flex: 1, width: "100%" },
  hint: { ...typography.caption, color: palette.textSecondary },
  grow: { flex: 1, minWidth: 0 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 }
});
