import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal } from "../../security/DeviceSecurityContext";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";

/** Ventana de selección a pantalla casi completa, con título y cierre. */
export function PickerSheet({ title, onClose, children, footer, search }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; search?: ReactNode }) {
  return <PrivateModal visible transparent animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.overlay}>
      <View style={styles.panel} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
          <IconButton name="close" label="Cerrar" onPress={onClose} />
        </View>
        {search}
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {footer}
      </View>
    </SafeAreaView>
  </PrivateModal>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <View style={styles.search}>
    <Ionicons name="search-outline" size={18} color={palette.textMuted} accessible={false} />
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={palette.textMuted} style={styles.searchInput}
      autoCorrect={false} returnKeyType="search" accessibilityLabel={placeholder} />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" hitSlop={8} onPress={() => onChange("")}><Ionicons name="close-circle" size={18} color={palette.textMuted} /></Pressable> : null}
  </View>;
}

export function OptionRow({ title, subtitle, selected, multiple, onPress, leading }: { title: string; subtitle?: string | null; selected: boolean; multiple?: boolean; onPress: () => void; leading?: ReactNode }) {
  return <Pressable accessibilityRole={multiple ? "checkbox" : "radio"} accessibilityState={{ checked: selected }} aria-checked={selected} onPress={onPress}
    style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.optionPressed]}>
    {leading}
    <View style={styles.optionText}>
      <Text style={[styles.optionTitle, selected && styles.optionTitleOn]} numberOfLines={2}>{title}</Text>
      {subtitle ? <Text style={styles.optionSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
    </View>
    <Ionicons name={multiple ? (selected ? "checkbox" : "square-outline") : (selected ? "radio-button-on" : "radio-button-off")} size={22}
      color={selected ? palette.primary : palette.textMuted} accessible={false} />
  </Pressable>;
}

export function PickerState({ loading, error, empty, onRetry }: { loading: boolean; error: string; empty: string | null; onRetry?: () => void }) {
  if (loading) return <View style={styles.state}><ActivityIndicator color={palette.primary} /><Text style={styles.stateText}>Cargando…</Text></View>;
  if (error) return <View style={styles.state}><Text style={[styles.stateText, { color: palette.danger }]}>{error}</Text>{onRetry ? <Button title="Reintentar" variant="secondary" icon="refresh" onPress={onRetry} /> : null}</View>;
  if (empty) return <View style={styles.state}><Ionicons name="search-outline" size={26} color={palette.textMuted} accessible={false} /><Text style={styles.stateText}>{empty}</Text></View>;
  return null;
}

/** Acción "crear nuevo" al inicio de una lista. */
export interface PickerAction { label: string; onPress: () => void }
function ActionRow({ action }: { action: PickerAction }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} style={({ pressed }) => [styles.action, pressed && styles.optionPressed]}>
    <View style={styles.actionIcon}><Ionicons name="add" size={20} color={palette.white} accessible={false} /></View>
    <Text style={styles.actionText}>{action.label}</Text>
  </Pressable>;
}

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lista local con búsqueda (por ejemplo, clientes o naves): una opción. */
export function LocalPicker<T extends { id: number }>({ title, placeholder, load, label, detail, selectedId, onPick, onClose, emptyText, action }: {
  title: string; placeholder: string; load: () => Promise<T[]>; label: (item: T) => string; detail?: (item: T) => string | null;
  selectedId: number | null; onPick: (item: T) => void; onClose: () => void; emptyText: string; action?: PickerAction;
}) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const loader = useRef(load);
  loader.current = load;
  const fetchItems = () => { setError(""); setItems(null); loader.current().then(setItems, (failure: unknown) => setError(failure instanceof Error ? failure.message : "No se pudo cargar la lista.")); };
  useEffect(fetchItems, []);
  const visible = useMemo(() => {
    const term = normalize(query.trim());
    const all = items ?? [];
    return (term ? all.filter((item) => normalize(`${label(item)} ${detail?.(item) ?? ""}`).includes(term)) : all).slice(0, 200);
  }, [items, query]);
  return <PickerSheet title={title} onClose={onClose} search={<SearchBox value={query} onChange={setQuery} placeholder={placeholder} />}>
    {action ? <ActionRow action={action} /> : null}
    <PickerState loading={items === null && !error} error={error} empty={items !== null && visible.length === 0 ? (query ? "Sin resultados para esa búsqueda." : emptyText) : null} onRetry={fetchItems} />
    {visible.map((item) => <OptionRow key={item.id} title={label(item)} subtitle={detail?.(item)} selected={item.id === selectedId} onPress={() => onPick(item)} />)}
    {items !== null && (items.length > visible.length) && !query ? <Text style={styles.more}>Escribe para buscar entre {items.length} opciones.</Text> : null}
  </PickerSheet>;
}

