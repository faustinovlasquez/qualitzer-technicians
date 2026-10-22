import { useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { BackHandler, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { IconButton, type IconName } from "../ui/components";
import { palette, radius, theme, typography } from "../ui/theme";
import { isWorkshopEntryOverdue, workshopStatusLabel, type WorkshopArea, type WorkshopEntry } from "../domain/workshopBoard";

const longDate = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

function Fact({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone?: string }) {
  return <View style={styles.fact}>
    <Ionicons name={icon} size={16} color={palette.textSecondary} accessible={false} />
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={[styles.factValue, tone ? { color: tone } : null]} numberOfLines={2}>{value}</Text>
  </View>;
}

/** Ficha del ingreso abierta desde el tablero. Atrás (botón o el del teléfono) vuelve al tablero. */
export function WorkshopEntryScreen({ entry, area, onBack }: { entry: WorkshopEntry; area: WorkshopArea; onBack: () => void }) {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back.current(); return true; });
    return () => subscription.remove();
  }, []);
  const overdue = isWorkshopEntryOverdue(entry);

  return <View style={styles.screen}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label="Volver al taller" onPress={onBack} />
      <View style={styles.barText}>
        <Text style={styles.barCode}>{entry.code}</Text>
        <Text style={styles.barArea} numberOfLines={1}>{area.title}</Text>
      </View>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.photo}>
          {entry.imageUrl ? <Image source={{ uri: entry.imageUrl }} style={styles.photoImage} resizeMode="cover" accessibilityLabel="Foto del equipo" />
            : <Ionicons name="image-outline" size={34} color={palette.textMuted} accessible={false} />}
        </View>
        <View style={styles.heroBody}>
          {entry.isReceptionPending
            ? <View style={[styles.status, { backgroundColor: palette.orangeSoft }]}><Text style={[styles.statusText, { color: palette.orange }]}>Pendiente por terminar</Text></View>
            : <View style={[styles.status, { backgroundColor: entry.statusColor ?? palette.textSecondary }]}><Text style={styles.statusText}>{workshopStatusLabel(entry.statusKey)}</Text></View>}
          {entry.subStatusName ? <Text style={styles.subStatus}>{entry.subStatusName}</Text> : null}
          <Text accessibilityRole="header" style={styles.equipment}>{entry.equipmentLabel}</Text>
          {entry.title ? <Text style={styles.title} numberOfLines={3}>{entry.title}</Text> : null}
        </View>
      </View>
      <View style={styles.card}>
        <Fact icon="person-outline" label="Cliente" value={entry.isInternalEntry ? "Equipo propio" : entry.customerName ?? "Sin cliente"} />
        {entry.equipmentCode ? <Fact icon="barcode-outline" label="Identificación" value={entry.equipmentCode} /> : null}
        <Fact icon="business-outline" label="Nave" value={area.title} />
        <Fact icon="time-outline" label="En nave" value={entry.daysInArea === 1 ? "1 día" : `${entry.daysInArea} días`} />
        <Fact icon="calendar-outline" label="Entrega estimada" value={entry.estimatedDeliveryAt ? `${longDate(entry.estimatedDeliveryAt)}${overdue ? " · atrasado" : ""}` : "Sin fecha"}
          tone={overdue ? palette.danger : undefined} />
        <Fact icon="document-text-outline" label="Cotizaciones y OT" value={String(entry.negotiationsCount)} />
      </View>
      {entry.isReceptionPending ? <View style={styles.notice} accessibilityRole="alert">
        <Ionicons name="alert-circle-outline" size={20} color={palette.orange} accessible={false} />
        <Text style={styles.noticeText}>Falta terminar el ingreso: inspección y firma de recepción.</Text>
      </View> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barCode: { fontSize: 15, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  barArea: { ...typography.caption, color: palette.textSecondary },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 14, paddingBottom: 28 },
  hero: { flexDirection: "row", gap: 14, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, ...theme.shadow },
  photo: { width: 84, height: 84, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  photoImage: { width: 84, height: 84 },
  heroBody: { flex: 1, minWidth: 0, gap: 5, alignItems: "flex-start" },
  status: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 12, fontWeight: "800", color: palette.white },
  subStatus: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
  equipment: { fontSize: 16, lineHeight: 21, fontWeight: "800", color: palette.heading },
  title: { ...typography.caption, color: palette.text },
  card: { padding: 14, gap: 12, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  fact: { flexDirection: "row", alignItems: "center", gap: 8 },
  factLabel: { width: 128, ...typography.caption, color: palette.textSecondary },
  factValue: { flex: 1, fontSize: 14, fontWeight: "700", color: palette.text },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.orange, backgroundColor: palette.orangeSoft },
  noticeText: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" }
});
