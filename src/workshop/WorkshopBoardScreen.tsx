import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { IconButton, type IconName } from "../ui/components";
import { palette, radius, theme, typography } from "../ui/theme";
import { animateNextLayout } from "../ui/motion";
import { isWorkshopEntryOverdue, workshopAreaHasRoom, workshopStatusLabel, type WorkshopArea, type WorkshopEntry } from "../domain/workshopBoard";
import type { useWorkshopBoard } from "./useWorkshopBoard";

type WorkshopModel = ReturnType<typeof useWorkshopBoard>;
type Chip = "all" | "inProgress" | "pending" | "overdue";
const nativeDriver = Platform.OS !== "web";

/** Aparece con un desplazamiento suave. */
function FadeIn({ index, children }: { index: number; children: ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 260, delay: Math.min(index, 8) * 40, useNativeDriver: nativeDriver }).start();
  }, [progress, index]);
  return <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>{children}</Animated.View>;
}

function Tag({ label, color, soft, icon }: { label: string; color: string; soft: string; icon?: IconName }) {
  return <View style={[styles.tag, { backgroundColor: soft }]}>
    {icon ? <Ionicons name={icon} size={12} color={color} accessible={false} /> : null}
    <Text style={[styles.tagText, { color }]} numberOfLines={1}>{label}</Text>
  </View>;
}

const shortDate = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(iso));

function EntryCard({ entry }: { entry: WorkshopEntry }) {
  const overdue = isWorkshopEntryOverdue(entry);
  return <View style={[styles.card, entry.isReceptionPending && styles.cardPending]} accessible accessibilityLabel={`${entry.code}, ${entry.equipmentLabel}`}>
    <View style={styles.thumb}>
      {entry.imageUrl ? <Image source={{ uri: entry.imageUrl }} style={styles.thumbImage} resizeMode="cover" accessible={false} />
        : <Ionicons name={entry.isReceptionPending ? "construct-outline" : "image-outline"} size={24} color={palette.textMuted} accessible={false} />}
    </View>
    <View style={styles.cardBody}>
      <View style={styles.cardTop}>
        <Text style={styles.code}>{entry.code}</Text>
        {entry.isReceptionPending
          ? <Tag label="Pendiente por terminar" color={palette.orange} soft={palette.orangeSoft} />
          : <View style={[styles.status, { backgroundColor: entry.statusColor ?? palette.textSecondary }]}><Text style={styles.statusText} numberOfLines={1}>{workshopStatusLabel(entry.statusKey)}</Text></View>}
      </View>
      <Text style={styles.equipment} numberOfLines={1}>{entry.equipmentLabel}</Text>
      <Text style={styles.customer} numberOfLines={1}>{entry.isInternalEntry ? "Equipo propio" : entry.customerName ?? "Sin cliente"}{entry.equipmentCode ? ` · ${entry.equipmentCode}` : ""}</Text>
      {entry.isReceptionPending
        ? <Text style={styles.pendingText}>Falta la firma de recepción</Text>
        : <View style={styles.tags}>
          <Tag label={`${entry.daysInArea} d en nave`} color={palette.success} soft={palette.successSoft} icon="time-outline" />
          <Tag label={entry.estimatedDeliveryAt ? `${overdue ? "Atrasado · " : "Entrega "}${shortDate(entry.estimatedDeliveryAt)}` : "Sin fecha de entrega"}
            color={!entry.estimatedDeliveryAt ? palette.textSecondary : overdue ? palette.danger : palette.orange}
            soft={!entry.estimatedDeliveryAt ? palette.track : overdue ? palette.dangerSoft : palette.orangeSoft} icon="calendar-outline" />
          {entry.negotiationsCount > 0 ? <Tag label={`${entry.negotiationsCount} OT`} color={palette.info} soft={palette.infoSoft} icon="document-text-outline" /> : null}
        </View>}
    </View>
  </View>;
}

function AreaSection({ area, index }: { area: WorkshopArea; index: number }) {
  const occupancy = area.hasUnlimitedSlots ? `${area.occupiedSlots} en nave` : area.occupiedSlots === 0 ? "Libre" : `${area.occupiedSlots} de ${area.maxSlots}`;
  return <FadeIn index={index}>
    <View style={styles.area}>
      <View style={styles.areaHeader}>
        <Ionicons name="business-outline" size={17} color={palette.primary} accessible={false} />
        <Text style={styles.areaTitle} numberOfLines={1} accessibilityRole="header">{area.title}</Text>
        <View style={[styles.occupancy, area.entries.length === 0 && styles.occupancyFree]}>
          <Text style={[styles.occupancyText, area.entries.length === 0 && styles.occupancyTextFree]}>{occupancy}</Text>
        </View>
      </View>
      {area.entries.length > 0 ? area.entries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
        : <View style={styles.free}><Ionicons name="checkmark-circle-outline" size={18} color={palette.primary} accessible={false} />
          <Text style={styles.freeText}>{workshopAreaHasRoom(area) ? "Nave libre, sin equipos" : "Sin ingresos visibles"}</Text></View>}
    </View>
  </FadeIn>;
}

