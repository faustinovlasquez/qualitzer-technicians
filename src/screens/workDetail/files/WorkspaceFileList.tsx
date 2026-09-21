import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Attachment } from "../../../domain/models";
import type { OfflineController } from "../../../domain/offline";
import { offlineAttachment, trustedLocalFile } from "../../offline/offlineUi";
import { OfflineFileCard } from "../../offline/OfflineFileCard";
import { BodyText, Button, IconButton } from "../../../ui/components";
import { palette } from "../../../ui/theme";
import { AttachmentList, Notice } from "../DetailUi";
import { styles } from "../detailStyles";
import { fileSizeLabel, isImageType, presentAttachment, sortedAttachments, type WorkspaceMode } from "./fileRules";
import type { WorkspaceFileDraft } from "./WorkspaceDraftStore";
import { workspaceStyles } from "./workspaceStyles";

function DraftTile({ file, disabled, onRemove, onPreview, expanded = false }: { file: WorkspaceFileDraft; disabled: boolean; onRemove: () => void; onPreview: () => void; expanded?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <View style={expanded ? workspaceStyles.tile : workspaceStyles.draftRow}>
    {isImageType(file.mimeType) && !failed ? <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar archivo pendiente: ${file.name}`} onPress={onPreview}><Image source={{ uri: file.uri }} style={expanded ? styles.photo : workspaceStyles.thumbnail} resizeMode={expanded ? "contain" : "cover"} onError={() => setFailed(true)} accessible={false} /></Pressable> : <View style={expanded ? workspaceStyles.document : workspaceStyles.thumbnail}><Ionicons name={file.mimeType === "application/pdf" ? "document-text-outline" : "document-outline"} size={26} color={palette.primary} accessible={false} /></View>}
    <View style={expanded ? styles.tight : styles.grow}>
      <Text selectable numberOfLines={2} style={styles.label}>{file.name}</Text>
      <Text style={styles.caption}>{fileSizeLabel(file.size)} · {file.uploaded ? "Transferido · limpiar copia" : "Sin guardar"}</Text>
      {failed ? <Text style={styles.caption}>Vista previa no disponible</Text> : null}
    </View>
    <IconButton label={`${file.uploaded ? "Limpiar copia local de" : "Quitar del borrador"} ${file.name}`} name="trash-outline" disabled={disabled} onPress={onRemove} />
  </View>;
}

export function PendingFileList({ files, disabled, onRemove, expanded = false }: { files: WorkspaceFileDraft[]; disabled: boolean; onRemove: (id: string) => void; expanded?: boolean }) {
  const [preview, setPreview] = useState<WorkspaceFileDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const selected = files.find((file) => file.id === preview?.id);
  return <View style={styles.tight}>
    <View style={expanded ? workspaceStyles.grid : styles.tight}>{files.map((file) => <DraftTile key={file.id} file={file} expanded={expanded} disabled={disabled} onRemove={() => onRemove(file.id)} onPreview={() => { setFailed(false); setPreview(file); }} />)}</View>
    <Modal visible={selected !== undefined} animationType="fade" onRequestClose={() => setPreview(null)}>
      <SafeAreaView style={styles.viewer} accessibilityViewIsModal>
        <View style={styles.viewerHeader}><Text style={styles.viewerTitle}>{selected?.name}</Text><Button title="Cerrar vista previa" icon="close-outline" variant="secondary" onPress={() => setPreview(null)} /></View>
        {failed ? <Notice message="No se pudo ampliar esta imagen." tone="warning" /> : selected ? <Image source={{ uri: selected.uri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={selected.name} onError={() => setFailed(true)} /> : null}
      </SafeAreaView>
    </Modal>
  </View>;
}

interface SavedFileProps { file: Attachment; mode: WorkspaceMode; canDelete: boolean; onDelete?: (file: Attachment) => void; readLocalFile?: OfflineController["readLocalFile"]; }

function SavedFileTile({ file, mode, canDelete, onDelete, readLocalFile }: SavedFileProps) {
  const localFile = offlineAttachment(file);
  const localId = localFile?.offline.downloaded ? localFile.offline.localFileId : undefined;
  const [localPreview, setLocalPreview] = useState<{ id: string; uri: string; reader: OfflineController["readLocalFile"] } | null>(null);
  useEffect(() => {
    let active = true;
    if (localId && readLocalFile && isImageType(file.type)) {
      void readLocalFile(localId).then((local) => {
        if (active && isImageType(local.mimeType) && trustedLocalFile(localId, local, Platform.OS)) setLocalPreview({ id: localId, uri: local.uri, reader: readLocalFile });
      }).catch(() => { if (active) setLocalPreview(null); });
    } else setLocalPreview(null);
    return () => { active = false; };
  }, [localId, readLocalFile, file.type]);
  const presented = presentAttachment(file, mode);
  const preview = localPreview?.id === localId && localPreview?.reader === readLocalFile ? localPreview?.uri : undefined;
  return <View style={workspaceStyles.tile}>
    <AttachmentList key={preview ?? presented.url} files={[preview ? { ...presented, url: presented.url || preview, thumbnailUrl: preview } : presented]} />
    {localFile && localId && !isImageType(file.type) ? <OfflineFileCard file={localFile} readLocalFile={readLocalFile} actionsOnly /> : null}
    {onDelete ? <Button title="Eliminar archivo" accessibilityLabel={`Eliminar archivo guardado: ${file.name}`} icon="trash-outline" variant="secondary" disabled={!canDelete} onPress={() => onDelete(file)} /> : null}
  </View>;
}

export function SavedFileList({ files, ...props }: Omit<SavedFileProps, "file"> & { files: Attachment[] }) {
  return <View style={workspaceStyles.grid}>{sortedAttachments(files).map((file) => <SavedFileTile key={`${file.id}:${file.url}`} {...props} file={file} />)}</View>;
}