/** Lista con búsqueda en el servidor y "Cargar más" (por ejemplo, equipos). */
export function RemotePicker<T extends { id: number }>({ title, placeholder, load, label, detail, leading, selectedId, onPick, onClose, emptyText }: {
  title: string; placeholder: string; load: (search: string, page: number) => Promise<{ items: T[]; hasMore: boolean }>;
  label: (item: T) => string; detail?: (item: T) => string | null; leading?: (item: T) => ReactNode;
  selectedId: number | null; onPick: (item: T) => void; onClose: () => void; emptyText: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loader = useRef(load);
  loader.current = load;
  const revision = useRef(0);
  async function fetchPage(search: string, target: number) {
    const read = ++revision.current;
    setLoading(true); setError("");
    try {
      const result = await loader.current(search, target);
      if (read !== revision.current) return;
      setItems((current) => target === 0 ? result.items : [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setHasMore(result.hasMore); setPage(target);
    } catch (failure) {
      if (read === revision.current) setError(failure instanceof Error ? failure.message : "No se pudo cargar la lista.");
    } finally {
      if (read === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => { void fetchPage(query.trim(), 0); }, query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [query]);
  return <PickerSheet title={title} onClose={onClose} search={<SearchBox value={query} onChange={setQuery} placeholder={placeholder} />}
    footer={hasMore && !loading ? <Button title="Cargar más" variant="secondary" icon="chevron-down" onPress={() => void fetchPage(query.trim(), page + 1)} /> : null}>
    {items.map((item) => <OptionRow key={item.id} title={label(item)} subtitle={detail?.(item)} leading={leading?.(item)} selected={item.id === selectedId} onPress={() => onPick(item)} />)}
    <PickerState loading={loading} error={error} empty={!loading && !error && items.length === 0 ? (query ? "Sin resultados para esa búsqueda." : emptyText) : null} onRetry={() => void fetchPage(query.trim(), page)} />
  </PickerSheet>;
}

/** Varias opciones con casillas (sucursales o contactos del cliente). */
export function MultiPicker<T extends { id: number }>({ title, items, label, detail, selected, onConfirm, onClose, emptyText, action }: {
  title: string; items: T[]; label: (item: T) => string; detail?: (item: T) => string | null; selected: number[];
  onConfirm: (ids: number[]) => void; onClose: () => void; emptyText: string; action?: PickerAction;
}) {
  const [chosen, setChosen] = useState<number[]>(selected);
  const toggle = (itemId: number) => setChosen((current) => current.includes(itemId) ? current.filter((value) => value !== itemId) : [...current, itemId]);
  return <PickerSheet title={title} onClose={onClose}
    footer={<Button title={chosen.length === 0 ? "Sin seleccionar" : `Usar ${chosen.length} seleccionado(s)`} icon="checkmark" onPress={() => onConfirm(chosen)} />}>
    {action ? <ActionRow action={action} /> : null}
    {items.length === 0 ? <PickerState loading={false} error="" empty={emptyText} /> : null}
    {items.map((item) => <OptionRow key={item.id} multiple title={label(item)} subtitle={detail?.(item)} selected={chosen.includes(item.id)} onPress={() => toggle(item.id)} />)}
  </PickerSheet>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(18,44,58,0.55)" },
  panel: { width: "100%", maxWidth: 640, alignSelf: "center", maxHeight: "92%", minHeight: "60%", gap: 10, padding: 16, paddingBottom: 20,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: palette.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: palette.heading },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  searchInput: { flex: 1, fontSize: 15, color: palette.text, paddingVertical: 0 },
  list: { gap: 8, paddingBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  optionOn: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  optionPressed: { opacity: 0.8 },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionTitle: { fontSize: 15, fontWeight: "700", color: palette.text },
  optionTitleOn: { color: palette.primary },
  optionSubtitle: { ...typography.caption, color: palette.textSecondary },
  state: { alignItems: "center", gap: 10, paddingVertical: 28, paddingHorizontal: 12 },
  stateText: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  action: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: palette.primary, backgroundColor: palette.primarySoft },
  actionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  actionText: { flex: 1, fontSize: 15, fontWeight: "800", color: palette.primary },
  more: { ...typography.caption, color: palette.textSecondary, textAlign: "center", paddingVertical: 8 }
});
