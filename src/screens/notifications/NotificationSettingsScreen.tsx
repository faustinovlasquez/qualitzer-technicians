import { Ionicons } from "@expo/vector-icons";
import { useContext, useEffect, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { notificationPreferencesSchema, type NotificationPreferences } from "../../domain/notifications";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../notifications/notificationSafety";
import type { MobileNotificationsModel } from "../../notifications/useMobileNotifications";
import { DeviceSecurityContext, PrivateModal } from "../../security/DeviceSecurityContext";
import { BodyText, Button, Card, Field, IconButton, SectionTitle, type IconName } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { notificationErrorMessage, notificationNoticeMessage, sameNotificationPreferences } from "./notificationPresentation";
import { NotificationStatusCard } from "./NotificationStatusCard";

interface NotificationSettingsProps { notifications: MobileNotificationsModel; onBack: () => void; }

export function NotificationSettingsScreen(props: NotificationSettingsProps) {
  return <NotificationSettingsContent key={props.notifications.storageKey} {...props} />;
}

function NotificationSettingsContent({ notifications, onBack }: NotificationSettingsProps) {
  const { client, state } = notifications;
  const security = useContext(DeviceSecurityContext);
  const insets = useSafeAreaInsets();
  const initial = state?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const [preferences, setPreferences] = useState<NotificationPreferences>(initial);
  const [quietEnabled, setQuietEnabled] = useState(initial.quietHoursStart !== initial.quietHoursEnd);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "disable" | null>(null);
  const [localError, setLocalError] = useState(false);
  const baseline = useRef(initial);
  const draft = useRef(preferences);
  const dirtyRef = useRef(false);
  const revision = useRef(0);
  const operation = useRef(false);
  const mounted = useRef(true);
  const latestClient = useRef(client);
  latestClient.current = client;
  const quietWindow = useRef({ start: initial.quietHoursStart, end: initial.quietHoursEnd });
  const unlocked = () => security?.isUnlocked() ?? true;
  const current = () => Boolean(client?.isCurrent() && unlocked());
  const native = Boolean(client && client.options.adapter.platform !== "unsupported");
  const loaded = Boolean(state?.ready && notificationPreferencesSchema.safeParse(state.preferences).success);
  const editable = Boolean(client && loaded && state?.registered && !state.busy && !saving);
  const valid = notificationPreferencesSchema.safeParse(preferences).success && (!quietEnabled || preferences.quietHoursStart !== preferences.quietHoursEnd);
  const canEnable = Boolean(client && loaded && native && state?.status?.enabled && client.options.adapter.projectId
    && client.options.adapter.projectId === state.status.projectId && state.permission !== "blocked" && !state.busy && !saving);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!state?.ready || !notificationPreferencesSchema.safeParse(state.preferences).success || dirtyRef.current) return;
    baseline.current = state.preferences;
    draft.current = state.preferences;
    setPreferences(state.preferences);
    const enabled = state.preferences.quietHoursStart !== state.preferences.quietHoursEnd;
    setQuietEnabled(enabled);
    if (enabled) quietWindow.current = { start: state.preferences.quietHoursStart, end: state.preferences.quietHoursEnd };
  }, [state?.ready, state?.preferences]);

  function requestBack() {
    if (!unlocked()) return;
    if (dirtyRef.current || operation.current) setConfirm("leave");
    else onBack();
  }

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { requestBack(); return true; });
    return () => subscription.remove();
  }, [onBack, security]);

  function update(change: Partial<NotificationPreferences>) {
    if (!editable || !current() || operation.current) return;
    const next = { ...draft.current, ...change };
    draft.current = next;
    revision.current += 1;
    dirtyRef.current = !sameNotificationPreferences(next, baseline.current);
    setDirty(dirtyRef.current);
    setPreferences(next);
    setLocalError(false);
  }

  function changeQuiet(enabled: boolean) {
    if (!editable || !current() || operation.current) return;
    if (!enabled) {
      quietWindow.current = { start: draft.current.quietHoursStart, end: draft.current.quietHoursEnd };
      update({ quietHoursStart: "00:00", quietHoursEnd: "00:00" });
    } else {
      const saved = quietWindow.current;
      update({ quietHoursStart: saved.start !== saved.end ? saved.start : "22:00", quietHoursEnd: saved.start !== saved.end ? saved.end : "07:00" });
    }
    setQuietEnabled(enabled);
  }

  async function save(leave = false) {
    if (!client || !current() || !editable || !valid || !dirtyRef.current || operation.current) return;
    operation.current = true;
    setSaving(true);
    setLocalError(false);
    const savedRevision = revision.current;
    const value = { ...draft.current };
    try {
      const success = await client.savePreferences(value);
      if (!mounted.current || latestClient.current !== client || !client.isCurrent()) return;
      if (!success) { setLocalError(true); return; }
      if (savedRevision !== revision.current) return;
      const confirmed = client.getSnapshot().preferences;
      baseline.current = confirmed;
      draft.current = confirmed;
      dirtyRef.current = false;
      setDirty(false);
      setPreferences(confirmed);
      setQuietEnabled(confirmed.quietHoursStart !== confirmed.quietHoursEnd);
      if (leave && unlocked()) { setConfirm(null); onBack(); }
    } catch {
      if (mounted.current && latestClient.current === client && client.isCurrent()) setLocalError(true);
    } finally {
      operation.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function disable() {
    if (!client || !current() || state?.busy || operation.current) return;
    operation.current = true;
    setSaving(true);
    setLocalError(false);
    try {
      const success = await client.disable();
      if (!mounted.current || latestClient.current !== client || !client.isCurrent()) return;
      if (success) setConfirm(null);
      else setLocalError(true);
    } catch {
      if (mounted.current && latestClient.current === client && client.isCurrent()) setLocalError(true);
    } finally {
      operation.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const hasError = Boolean(state?.error || localError);
  const dismiss = () => { if (!operation.current) { setConfirm(null); setLocalError(false); } };
  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><IconButton name="arrow-back" label="Volver a mi perfil" onPress={requestBack} /><View style={styles.grow}>
        <Text accessibilityRole="header" style={styles.title}>Tus avisos</Text><Text style={styles.caption}>Elige cómo quieres recibirlos</Text>
      </View></View>
      {native ? <Card style={styles.stack}>
        <ToggleRow icon="notifications-outline" title="Recibir avisos" description="En este teléfono, para tu cuenta y sucursal actual."
          value={Boolean(state?.registered)} disabled={Boolean(state?.busy || saving || !loaded || (!(state?.registered || state?.optedIn) && !canEnable))}
          onChange={(enabled) => { if (!current()) return; if (enabled) { if (canEnable) void client?.retryEnable(); } else setConfirm("disable"); }} />
        {state?.optedIn && !state.registered ? <>
          <BodyText>La activación está pendiente. Puedes reintentarlo o cancelar la solicitud.</BodyText>
          <Button title="Reintentar activación" variant="secondary" disabled={!canEnable} onPress={() => { if (current()) void client?.retryEnable(); }} />
          <Button title="Desactivar avisos" variant="ghost" disabled={Boolean(state.busy || saving)} onPress={() => { if (current()) setConfirm("disable"); }} />
        </> : null}
        {loaded && state?.status?.enabled === false ? <Text style={styles.caption}>El servicio no está disponible todavía. Puedes conservar tus preferencias y volver más tarde.</Text> : null}
      </Card> : null}
      <NotificationStatusCard notifications={notifications} />
      {hasError ? <Text accessibilityRole="alert" style={styles.error}>{notificationErrorMessage(state?.error)}</Text> : null}
      {state?.notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notificationNoticeMessage(state.notice)}</Text> : null}
      {!loaded && !dirty ? <Card><BodyText>{client ? "Cargando tus preferencias…" : "Conecta tu sesión para consultar y guardar tus preferencias."}</BodyText></Card> : native || dirty ? <>
        <Card style={styles.stack}>
          <SectionTitle title="Qué quieres recibir" />
          {!state?.registered ? <Text style={styles.caption}>Activa los avisos para editar y guardar. Tus cambios sin guardar se mantienen en esta pantalla.</Text> : null}
          <ToggleRow icon="briefcase-outline" title="Nuevas asignaciones" description="Cuando te asignen una OT o un trabajo." value={preferences.assignments} disabled={!editable} onChange={(assignments) => update({ assignments })} />
          <View style={styles.divider} />
          <ToggleRow icon="timer-outline" title="Cronómetros activos" description="Un recordatorio para revisar el tiempo en curso." value={preferences.timers} disabled={!editable} onChange={(timers) => update({ timers })} />
          <Text style={styles.caption}>Los avisos no pausan ni modifican tus trabajos.</Text>
        </Card>
        <Card style={styles.stack}>
          <SectionTitle title="A tu ritmo" subtitle="Recordatorios de cronómetros activos" />
          <Text style={styles.label}>Primer recordatorio después de</Text>
          <View style={styles.options}>{([30, 60, 120] as const).map((minutes) => <TimeChip key={minutes} label={`${minutes} min`} selected={preferences.remindAfterMinutes === minutes}
            disabled={!editable || !preferences.timers} onPress={() => update({ remindAfterMinutes: minutes })} />)}</View>
          <Text style={styles.label}>Repetir como máximo cada</Text>
          <View style={styles.options}>{([120, 240] as const).map((minutes) => <TimeChip key={minutes} label={`${minutes / 60} horas`} selected={preferences.repeatEveryMinutes === minutes}
            disabled={!editable || !preferences.timers} onPress={() => update({ repeatEveryMinutes: minutes })} />)}</View>
          {preferences.repeatEveryMinutes === 60 ? <Text style={styles.caption}>Valor guardado: 60 min (anterior). El servicio aplica un mínimo de 120 min. No cambiaremos tu valor hasta que elijas otro y guardes.</Text> : null}
        </Card>
        <Card style={styles.stack}>
          <ToggleRow icon="moon-outline" title="Horario silencioso" description="Un espacio sin avisos, según la hora de tu sucursal." value={quietEnabled} disabled={!editable} onChange={changeQuiet} />
          {quietEnabled ? <>
            <View style={styles.hours}>
              <Field label="Desde" hint="HH:mm" value={preferences.quietHoursStart} onChangeText={(quietHoursStart) => update({ quietHoursStart })} editable={editable} maxLength={5} autoCapitalize="none" autoCorrect={false} placeholder="22:00" containerStyle={styles.hourField} />
              <Field label="Hasta" hint="HH:mm" value={preferences.quietHoursEnd} onChangeText={(quietHoursEnd) => update({ quietHoursEnd })} editable={editable} maxLength={5} autoCapitalize="none" autoCorrect={false} placeholder="07:00" containerStyle={styles.hourField} />
            </View>
            <Text style={styles.caption}>Puede continuar al día siguiente; por ejemplo, de 22:00 a 07:00.</Text>
          </> : <Text style={styles.caption}>Desactivado: permites avisos a cualquier hora. Se guardará inicio y fin a las 00:00 al desactivarlo.</Text>}
          {!valid ? <Text accessibilityRole="alert" style={styles.error}>Usa horas entre 00:00 y 23:59 con formato HH:mm. Para activar el silencio, el inicio y el fin deben ser distintos.</Text> : null}
        </Card>
        <View style={styles.saveArea}>
          <Button title="Guardar preferencias" icon="save-outline" loading={saving && confirm !== "disable"} disabled={!editable || !valid || !dirty} onPress={() => { void save(); }} />
          <Text accessibilityLiveRegion="polite" style={styles.saveHint}>{dirty ? "Tienes cambios sin guardar." : "Las preferencias solo cambian cuando pulsas Guardar."}</Text>
        </View>
        <Card style={styles.stack}>
          <SectionTitle title="Prueba tus avisos" subtitle="Solicita un aviso para este teléfono" />
          <Button title="Enviar notificación de prueba" icon="paper-plane-outline" variant="secondary" disabled={!editable} onPress={() => { if (current()) void client?.sendTest(); }} />
          <Text style={styles.caption}>Máximo 5 pruebas por hora. La prueba usa tus preferencias guardadas y respeta el horario silencioso; puede vencer antes de enviarse. Solicitarla no confirma su entrega.</Text>
        </Card>
      </> : null}
    </ScrollView>
    <PrivateModal visible={confirm !== null} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={[styles.backdrop, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled"><Card style={styles.modalCard}>
          <SectionTitle title={confirm === "disable" ? "¿Desactivar los avisos?" : "Tienes cambios sin guardar"} />
          <BodyText>{confirm === "disable" ? "Dejarás de recibir avisos en este teléfono. Tu bandeja y tus trabajos se conservarán. Los cambios de preferencias sin guardar seguirán en esta pantalla." : "Guarda tus preferencias antes de volver o descarta los cambios de esta pantalla."}</BodyText>
          {hasError ? <Text accessibilityRole="alert" style={styles.error}>{notificationErrorMessage(state?.error)}</Text> : null}
          {confirm === "disable" ? <Button title="Desactivar avisos" variant="danger" loading={saving} disabled={Boolean(state?.busy)} onPress={() => { void disable(); }} /> : <>
            <Button title="Guardar y volver" loading={saving} disabled={!editable || !valid || !dirty} onPress={() => { void save(true); }} />
            <Button title="Salir sin guardar" variant="secondary" disabled={saving} onPress={() => { if (!operation.current && unlocked()) { setConfirm(null); onBack(); } }} />
          </>}
          <Button title={confirm === "disable" ? "Cancelar" : "Seguir editando"} variant="ghost" disabled={saving} onPress={dismiss} />
        </Card></ScrollView>
      </View>
    </PrivateModal>
  </View>;
}

function ToggleRow({ icon, title, description, value, disabled, onChange }: { icon: IconName; title: string; description: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <Pressable style={styles.toggle} accessibilityRole="switch" accessibilityLabel={title} accessibilityHint={description}
    accessibilityState={{ checked: value, disabled }} aria-checked={value} disabled={disabled} onPress={() => onChange(!value)}>
    <View style={styles.toggleHeading}><Ionicons name={icon} size={22} color={palette.primary} accessible={false} /><View style={styles.grow}>
      <Text style={styles.label}>{title}</Text><Text style={styles.caption}>{description}</Text>
    </View></View>
    <View style={styles.switchTarget} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden><Switch accessible={false} disabled={disabled} value={value}
      trackColor={{ false: palette.border, true: palette.primary }} thumbColor={palette.white} /></View>
  </Pressable>;
}

function TimeChip({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} aria-checked={selected} disabled={disabled}
    onPress={onPress} style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background }, content: { padding: 16, gap: 16, width: "100%", maxWidth: 880, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8 }, grow: { flex: 1, minWidth: 0, gap: 4 }, title: { ...typography.title, color: palette.navy },
  stack: { gap: 16 }, label: { ...typography.label, color: palette.navy }, caption: { ...typography.caption, color: palette.textSecondary },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 }, toggleHeading: { flexDirection: "row", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 },
  switchTarget: { minWidth: 52, minHeight: 48, justifyContent: "center", alignItems: "center" }, divider: { height: 1, backgroundColor: palette.border },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { minHeight: 48, minWidth: 72, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", alignItems: "center", flexGrow: 1 },
  chipSelected: { backgroundColor: palette.primarySoft, borderColor: palette.primary }, chipText: { ...typography.label, color: palette.textSecondary }, chipTextSelected: { color: palette.primary, fontWeight: "800" }, disabled: { opacity: 0.55 },
  hours: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, hourField: { flexGrow: 1, flexBasis: 110 }, saveArea: { gap: 8 }, saveHint: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  error: { ...typography.label, color: palette.danger }, notice: { ...typography.label, color: palette.primary },
  backdrop: { flex: 1, backgroundColor: "rgba(18,44,58,0.55)", paddingHorizontal: 20 }, modalScroll: { flexGrow: 1, justifyContent: "center", alignItems: "center" }, modalCard: { width: "100%", maxWidth: 480, gap: 16 },
});