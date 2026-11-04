import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Attachment } from "../../../domain/models";
import type { OfflineAttachment, OfflineController } from "../../../domain/offline";
import { DriveViewSwitch, GRID_GAP, useDriveView } from "../../../files/driveView";
import { canDownloadImage, downloadImage, ImageGalleryViewer, type GalleryAction, type GalleryImage } from "../../../files/ImageGalleryViewer";
import { PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { BodyText, Button, SectionTitle } from "../../../ui/components";
import { palette, radius } from "../../../ui/theme";
import { offlineAttachment, trustedLocalFile } from "../../offline/offlineUi";
import { OfflineFileCard } from "../../offline/OfflineFileCard";
import { Notice } from "../DetailUi";
import { styles as detailStyles } from "../detailStyles";
import { fileSizeLabel, isImageType, presentAttachment, sortedAttachments, type WorkspaceMode } from "./fileRules";
import type { WorkspaceFileDraft } from "./WorkspaceDraftStore";

type TileState = "saved" | "uploading" | "queued" | "failed" | "draft";
interface Entry {
  key: string; name: string; type?: string | null; size?: number; state: TileState;
  /** Dirección de la foto cuando no hace falta leer la copia local. */
  uri?: string; fullUri?: string; error?: string;
  file?: Attachment; local?: OfflineAttachment; draft?: WorkspaceFileDraft;
}

/** Velocidad supuesta para estimar el avance, igual que en el gestor de archivos: el envío no informa los bytes enviados. */
const UPLOAD_BYTES_PER_SECOND = 120 * 1024;

function useUploadShare(active: boolean, size: number | undefined): number {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) { setStartedAt(null); return; }
    setStartedAt(Date.now());
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  if (startedAt === null) return 0;
  const expected = Math.max(1500, ((size ?? 600 * 1024) / UPLOAD_BYTES_PER_SECOND) * 1000);
  // Llega al 90 % al tiempo estimado y se queda ahí hasta que el servidor confirma.
  return Math.min(0.9, ((now - startedAt) / expected) * 0.9);
}

