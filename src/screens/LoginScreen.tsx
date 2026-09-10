import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BodyText, Brand, Button, Card, Field, IconButton, SectionTitle } from "../ui/components";
import { palette, radius, typography } from "../ui/theme";
import { gatewayLoopbackWarning, loginConnectionError, probeGatewayConnection, safeGatewayUrl, suggestedExpoGatewayUrl, type GatewayProbeResult } from "../infrastructure/gatewayConnection";
import { uploadFetch } from "../infrastructure/photos";
import { NetworkError } from "../infrastructure/errors";
import { gatewayConfiguration } from "../infrastructure/gatewayConfig";

export interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onDemo: () => void;
  gatewayUrl: string;
  suggestedGatewayUrl?: string;
  onGatewayChange: (url: string) => void;
  error: string | null;
  busy: boolean;
}

export function LoginScreen({ onLogin, onDemo, gatewayUrl, suggestedGatewayUrl, onGatewayChange, error, busy }: LoginScreenProps) {
  const { width } = useWindowDimensions();
  const wide = width >= 860;
  const passwordInput = useRef<TextInput>(null);
  const submissionLock = useRef(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const connectionVersion = useRef({ url: gatewayUrl, version: 0, pending: false });
  if (connectionVersion.current.url !== gatewayUrl) {
    connectionVersion.current = { url: gatewayUrl, version: connectionVersion.current.version + 1, pending: false };
  }
  const [diagnostic, setDiagnostic] = useState<{ version: number; result: GatewayProbeResult | null } | null>(null);
  useEffect(() => () => { connectionVersion.current.version += 1; connectionVersion.current.pending = false; }, []);
  const diagnosticBusy = diagnostic?.version === connectionVersion.current.version && connectionVersion.current.pending;
  const diagnosticResult = diagnostic?.version === connectionVersion.current.version ? diagnostic.result : null;
  const isBusy = busy || submitting;
  const visibleError = error ?? localError;
  const native = Platform.OS !== "web";
  const loopbackWarning = native ? gatewayLoopbackWarning(gatewayUrl) : null;
  const gatewayLocked = gatewayConfiguration.locked;
  const suggested = !gatewayLocked && native && __DEV__ ? suggestedExpoGatewayUrl(suggestedGatewayUrl, gatewayUrl) : undefined;

  function changeGateway(value: string): void {
    if (gatewayLocked || isBusy || submissionLock.current) return;
    connectionVersion.current.version += 1;
    connectionVersion.current.pending = false;
    setDiagnostic(null);
    setLocalError(null);
    onGatewayChange(value);
  }

  async function checkConnection(): Promise<void> {
    if (isBusy || submissionLock.current || connectionVersion.current.pending) return;
    const version = ++connectionVersion.current.version;
    const url = gatewayUrl;
    connectionVersion.current.pending = true;
    setDiagnostic({ version, result: null });
    const result = await probeGatewayConnection(url, uploadFetch);
    if (version !== connectionVersion.current.version) return;
    connectionVersion.current.pending = false;
    setDiagnostic({ version, result });
  }

  const connectionPanel = <View style={styles.connectionDiagnostic}>
    <Text selectable style={[styles.connectionDestination, loopbackWarning && styles.connectionDanger]}>Pasarela en uso: {safeGatewayUrl(gatewayUrl) ?? "URL no válida"}</Text>
    {loopbackWarning ? <Text accessibilityRole="alert" style={styles.connectionDanger}>{loopbackWarning}</Text> : null}
    {suggested ? <>
      <BodyText style={styles.connectionHelp}>La app fue abierta desde otro equipo/dirección de Expo: {suggested}. Esto no confirma que la pasarela actual sea incorrecta. Solo se cambiará si lo eliges.</BodyText>
      <Button title="Usar conexión de Expo" variant="secondary" disabled={isBusy} onPress={() => changeGateway(suggested)} />
    </> : null}
    <Button title="Comprobar conexión" variant="secondary" loading={diagnosticBusy} disabled={isBusy || diagnosticBusy} onPress={() => { void checkConnection(); }} />
    {diagnosticResult ? <Text accessibilityLiveRegion="polite" style={[styles.connectionHelp, diagnosticResult.status !== "ready" && styles.connectionDanger]}>{diagnosticResult.message}</Text> : null}
    {gatewayLocked ? <BodyText style={styles.connectionHelp}>Servidor fijado en esta versión. Su disponibilidad depende del despliegue de la pasarela en esta URL base; la app no necesita Expo Go ni un equipo local.</BodyText> : null}
    {native && !gatewayLocked ? <>
      <Button title={showConnection ? "Ocultar configuración" : "Configurar conexión"} variant="ghost" disabled={isBusy} onPress={() => setShowConnection((value) => !value)} />
      {showConnection ? <Field label="URL de la pasarela" value={gatewayUrl} onChangeText={changeGateway} keyboardType="url" autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="URL" editable={!isBusy} accessibilityState={{ disabled: isBusy }} /> : null}
    </> : null}
  </View>;

  async function handleLogin(): Promise<void> {
    if (isBusy || submissionLock.current || connectionVersion.current.pending) return;
    setLocalError(null);
    setAttempted(true);
    if (!username.trim() || !password) return;
    submissionLock.current = true;
    setSubmitting(true);
    try {
      await onLogin(username.trim(), password);
    } catch (caught) {
      setLocalError(caught instanceof NetworkError ? loginConnectionError(caught, gatewayUrl) : "No se pudo iniciar sesión. Revisa tus credenciales y tu conexión e inténtalo de nuevo.");
    } finally {
      setPassword("");
      setShowPassword(false);
      setAttempted(false);
      submissionLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}>
      <SafeAreaView style={styles.screen}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, wide && styles.contentWide]}>
          <Brand />
          <View style={[styles.layout, wide && styles.layoutWide]}>
            <LinearGradient colors={[palette.navy, "#174C57", palette.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, wide && styles.heroWide]}>
              <View pointerEvents="none" style={styles.heroOrbit} />
              <View pointerEvents="none" style={styles.heroOrbitInner} />
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}><Ionicons name="construct-outline" size={30} color={palette.white} accessible={false} /></View>
                <Text style={styles.eyebrow}>TU OPERACIÓN, A MANO</Text>
              </View>
              <View style={styles.heroCopy}>
                <Text accessibilityRole="header" accessibilityLabel="Tu trabajo. En tus manos." style={[styles.heroTitle, width < 360 && styles.heroTitleSmall]}>Tu trabajo.{"\n"}En tus manos.</Text>
                <Text style={styles.heroDescription}>Tus tareas, equipos y listas de verificación. Todo en un mismo lugar.</Text>
              </View>
              <View style={styles.heroFooter}>
                <Ionicons name="shield-checkmark-outline" size={19} color="#A9E4D9" accessible={false} />
                <Text style={styles.heroFooterText}>Diseñado para el trabajo en campo</Text>
              </View>
            </LinearGradient>

            <View style={[styles.formColumn, wide && styles.formColumnWide]}>
              <Card style={styles.form}>
                <SectionTitle title="Entra a tu jornada" subtitle="Ingresa con tu usuario y contraseña. Si tienes acceso a varias empresas, podrás elegir después." />
                <View style={styles.fields}>
                  <Field
                    label="Correo o usuario"
                    icon="person-outline"
                    placeholder="Tu correo o nombre de usuario"
                    value={username}
                    onChangeText={(value) => { setUsername(value); setLocalError(null); }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => passwordInput.current?.focus()}
                    editable={!isBusy}
                    accessibilityState={{ disabled: isBusy }}
                    error={attempted && !username.trim() ? "Ingresa tu correo o usuario." : null}
                  />
                  <Field
                    ref={passwordInput}
                    label="Contraseña"
                    icon="lock-closed-outline"
                    placeholder="Ingresa tu contraseña"
                    value={password}
                    onChangeText={(value) => { setPassword(value); setLocalError(null); }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={() => { void handleLogin(); }}
                    editable={!isBusy}
                    accessibilityState={{ disabled: isBusy }}
                    error={attempted && !password ? "Ingresa tu contraseña." : null}
                    trailing={<IconButton name={showPassword ? "eye-off-outline" : "eye-outline"} label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onPress={() => setShowPassword((value) => !value)} disabled={isBusy} />}
                  />
                </View>
                {visibleError ? (
                  <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
                    <Ionicons name="alert-circle-outline" size={21} color={palette.danger} accessible={false} />
                    <Text style={styles.errorText}>{visibleError}</Text>
                  </View>
                ) : null}
                {native || gatewayLocked ? connectionPanel : null}
                <View style={styles.sessionNotice}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={palette.primary} accessible={false} />
                  <Text style={styles.sessionNoticeText}>La sesión se recuerda automáticamente en este dispositivo hasta que cierres sesión o el servidor solicite un nuevo acceso por revocación o seguridad.</Text>
                </View>
                <Button title={isBusy ? "Iniciando sesión…" : "Iniciar sesión"} onPress={() => { void handleLogin(); }} loading={isBusy} disabled={diagnosticBusy} icon="arrow-forward-outline" />
                <View style={styles.dividerRow}>
                  <View style={styles.divider} />
                  <Text style={styles.dividerText}>Demostración independiente</Text>
                  <View style={styles.divider} />
                </View>
                <View style={styles.demo}>
                  <Button title="Explorar demostración" variant="secondary" icon="play-circle-outline" onPress={onDemo} disabled={isBusy || diagnosticBusy} />
                  <Text style={styles.demoNote}>Datos de ejemplo. No requiere credenciales ni modifica Qualitzer.</Text>
                </View>
              </Card>

              {!gatewayLocked ? <Card style={styles.connectionCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Conexión avanzada. Configurar pasarela móvil"
                  accessibilityState={{ expanded: showConnection, disabled: isBusy }}
                  onPress={() => setShowConnection((value) => !value)}
                  disabled={isBusy}
                  style={({ pressed }) => [styles.connectionToggle, pressed && styles.pressed]}
                >
                  <View style={styles.connectionIcon}><Ionicons name="options-outline" size={20} color={palette.textSecondary} accessible={false} /></View>
                  <View style={styles.connectionCopy}>
                    <Text style={styles.connectionTitle}>Conexión avanzada</Text>
                    <Text style={styles.connectionSubtitle}>Pasarela móvil · opcional</Text>
                  </View>
                  <Ionicons name={showConnection ? "chevron-up-outline" : "chevron-down-outline"} size={18} color={palette.textMuted} accessible={false} />
                </Pressable>
                {showConnection ? (
                  <View style={styles.connectionBody}>
                    {!native ? <>
                      <Field label="URL de la pasarela" value={gatewayUrl} onChangeText={changeGateway} placeholder="https://pasarela.tu-empresa.cl" keyboardType="url" autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="URL" editable={!isBusy} accessibilityState={{ disabled: isBusy }} />
                      {connectionPanel}
                    </> : null}
                    <BodyText style={styles.connectionHelp}>Cámbiala solo si tu administrador te lo indica. Usa la dirección de la pasarela móvil, no el portal de una empresa. Las empresas disponibles se muestran después de verificar tus credenciales.</BodyText>
                  </View>
                ) : null}
              </Card> : null}
            </View>
          </View>
          <Text style={styles.footer}>Menos escritorio. Más terreno.</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { flexGrow: 1, padding: 20, paddingTop: 26, paddingBottom: 32, gap: 26, width: "100%", maxWidth: 1100, alignSelf: "center" },
  contentWide: { padding: 40, justifyContent: "center", gap: 32 },
  layout: { gap: 20 },
  layoutWide: { flexDirection: "row", gap: 32, alignItems: "stretch" },
  hero: { borderRadius: radius.xl, padding: 26, gap: 28, overflow: "hidden" },
  heroWide: { flex: 1, padding: 36, justifyContent: "space-between", minHeight: 510 },
  heroOrbit: { position: "absolute", width: 290, height: 290, borderRadius: 145, borderWidth: 1, borderColor: palette.darkBorder, top: -65, right: -140 },
  heroOrbitInner: { position: "absolute", width: 230, height: 230, borderRadius: 115, borderWidth: 1, borderColor: palette.darkBorder, top: -35, right: -110 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: palette.darkSurface, borderWidth: 1, borderColor: palette.darkBorder, alignItems: "center", justifyContent: "center" },
  eyebrow: { ...typography.overline, color: palette.onDark, flexShrink: 1, fontSize: 10 },
  heroCopy: { gap: 14 },
  heroTitle: { ...typography.hero, color: palette.white },
  heroTitleSmall: { fontSize: 30, lineHeight: 37 },
  heroDescription: { ...typography.body, color: palette.onDark, maxWidth: 320, lineHeight: 25 },
  heroFooter: { flexDirection: "row", alignItems: "center", gap: 9, paddingTop: 18, borderTopWidth: 1, borderTopColor: palette.darkBorder },
  heroFooterText: { ...typography.caption, color: palette.onDark, flex: 1 },
  formColumn: { gap: 14 },
  formColumnWide: { flex: 1.05 },
  form: { gap: 22, padding: 22 },
  fields: { gap: 18 },
  sessionNotice: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: palette.primarySoft },
  sessionNoticeText: { ...typography.caption, color: palette.textSecondary, flex: 1 },
  error: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: palette.dangerSoft, borderRadius: radius.sm, padding: 14 },
  errorText: { ...typography.label, fontWeight: "400", color: palette.danger, flex: 1 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { flex: 1, height: 1, backgroundColor: palette.border },
  dividerText: { ...typography.caption, color: palette.textMuted, flexShrink: 1 },
  demo: { gap: 10 },
  demoNote: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  connectionCard: { padding: 0 },
  connectionToggle: { minHeight: 76, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radius.lg },
  connectionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.background },
  connectionCopy: { flex: 1, gap: 2 },
  connectionTitle: { ...typography.label, color: palette.text },
  connectionSubtitle: { ...typography.caption, color: palette.textMuted },
  connectionBody: { padding: 18, paddingTop: 0, gap: 12 },
  connectionHelp: { fontSize: 13, lineHeight: 20 },
  connectionDiagnostic: { gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  connectionDestination: { ...typography.label, color: palette.text, flexShrink: 1 },
  connectionDanger: { color: palette.danger, fontSize: 13, lineHeight: 20 },
  pressed: { backgroundColor: palette.track },
  footer: { ...typography.caption, color: palette.textMuted, textAlign: "center", letterSpacing: 0.3 },
});