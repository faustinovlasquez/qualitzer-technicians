import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BodyText, Brand, Button, Card, Field, IconButton, SectionTitle } from "../ui/components";
import { palette, radius, typography } from "../ui/theme";
import { gatewayLoopbackWarning, probeGatewayConnection, safeGatewayUrl, suggestedExpoGatewayUrl, type GatewayProbeResult } from "../infrastructure/gatewayConnection";
import { uploadFetch } from "../infrastructure/photos";
import { apiMessage, NetworkError } from "../infrastructure/errors";
import { gatewayConfiguration } from "../infrastructure/gatewayConfig";

const loginFailure = "No se pudo iniciar sesión. Revisa tus credenciales y tu conexión e inténtalo de nuevo.";
const connectionFailure = "No se pudo conectar con Qualitzer. Revisa tu conexión a internet e inténtalo de nuevo. Si el problema continúa, contacta a tu administrador.";

function loginErrorMessage(message: string | null): string | null {
  if (!message) return null;
  const safeCodes = ["AUTH_INVALID_CREDENTIALS", "AUTH_RATE_LIMITED", "RATE_LIMITED", "UNAUTHORIZED", "WORKER_REQUIRED", "BRANCH_FORBIDDEN", "LOGIN_CHALLENGE_EXPIRED", "INVALID_LOGIN_CHALLENGE", "PASSWORD_CHANGE_REQUIRED"];
  for (const code of safeCodes) {
    if (message === apiMessage(code)) return apiMessage(code);
  }
  if (message.startsWith("No se pudo conectar con ") || message.startsWith("La conexión tardó demasiado con ")) return connectionFailure;
  if (message === apiMessage("UPSTREAM_UNAVAILABLE") || message === apiMessage("UPSTREAM_TIMEOUT")) return connectionFailure;
  if (message === apiMessage("UPSTREAM_INVALID_RESPONSE")) return "El servicio no está disponible en este momento. Inténtalo más tarde o contacta a tu administrador.";
  if (message === apiMessage("TENANT_NOT_FOUND")) return "Esta empresa no está disponible. Contacta a tu administrador.";
  if (message === apiMessage("ORIGIN_FORBIDDEN")) return "No se puede acceder desde esta versión de la app. Contacta a tu administrador.";
  if (message === apiMessage("LOGIN_DISCOVERY_UNAVAILABLE")) return "No se pudo verificar tu acceso a las empresas. Inténtalo de nuevo en unos momentos.";
  if (message === apiMessage("SESSION_PERSISTENCE_UNAVAILABLE")) return "No se pudo guardar tu sesión de forma segura. Inténtalo de nuevo; si continúa, contacta a tu administrador.";
  if (message === gatewayConfiguration.error || message === "Esta versión solo permite la URL base HTTPS fijada al compilar.") return "Esta versión de la app necesita ser revisada. Contacta a tu administrador para recuperar el acceso.";
  if (message.startsWith("La sesión guardada pertenece a otra URL base.")) return "Tu sesión guardada no es compatible con esta versión. Tus datos pendientes se conservan. Contacta a tu administrador para recuperar el acceso sin borrar los datos de la app.";
  if (message === "Tu sesión venció o fue cerrada desde otro dispositivo. Ingresa nuevamente. Los borradores se conservan para el mismo usuario.") return message;
  return loginFailure;
}

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
  const visibleError = loginErrorMessage(error) ?? localError;
  const native = Platform.OS !== "web";
  const loopbackWarning = native ? gatewayLoopbackWarning(gatewayUrl) : null;
  const gatewayLocked = gatewayConfiguration.locked;
  const showDevelopmentTools = __DEV__ && !gatewayLocked;
  const suggested = !gatewayLocked && native && __DEV__ ? suggestedExpoGatewayUrl(suggestedGatewayUrl, gatewayUrl) : undefined;

  function changeGateway(value: string): void {
    if (!showDevelopmentTools || isBusy || submissionLock.current) return;
    connectionVersion.current.version += 1;
    connectionVersion.current.pending = false;
    setDiagnostic(null);
    setLocalError(null);
    onGatewayChange(value);
  }

  async function checkConnection(): Promise<void> {
    if (!showDevelopmentTools || isBusy || submissionLock.current || connectionVersion.current.pending) return;
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
      setLocalError(caught instanceof NetworkError ? connectionFailure : loginFailure);
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
            <LinearGradient testID="login-hero" colors={[palette.navy, "#174C57", palette.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, wide && styles.heroWide]}>
              <View style={styles.heroIcon}><Ionicons name="construct-outline" size={23} color={palette.white} accessible={false} /></View>
              <View style={styles.heroCopy}>
                <Text accessibilityRole="header" accessibilityLabel="Tu trabajo. En tus manos." style={styles.heroTitle}>Tu trabajo. En tus manos.</Text>
                <Text style={styles.heroDescription}>Tareas, equipos y checklists.</Text>
              </View>
            </LinearGradient>

            <View style={[styles.formColumn, wide && styles.formColumnWide]}>
              <Card style={styles.form}>
                <SectionTitle title="Entra a tu jornada" subtitle="Ingresa con tu usuario y contraseña." />
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
                <View style={styles.sessionNotice}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={palette.primary} accessible={false} />
                  <Text style={styles.sessionNoticeText}>Tu sesión se recuerda en este dispositivo hasta que la cierres o debas identificarte de nuevo.</Text>
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

              {showDevelopmentTools ? <Card style={styles.connectionCard}>
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
                    <Field label="URL de la pasarela" value={gatewayUrl} onChangeText={changeGateway} placeholder="https://pasarela.tu-empresa.cl" keyboardType="url" autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="URL" editable={!isBusy} accessibilityState={{ disabled: isBusy }} />
                    {connectionPanel}
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
  content: { flexGrow: 1, padding: 16, paddingTop: 14, paddingBottom: 24, gap: 14, width: "100%", maxWidth: 1100, alignSelf: "center" },
  contentWide: { padding: 32, justifyContent: "center", gap: 20 },
  layout: { gap: 14 },
  layoutWide: { flexDirection: "row", gap: 24, alignItems: "flex-start" },
  hero: { borderRadius: radius.lg, padding: 14, gap: 12, flexDirection: "row", alignItems: "center" },
  heroWide: { flex: 1 },
  heroIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.darkSurface, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroTitle: { fontSize: 18, lineHeight: 23, fontWeight: "700", color: palette.white },
  heroDescription: { fontSize: 13, lineHeight: 18, color: palette.onDark },
  formColumn: { gap: 14 },
  formColumnWide: { flex: 1.05 },
  form: { gap: 14, padding: 16 },
  fields: { gap: 12 },
  sessionNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: palette.primarySoft },
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