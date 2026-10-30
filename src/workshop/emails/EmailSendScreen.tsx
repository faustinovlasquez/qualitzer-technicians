import { useEffect, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { LocalPicker, MultiPicker } from "../intake/IntakePickers";
import { NewContactSheet } from "../intake/CustomerForms";
import { useAppPermission } from "../../application/appPermissions";
import { Notice } from "../entry/EntrySections";
import {
  EMAIL_PROVIDER_LABEL, type EmailEligibility, type EmailOptions, type EmailPreview, type EmailProvider, type EmailRecipient, type EmailSendResult
} from "../../domain/workshopCustomerEmail";
import type { useWorkshopBoard } from "../useWorkshopBoard";

type EmailsApi = ReturnType<typeof useWorkshopBoard>["emails"];
type IntakeApi = ReturnType<typeof useWorkshopBoard>["intake"];
/** Contacto con correo que se puede elegir en «Para»: del ingreso o del cliente. */
type ContactOption = { id: number; name: string; email: string; fromEntry: boolean };
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const splitEmails = (value: string) => value.split(/[,;\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);

/** Une listas de contactos sin repetir (por id o por correo); uno del ingreso sigue marcado como del ingreso. */
function mergeContacts(current: ContactOption[], next: ContactOption[]): ContactOption[] {
  const merged = [...current];
  for (const contact of next) {
    const found = merged.findIndex((item) => item.id === contact.id || item.email === contact.email);
    if (found === -1) merged.push(contact);
    else merged[found] = { ...merged[found], fromEntry: merged[found].fromEntry || contact.fromEntry };
  }
  return merged;
}

/**
 * Enviar la confirmación de ingreso al cliente (como en la web): plantilla, «Para» con los contactos del ingreso y del
 * cliente (y «+» para crear uno), con copia, certificado de ingreso adjunto y canal. La vista previa se abre en una ventana.
 * `contacts` (datos del ingreso) permite listar los contactos del cliente y crear uno nuevo.
 */
export function EmailSendScreen({ api, contacts, entryId, entryCode, onClose, onSent }: {
  api: EmailsApi; contacts?: IntakeApi; entryId: number; entryCode: string; onClose: () => void; onSent: (result: EmailSendResult) => void;
}) {
  const canCreateContacts = useAppPermission("workshopCustomers");
  const [eligibility, setEligibility] = useState<EmailEligibility | null>(null);
  const [options, setOptions] = useState<EmailOptions | null>(null);
  const [loadError, setLoadError] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [contactsNote, setContactsNote] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ccText, setCcText] = useState("");
  const [ccError, setCcError] = useState("");
  const [provider, setProvider] = useState<EmailProvider | null>(null);
  const [attachReport, setAttachReport] = useState(true);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  // Contactos del cliente del ingreso (con correo), para elegirlos además de los del ingreso.
  const loadCustomerContacts = async (select?: number) => {
    if (!contacts) return;
    try {
      const form = await contacts.form(entryId);
      if (!form.customer || form.isInternalEntry) return;
      setCustomer(form.customer);
      const detail = await contacts.customer(form.customer.id);
      const entryIds = new Set(form.contacts.map((item) => item.id));
      const found = detail.contacts.flatMap((item) => item.email && isEmail(item.email)
        ? [{ id: item.id, name: item.fullName, email: item.email.trim().toLowerCase(), fromEntry: entryIds.has(item.id) }] : []);
      setContactOptions((current) => mergeContacts(current, found));
      setContactsNote("");
      if (select !== undefined) {
        if (found.some((item) => item.id === select)) setSelectedIds((current) => current.includes(select) ? current : [...current, select]);
        else setContactsNote("Ese contacto no tiene correo: agrégaselo desde la web para enviarle la confirmación.");
      }
    } catch {
      setContactsNote("No se pudieron cargar los contactos del cliente. Puedes elegir los del ingreso.");
    }
  };

  const load = () => {
    setLoadError("");
    Promise.all([api.eligibility(entryId), api.options()])
      .then(([nextEligibility, nextOptions]) => {
        setEligibility(nextEligibility);
        setOptions(nextOptions);
        setTemplateId(nextEligibility.template?.id ?? nextOptions.templates.find((item) => item.isDefault)?.id ?? nextOptions.templates[0]?.id ?? null);
        const fromEntry = nextEligibility.recipients.map((recipient, index) => ({
          id: recipient.contactId ?? -(index + 1), name: recipient.name ?? recipient.email, email: recipient.email.toLowerCase(), fromEntry: true
        }));
        setContactOptions(fromEntry);
        setSelectedIds(fromEntry.map((item) => item.id));
        setCcText(nextEligibility.ccEmails.join(", "));
        setAttachReport(nextEligibility.attachReport);
        void loadCustomerContacts();
      })
      .catch((failure: unknown) => setLoadError(failureText(failure, "No se pudo revisar el ingreso. Revisa tu conexión.")));
  };
  useEffect(load, [entryId]);

  const chosen = contactOptions.filter((item) => selectedIds.includes(item.id));
  const recipients: EmailRecipient[] = useMemo(() => chosen.map((item) => ({ email: item.email, name: item.name, contactId: item.id > 0 ? item.id : null })),
    [contactOptions, selectedIds]);

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

  const template = options?.templates.find((item) => item.id === templateId) ?? null;
  const blocked = (eligibility?.issues.length ?? 0) > 0;
  const warnings = (eligibility?.warnings ?? []).filter((warning) => warning.code !== "NO_RECIPIENTS" || recipients.length === 0);

  const send = async () => {
    if (sending || recipients.length === 0 || templateId === null) return;
    const cc = splitEmails(ccText);
    const invalidCc = cc.filter((email) => !isEmail(email));
    if (invalidCc.length > 0) { setCcError(`Revisa: ${invalidCc.join(", ")}`); return; }
    setSending(true);
    setSendError("");
    try {
      // Un contacto del cliente que no estaba en el ingreso queda unido al ingreso al enviar (como en la web).
      const result = await api.send(entryId, {
        templateId, recipients, cc: [...new Set(cc)].slice(0, 20), attachReport, saveNewContacts: chosen.some((item) => !item.fromEntry), provider
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

            {/* «Para»: lista de contactos del ingreso y del cliente (con correo) y «+» para crear uno, como en la web. */}
            <View style={styles.section}>
              <Text style={styles.label}>Para *</Text>
              <View style={[styles.addRow, styles.alignStart]}>
                {/* Las etiquetas (con su «x») y la zona que abre la lista van separadas: un botón no puede ir dentro de otro. */}
                <View style={styles.combo}>
                  {chosen.length > 0 ? <View style={styles.chips}>
                    {chosen.map((item) => <View key={item.id} style={styles.chip}>
                      <Text style={styles.chipText} numberOfLines={1}>{item.name} · {item.email}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${item.name}`} hitSlop={8} disabled={sending}
                        onPress={() => setSelectedIds((current) => current.filter((value) => value !== item.id))}>
                        <Ionicons name="close" size={14} color={palette.primary} />
                      </Pressable>
                    </View>)}
                  </View> : null}
                  <Pressable accessibilityRole="button" accessibilityLabel="Elegir los contactos que recibirán el correo" disabled={sending}
                    onPress={() => setChoosing(true)} style={({ pressed }) => [styles.comboTrigger, pressed && styles.pressed]}>
                    <Text style={[styles.comboPlaceholder, styles.grow]} numberOfLines={1}>
                      {chosen.length === 0 ? "Elige los contactos que recibirán el correo…" : "Agregar o quitar contactos"}</Text>
                    <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
                  </Pressable>
                </View>
                {contacts && customer && canCreateContacts ? <Pressable accessibilityRole="button" accessibilityLabel="Crear un contacto nuevo del cliente" disabled={sending}
                  onPress={() => setCreating(true)} style={({ pressed }) => [styles.plus, pressed && styles.pressed]}>
                  <Ionicons name="add" size={22} color={palette.primary} />
                </Pressable> : null}
              </View>
              <Text style={styles.hint}>Contactos del ingreso y del cliente con correo.{contacts && customer && canCreateContacts ? " Con el «+» creas un contacto nuevo del cliente." : ""}</Text>
              {eligibility.contactsWithoutEmail.length > 0 ? <Text style={styles.hint}>Sin correo: {eligibility.contactsWithoutEmail.join(", ")}</Text> : null}
              {contactsNote !== "" ? <Text style={styles.warningText}>{contactsNote}</Text> : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Con copia (opcional)</Text>
              <TextInput value={ccText} onChangeText={(value) => { setCcText(value); setCcError(""); }} placeholder="correo1@empresa.cl, correo2@empresa.cl"
                placeholderTextColor={palette.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                style={[styles.input, ccError !== "" && styles.invalid]} accessibilityLabel="Con copia" editable={!sending} />
              {ccError !== "" ? <Text style={styles.errorText}>{ccError}</Text> : null}
            </View>

            <View style={[styles.row, styles.switchCard]}>
              <Switch value={attachReport} onValueChange={setAttachReport} disabled={sending} />
              <Text style={[styles.rowTitle, styles.grow]}>Adjuntar certificado de ingreso (PDF)</Text>
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

            {sendError !== "" ? <Notice tone="danger" icon="alert-circle-outline" message={sendError} /> : null}
          </> : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Text style={styles.hint}>{recipients.length === 0 ? "Elige al menos un destinatario." : `${recipients.length} destinatario(s)`}</Text>
        <View style={styles.footerButtons}>
          <Button title="Vista previa" icon="eye-outline" variant="secondary" disabled={templateId === null} onPress={() => setPreviewOpen(true)} />
          <Button title="Enviar al cliente" icon="send" variant="warning" loading={sending} style={styles.grow}
            disabled={sending || blocked || recipients.length === 0 || templateId === null} onPress={() => void send()} />
        </View>
      </View>
      {previewOpen ? <Modal visible transparent animationType="fade" onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <View style={styles.dialogHead}>
              <Ionicons name="eye-outline" size={18} color={palette.primary} />
              <View style={styles.grow}>
                <Text style={styles.rowTitle}>Vista previa</Text>
                <Text style={styles.hint} numberOfLines={1}>{recipients[0] ? `Para ${recipients[0].name ?? recipients[0].email}` : "Sin destinatario elegido"}</Text>
              </View>
              <IconButton name="close" label="Cerrar vista previa" onPress={() => setPreviewOpen(false)} />
            </View>
            <ScrollView contentContainerStyle={styles.previewBody}>
              {previewLoading && preview === null ? <ActivityIndicator color={palette.primary} /> : null}
              {!previewLoading && preview === null ? <Text style={styles.hint}>No se pudo cargar la vista previa.</Text> : null}
              {preview !== null ? <>
                <Text style={styles.previewSubject}>{preview.subject}</Text>
                {attachReport && preview.attachmentName ? <View style={styles.attachment}>
                  <Ionicons name="document-attach-outline" size={16} color={palette.danger} />
                  <Text style={styles.hint} numberOfLines={1}>{preview.attachmentName}</Text>
                </View> : null}
                {preview.missing.length > 0 ? <Text style={styles.warningText}>Sin dato en este ingreso: {preview.missing.join(", ")}</Text> : null}
                {preview.paragraphs.map((paragraph, index) => <Text key={index} style={styles.previewText}>{paragraph}</Text>)}
              </> : null}
            </ScrollView>
          </View>
        </View>
      </Modal> : null}
      {choosing ? <MultiPicker title="Para" items={contactOptions} selected={selectedIds}
        label={(item) => item.name} detail={(item) => `${item.email} · ${item.fromEntry ? "contacto del ingreso" : "contacto del cliente"}`}
        emptyText="Ni el ingreso ni el cliente tienen contactos con correo."
        action={contacts && customer && canCreateContacts ? { label: "Crear contacto nuevo", onPress: () => { setChoosing(false); setCreating(true); } } : undefined}
        onConfirm={(ids) => { setSelectedIds(ids); setChoosing(false); }} onClose={() => setChoosing(false)} /> : null}
      {creating && contacts && customer ? <NewContactSheet customerName={customer.name} onClose={() => setCreating(false)}
        create={(input) => contacts.createContact(customer.id, input)}
        findDuplicates={(query) => contacts.contactDuplicates(customer.id, query)}
        onUseExisting={(contact) => { setCreating(false); void loadCustomerContacts(contact.id); }}
        onCreated={(contact) => {
          setCreating(false);
          if (contact.email && isEmail(contact.email)) {
            const option = { id: contact.id, name: contact.fullName, email: contact.email.trim().toLowerCase(), fromEntry: false };
            setContactOptions((current) => mergeContacts(current, [option]));
            setSelectedIds((current) => current.includes(contact.id) ? current : [...current, contact.id]);
            setContactsNote("");
          } else setContactsNote("El contacto se creó sin correo: no se le puede enviar la confirmación.");
        }} /> : null}
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
  pressed: { opacity: 0.75 },
  combo: { flex: 1, minHeight: 48, gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, justifyContent: "center" },
  comboTrigger: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34 },
  comboPlaceholder: { fontSize: 14, color: palette.textMuted },
  alignStart: { alignItems: "flex-start" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 10, paddingRight: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  chipText: { flexShrink: 1, fontSize: 12, fontWeight: "700", color: palette.primary },
  plus: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  switchCard: { gap: 10 },
  footerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(15,23,42,0.55)" },
  dialog: { width: "100%", maxWidth: 480, maxHeight: "85%", borderRadius: radius.lg, backgroundColor: palette.surface, overflow: "hidden" },
  dialogHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border },
  previewBody: { gap: 8, padding: 14 },
  previewSubject: { fontSize: 16, fontWeight: "800", color: palette.heading },
  previewText: { fontSize: 14, lineHeight: 21, color: palette.text },
  attachment: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: palette.track },
  footer: { gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface }
});
