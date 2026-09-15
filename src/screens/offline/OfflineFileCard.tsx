import { useEffect, useRef, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import type { LocalPhoto } from "../../domain/models";
import type { OfflineAttachment, OfflineController } from "../../domain/offline";
import { Badge, BodyText, Button } from "../../ui/components";
import { Notice } from "../workDetail/DetailUi";
import { errorMessage } from "../workDetail/detailRules";
import { styles } from "../workDetail/detailStyles";
import { fileSizeLabel } from "../workDetail/files/fileRules";
import { operationStatusLabels, trustedLocalFile } from "./offlineUi";

export interface OfflineFileCardProps {
  file: OfflineAttachment;
  readLocalFile?: OfflineController["readLocalFile"];
  actionsOnly?: boolean;
}

export function OfflineFileCard({ file, readLocalFile, actionsOnly = false }: OfflineFileCardProps) {
  const [preview, setPreview] = useState<LocalPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const localId = file.offline.localFileId;
  async function open(download: boolean): Promise<void> {
    if (!readLocalFile || !localId || lock.current || !file.offline.downloaded) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const local = await readLocalFile(localId);
      if (!active.current) return;
      if (!trustedLocalFile(localId, local, Platform.OS)) throw new Error("No se recibió una copia local válida para este archivo.");
      if (!download && /^image\/(jpeg|png|webp|heic|heif)$/i.test(local.mimeType)) setPreview(local);
      else if (Platform.OS === "web") {
        const link = document.createElement("a");
        link.href = local.uri;
        link.download = local.name;
        link.rel = "noopener";
        link.click();
      } else throw new Error("La vista local nativa admite imágenes. Este documento sigue protegido en el dispositivo; su apertura con otra aplicación aún no está disponible.");
    } catch (failure) { if (active.current) setError(`No se pudo abrir la copia local: ${errorMessage(failure)}`); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  return <View style={actionsOnly ? styles.tight : styles.attachment}>
    {!actionsOnly ? <>
    <Text selectable style={styles.label}>{file.name}</Text>
    <Badge label={file.offline.confirmed ? "Confirmado" : `Pendiente · ${operationStatusLabels[file.offline.status ?? "pending"]}`} tone={file.offline.confirmed ? "success" : "warning"} />
    <BodyText>{file.size === undefined ? "Tamaño no informado" : fileSizeLabel(file.size)} · {file.offline.downloaded ? "Copia en este dispositivo" : "Bytes no descargados · requiere conexión"}</BodyText>
    {!file.offline.confirmed ? <BodyText>No cuenta como evidencia confirmada. Su copia pendiente no se puede eliminar desde aquí.</BodyText> : null}
    </> : null}
    <View style={styles.row}>
      <Button title="Abrir copia local" variant="secondary" loading={busy} disabled={!localId || !readLocalFile || !file.offline.downloaded || busy} onPress={() => void open(false)} />
      {Platform.OS === "web" ? <Button title="Descargar copia" variant="ghost" disabled={!localId || !readLocalFile || !file.offline.downloaded || busy} onPress={() => void open(true)} /> : null}
    </View>
    {error ? <Notice message={error} tone="error" onDismiss={() => setError(null)} /> : null}
    <Modal visible={preview !== null} animationType="fade" onRequestClose={() => setPreview(null)}>
      <SafeAreaView style={styles.viewer}>
        <View style={styles.viewerHeader}><Text style={styles.viewerTitle}>{preview?.name}</Text><Button title="Cerrar imagen" variant="secondary" onPress={() => setPreview(null)} /></View>
        {preview ? <Image source={{ uri: preview.uri }} resizeMode="contain" style={styles.viewerImage} accessibilityLabel={preview.name} onError={() => { setPreview(null); setError("No se pudo mostrar la imagen. La copia local sigue conservada."); }} /> : null}
      </SafeAreaView>
    </Modal>
  </View>;
}