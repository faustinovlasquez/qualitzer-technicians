import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Animated, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { TimeField } from "../../ui/time/TimeField";
import { CreationDatePicker } from "../../screens/creation/CreationDatePicker";
import { SignatureField } from "../../screens/orders/lifecycle/SignatureField";
import { hasSignature, requireSignaturePng, type SignaturePadHandle, type SignatureStrokes } from "../../screens/orders/lifecycle/signatureGeometry";
import { evaluateInspection, inspectionRequirementLabel, type WorkshopEntryDetail } from "../../domain/workshopEntry";
import { deliveryBlockers } from "../../domain/workshopDelivery";
import type { WorkshopContact } from "../../domain/workshopIntake";
import type { useWorkshopBoard } from "../useWorkshopBoard";
import { PickerSheet } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";

type Workshop = ReturnType<typeof useWorkshopBoard>;
const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const prettyDate = (value: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

function Success({ detail, receiver, onEntry, onBoard }: { detail: WorkshopEntryDetail; receiver: string; onEntry: () => void; onBoard: () => void }) {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: Platform.OS !== "web" })
    ]).start();
  }, []);
  return <View style={styles.success} accessibilityLiveRegion="polite">
    <Animated.View style={[styles.successIcon, { opacity, transform: [{ scale }] }]}>
      <Ionicons name="checkmark-done" size={46} color={palette.white} accessible={false} />
    </Animated.View>
    <Text style={styles.successTitle} accessibilityRole="header">Equipo entregado</Text>
    <Text style={styles.successText}>{detail.equipmentLabel} · {detail.code}</Text>
    <Text style={styles.successText}>Lo retiró {receiver}. Ya no aparece en la nave y queda en «Entregados».</Text>
    <Button title="Ver ficha del ingreso" icon="document-text-outline" onPress={onEntry} />
    <Button title="Volver al tablero" icon="grid-outline" variant="secondary" onPress={onBoard} />
  </View>;
}

