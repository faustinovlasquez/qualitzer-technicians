import { useContext, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CreationOptions, CreationOptionsQuery } from "../../domain/creation";
import { Button, Field, IconButton } from "../../ui/components";
import { palette, typography } from "../../ui/theme";
import { CreationCatalogSelector, type CreationCatalogCache } from "./CreationCatalogSelector";
import { CreationModal } from "./CreationModal";
import { DeviceSecurityContext } from "../../security/DeviceSecurityContext";
import type { CatalogItem } from "./creationForm";
import { lookupEquipment, type EquipmentLookupContext, type EquipmentLookupResult } from "./equipmentLookup";

interface Props extends EquipmentLookupContext {
  required: boolean;
  editing?: boolean;
  disabled: boolean;
  selected: CatalogItem | null;
  error?: string;
  cache: CreationCatalogCache;
  onLoadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>;
  onSelect: (item: CatalogItem | null) => void;
}

export function CreationEquipmentLookup(props: Props) {
  const security = useContext(DeviceSecurityContext);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"code" | "catalog">("code");
  const owner = JSON.stringify([props.companyBranchId, props.userId, props.workerId]);
  const openedFor = useRef<{ owner: string } | null>(null);
  const selectionSession = openedFor.current;
  const latest = useRef({ props, security, owner }); latest.current = { props, security, owner };
  const [text, setText] = useState("");
  const [searched, setSearched] = useState("");
  const [result, setResult] = useState<EquipmentLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);
  const disabled = useRef(props.disabled);
  disabled.current = props.disabled;
  useEffect(() => () => { ticket.current += 1; }, []);
  useEffect(() => { close(); }, [owner, props.disabled, security?.blocked]);

  function close(): void { ticket.current++; openedFor.current = null; setOpen(false); setLoading(false); setResult(null); setError(""); }
  function permitted(): boolean { return !latest.current.props.disabled && (latest.current.security?.isUnlocked() ?? true); }
  function begin(): void {
    if (!permitted()) return;
    ticket.current++; openedFor.current = { owner: latest.current.owner }; setText(""); setResult(null); setError(""); setLoading(false); setMode("code"); setOpen(true);
  }
  function select(item: CatalogItem): void {
    if (!permitted() || !selectionSession || openedFor.current !== selectionSession || selectionSession.owner !== latest.current.owner) return;
    latest.current.props.onSelect(item); close();
  }

  async function search(page = 0): Promise<void> {
    if (!permitted() || !selectionSession || openedFor.current !== selectionSession || selectionSession.owner !== latest.current.owner || loading || !text.trim()) return;
    const request = ++ticket.current;
    const query = page === 0 ? text.trim() : searched;
    setLoading(true);
    setError("");
    if (page === 0) { setResult(null); setSearched(query); }
    try {
      const next = await lookupEquipment(props, query, page, props.cache, props.onLoadOptions);
      if (ticket.current !== request || !permitted() || openedFor.current !== selectionSession || selectionSession.owner !== latest.current.owner) return;
      setResult((previous) => ({ ...next, items: [...new Map([...(page === 0 ? [] : previous?.items ?? []), ...next.items].map((item) => [item.id, item])).values()] }));
    } catch {
      if (ticket.current === request && !disabled.current) setError("No se pudo verificar el número interno. Reintenta o abre el catálogo. Tu selección anterior se conserva.");
    } finally {
      if (ticket.current === request) setLoading(false);
    }
  }

  return <View style={styles.section}>
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.label}>{props.required ? "Equipo *" : "Equipo (opcional)"}</Text>
      {props.selected ? <View style={styles.actions}><IconButton name="swap-horizontal-outline" label="Cambiar equipo" disabled={props.disabled} onPress={begin} /><IconButton name="close-outline" label="Quitar equipo" disabled={props.disabled} onPress={() => { if (permitted()) { close(); latest.current.props.onSelect(null); } }} /></View> : null}
    </View>
    {props.selected ? <View style={styles.summary} testID="selected-equipment-summary">
      <Ionicons name="checkmark-circle" size={24} color={palette.success} accessible={false} />
      <View style={styles.information}><Text style={styles.selected} accessibilityLiveRegion="polite">Equipo seleccionado</Text>
        <Text style={styles.body}>{props.selected.label}</Text>
        {props.selected.internalNumber || props.selected.identifier ? <Text style={styles.hint}>{[props.selected.internalNumber ? `N.º interno: ${props.selected.internalNumber}` : "", props.selected.identifier ? `Identificación: ${props.selected.identifier}` : ""].filter(Boolean).join(" · ")}</Text> : null}
      </View>
    </View> : <Button title="Asociar equipo" icon="add-outline" variant="secondary" disabled={props.disabled} onPress={begin} />}
    {props.error ? <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text> : null}
    {open && openedFor.current?.owner === owner && !props.disabled && !security?.blocked ? <CreationModal title={props.selected ? "Cambiar equipo" : "Asociar equipo"} onClose={close}>
      <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Búsqueda de equipo">
        {(["code", "catalog"] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === "code" ? "Código" : "Catálogo"} accessibilityState={{ selected: mode === value }}
          onPress={() => { ticket.current++; setLoading(false); setResult(null); setError(""); setMode(value); }} style={[styles.tab, mode === value && styles.activeTab]}>
          <Text style={styles.tabText}>{value === "code" ? "Código" : "Catálogo"}</Text>
        </Pressable>)}
      </View>
      {mode === "code" ? <View style={styles.section}>
        <Field label="Código / número interno" value={text} maxLength={100} autoCapitalize="none" autoCorrect={false} placeholder="Ej. EQ-008" returnKeyType="search"
          onChangeText={value => { ticket.current++; setText(value.replace(/[\x00-\x1f\x7f]/g, "")); setResult(null); setError(""); setLoading(false); }} onSubmitEditing={() => void search()} />
        <Button title="Buscar equipo" icon="search-outline" loading={loading} disabled={!text.trim()} onPress={() => void search()} />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {result ? <View style={styles.section}>
          {result.cachedOnly ? <Text style={styles.hint}>Resultados guardados · sin conexión</Text> : null}
          {!result.items.length ? <Text style={styles.hint}>{result.cachedOnly ? "Sin coincidencias guardadas para este código." : "No se encontró ese número interno."}</Text> : null}
          {result.items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Seleccionar ${item.label}`} onPress={() => select({ id: item.id, label: item.label, internalNumber: item.internalNumber, identifier: item.identifier, equipmentType: item.equipmentType })} style={styles.result}>
            <Text style={[styles.body, styles.information]}>{item.label}</Text><Ionicons name="add-circle-outline" size={22} color={palette.primary} accessible={false} />
          </Pressable>)}
          {result.hasMore ? <Button title="Ver más coincidencias" variant="secondary" disabled={loading} onPress={() => void search(result.page + 1)} /> : null}
        </View> : null}
      </View> : <CreationCatalogSelector embedded resource="equipment" companyBranchId={props.companyBranchId} userId={props.userId} workerId={props.workerId} selected={props.selected} cache={props.cache} onLoadOptions={props.onLoadOptions} onSelect={select} onClose={close} />}
    </CreationModal> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10, minWidth: 0 }, heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  actions: { flexDirection: "row", gap: 4 }, summary: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, information: { flex: 1, minWidth: 0, gap: 4 },
  label: { ...typography.label, color: palette.text, flexShrink: 1 }, body: { ...typography.body, color: palette.text, flexShrink: 1 },
  selected: { ...typography.caption, fontWeight: "700", color: palette.success }, hint: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.caption, color: palette.danger },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderColor: palette.border }, tab: { flex: 1, minWidth: 0, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 8, borderBottomWidth: 2, borderColor: "transparent" },
  activeTab: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, tabText: { ...typography.label, color: palette.text, flexShrink: 1 },
  result: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: palette.border },
});