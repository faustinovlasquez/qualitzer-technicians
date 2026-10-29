import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { EMAIL_PROVIDER_LABEL, emailStatusLabel, type EmailHistory, type EmailHistoryItem } from "../../domain/workshopCustomerEmail";
import type { useWorkshopBoard } from "../useWorkshopBoard";
import { EmailSendScreen } from "./EmailSendScreen";

type EmailsApi = ReturnType<typeof useWorkshopBoard>["emails"];

const formatDate = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.toLocaleDateString("es-CL")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** «Correo al cliente» en la ficha del ingreso: estado de la confirmación, enviarla y ver el historial de envíos. */
export function EntryEmailCard({ api, entryId, entryCode }: { api: EmailsApi; entryId: number; entryCode: string }) {
  const [history, setHistory] = useState<EmailHistory | null>(null);
  const [error, setError] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(() => {
    setError(false);
    api.history(entryId).then(setHistory, () => setError(true));
  }, [api, entryId]);
  useEffect(() => { if (api.available) load(); }, [api.available, entryId]);

  if (!api.available) return null;
  const status = history ? emailStatusLabel(history.summary) : null;
  const sent = (history?.summary.sent ?? 0) > 0;
  const total = (history?.summary.sent ?? 0) + (history?.summary.failed ?? 0);

  return <View style={styles.card}>
    <View style={styles.head}>
      <View style={styles.icon}><Ionicons name={sent ? "mail-open" : "mail"} size={18} color={palette.white} /></View>
      <View style={styles.grow}>
        <Text style={styles.title}>Correo al cliente</Text>
        {status ? <Text style={[styles.status, status.tone === "success" ? styles.statusOk : status.tone === "danger" ? styles.statusBad : styles.statusPending]}>{status.label}</Text>
          : error ? <Text style={styles.hint}>No se pudo revisar el envío.</Text> : <ActivityIndicator size="small" color={palette.info} />}
      </View>
    </View>
    <View style={styles.actions}>
      <Button title={sent ? "Reenviar" : "Enviar al cliente"} icon="send" onPress={() => setSendOpen(true)} style={styles.grow} />
      <Button title={total > 0 ? `Envíos (${total})` : "Envíos"} icon="time-outline" variant="secondary" onPress={() => { setHistoryOpen(true); load(); }} />
    </View>

    {sendOpen ? <EmailSendScreen api={api} entryId={entryId} entryCode={entryCode} onClose={() => setSendOpen(false)} onSent={() => { setSendOpen(false); load(); }} /> : null}

    {historyOpen ? <Modal visible animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
      <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
        <View style={styles.bar}>
          <IconButton name="arrow-back" label="Cerrar" onPress={() => setHistoryOpen(false)} />
          <View style={styles.grow}>
            <Text style={styles.barTitle}>Envíos al cliente</Text>
            <Text style={styles.hint}>{entryCode}{history && history.summary.sent > 0 ? ` · enviado a ${history.summary.recipients} · leído por ${history.summary.read}` : ""}</Text>
          </View>
          <IconButton name="refresh" label="Actualizar" onPress={load} />
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {history === null && !error ? <ActivityIndicator color={palette.primary} /> : null}
          {history?.trackingReachable === false ? <Text style={styles.warning}>
            En este servidor no se pueden registrar lecturas (su dirección no es accesible desde internet). Los correos se envían igual.
          </Text> : null}
          {history !== null && history.items.length === 0 ? <Text style={styles.hint}>Aún no se ha enviado la confirmación.</Text> : null}
          {(history?.items ?? []).map((item) => <HistoryRow key={item.id} item={item} />)}
          <Text style={styles.hint}>La lectura se registra cuando el programa de correo del cliente muestra imágenes; si las bloquea, puede haberlo leído sin que se registre.</Text>
        </ScrollView>
        <View style={styles.footer}>
          <Button title={sent ? "Reenviar" : "Enviar al cliente"} icon="send" variant="warning" onPress={() => { setHistoryOpen(false); setSendOpen(true); }} />
        </View>
      </SafeAreaView>
    </Modal> : null}
  </View>;
}

function HistoryRow({ item }: { item: EmailHistoryItem }) {
  return <View style={styles.item}>
    <View style={styles.itemHead}>
      <Text style={styles.itemDate}>{formatDate(item.date)}</Text>
      <Text style={[styles.chip, item.status === "sent" ? styles.statusOk : styles.statusBad]}>{item.status === "sent" ? "Enviado" : "Falló"}</Text>
      {item.status === "sent" ? <Text style={[styles.chip, item.read ? styles.statusRead : styles.statusMuted]}>
        {item.read ? `Abierto ${item.readCount} ${item.readCount === 1 ? "vez" : "veces"}` : "Lectura no registrada"}
      </Text> : null}
    </View>
    <Text style={styles.line}><Text style={styles.strong}>Para: </Text>{item.recipients.join(", ")}</Text>
    <Text style={styles.line}><Text style={styles.strong}>Desde: </Text>{item.senderEmail ?? "—"}{item.provider ? ` (${EMAIL_PROVIDER_LABEL[item.provider]})` : ""}</Text>
    <Text style={styles.line}><Text style={styles.strong}>Por: </Text>{item.trigger === "automatic" ? "Envío automático" : item.responsibleName ?? "Manual"}</Text>
    {item.subject ? <Text style={styles.line} numberOfLines={2}><Text style={styles.strong}>Asunto: </Text>{item.subject}</Text> : null}
    {item.lastOpenedAt ? <Text style={styles.hint}>Última apertura: {formatDate(item.lastOpenedAt)}</Text> : null}
    {item.note ? <Pressable accessibilityRole="text" style={[styles.note, item.status === "sent" ? styles.noteInfo : styles.noteBad]}>
      <Text style={styles.noteText}>{item.note}</Text>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.infoBorder, backgroundColor: palette.infoSoft },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.info },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "800", color: palette.heading },
  status: { alignSelf: "flex-start", marginTop: 3, fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  statusOk: { color: palette.success, backgroundColor: palette.successSoft },
  statusBad: { color: palette.danger, backgroundColor: palette.dangerSoft },
  statusPending: { color: palette.amber, backgroundColor: palette.amberSoft },
  statusRead: { color: palette.info, backgroundColor: palette.infoSoft },
  statusMuted: { color: palette.textSecondary, backgroundColor: palette.track },
  actions: { flexDirection: "row", gap: 8 },
  hint: { ...typography.caption, color: palette.textSecondary },
  warning: { fontSize: 12, color: palette.amber, padding: 10, borderRadius: radius.md, backgroundColor: palette.amberSoft },
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  barTitle: { fontSize: 17, fontWeight: "800", color: palette.heading },
  list: { padding: 16, gap: 10 },
  item: { gap: 4, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  itemHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 2 },
  itemDate: { fontSize: 14, fontWeight: "800", color: palette.heading },
  chip: { fontSize: 10, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  line: { fontSize: 13, color: palette.text },
  strong: { fontWeight: "700" },
  note: { marginTop: 4, padding: 8, borderRadius: radius.sm },
  noteInfo: { backgroundColor: palette.infoSoft },
  noteBad: { backgroundColor: palette.dangerSoft },
  noteText: { fontSize: 12, color: palette.text },
  footer: { padding: 12, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface }
});