/** Copia guardada en el dispositivo: se ve la foto aunque todavía no esté en el servidor o no haya señal. */
function useLocalUri(local: OfflineAttachment | undefined, readLocalFile: OfflineController["readLocalFile"] | undefined): string | undefined {
  const id = local?.offline.downloaded ? local.offline.localFileId : undefined;
  const image = isImageType(local?.type);
  const [uri, setUri] = useState<string | undefined>();
  useEffect(() => {
    let active = true;
    setUri(undefined);
    if (id && image && readLocalFile) {
      void readLocalFile(id).then((file) => { if (active && isImageType(file.mimeType) && trustedLocalFile(id, file, Platform.OS)) setUri(file.uri); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [id, image, readLocalFile]);
  return uri;
}

function fileKind(entry: Entry): { icon: ComponentProps<typeof Ionicons>["name"]; tone: string; soft: string; label: string } {
  const type = entry.type?.toLowerCase() ?? "";
  const name = entry.name.toLowerCase();
  if (type.startsWith("image/")) return { icon: "image", tone: palette.violet, soft: palette.violetSoft, label: "Imagen" };
  if (type.includes("pdf") || name.endsWith(".pdf")) return { icon: "document-text", tone: palette.danger, soft: palette.dangerSoft, label: "PDF" };
  if (type.includes("sheet") || type.includes("excel") || /\.(xlsx?|csv)$/.test(name)) return { icon: "grid", tone: palette.success, soft: palette.successSoft, label: "Planilla" };
  if (type.includes("word") || /\.docx?$/.test(name)) return { icon: "document", tone: palette.info, soft: palette.infoSoft, label: "Documento" };
  return { icon: "document-attach", tone: palette.textSecondary, soft: palette.track, label: "Archivo" };
}

function stateLabel(state: TileState, share: number): string {
  switch (state) {
    case "uploading": return `Subiendo ${Math.round(share * 100)} %`;
    case "queued": return "En cola";
    case "failed": return "No se subió";
    case "draft": return "Sin enviar";
    default: return "Guardado";
  }
}

function Thumb({ entry, size, uri, share }: { entry: Entry; size: number; uri?: string; share: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const kind = fileKind(entry);
  const shown = uri && failed !== uri ? uri : undefined;
  const pending = entry.state !== "saved";
  const icon = entry.state === "failed" ? "alert-circle" : entry.state === "queued" ? "cloud-upload-outline" : entry.state === "draft" ? "time-outline" : null;
  return <View style={[galleryStyles.thumb, { width: size, height: size, backgroundColor: shown ? palette.track : kind.soft }]}>
    {shown ? <Image source={{ uri: shown }} style={{ width: size, height: size }} accessible={false} onError={() => setFailed(shown)} />
      : <Ionicons name={kind.icon} size={Math.round(size * 0.42)} color={kind.tone} accessible={false} />}
    {pending ? <View style={[galleryStyles.shade, entry.state === "failed" && galleryStyles.shadeFailed, (entry.state === "queued" || entry.state === "draft") && galleryStyles.shadeQueued]}>
      {icon ? <Ionicons name={icon} size={size > 60 ? 28 : 20} color={palette.white} accessible={false} /> : <ActivityIndicator size="small" color={palette.white} />}
      {size > 60 ? <Text style={galleryStyles.shadeText}>{stateLabel(entry.state, share)}</Text> : null}
    </View> : null}
    {entry.state === "uploading" ? <View style={galleryStyles.track}><View style={[galleryStyles.fill, { width: `${Math.round(share * 100)}%` }]} /></View> : null}
  </View>;
}

function GalleryItem({ entry, view, size, tileStyle, readLocalFile, onLocalUri, onOpen }: { entry: Entry; view: "large" | "small" | "list"; size: number; tileStyle: object; readLocalFile: OfflineController["readLocalFile"] | undefined; onLocalUri: (key: string, uri: string) => void; onOpen: (entry: Entry, uri?: string) => void }) {
  const localUri = useLocalUri(entry.local, readLocalFile);
  useEffect(() => { if (localUri) onLocalUri(entry.key, localUri); }, [entry.key, localUri]);
  const uri = entry.uri ?? localUri;
  const share = useUploadShare(entry.state === "uploading", entry.size);
  const meta = [fileKind(entry).label, entry.size === undefined ? null : fileSizeLabel(entry.size), entry.state === "saved" ? null : stateLabel(entry.state, share)].filter(Boolean).join(" · ");
  const label = `${entry.name}. ${meta}`;
  if (view === "list") return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(entry, uri)} style={({ pressed }) => [galleryStyles.row, pressed && galleryStyles.pressed]}>
    <Thumb entry={entry} size={44} uri={uri} share={share} />
    <View style={galleryStyles.grow}>
      <Text style={galleryStyles.rowName} numberOfLines={1}>{entry.name}</Text>
      <Text style={[galleryStyles.meta, entry.state === "failed" && galleryStyles.metaFailed]} numberOfLines={1}>{meta}</Text>
    </View>
    <Ionicons name="ellipsis-vertical" size={16} color={palette.textSecondary} accessible={false} />
  </Pressable>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(entry, uri)} style={({ pressed }) => [galleryStyles.tile, tileStyle, pressed && galleryStyles.pressed]}>
    <Thumb entry={entry} size={size} uri={uri} share={share} />
    <Text style={[galleryStyles.tileName, entry.state === "failed" && galleryStyles.metaFailed]} numberOfLines={2}>{entry.name}</Text>
  </Pressable>;
}

export interface FileGalleryProps {
  saved: Attachment[];
  local: OfflineAttachment[];
  drafts: WorkspaceFileDraft[];
  uploadingDrafts: boolean;
  online: boolean;
  mode: WorkspaceMode;
  readLocalFile?: OfflineController["readLocalFile"];
  errorFor: (file: OfflineAttachment) => string | null;
  canDiscard: (file: OfflineAttachment) => boolean;
  canDelete: boolean;
  canRemoveDraft: boolean;
  onDelete?: (file: Attachment) => void;
  onDiscard: (file: OfflineAttachment) => void;
  onRemoveDraft: (id: string) => void;
  /** Botones junto a la vista (por ejemplo, actualizar). */
  action?: ReactNode;
  empty: ReactNode;
}

/** Archivos como en el gestor: fotos grandes, pequeñas o lista, con su avance mientras suben. Tocar uno abre sus opciones. */
export function FileGallery(props: FileGalleryProps) {
  const { view, setView, tileSize, tileStyle, onGridLayout } = useDriveView();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  // Copias locales ya leídas por cada foto: permiten verlas en la galería aunque aún no estén en el servidor.
  const [localUris, setLocalUris] = useState<Record<string, string>>({});
  const rememberLocalUri = (key: string, uri: string) => setLocalUris((current) => current[key] === uri ? current : { ...current, [key]: uri });

  const entries: Entry[] = [
    ...props.drafts.map((draft): Entry => ({ key: `draft:${draft.id}`, name: draft.name, type: draft.mimeType, size: draft.size, state: props.uploadingDrafts ? "uploading" : "draft", uri: isImageType(draft.mimeType) ? draft.uri : undefined, fullUri: isImageType(draft.mimeType) ? draft.uri : undefined, draft })),
    ...props.local.map((file): Entry => {
      const waiting = ["pending", "syncing"].includes(file.offline.status ?? "pending");
      return { key: `local:${file.id}`, name: file.name, type: file.type, size: file.size, state: waiting ? (props.online ? "uploading" : "queued") : "failed", error: props.errorFor(file) ?? undefined, file, local: file };
    }),
    ...sortedAttachments(props.saved).map((file): Entry => {
      const presented = presentAttachment(file, props.mode);
      const image = isImageType(presented.type);
      return { key: `saved:${file.id}:${file.url}`, name: file.name, type: presented.type, size: file.size, state: "saved", uri: image ? presented.thumbnailUrl || presented.url || undefined : undefined, fullUri: presented.url || undefined, file, local: offlineAttachment(file) ?? undefined };
    }),
  ];
  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
  const openUrl = selected?.state === "saved" ? selected.fullUri : undefined;
  const close = () => setSelectedKey(null);
  const viewable = (entry: Entry) => isImageType(entry.type) ? entry.fullUri ?? localUris[entry.key] ?? entry.uri : undefined;
  /** Una foto se abre directo en la galería, con sus opciones a la vista; los demás archivos muestran sus opciones. */
  const openEntry = (entry: Entry, uri?: string) => {
    if (uri && isImageType(entry.type)) { rememberLocalUri(entry.key, uri); setViewerKey(entry.key); }
    else setSelectedKey(entry.key);
  };
  const galleryImages: GalleryImage[] = entries.flatMap((entry) => {
    const uri = viewable(entry);
    if (!uri) return [];
    const leave = (action: () => void) => () => { setViewerKey(null); action(); };
    const actions: GalleryAction[] = [];
    if (canDownloadImage(uri)) actions.push({ icon: "download-outline", label: "Descargar", onPress: () => downloadImage(uri, entry.name) });
    if (entry.state === "saved" && entry.file && props.onDelete) { const file = entry.file; actions.push({ icon: "trash-outline", label: "Eliminar", danger: true, disabled: !props.canDelete, onPress: leave(() => props.onDelete?.(file)) }); }
    if (entry.local && entry.state !== "saved" && props.canDiscard(entry.local)) { const file = entry.local; actions.push({ icon: "trash-outline", label: "Descartar", danger: true, onPress: leave(() => props.onDiscard(file)) }); }
    if (entry.draft) { const id = entry.draft.id; actions.push({ icon: "trash-outline", label: "Quitar", danger: true, disabled: !props.canRemoveDraft, onPress: leave(() => props.onRemoveDraft(id)) }); }
    const status = entry.state === "uploading" ? "Subiendo" : entry.state === "queued" ? "En cola: se subirá al volver la conexión" : entry.state === "failed" ? entry.error ?? "No se subió" : entry.state === "draft" ? "Sin enviar" : null;
    return [{ key: entry.key, name: entry.name, uri, detail: status ?? (entry.size === undefined ? undefined : fileSizeLabel(entry.size)), actions }];
  });

  return <View style={galleryStyles.stack}>
    <View style={galleryStyles.header}>
      <Text style={[galleryStyles.title, galleryStyles.grow]} numberOfLines={1}>Archivos · {entries.length}</Text>
      {entries.length > 0 ? <DriveViewSwitch view={view} onChange={setView} /> : null}
      {props.action}
    </View>
    {entries.length === 0 ? props.empty : view === "list"
      ? <View style={galleryStyles.list}>{entries.map((entry) => <GalleryItem key={entry.key} entry={entry} view={view} size={44} tileStyle={tileStyle} readLocalFile={props.readLocalFile} onLocalUri={rememberLocalUri} onOpen={openEntry} />)}</View>
      : <View style={galleryStyles.grid} onLayout={onGridLayout}>{entries.map((entry) => <GalleryItem key={entry.key} entry={entry} view={view} size={tileSize} tileStyle={tileStyle} readLocalFile={props.readLocalFile} onLocalUri={rememberLocalUri} onOpen={openEntry} />)}</View>}

    {selected ? <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={detailStyles.modalOverlay}><View style={detailStyles.modalCard} accessibilityViewIsModal><ScrollView contentContainerStyle={detailStyles.modalContent}>
        <SectionTitle title={selected.name} subtitle={[fileKind(selected).label, selected.size === undefined ? null : fileSizeLabel(selected.size)].filter(Boolean).join(" · ")} />
        {selected.state === "uploading" ? <BodyText>Se está subiendo. Aparecerá como guardado al terminar.</BodyText> : null}
        {selected.state === "queued" ? <BodyText>Guardado en este dispositivo. Se subirá solo cuando vuelva la conexión.</BodyText> : null}
        {selected.state === "draft" ? <BodyText>Todavía no se envía. Usa «Guardar pendientes» o quítalo de la lista.</BodyText> : null}
        {selected.error ? <Notice message={selected.error} tone="warning" /> : null}
        {openUrl ? <Button title="Abrir archivo" icon="open-outline" onPress={() => { void Linking.openURL(openUrl).catch(() => undefined); close(); }} /> : null}
        {selected.local && selected.local.offline.downloaded ? <OfflineFileCard file={selected.local} readLocalFile={props.readLocalFile} actionsOnly /> : null}
        {selected.local && selected.state !== "saved" && props.canDiscard(selected.local) ? <Button title="Descartar este envío" icon="trash-outline" variant="secondary" onPress={() => { const file = selected.local!; close(); props.onDiscard(file); }} /> : null}
        {selected.draft ? <Button title="Quitar de la lista" icon="trash-outline" variant="secondary" disabled={!props.canRemoveDraft} onPress={() => { const id = selected.draft!.id; close(); props.onRemoveDraft(id); }} /> : null}
        {selected.state === "saved" && selected.file && props.onDelete ? <Button title="Eliminar archivo" accessibilityLabel={`Eliminar archivo guardado: ${selected.name}`} icon="trash-outline" variant="secondary" disabled={!props.canDelete} onPress={() => { const file = selected.file!; close(); props.onDelete?.(file); }} /> : null}
        <Button title="Cerrar" variant="ghost" onPress={close} />
      </ScrollView></View></View>
    </Modal> : null}

    {viewerKey !== null && galleryImages.some((image) => image.key === viewerKey) ? <ImageGalleryViewer images={galleryImages} initialKey={viewerKey} onClose={() => setViewerKey(null)} /> : null}
  </View>;
}

const galleryStyles = StyleSheet.create({
  stack: { gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: palette.textSecondary },
  grow: { flex: 1, minWidth: 0 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, overflow: "hidden" },
  tile: { gap: 6, borderRadius: radius.md },
  tileName: { fontSize: 12, fontWeight: "600", color: palette.text },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.track },
  rowName: { fontSize: 14, fontWeight: "700", color: palette.heading },
  meta: { fontSize: 12, lineHeight: 18, fontWeight: "500", color: palette.textSecondary },
  metaFailed: { color: palette.danger },
  pressed: { opacity: 0.7 },
  thumb: { borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  shade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "rgba(15,23,42,0.45)" },
  shadeFailed: { backgroundColor: "rgba(220,38,38,0.6)" },
  shadeQueued: { backgroundColor: "rgba(217,119,6,0.6)" },
  shadeText: { fontSize: 12, fontWeight: "800", color: palette.white, textAlign: "center" },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: "rgba(255,255,255,0.35)" },
  fill: { height: 4, backgroundColor: palette.white },
});
