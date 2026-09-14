import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Linking, Platform, Pressable, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Attachment } from "../../domain/models";
import { BodyText, Button, IconButton } from "../../ui/components";
import { palette } from "../../ui/theme";
import { errorMessage, httpUrl } from "./detailRules";
import { styles } from "./detailStyles";

export function Notice({ message, tone = "info", onDismiss }: { message: string; tone?: "info" | "error" | "warning" | "success"; onDismiss?: () => void }) {
  return (
    <View style={[styles.notice, tone === "error" && styles.noticeError, tone === "warning" && styles.noticeWarning, tone === "success" && styles.noticeSuccess]}>
      <View style={styles.row}>
        <Text accessibilityRole={tone === "error" ? "alert" : undefined} accessibilityLiveRegion="polite" style={[styles.grow, tone === "error" ? styles.errorText : styles.label]}>{message}</Text>
        {onDismiss ? <IconButton name="close-outline" label="Cerrar mensaje" onPress={onDismiss} /> : null}
      </View>
    </View>
  );
}

export function ChoiceButton({ label, selected, disabled = false, multiple = false, onPress }: { label: string; selected: boolean; disabled?: boolean; multiple?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole={multiple ? "checkbox" : "radio"} accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} aria-checked={selected} aria-disabled={disabled} style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, (disabled || pressed) && styles.disabled]}>
      <Ionicons name={multiple ? selected ? "checkbox" : "square-outline" : selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? palette.primary : palette.textMuted} accessible={false} />
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

export function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return <View style={styles.tight}><Text style={styles.caption}>{label}</Text><Text selectable style={styles.label}>{value?.trim() ? value : "No informado"}</Text></View>;
}

export function HttpLink({ url, label, onError }: { url: string; label: string; onError: (message: string) => void }) {
  const safe = httpUrl(url);
  return <Button title={label} icon="open-outline" variant="secondary" disabled={safe === null} onPress={() => { if (safe) void Linking.openURL(safe).catch((error: unknown) => onError(`No se pudo abrir el enlace: ${errorMessage(error)}`)); }} />;
}

function imageUri(value: string | null | undefined): string | null {
  const remote = httpUrl(value);
  if (remote) return remote;
  if (!value) return null;
  if (/^data:image\/(?:jpeg|png|webp|heic);base64,/i.test(value)) return value;
  if (Platform.OS === "web" && value.startsWith("blob:")) return value;
  if (Platform.OS !== "web" && value.startsWith("file:///")) return value;
  return null;
}

function AttachmentItem({ file, onPreview }: { file: Attachment; onPreview: (file: Attachment) => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const url = httpUrl(file.url);
  const original = imageUri(file.url);
  const thumbnail = imageUri(file.thumbnailUrl) ?? original;
  const image = file.type?.toLowerCase().startsWith("image/") === true;
  return (
    <View style={styles.attachment}>
      {image && thumbnail && !imageFailed ? <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar imagen: ${file.name}`} onPress={() => onPreview(file)} disabled={original === null} style={styles.previewPress}><Image source={{ uri: thumbnail }} resizeMode="contain" style={styles.photo} accessibilityLabel={file.name} onError={() => setImageFailed(true)} /></Pressable> : null}
      <Text selectable style={styles.label}>{file.name}</Text>
      {file.responsible?.name ? <Text style={styles.caption}>Adjuntado por {file.responsible.name}</Text> : null}
      {imageFailed ? <BodyText>Vista previa no disponible. Puedes intentar abrir el archivo original.</BodyText> : null}
      {url ? <HttpLink url={url} label={`Abrir ${file.name}`} onError={setLinkError} /> : <BodyText>Este archivo no tiene un enlace HTTP/HTTPS disponible.</BodyText>}
      {linkError ? <Notice message={linkError} tone="error" onDismiss={() => setLinkError(null)} /> : null}
    </View>
  );
}

export function AttachmentList({ files, emptyMessage = "Sin archivos confirmados." }: { files: Attachment[]; emptyMessage?: string }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [previewError, setPreviewError] = useState(false);
  return (
    <View style={styles.tight}>
      {files.length === 0 ? <BodyText>{emptyMessage}</BodyText> : files.map((file) => <AttachmentItem key={`${file.id}:${file.url}`} file={file} onPreview={(selected) => { setPreviewError(false); setPreview(selected); }} />)}
      <Modal visible={preview !== null} animationType="fade" onRequestClose={() => setPreview(null)}>
        <SafeAreaView style={styles.viewer}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle}>{preview?.name}</Text>
            <Button title="Cerrar imagen" icon="close-outline" variant="secondary" onPress={() => setPreview(null)} />
          </View>
          {previewError ? <Notice message="No se pudo cargar la imagen original." tone="warning" /> : preview && imageUri(preview.url) ? <Image source={{ uri: preview.url }} resizeMode="contain" style={styles.viewerImage} accessibilityLabel={preview.name} onError={() => setPreviewError(true)} /> : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}