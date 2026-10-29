import { useEffect, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { LocalPicker } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";
import {
  EMAIL_PROVIDER_LABEL, type EmailEligibility, type EmailOptions, type EmailPreview, type EmailProvider, type EmailRecipient, type EmailSendResult
} from "../../domain/workshopCustomerEmail";
import type { useWorkshopBoard } from "../useWorkshopBoard";

type EmailsApi = ReturnType<typeof useWorkshopBoard>["emails"];
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

/**
 * Enviar la confirmación de ingreso al cliente (como en la web): plantilla, destinatarios (contactos del ingreso o
 * correos nuevos, con opción de guardarlos como contacto), canal, informe adjunto y vista previa.
 */
export function EmailSendScreen({ api, entryId, entryCode, onClose, onSent }: {
  api: EmailsApi; entryId: number; entryCode: string; onClose: () => void; onSent: (result: EmailSendResult) => void;
}) {
  const [eligibility, setEligibility] = useState<EmailEligibility | null>(null);
  const [options, setOptions] = useState<EmailOptions | null>(null);
  const [loadError, setLoadError] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [saveNew, setSaveNew] = useState(true);
  const [provider, setProvider] = useState<EmailProvider | null>(null);
  const [attachReport, setAttachReport] = useState(true);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const load = () => {
    setLoadError("");
    Promise.all([api.eligibility(entryId), api.options()])
      .then(([nextEligibility, nextOptions]) => {
        setEligibility(nextEligibility);
        setOptions(nextOptions);
        setTemplateId(nextEligibility.template?.id ?? nextOptions.templates.find((item) => item.isDefault)?.id ?? nextOptions.templates[0]?.id ?? null);
        setSelected(nextEligibility.recipients.map((recipient) => recipient.email));
        setAttachReport(nextEligibility.attachReport);
      })
      .catch((failure: unknown) => setLoadError(failureText(failure, "No se pudo revisar el ingreso. Revisa tu conexión.")));
  };
  useEffect(load, [entryId]);

  const recipients: EmailRecipient[] = useMemo(() => [
    ...(eligibility?.recipients ?? []).filter((recipient) => selected.includes(recipient.email)),
    ...extra.map((email) => ({ email, name: null, contactId: null }))
  ], [eligibility?.recipients, selected, extra]);

  // Vista previa con el primer destinatario (el saludo usa su nombre).
  const firstName = recipients[0]?.name ?? null;
  useEffect(() => {
    if (templateId === null) return;
    let active = true;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      api.preview(entryId, templateId, firstName)
        .then((result) => { if (active) setPreview(result); })
        .catch(() => { if (active) setPreview(null); })
        .finally(() => { if (active) setPreviewLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [entryId, templateId, firstName]);

  const addEmail = () => {
    const email = draft.trim().toLowerCase();
    if (email === "") return;
    if (!isEmail(email)) { setDraftError("Ese correo no es válido."); return; }
    setDraftError("");
    if ((eligibility?.recipients ?? []).some((recipient) => recipient.email === email)) {
      setSelected((current) => current.includes(email) ? current : [...current, email]);
    } else if (!extra.includes(email)) setExtra([...extra, email]);
    setDraft("");
  };

  const template = options?.templates.find((item) => item.id === templateId) ?? null;
  const blocked = (eligibility?.issues.length ?? 0) > 0;
  const warnings = (eligibility?.warnings ?? []).filter((warning) => warning.code !== "NO_RECIPIENTS" || recipients.length === 0);

  const send = async () => {
    if (sending || recipients.length === 0 || templateId === null) return;
    setSending(true);
    setSendError("");
    try {
      const result = await api.send(entryId, {
        templateId, recipients, cc: [], attachReport, saveNewContacts: saveNew && extra.length > 0, provider
      });
      if (result.results.some((item) => item.status === "sent")) onSent(result);
      else setSendError(result.results[0]?.error ?? "No se pudo enviar. Revisa el canal elegido e inténtalo de nuevo.");
    } catch (failure) {
      setSendError(failureText(failure, "No se pudo enviar. Revisa tu conexión e inténtalo de nuevo."));
    } finally {
      setSending(false);
    }
  };

  return <Modal visible animationType="slide" onRequestClose={() => { if (!sending) onClose(); }}>
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.bar}>
        <IconButton name="close" label="Cerrar" disabled={sending} onPress={onClose} />
        <View style={styles.grow}>
          <Text style={styles.barTitle}>Enviar confirmación</Text>
          <Text style={styles.hint}>{entryCode} · al cliente</Text>
        </View>
      </View>
      <KeyboardAvoidingView style={styles.grow} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {eligibility === null && loadError === "" ? <View style={styles.center}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Revisando el ingreso…</Text></View> : null}
          {loadError !== "" ? <View style={styles.center}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Button title="Reintentar" icon="refresh" variant="secondary" onPress={load} />
          </View> : null}

          {eligibility !== null && options !== null ? <>
            {eligibility.issues.map((issue) => <Notice key={issue.code} tone="danger" icon="alert-circle-outline" message={issue.message} />)}
            {warnings.map((warning) => <Notice key={warning.code} tone="warning" icon="warning-outline" message={warning.message} />)}

            <SelectorTrigger label="Plantilla" icon="document-text-outline" value={template?.name ?? ""} disabled={sending} onPress={() => setPicking(true)} />

            <View style={styles.section}>
              <Text style={styles.label}>Para *</Text>
              {eligibility.recipients.map((recipient) => {
                const on = selected.includes(recipient.email);
                return <Pressable key={recipient.email} accessibilityRole="checkbox" accessibilityState={{ checked: on }} disabled={sending}
                  onPress={() => setSelected((current) => on ? current.filter((email) => email !== recipient.email) : [...current, recipient.email])}
                  style={[styles.row, on && styles.rowOn]}>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? palette.primary : palette.textMuted} />
                  <View style={styles.grow}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{recipient.name ?? recipient.email}</Text>
                    <Text style={styles.hint} numberOfLines={1}>{recipient.email} · contacto del ingreso</Text>
                  </View>
                </Pressable>;
              })}
              {eligibility.contactsWithoutEmail.map((name) => <Text key={name} style={styles.hint}>{name} · sin correo</Text>)}
              {extra.map((email) => <View key={email} style={[styles.row, styles.rowOn]}>
                <Ionicons name="mail-outline" size={20} color={palette.primary} />
                <Text style={[styles.rowTitle, styles.grow]} numberOfLines={1}>{email}</Text>
                <IconButton name="close" label={`Quitar ${email}`} onPress={() => setExtra(extra.filter((item) => item !== email))} />
              </View>)}
              <View style={styles.addRow}>
                <TextInput value={draft} onChangeText={(value) => { setDraft(value); setDraftError(""); }} onSubmitEditing={addEmail} placeholder="Agregar otro correo"
                  placeholderTextColor={palette.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="done"
                  style={[styles.input, draftError !== "" && styles.invalid]} accessibilityLabel="Agregar otro correo" editable={!sending} />
                <Button title="Agregar" icon="add" variant="secondary" disabled={sending || draft.trim() === ""} onPress={addEmail} />
              </View>
              {draftError !== "" ? <Text style={styles.errorText}>{draftError}</Text> : null}
              {extra.length > 0 ? <View style={styles.switchRow}>
                <Switch value={saveNew} onValueChange={setSaveNew} disabled={sending} />
                <Text style={[styles.hint, styles.grow]}>Guardar los correos nuevos como contactos del cliente y del ingreso</Text>
              </View> : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Enviar desde</Text>
              <ChannelRow selected={provider === null} disabled={sending} title="Automático (recomendado)" icon="sparkles-outline"
                detail={eligibility.sender.provider !== null
                  ? `Hoy sale por ${EMAIL_PROVIDER_LABEL[eligibility.sender.provider]}${eligibility.sender.email ? ` (${eligibility.sender.email})` : ""}. Si falla, por la cuenta del sistema.`
                  : eligibility.sender.reason ?? "Sin canal disponible."}
                onPress={() => setProvider(null)} />
              {options.channels.map((channel) => <ChannelRow key={channel.provider} selected={provider === channel.provider} disabled={sending || !channel.available}
                title={EMAIL_PROVIDER_LABEL[channel.provider]} icon={channel.provider === "SMTP" ? "business-outline" : "mail-outline"}
                status={channel.available ? "Conectado" : "No conectado"}
                detail={channel.available ? channel.email ?? "" : `${channel.reason ?? "No disponible."} ${channel.howTo}`.trim()}
                onPress={() => setProvider(channel.provider)} />)}
              <Text style={styles.hint}>Para conectar tu Gmail o tu correo, entra a tu perfil desde la web.</Text>
            </View>

            <View style={styles.switchRow}>
              <Switch value={attachReport} onValueChange={setAttachReport} disabled={sending} />
              <Text style={[styles.rowTitle, styles.grow]}>Adjuntar informe de ingreso (PDF)</Text>
            </View>

            <View style={styles.preview}>
              <Text style={styles.previewLabel}>VISTA PREVIA</Text>
              {previewLoading && preview === null ? <ActivityIndicator color={palette.primary} /> : null}
              {preview !== null ? <>
                <Text style={styles.previewSubject}>{preview.subject}</Text>
                {attachReport && preview.attachmentName ? <View style={styles.attachment}>
                  <Ionicons name="document-attach-outline" size={16} color={palette.danger} />
                  <Text style={styles.hint} numberOfLines={1}>{preview.attachmentName}</Text>
                </View> : null}
                {preview.missing.length > 0 ? <Text style={styles.warningText}>Sin dato en este ingreso: {preview.missing.join(", ")}</Text> : null}
                {preview.paragraphs.map((paragraph, index) => <Text key={index} style={styles.previewText}>{paragraph}</Text>)}
              </> : null}
            </View>

            {sendError !== "" ? <Notice tone="danger" icon="alert-circle-outline" message={sendError} /> : null}
          </> : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Text style={styles.hint}>{recipients.length === 0 ? "Elige al menos un destinatario." : `${recipients.length} destinatario(s)`}</Text>
        <Button title="Enviar al cliente" icon="send" variant="warning" loading={sending}
          disabled={sending || blocked || recipients.length === 0 || templateId === null} onPress={() => void send()} />
      </View>
      {picking && options !== null ? <LocalPicker title="Plantilla" placeholder="Buscar plantilla" emptyText="No hay plantillas activas para esta sucursal."
        load={async () => options.templates} label={(item) => item.name} detail={(item) => item.isDefault ? "Por defecto" : null}
        selectedId={templateId} onPick={(item) => { setTemplateId(item.id); setAttachReport((eligibility?.attachReport ?? true) && item.attachReport); setPicking(false); }}
        onClose={() => setPicking(false)} /> : null}
    </SafeAreaView>
  </Modal>;
}

function ChannelRow({ selected, disabled, title, detail, status, icon, onPress }: {
  selected: boolean; disabled: boolean; title: string; detail: string; status?: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void;
}) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.row, selected && styles.rowOn, disabled && styles.rowDisabled]}>
    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? palette.primary : palette.textMuted} />
    <Ionicons name={icon} size={18} color={disabled ? palette.textMuted : palette.primary} />
    <View style={styles.grow}>
      <View style={styles.titleLine}>
        <Text style={styles.rowTitle}>{title}</Text>
        {status ? <Text style={[styles.status, status === "Conectado" ? styles.statusOn : styles.statusOff]}>{status}</Text> : null}
      </View>
      {detail !== "" ? <Text style={styles.hint}>{detail}</Text> : null}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  barTitle: { fontSize: 17, fontWeight: "800", color: palette.heading },
  grow: { flex: 1, minWidth: 0 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  center: { alignItems: "center", gap: 10, paddingVertical: 40 },
  section: { gap: 8 },
  label: { ...typography.label, color: palette.text },
  hint: { ...typography.caption, color: palette.textSecondary },
  errorText: { fontSize: 13, color: palette.danger },
  warningText: { fontSize: 12, color: palette.amber },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  rowOn: { borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  rowDisabled: { opacity: 0.65, borderStyle: "dashed" },
  rowTitle: { fontSize: 15, fontWeight: "700", color: palette.heading },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  status: { fontSize: 10, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  statusOn: { color: palette.success, backgroundColor: palette.successSoft },
  statusOff: { color: palette.textSecondary, backgroundColor: palette.track },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 46, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, fontSize: 15, color: palette.text },
  invalid: { borderColor: palette.danger },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  preview: { gap: 8, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  previewLabel: { ...typography.overline, color: palette.textMuted },
  previewSubject: { fontSize: 16, fontWeight: "800", color: palette.heading },
  previewText: { fontSize: 14, lineHeight: 21, color: palette.text },
  attachment: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: palette.track },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface }
});
