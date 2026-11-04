import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal as Modal } from "../security/DeviceSecurityContext";
import { palette, radius } from "../ui/theme";

export interface GalleryAction {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}
export interface GalleryImage {
  key: string;
  name: string;
  uri: string;
  /** Estado o datos de la foto, debajo del nombre. */
  detail?: string;
  actions: GalleryAction[];
}

const isRemote = (uri: string) => /^https?:\/\//i.test(uri);

/** Se puede descargar en el navegador, o abrir en el teléfono si la foto ya está en el servidor. */
export function canDownloadImage(uri: string): boolean {
  return Platform.OS === "web" || isRemote(uri);
}

export function downloadImage(uri: string, name: string): void {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const link = document.createElement("a");
    link.href = uri;
    link.download = name;
    link.target = "_blank";
    link.rel = "noopener";
    link.click();
    return;
  }
  void Linking.openURL(uri).catch(() => undefined);
}

/** Galería a pantalla completa: se pasa de una foto a otra deslizando y sus opciones están a la vista. */
export function ImageGalleryViewer({ images, initialKey, onClose }: { images: GalleryImage[]; initialKey: string; onClose: () => void }) {
  const window = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(window.width);
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((image) => image.key === initialKey)));
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const scroll = useRef<ScrollView>(null);
  const placed = useRef(false);
  const current = Math.min(index, Math.max(0, images.length - 1));
  const image = images[current];

  function go(next: number): void {
    if (next < 0 || next >= images.length) return;
    setIndex(next);
    scroll.current?.scrollTo({ x: next * pageWidth, animated: true });
  }
  const goRef = useRef(go);
  goRef.current = go;
  const indexRef = useRef(current);
  indexRef.current = current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // En el navegador también se navega con las flechas del teclado y se cierra con Esc.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof globalThis.addEventListener !== "function") return;
    const onKey = (event: Event) => {
      const key = (event as Event & { key?: string }).key;
      if (key === "ArrowRight") goRef.current(indexRef.current + 1);
      else if (key === "ArrowLeft") goRef.current(indexRef.current - 1);
      else if (key === "Escape") closeRef.current();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    if (pageWidth <= 0) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    if (next !== indexRef.current && next >= 0 && next < images.length) setIndex(next);
  }

  if (!image) return null;
  return <Modal visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <SafeAreaView style={viewerStyles.screen} testID="image-gallery" accessibilityViewIsModal>
      <View style={viewerStyles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar galería" hitSlop={8} onPress={onClose} style={({ pressed }) => [viewerStyles.barButton, pressed && viewerStyles.pressed]}>
          <Ionicons name="close" size={26} color={palette.white} accessible={false} />
        </Pressable>
        <View style={viewerStyles.barText}>
          <Text style={viewerStyles.title} numberOfLines={1}>{image.name}</Text>
          <Text style={viewerStyles.detail} numberOfLines={2} accessibilityLiveRegion="polite">{images.length > 1 ? `${current + 1} de ${images.length}` : ""}{images.length > 1 && image.detail ? " · " : ""}{image.detail ?? ""}</Text>
        </View>
      </View>

      <View style={viewerStyles.stage} onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width <= 0) return;
        setPageWidth(width);
        // La galería abre en la foto tocada, sin animar el recorrido hasta ella.
        scroll.current?.scrollTo({ x: indexRef.current * width, animated: false });
        placed.current = true;
      }}>
        <ScrollView ref={scroll} horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={32} onScroll={onScroll} style={viewerStyles.pager} testID="image-gallery-pager">
          {images.map((item, position) => <View key={item.key} style={[viewerStyles.page, { width: pageWidth }]}>
            {/* Solo se cargan la foto visible y sus vecinas, para no gastar memoria en carpetas grandes. */}
            {Math.abs(position - current) > 1 ? null : failed.has(item.key)
              ? <View style={viewerStyles.failed}><Ionicons name="image-outline" size={40} color={palette.onDark} accessible={false} /><Text style={viewerStyles.detail}>No se pudo mostrar esta imagen.</Text></View>
              : <Image source={{ uri: item.uri }} style={viewerStyles.image} resizeMode="contain" accessibilityLabel={item.name} onError={() => setFailed((set) => new Set(set).add(item.key))} />}
          </View>)}
        </ScrollView>
        {Platform.OS === "web" && current > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Foto anterior" onPress={() => go(current - 1)} style={({ pressed }) => [viewerStyles.arrow, viewerStyles.arrowLeft, pressed && viewerStyles.pressed]}>
          <Ionicons name="chevron-back" size={26} color={palette.white} accessible={false} />
        </Pressable> : null}
        {Platform.OS === "web" && current < images.length - 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Foto siguiente" onPress={() => go(current + 1)} style={({ pressed }) => [viewerStyles.arrow, viewerStyles.arrowRight, pressed && viewerStyles.pressed]}>
          <Ionicons name="chevron-forward" size={26} color={palette.white} accessible={false} />
        </Pressable> : null}
      </View>

      {image.actions.length > 0 ? <View style={viewerStyles.actions}>
        {image.actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={{ disabled: action.disabled === true }} disabled={action.disabled} onPress={action.onPress}
          style={({ pressed }) => [viewerStyles.action, (pressed || action.disabled) && viewerStyles.pressed]}>
          <Ionicons name={action.icon} size={22} color={action.danger ? "#FF9A9A" : palette.white} accessible={false} />
          <Text style={[viewerStyles.actionLabel, action.danger && viewerStyles.actionDanger]} numberOfLines={1}>{action.label}</Text>
        </Pressable>)}
      </View> : null}
    </SafeAreaView>
  </Modal>;
}

const viewerStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A1A22" },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 8 },
  barButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  barText: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: "700", color: palette.white },
  detail: { fontSize: 12, lineHeight: 18, fontWeight: "500", color: palette.onDark },
  stage: { flex: 1, minHeight: 0 },
  pager: { flex: 1 },
  page: { height: "100%", alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  failed: { alignItems: "center", gap: 8, padding: 24 },
  arrow: { position: "absolute", top: "50%", marginTop: -24, width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)" },
  arrowLeft: { left: 10 },
  arrowRight: { right: 10 },
  actions: { flexDirection: "row", justifyContent: "space-around", gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.14)" },
  action: { flex: 1, minWidth: 0, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: radius.sm, paddingVertical: 6 },
  actionLabel: { fontSize: 12, fontWeight: "700", color: palette.white },
  actionDanger: { color: "#FF9A9A" },
  pressed: { opacity: 0.55 },
});