/** Taller: naves una debajo de otra con sus ingresos (solo lectura). */
export function WorkshopBoardScreen({ workshop }: { workshop: WorkshopModel }) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [chip, setChip] = useState<Chip>("all");
  const [picker, setPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const areas = useMemo(() => workshop.board?.areas ?? [], [workshop.board]);
  const allEntries = useMemo(() => areas.flatMap((area) => area.entries), [areas]);
  const counts = {
    all: allEntries.length,
    inProgress: allEntries.filter((entry) => entry.statusKey === "IN_PROGRESS").length,
    pending: allEntries.filter((entry) => entry.isReceptionPending).length,
    overdue: allEntries.filter((entry) => isWorkshopEntryOverdue(entry)).length
  };
  const normalized = query.trim().toLowerCase();
  const visibleAreas = useMemo(() => areas.map((area) => ({
    ...area,
    entries: area.entries.filter((entry) => {
      if (chip === "inProgress" && entry.statusKey !== "IN_PROGRESS") return false;
      if (chip === "pending" && !entry.isReceptionPending) return false;
      if (chip === "overdue" && !isWorkshopEntryOverdue(entry)) return false;
      if (normalized === "") return true;
      return [entry.code, entry.title, entry.equipmentLabel, entry.equipmentCode, entry.customerName, area.title].join(" ").toLowerCase().includes(normalized);
    })
  })).filter((area) => (chip === "all" && normalized === "") || area.entries.length > 0), [areas, chip, normalized]);
  const workshopName = workshop.workshops?.find((item) => item.id === workshop.workshopId)?.name ?? "Elegir taller";
  const chips: Array<{ id: Chip; label: string; count: number }> = [
    { id: "all", label: "Todos", count: counts.all }, { id: "inProgress", label: "En proceso", count: counts.inProgress },
    { id: "pending", label: "Falta firma", count: counts.pending }, { id: "overdue", label: "Atrasados", count: counts.overdue }
  ];
  async function refresh() { setRefreshing(true); try { await workshop.refresh(); } finally { setRefreshing(false); } }

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.primary} colors={[palette.primary]} />}>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}><Ionicons name="construct" size={20} color={palette.white} accessible={false} /></View>
          <View style={styles.heroText}>
            <Text accessibilityRole="header" style={styles.heroTitle}>Taller</Text>
            <Text style={styles.heroSubtitle}>{counts.all === 1 ? "1 equipo en naves" : `${counts.all} equipos en naves`}</Text>
          </View>
          <IconButton name={searching ? "close-outline" : "search-outline"} label={searching ? "Cerrar búsqueda" : "Buscar"} onPress={() => { animateNextLayout(); if (searching) setQuery(""); setSearching((value) => !value); }} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Taller: ${workshopName}`} disabled={(workshop.workshops?.length ?? 0) < 2} onPress={() => setPicker(true)} style={styles.select}>
          <Ionicons name="storefront-outline" size={17} color={palette.primary} accessible={false} />
          <Text style={styles.selectText} numberOfLines={1}>{workshopName}</Text>
          {(workshop.workshops?.length ?? 0) > 1 ? <Ionicons name="chevron-down" size={16} color={palette.textSecondary} accessible={false} /> : null}
        </Pressable>
        {searching ? <View style={styles.search}>
          <Ionicons name="search-outline" size={17} color={palette.textMuted} accessible={false} />
          <TextInput value={query} onChangeText={setQuery} autoFocus placeholder="Buscar ingreso, equipo o cliente" placeholderTextColor={palette.textMuted}
            style={styles.searchInput} returnKeyType="search" accessibilityLabel="Buscar en el taller" />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" hitSlop={8} onPress={() => setQuery("")}><Ionicons name="close-circle" size={18} color={palette.textMuted} /></Pressable> : null}
        </View> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {chips.map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: chip === option.id }} onPress={() => setChip(option.id)}
          style={[styles.chip, chip === option.id && styles.chipOn]}>
          <Text style={[styles.chipText, chip === option.id && styles.chipTextOn]}>{option.label}</Text>
          <View style={[styles.chipCount, chip === option.id && styles.chipCountOn]}><Text style={[styles.chipCountText, chip === option.id && styles.chipTextOn]}>{option.count}</Text></View>
        </Pressable>)}
      </ScrollView>

      {workshop.error ? <View accessibilityRole="alert" style={styles.alert}>
        <Ionicons name="cloud-offline-outline" size={20} color={palette.danger} accessible={false} />
        <Text style={styles.alertText}>{workshop.error}</Text>
      </View> : null}
      {workshop.workshops !== null && workshop.workshops.length === 0 ? <View style={styles.empty}>
        <View style={styles.emptyIcon}><Ionicons name="storefront-outline" size={30} color={palette.primary} accessible={false} /></View>
        <Text style={styles.emptyTitle}>Sin talleres en esta sucursal</Text>
        <Text style={styles.emptyText}>Cuando la sucursal tenga talleres con naves configuradas, aparecerán aquí.</Text>
      </View> : null}
      {!workshop.board && !workshop.error && workshop.workshops?.length !== 0 ? <Text style={styles.loading}>Cargando naves…</Text> : null}
      {workshop.board && visibleAreas.length === 0 ? <View style={styles.empty}>
        <View style={styles.emptyIcon}><Ionicons name={normalized || chip !== "all" ? "search-outline" : "business-outline"} size={30} color={palette.primary} accessible={false} /></View>
        <Text style={styles.emptyTitle}>{normalized || chip !== "all" ? "Sin resultados" : "Sin naves configuradas"}</Text>
        <Text style={styles.emptyText}>{normalized || chip !== "all" ? "Prueba con otra búsqueda o filtro." : "Este taller todavía no tiene naves."}</Text>
      </View> : null}
      {visibleAreas.map((area, index) => <AreaSection key={area.id} area={area} index={index} />)}
    </ScrollView>

    <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
      <Pressable style={styles.backdrop} accessibilityLabel="Cerrar" onPress={() => setPicker(false)}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>Taller</Text>
          {(workshop.workshops ?? []).map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: workshop.workshopId === option.id }}
            onPress={() => { workshop.selectWorkshop(option.id); setPicker(false); }} style={[styles.sheetOption, workshop.workshopId === option.id && styles.sheetOptionOn]}>
            <Ionicons name="storefront-outline" size={18} color={workshop.workshopId === option.id ? palette.primary : palette.textSecondary} accessible={false} />
            <Text style={[styles.sheetText, workshop.workshopId === option.id && styles.sheetTextOn]} numberOfLines={1}>{option.name}</Text>
            {workshop.workshopId === option.id ? <Ionicons name="checkmark" size={18} color={palette.primary} accessible={false} /> : null}
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 14, paddingBottom: 28 },
  hero: { gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, ...theme.shadow },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  heroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  heroText: { flex: 1, minWidth: 0 }, heroTitle: { ...typography.heading, color: palette.heading }, heroSubtitle: { ...typography.caption, color: palette.textSecondary },
  select: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  selectText: { flex: 1, ...typography.label, color: palette.text },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.surface },
  searchInput: { flex: 1, fontSize: 15, color: palette.text, paddingVertical: 0 },
  chips: { gap: 8, paddingRight: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 14, paddingRight: 8, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { borderColor: palette.primary, backgroundColor: palette.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: palette.textSecondary }, chipTextOn: { color: palette.white },
  chipCount: { minWidth: 22, paddingHorizontal: 6, height: 20, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  chipCountOn: { backgroundColor: "rgba(255,255,255,0.22)" }, chipCountText: { fontSize: 11, fontWeight: "800", color: palette.textSecondary },
  alert: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.danger, backgroundColor: palette.dangerSoft },
  alertText: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" },
  loading: { ...typography.caption, color: palette.textSecondary, textAlign: "center", paddingVertical: 20 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 34, paddingHorizontal: 20, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  emptyTitle: { ...typography.label, fontSize: 16, color: palette.text }, emptyText: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  area: { gap: 8 },
  areaHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  areaTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: palette.heading },
  occupancy: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: palette.successSoft },
  occupancyFree: { backgroundColor: palette.track },
  occupancyText: { fontSize: 12, fontWeight: "800", color: palette.success }, occupancyTextFree: { color: palette.textSecondary },
  free: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  freeText: { fontSize: 13, fontWeight: "700", color: palette.primary },
  card: { flexDirection: "row", gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, ...theme.shadow },
  cardPending: { borderColor: palette.orange },
  thumb: { width: 56, height: 56, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  thumbImage: { width: 56, height: 56 },
  cardBody: { flex: 1, minWidth: 0, gap: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  code: { fontSize: 12, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  status: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, maxWidth: 170 },
  statusText: { fontSize: 11, fontWeight: "800", color: palette.white },
  equipment: { fontSize: 14, lineHeight: 19, fontWeight: "800", color: palette.heading },
  customer: { ...typography.caption, color: palette.textSecondary },
  pendingText: { fontSize: 12, fontWeight: "700", color: palette.orange, marginTop: 2 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 3 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  tagText: { fontSize: 11, fontWeight: "700" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { gap: 4, padding: 16, paddingBottom: 28, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: palette.surface },
  sheetTitle: { ...typography.label, fontSize: 16, color: palette.heading, marginBottom: 6 },
  sheetOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, minHeight: 48, borderRadius: radius.md },
  sheetOptionOn: { backgroundColor: palette.primarySoft }, sheetText: { flex: 1, fontSize: 15, color: palette.text }, sheetTextOn: { color: palette.primary, fontWeight: "800" }
});
