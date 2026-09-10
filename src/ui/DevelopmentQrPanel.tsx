import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";
import { Button, IconButton } from "./components";
import { palette, radius, theme, typography } from "./theme";

const connectionSchema = z.object({
  expoUrl: z.string().regex(/^exp:\/\/(?:localhost|\d{1,3}(?:\.\d{1,3}){3}):[1-9]\d{0,4}$/),
  gatewayUrl: z.string().regex(/^http:\/\/(?:localhost|\d{1,3}(?:\.\d{1,3}){3}):[1-9]\d{0,4}$/),
  qrDataUrl: z.string().max(100_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  metroReachable: z.boolean().optional(),
  lanAvailable: z.boolean().optional(),
  message: z.string().max(500).optional(),
});
type DevelopmentConnection = z.infer<typeof connectionSchema>;
export interface DevelopmentQrPanelProps { gatewayUrl: string; }

export function DevelopmentQrPanel(props: DevelopmentQrPanelProps) {
  return __DEV__ ? <DevelopmentQrPanelContent key={props.gatewayUrl} {...props} /> : null;
}

function DevelopmentQrPanelContent({ gatewayUrl }: DevelopmentQrPanelProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [connection, setConnection] = useState<DevelopmentConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(false);
  const desktop = Platform.OS === "web" && width >= 1100;
  const qrSize = Math.min(280, Math.max(144, width - 88));

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 5_000);
    setLoading(true);
    setError(null);
    setLinkError(null);
    async function load(): Promise<void> {
      try {
        const url = new URL(gatewayUrl);
        if (!/^https?:\/\//i.test(gatewayUrl) || !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
            url.search || url.hash || url.pathname !== "/" || /[\s\u0000-\u001f\u007f\\]/.test(gatewayUrl)) throw new Error("INVALID_GATEWAY");
        const response = await fetch(`${url.origin}/api/development/connection`, {
          headers: { Accept: "application/json" }, credentials: "omit", redirect: "error", signal: controller.signal,
        });
        if (!response.ok) throw new Error("DEVELOPMENT_CONNECTION_UNAVAILABLE");
        const data: unknown = await response.json();
        const result = connectionSchema.parse(data);
        if (active) setConnection(result);
      } catch {
        if (active) {
          setConnection(null);
          setError("El QR está disponible sólo con la pasarela de desarrollo iniciada. Comprueba la conexión y pulsa Actualizar para reintentar.");
        }
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [gatewayUrl, refresh]);

  async function openExpo(): Promise<void> {
    if (!connection) return;
    setLinkError(null);
    try { await Linking.openURL(connection.expoUrl); }
    catch { setLinkError("No se pudo abrir Expo Go. Instálalo en el teléfono y escanea el QR desde otro dispositivo o introduce la URL de Expo manualmente."); }
  }

  const launcher = desktop ? (
    <Pressable accessibilityRole="button" accessibilityLabel="Abrir en Expo Go: ver QR, conexión y opciones de actualización" onPress={() => setVisible(true)} style={({ pressed }) => [styles.compact, pressed && styles.pressed]}>
      <Text style={styles.compactTitle}>Abrir en Expo Go</Text>
      {connection ? <Image source={{ uri: connection.qrDataUrl }} style={styles.compactQr} resizeMode="contain" accessibilityLabel="Código QR para abrir el proyecto en Expo Go" /> : (
        <View style={styles.compactPlaceholder}>
          {loading ? <ActivityIndicator color={palette.primary} /> : null}
          <Text style={styles.caption}>{loading ? "Preparando QR…" : "QR no disponible. Pulsa para reintentar."}</Text>
        </View>
      )}
      <Text style={[styles.caption, styles.centerText]}>{connection?.lanAvailable === false ? "Sin LAN · sólo este equipo" : connection?.metroReachable === false ? "Metro sin respuesta" : "Desarrollo · misma Wi-Fi"}</Text>
      <Text style={styles.compactAction}>Conexión y actualizar</Text>
    </Pressable>
  ) : (
    <Pressable accessibilityRole="button" accessibilityLabel="Mostrar QR e instrucciones para Expo Go" onPress={() => setVisible(true)} style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
      <Text style={styles.pillText}>QR · Expo Go</Text>
    </Pressable>
  );

  return <>
    {Platform.OS === "web" ? (
      <div style={{ position: "fixed", right: Math.max(20, insets.right), bottom: 96 + insets.bottom, zIndex: 1000 }}>{launcher}</div>
    ) : (
      <View pointerEvents="box-none" style={[styles.nativeDock, { right: Math.max(20, insets.right), bottom: 96 + insets.bottom }]}>{launcher}</View>
    )}
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <SafeAreaView style={styles.modalOverlay}>
        <View accessibilityViewIsModal style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.heading}>
              <Text style={styles.overline}>SÓLO DESARROLLO</Text>
              <Text accessibilityRole="header" style={styles.title}>Abrir en Expo Go</Text>
            </View>
            <IconButton name="close-outline" label="Cerrar conexión de Expo Go" onPress={() => setVisible(false)} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            {connection ? <>
              <Image source={{ uri: connection.qrDataUrl }} style={[styles.modalQr, { width: qrSize, height: qrSize }]} resizeMode="contain" accessibilityLabel="Código QR para abrir el proyecto en Expo Go" />
              {connection.lanAvailable === false ? <Text accessibilityRole="alert" style={styles.warning}>{connection.message ?? "No se detectó una LAN privada. localhost sólo funciona en este equipo, no desde el teléfono."}</Text> : null}
              <Text style={[styles.status, connection.metroReachable === false && styles.warning]}>
                {connection.metroReachable === true ? "Metro responde en este equipo; comprueba el acceso desde el teléfono." : connection.metroReachable === false ? "Metro no responde. Inicia Expo en el equipo y pulsa Actualizar. El QR no confirma que el teléfono pueda conectarse." : "Estado de Metro sin verificar."}
              </Text>
              <View style={styles.address}>
                <Text style={styles.label}>URL de Expo Go</Text>
                <Text selectable style={styles.url}>{connection.expoUrl}</Text>
                <Text style={styles.label}>Pasarela para el teléfono</Text>
                <Text selectable style={styles.url}>{connection.gatewayUrl}</Text>
              </View>
            </> : loading ? <ActivityIndicator size="large" color={palette.primary} accessibilityLabel="Preparando conexión de desarrollo" /> : null}
            {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
            <View style={styles.instructions}>
              <Text style={styles.body}>1. Conecta el teléfono y este equipo a la misma red Wi-Fi.</Text>
              <Text style={styles.body}>2. Android: abre Expo Go y escanea el QR. iPhone: escanéalo con la Cámara y abre el enlace en Expo Go.</Text>
              <Text style={styles.body}>3. Si se solicita una pasarela, usa la URL indicada arriba. localhost no apunta a tu equipo desde el teléfono.</Text>
              <Text style={styles.body}>Si ya estás en el teléfono, abre el enlace o introduce la URL de Expo Go manualmente. Revisa el firewall o la VPN si no conecta.</Text>
            </View>
            {connection ? <Button title="Abrir enlace en Expo Go" variant="secondary" disabled={connection.lanAvailable === false} onPress={() => void openExpo()} /> : null}
            {linkError ? <Text accessibilityRole="alert" style={styles.warning}>{linkError}</Text> : null}
            <Button title="Actualizar" icon="refresh-outline" loading={loading} onPress={() => setRefresh((value) => value + 1)} />
            <Text style={styles.caption}>Sin inicio de sesión ni credenciales. La conexión se actualiza al cambiar la pasarela o al pulsar Actualizar; el servidor conserva el resultado hasta 30 segundos.</Text>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  nativeDock: { position: "absolute", zIndex: 1000 },
  compact: { width: 164, padding: 9, gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, ...theme.shadow },
  compactTitle: { color: palette.navy, fontSize: 13, lineHeight: 18, fontWeight: "800", textAlign: "center" },
  compactQr: { width: 144, height: 144, backgroundColor: palette.white },
  compactPlaceholder: { width: 144, height: 144, alignItems: "center", justifyContent: "center", padding: 8, gap: 12 },
  compactAction: { color: palette.primary, fontSize: 12, lineHeight: 18, fontWeight: "700", textAlign: "center", paddingVertical: 9 },
  pill: { minHeight: 48, justifyContent: "center", paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: palette.navy, ...theme.shadow },
  pillText: { color: palette.white, fontSize: 14, fontWeight: "700" },
  pressed: { opacity: 0.8 },
  caption: { ...typography.caption, color: palette.textSecondary },
  centerText: { textAlign: "center" },
  modalOverlay: { flex: 1, padding: 16, backgroundColor: "rgba(18,44,58,0.60)", alignItems: "center", justifyContent: "center" },
  modalCard: { width: "100%", maxWidth: 460, maxHeight: "100%", flexShrink: 1, borderRadius: radius.lg, backgroundColor: palette.surface, overflow: "hidden" },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, borderBottomWidth: 1, borderColor: palette.border },
  heading: { flex: 1, gap: 4 },
  overline: { ...typography.overline, color: palette.primary },
  title: { ...typography.heading, color: palette.navy },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalContent: { padding: 20, gap: 16 },
  modalQr: { alignSelf: "center", backgroundColor: palette.white },
  status: { ...typography.caption, color: palette.textSecondary },
  warning: { ...typography.body, color: palette.amber, backgroundColor: palette.amberSoft, padding: 12, borderRadius: radius.sm },
  address: { gap: 8, backgroundColor: palette.background, borderRadius: radius.md, padding: 14 },
  label: { ...typography.label, color: palette.text },
  url: { ...typography.body, color: palette.primary, flexShrink: 1 },
  instructions: { gap: 10 },
  body: { ...typography.body, color: palette.textSecondary },
});