/** Entrega del equipo: inspección de entrega, quién lo retira (contacto del cliente u otra persona), firma y confirmación. */
export function WorkshopDeliveryScreen({ workshop, entryId, onClose, onExitInspection, onGoEntry, onGoBoard }: {
  workshop: Workshop; entryId: number; onClose: () => void; onExitInspection: () => void; onGoEntry: () => void; onGoBoard: () => void;
}) {
  const [detail, setDetail] = useState<WorkshopEntryDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [contacts, setContacts] = useState<WorkshopContact[]>([]);
  const [contactId, setContactId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => localDate(new Date()));
  const [time, setTime] = useState(() => localTime(new Date()));
  const [datePicker, setDatePicker] = useState(false);
  const [strokes, setStrokes] = useState<SignatureStrokes>([]);
  const [drawing, setDrawing] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const signaturePad = useRef<SignaturePadHandle>(null);
  const signature = useRef<string | null>(null);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const close = useRef(onClose);
  close.current = done ? onGoEntry : onClose;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { if (!saving) close.current(); return true; });
    return () => subscription.remove();
  }, [saving]);

  async function load() {
    setLoadError("");
    try {
      const loaded = await workshop.loadEntry(entryId);
      setDetail(loaded);
      // Contactos del cliente del ingreso, como el ComboboxWithAdd de la web.
      const form = await workshop.intake.form(entryId).catch(() => null);
      if (form?.customer) {
        const customer = await workshop.intake.customer(form.customer.id).catch(() => null);
        setContacts(customer?.contacts ?? form.contacts);
      }
    } catch (failure) { setLoadError(failureText(failure, "No se pudo cargar el ingreso.")); }
  }
  useEffect(() => { void load(); }, [entryId]);

  function pickContact(contact: WorkshopContact | null) {
    setContactId(contact?.id ?? null); setIssues({});
    setName((contact?.fullName ?? "").slice(0, 255)); setEmail((contact?.email ?? "").slice(0, 100)); setPhone((contact?.phone ?? "").slice(0, 50));
  }

  async function review() {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Escribe el nombre de quien retira.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Revisa el correo.";
    if (!hasSignature(strokes)) found.signature = "Falta la firma de quien retira.";
    const when = new Date(`${date}T${time || "00:00"}:00`);
    if (!Number.isFinite(when.getTime()) || when.getTime() > Date.now() + 10 * 60_000) found.date = "La fecha de entrega no puede ser futura.";
    if (Object.keys(found).length > 0) { setIssues(found); setMessage("Revisa los datos marcados."); return; }
    setMessage("");
    try { signature.current = requireSignaturePng(await signaturePad.current!.capture()); setConfirming(true); }
    catch (failure) { setMessage(failureText(failure, "No se pudo preparar la firma. Vuelve a intentarlo.")); }
  }

  async function deliver() {
    if (!signature.current || saving) return;
    const input = { receiverName: name.trim(), receiverEmail: email.trim() || null, receiverPhone: phone.trim() || null, receiverSignature: signature.current,
      deliveredAt: new Date(`${date}T${time || "00:00"}:00`).toISOString(), note: note.trim() || null };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: Crypto.randomUUID() };
    setSaving(true); setMessage("");
    try {
      await workshop.delivery.deliver(entryId, { ...input, requestId: attempt.current.requestId });
      attempt.current = null;
      setConfirming(false); setDone(input.receiverName);
      void workshop.refresh();
    } catch (failure) {
      setConfirming(false);
      setMessage(failureText(failure, "No se pudo registrar la entrega. Revisa tu conexión e inténtalo de nuevo."));
    } finally { setSaving(false); }
  }

  const blockers = detail ? deliveryBlockers(detail) : null;
  const exitRequirement = detail?.inspections.exitRequirement ?? "none";
  const exitCheck = detail ? evaluateInspection(exitRequirement, detail.inspections.exit, detail.inspections.photoSlots) : null;
  const blocked = Boolean(blockers && blockers.pending.length > 0);
  const exitPercent = detail?.inspections.exit?.percentage ?? 0;
  const inspectionReady = exitRequirement === "none" || Boolean(exitCheck?.met);
  const receiverReady = Boolean(name.trim()) && hasSignature(strokes);
  const steps = [
    { label: "Inspección", done: inspectionReady && (exitRequirement === "none" ? true : exitPercent > 0) },
    { label: "Quién retira", done: receiverReady },
    { label: "Fecha", done: Boolean(date && time) }
  ];
  const missing = [!name.trim() ? "nombre de quien retira" : null, !hasSignature(strokes) ? "firma" : null].filter((item): item is string => item !== null);
  const selectedContact = contacts.find((contact) => contact.id === contactId) ?? null;
  const initials = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

  return <View style={styles.screen}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label="Cerrar la entrega" disabled={saving} onPress={done ? onGoEntry : onClose} />
      <View style={styles.barText}>
        <Text style={styles.barTitle}>Entregar equipo</Text>
        <Text style={styles.barStep} numberOfLines={1}>{detail ? `${detail.code} · ${detail.equipmentLabel}` : "Cargando…"}</Text>
      </View>
    </View>
    {done && detail ? <Success detail={detail} receiver={done} onEntry={onGoEntry} onBoard={onGoBoard} />
      : !detail ? <View style={styles.loading}>
        {loadError ? <><Notice tone="danger" icon="cloud-offline-outline" message={loadError} /><Button title="Reintentar" icon="refresh" variant="secondary" onPress={() => void load()} /></>
          : <><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando el ingreso…</Text></>}
      </View>
      : detail.delivery ? <View style={styles.content}><Notice tone="success" icon="checkmark-done-circle-outline" message="Este equipo ya fue entregado." /><Button title="Volver" onPress={onGoEntry} /></View>
      : <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!drawing}>
          <View style={styles.equipment}>
            <View style={styles.equipmentIcon}><Ionicons name="construct-outline" size={22} color={palette.primary} accessible={false} /></View>
            <View style={styles.grow}>
              <Text style={styles.equipmentTitle} numberOfLines={2}>{detail.equipmentLabel}</Text>
              <Text style={styles.hint} numberOfLines={1}>{[detail.code, detail.customerName, detail.areaTitle ? `Nave ${detail.areaTitle}` : null].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>

          <View style={styles.stepper} accessibilityRole="progressbar" accessibilityLabel={`${steps.filter((step) => step.done).length} de ${steps.length} pasos listos`}>
            {steps.map((step, index) => <View key={step.label} style={styles.stepItem}>
              <View style={[styles.stepDot, step.done && styles.stepDotDone]}>
                {step.done ? <Ionicons name="checkmark" size={14} color={palette.white} accessible={false} /> : <Text style={styles.stepNumber}>{index + 1}</Text>}
              </View>
              <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]} numberOfLines={1}>{step.label}</Text>
              {index < steps.length - 1 ? <View style={[styles.stepLine, step.done && styles.stepLineDone]} /> : null}
            </View>)}
          </View>

          {blocked ? <Notice tone="warning" icon="alert-circle-outline" message={`Falta cumplir: ${blockers!.pending.map((condition) => `${condition.title} (${condition.detail})`).join(" · ")}`} /> : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionNumber, steps[0].done && styles.sectionNumberDone]}><Text style={[styles.sectionNumberText, steps[0].done && styles.sectionNumberTextDone]}>1</Text></View>
              <Text style={[styles.sectionTitle, styles.grow]} accessibilityRole="header">Inspección de entrega</Text>
              <Text style={[styles.badge, exitRequirement === "none" ? styles.badgeNeutral : exitCheck?.met ? styles.badgeOk : styles.badgeWarn]}>
                {exitRequirement === "none" ? "Opcional" : exitCheck?.met ? "Cumple" : "Exigida"}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${detail.inspections.exit ? "Continuar" : "Hacer"} la inspección de entrega. Avance ${exitPercent} por ciento`}
              onPress={onExitInspection} style={({ pressed }) => [styles.inspectionRow, pressed && styles.pressed]}>
              <View style={[styles.inspectionRing, exitPercent >= 100 && styles.inspectionRingDone]}>
                <Text style={[styles.inspectionPercent, exitPercent >= 100 && styles.inspectionPercentDone]}>{exitPercent}%</Text>
              </View>
              <View style={styles.grow}>
                <Text style={styles.inspectionTitle}>{detail.inspections.exit ? "Continuar inspección" : "Hacer inspección"}</Text>
                <Text style={styles.hint}>Exige: {inspectionRequirementLabel(exitRequirement).toLowerCase()}{detail.inspections.entry ? ` · Ingreso: ${detail.inspections.entry.percentage}%` : ""}</Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, exitPercent >= 100 && styles.progressDone, { width: `${Math.min(100, exitPercent)}%` }]} /></View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={palette.textMuted} accessible={false} />
            </Pressable>
            {blockers?.exitWarning ? <Text style={styles.warn}>{blockers.exitWarning}</Text> : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionNumber, steps[1].done && styles.sectionNumberDone]}><Text style={[styles.sectionNumberText, steps[1].done && styles.sectionNumberTextDone]}>2</Text></View>
              <Text style={[styles.sectionTitle, styles.grow]} accessibilityRole="header">Quién retira el equipo</Text>
            </View>
            {contacts.length > 0 ? <View style={styles.contacts} accessibilityRole="radiogroup">
              {[...contacts, null].map((contact) => {
                const selected = contact ? contactId === contact.id : contactId === null;
                const label = contact?.fullName ?? "Otra persona";
                const meta = contact ? [contact.email, contact.phone].filter(Boolean).join(" · ") || "Contacto del cliente" : "Escribe sus datos";
                return <Pressable key={contact?.id ?? "other"} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => pickContact(contact)}
                  style={({ pressed }) => [styles.contact, selected && styles.contactOn, pressed && styles.pressed]}>
                  <View style={[styles.avatar, selected && styles.avatarOn]}>
                    {contact ? <Text style={[styles.avatarText, selected && styles.avatarTextOn]}>{initials(contact.fullName)}</Text>
                      : <Ionicons name="person-add-outline" size={16} color={selected ? palette.white : palette.textSecondary} accessible={false} />}
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.contactName} numberOfLines={1}>{label}</Text>
                    <Text style={styles.hint} numberOfLines={1}>{meta}</Text>
                  </View>
                  <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? palette.primary : palette.textMuted} accessible={false} />
                </Pressable>;
              })}
            </View> : <Text style={styles.hint}>El cliente no tiene contactos registrados: escribe los datos de quien retira.</Text>}
            <View style={styles.field}>
              <Text style={styles.label}>Nombre *</Text>
              <TextInput value={name} onChangeText={(value) => { setName(value); setIssues({}); }} maxLength={255} placeholder="Nombre y apellido" placeholderTextColor={palette.textMuted}
                style={[styles.input, Boolean(issues.name) && styles.invalid]} accessibilityLabel="Nombre de quien retira" />
              {issues.name ? <Text style={styles.error}>{issues.name}</Text> : null}
            </View>
            <View style={styles.pair}>
              <View style={[styles.field, styles.grow]}>
                <Text style={styles.label}>Correo</Text>
                <TextInput value={email} onChangeText={(value) => { setEmail(value); setIssues({}); }} maxLength={100} keyboardType="email-address" autoCapitalize="none" placeholder="Opcional"
                  placeholderTextColor={palette.textMuted} style={[styles.input, Boolean(issues.email) && styles.invalid]} accessibilityLabel="Correo de quien retira" />
                {issues.email ? <Text style={styles.error}>{issues.email}</Text> : null}
              </View>
              <View style={[styles.field, styles.grow]}>
                <Text style={styles.label}>Teléfono</Text>
                <TextInput value={phone} onChangeText={setPhone} maxLength={50} keyboardType="phone-pad" placeholder="Opcional" placeholderTextColor={palette.textMuted} style={styles.input} accessibilityLabel="Teléfono de quien retira" />
              </View>
            </View>
            <SignatureField label={selectedContact ? `Firma de ${selectedContact.fullName}` : "Firma de quien retira"} name={name} strokes={strokes} signatureRef={signaturePad} disabled={saving} error={issues.signature}
              onChange={(next) => { setStrokes(next); setIssues({}); }} onDrawingChange={setDrawing} />
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionNumber, steps[2].done && styles.sectionNumberDone]}><Text style={[styles.sectionNumberText, steps[2].done && styles.sectionNumberTextDone]}>3</Text></View>
              <Text style={[styles.sectionTitle, styles.grow]} accessibilityRole="header">Fecha y nota</Text>
            </View>
            <View style={styles.row}>
              <SelectorTrigger label="Fecha de entrega" value={prettyDate(date)} icon="calendar-outline" disabled={saving} error={issues.date} containerStyle={styles.grow} onPress={() => setDatePicker(true)} />
              <TimeField label="Hora" value={time} scopeKey={`workshop-delivery-${entryId}`} disabled={saving} containerStyle={styles.time} onChange={setTime} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Nota de entrega</Text>
              <TextInput value={note} onChangeText={setNote} maxLength={2000} multiline placeholder="Opcional" placeholderTextColor={palette.textMuted} style={[styles.input, styles.multiline]}
                textAlignVertical="top" accessibilityLabel="Nota de entrega" />
            </View>
          </View>

          {message ? <Notice tone="danger" icon="alert-circle-outline" message={message} /> : null}
        </ScrollView>
        <View style={styles.actionBar}>
          <Text style={[styles.actionHint, (blocked || missing.length > 0) && styles.actionHintPending]} numberOfLines={2}>
            {blocked ? "Hay condiciones de entrega pendientes." : missing.length > 0 ? `Falta: ${missing.join(" y ")}.` : "Todo listo para entregar."}
          </Text>
          <Button title="Entregar equipo" icon="exit-outline" disabled={saving || blocked} onPress={() => void review()} />
        </View>
      </KeyboardAvoidingView>}

    {datePicker ? <CreationDatePicker value={date} showInputHint={false} onClose={() => setDatePicker(false)} onChange={(value) => { setDate(value); setIssues({}); }} /> : null}
    {confirming && detail ? <PickerSheet title="¿Confirmas la entrega?" onClose={() => { if (!saving) setConfirming(false); }}
      footer={<View style={styles.footer}>
        <Button title="Sí, entregar equipo" icon="checkmark-done" loading={saving} disabled={saving} onPress={() => void deliver()} />
        <Button title="Revisar de nuevo" variant="secondary" disabled={saving} onPress={() => setConfirming(false)} />
      </View>}>
      <Text style={styles.confirmTitle}>{detail.equipmentLabel}</Text>
      <Text style={styles.body}>• Lo retira {name.trim()}{phone.trim() ? ` (${phone.trim()})` : ""}.</Text>
      <Text style={styles.body}>• El equipo deja de aparecer en la nave {detail.areaTitle ?? ""} y queda en «Entregados», donde se puede seguir consultando.</Text>
      <Text style={styles.body}>• La entrega queda registrada con la firma y no se puede deshacer desde la app.</Text>
    </PickerSheet> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  barStep: { ...typography.caption, color: palette.textSecondary },
  loading: { alignItems: "center", gap: 10, padding: 32 },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 14, paddingBottom: 40 },
  section: { gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: palette.heading },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  equipment: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: palette.primarySoft, borderWidth: 1, borderColor: palette.primaryBorder },
  equipmentIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  equipmentTitle: { fontSize: 15, fontWeight: "800", color: palette.heading },
  stepper: { flexDirection: "row", paddingHorizontal: 4 },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.border, backgroundColor: palette.surface, zIndex: 1 },
  stepDotDone: { borderColor: palette.success, backgroundColor: palette.success },
  stepNumber: { fontSize: 12, fontWeight: "800", color: palette.textSecondary },
  stepLabel: { fontSize: 11, fontWeight: "700", color: palette.textSecondary },
  stepLabelDone: { color: palette.success },
  stepLine: { position: "absolute", top: 12, left: "62%", right: "-38%", height: 2, backgroundColor: palette.border },
  stepLineDone: { backgroundColor: palette.success },
  sectionNumber: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  sectionNumberDone: { backgroundColor: palette.success },
  sectionNumberText: { fontSize: 12, fontWeight: "800", color: palette.primary },
  sectionNumberTextDone: { color: palette.white },
  badge: { overflow: "hidden", fontSize: 11, fontWeight: "800", paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  badgeNeutral: { color: palette.textSecondary, backgroundColor: palette.track },
  badgeOk: { color: palette.success, backgroundColor: palette.successSoft },
  badgeWarn: { color: palette.orange, backgroundColor: palette.orangeSoft },
  inspectionRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  inspectionRing: { width: 48, height: 48, borderRadius: 24, borderWidth: 4, borderColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  inspectionRingDone: { borderColor: palette.successSoft },
  inspectionPercent: { fontSize: 13, fontWeight: "800", color: palette.heading },
  inspectionPercentDone: { color: palette.success },
  inspectionTitle: { fontSize: 14, fontWeight: "800", color: palette.text },
  progressTrack: { height: 5, marginTop: 6, borderRadius: 3, overflow: "hidden", backgroundColor: palette.track },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: palette.primary },
  progressDone: { backgroundColor: palette.success },
  contacts: { gap: 8 },
  contact: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  contactOn: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  contactName: { fontSize: 14, fontWeight: "800", color: palette.text },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  avatarOn: { backgroundColor: palette.primary },
  avatarText: { fontSize: 12, fontWeight: "800", color: palette.textSecondary },
  avatarTextOn: { color: palette.white },
  pair: { flexDirection: "row", gap: 10 },
  actionBar: { gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface },
  actionHint: { ...typography.caption, textAlign: "center", color: palette.success, fontWeight: "700" },
  actionHintPending: { color: palette.textSecondary },
  hint: { ...typography.caption, color: palette.textSecondary },
  warn: { ...typography.caption, color: palette.orange, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText: { fontSize: 14, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white },
  field: { gap: 6 },
  label: { ...typography.label, color: palette.text },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  multiline: { minHeight: 80, paddingTop: 10 },
  invalid: { borderColor: palette.danger },
  error: { ...typography.caption, color: palette.danger },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  time: { width: 120 },
  footer: { gap: 8 },
  confirmTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  body: { fontSize: 14, lineHeight: 20, color: palette.text },
  success: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", backgroundColor: palette.success, marginBottom: 8 },
  successTitle: { fontSize: 22, fontWeight: "800", color: palette.heading },
  successText: { ...typography.body, color: palette.textSecondary, textAlign: "center" }
});
