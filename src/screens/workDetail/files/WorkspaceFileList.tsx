import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Attachment } from "../../../domain/models";
import { BodyText, Button, IconButton } from "../../../ui/components";
import { palette } from "../../../ui/theme";
import { AttachmentList, Notice } from "../DetailUi";
import { styles } from "../detailStyles";
import { fileSizeLabel, isImageType, presentAttachment, sortedAttachments, type WorkspaceMode } from "./fileRules";
import type { WorkspaceFileDraft } from "./WorkspaceDraftStore";
import { workspaceStyles } from "./workspaceStyles";

function DraftTile({ file, disabled, onRemove, onPreview }: { file: WorkspaceFileDraft; disabled: boolean; onRemove: () => void; onPreview: () => void }) {
  const [failed, setFailed] = useState(false);
  return <View style={workspaceStyles.draftRow}>
    {isImageType(file.mimeType) && !failed ? <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar archivo pendiente: ${file.name}`} onPress={onPreview}><Image source={{ uri: file.uri }} style={workspaceStyles.thumbnail} resizeMode="cover" onError={() => setFailed(true)} accessible={false} /></Pressable> : <View style={workspaceStyles.thumbnail}><Ionicons name={file.mimeType === "application/pdf" ? "document-text-outline" : "document-outline"} size={26} color={palette.primary} accessible={false} /></View>}
    <View style={styles.grow}>
      <Text selectable numberOfLines={2} style={styles.label}>{file.name}</Text>
      <Text style={styles.caption}>{fileSizeLabel(file.size)} · {file.uploaded ? "Transferido · limpiar copia" : "Sin guardar"}</Text>
      {failed ? <Text style={styles.caption}>Vista previa no disponible</Text> : null}
    </View>
    <IconButton label={`${file.uploaded ? "Limpiar copia local de" : "Quitar del borrador"} ${file.name}`} name="trash-outline" disabled={disabled} onPress={onRemove} />
  </View>;
}

export function PendingFileList({ files, disabled, onRemove }: { files: WorkspaceFileDraft[]; disabled: boolean; onRemove: (id: string) => void }) {
  const [preview, setPreview] = useState<WorkspaceFileDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const selected = files.find((file) => file.id === preview?.id);
  return <View style={styles.tight}>
    <View style={styles.tight}>{files.map((file) => <DraftTile key={file.id} file={file} disabled={disabled} onRemove={() => onRemove(file.id)} onPreview={() => { setFailed(false); setPreview(file); }} />)}</View>
    <Modal visible={selected !== undefined} animationType="fade" onRequestClose={() => setPreview(null)}>
      <SafeAreaView style={styles.viewer} accessibilityViewIsModal>
        <View style={styles.viewerHeader}><Text style={styles.viewerTitle}>{selected?.name}</Text><Button title="Cerrar vista previa" icon="close-outline" variant="secondary" onPress={() => setPreview(null)} /></View>
        {failed ? <Notice message="No se pudo ampliar esta imagen." tone="warning" /> : selected ? <Image source={{ uri: selected.uri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={selected.name} onError={() => setFailed(true)} /> : null}
      </SafeAreaView>
    </Modal>
  </View>;
}

export function SavedFileList({ files, mode, canDelete, onDelete }: { files: Attachment[]; mode: WorkspaceMode; canDelete: boolean; onDelete?: (file: Attachment) => void }) {
  return <View style={workspaceStyles.grid}>{sortedAttachments(files).map((file) => <View key={`${file.id}:${file.url}`} style={workspaceStyles.tile}>
    <AttachmentList files={[presentAttachment(file, mode)]} />
    {onDelete ? <Button title="Eliminar archivo" accessibilityLabel={`Eliminar archivo guardado: ${file.name}`} icon="trash-outline" variant="secondary" disabled={!canDelete} onPress={() => onDelete(file)} /> : null}
  </View>)}</View>;
}