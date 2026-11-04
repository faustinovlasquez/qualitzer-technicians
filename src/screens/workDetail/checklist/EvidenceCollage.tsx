import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Attachment } from "../../../domain/models";
import { canDownloadImage, downloadImage, ImageGalleryViewer, type GalleryAction, type GalleryImage } from "../../../files/ImageGalleryViewer";
import { palette, radius } from "../../../ui/theme";
import { httpUrl } from "../detailRules";

const VISIBLE = 8;
const isImage = (file: Attachment) => file.type?.toLowerCase().startsWith("image/") === true;
const isQueued = (file: Attachment) => String(file.id).startsWith("local-");

function Tile({ file, extra, label, onPress }: { file: Attachment; extra: number; label: string; onPress: () => void }) {
  const candidates = [httpUrl(file.thumbnailUrl), isImage(file) ? httpUrl(file.url) : null].filter((url, index, all): url is string => url !== null && all.indexOf(url) === index);
  const [attempt, setAttempt] = useState(0);
  const uri = candidates[attempt];
  const queued = isQueued(file);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [collageStyles.tile, pressed && collageStyles.pressed]}>
    {uri ? <Image source={{ uri }} style={collageStyles.image} accessible={false} onError={() => setAttempt((value) => value + 1)} />
      : <Ionicons name={queued ? "cloud-upload-outline" : isImage(file) ? "image-outline" : "document-text-outline"} size={26} color={palette.textSecondary} accessible={false} />}
    {extra > 0 ? <View style={collageStyles.more}><Text style={collageStyles.moreText}>+{extra}</Text></View> : null}
  </Pressable>;
}

/** Mosaico compacto de la evidencia del paso: solo las miniaturas. Una foto abre la galería; lo demás, el gestor del paso. */
export function EvidenceCollage({ files, manageLabel, onManage }: { files: Attachment[]; manageLabel: string; onManage: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (files.length === 0) return null;
  const viewable = (file: Attachment) => isImage(file) && !isQueued(file) ? httpUrl(file.url) : null;
  const images: GalleryImage[] = files.flatMap((file) => {
    const uri = viewable(file);
    if (!uri) return [];
    const actions: GalleryAction[] = [];
    if (canDownloadImage(uri)) actions.push({ icon: "download-outline", label: "Descargar", onPress: () => downloadImage(uri, file.name) });
    actions.push({ icon: "albums-outline", label: manageLabel, onPress: () => { setOpenId(null); onManage(); } });
    return [{ key: String(file.id), name: file.name, uri, actions }];
  });
  const shown = files.slice(0, VISIBLE);
  const hidden = files.length - shown.length;
  return <View style={collageStyles.grid} testID="evidence-collage">
    {shown.map((file, index) => <Tile key={String(file.id)} file={file} extra={index === shown.length - 1 ? hidden : 0}
      label={isQueued(file) ? `${file.name}: pendiente de subir` : `Ver ${file.name}`}
      onPress={() => { if (viewable(file)) setOpenId(String(file.id)); else onManage(); }} />)}
    {openId !== null ? <ImageGalleryViewer images={images} initialKey={openId} onClose={() => setOpenId(null)} /> : null}
  </View>;
}

const collageStyles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 12, paddingBottom: 12 },
  tile: { width: "23.5%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  image: { width: "100%", height: "100%" },
  more: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,23,42,0.55)" },
  moreText: { fontSize: 18, fontWeight: "800", color: palette.white },
  pressed: { opacity: 0.7 },
});
