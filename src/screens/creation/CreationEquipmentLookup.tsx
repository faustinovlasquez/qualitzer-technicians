import { useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CreationOptions, CreationOptionsQuery } from "../../domain/creation";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { CreationCatalogSelector, type CreationCatalogCache } from "./CreationCatalogSelector";
import { CreationModal } from "./CreationModal";
import { DeviceSecurityContext } from "../../security/DeviceSecurityContext";
import type { CatalogItem } from "./creationForm";
import type { EquipmentLookupContext } from "./equipmentLookup";

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
  const owner = JSON.stringify([props.companyBranchId, props.userId, props.workerId]);
  const openedFor = useRef<{ owner: string } | null>(null);
  const selectionSession = openedFor.current;
  const latest = useRef({ props, security, owner }); latest.current = { props, security, owner };
  const ticket = useRef(0);
  useEffect(() => () => { ticket.current += 1; }, []);
  useEffect(() => { close(); }, [owner, props.disabled, security?.blocked]);

  function close(): void { ticket.current++; openedFor.current = null; setOpen(false); }
  function permitted(): boolean { return !latest.current.props.disabled && (latest.current.security?.isUnlocked() ?? true); }
  function begin(): void {
    if (!permitted()) return;
    ticket.current++; openedFor.current = { owner: latest.current.owner }; setOpen(true);
  }
  function select(item: CatalogItem): void {
    if (!permitted() || !selectionSession || openedFor.current !== selectionSession || selectionSession.owner !== latest.current.owner) return;
    latest.current.props.onSelect(item); close();
  }

  return <View style={styles.section}>
    <View style={styles.heading}><View style={styles.titleRow}><Text accessibilityRole="header" style={styles.label}>{props.required ? "Equipo *" : "Equipo (opcional)"}</Text>
      {props.selected ? <View style={[styles.badge, styles.badgeOk]}><Ionicons name="checkmark-circle" size={14} color={palette.success} accessible={false} /><Text style={[styles.badgeText, styles.badgeTextOk]}>Elegido</Text></View>
        : props.required ? <View style={[styles.badge, styles.badgeMissing]}><Ionicons name="alert-circle" size={14} color={palette.orange} accessible={false} /><Text style={[styles.badgeText, styles.badgeTextMissing]}>Falta elegir</Text></View> : null}</View>
      {props.selected ? <View style={styles.actions}><IconButton name="swap-horizontal-outline" label="Cambiar equipo" disabled={props.disabled} onPress={begin} /><IconButton name="close-outline" label="Quitar equipo" disabled={props.disabled} onPress={() => { if (permitted()) { close(); latest.current.props.onSelect(null); } }} /></View> : null}
    </View>
    {props.selected ? <View style={[styles.summary, styles.summaryCard]} testID="selected-equipment-summary">
      <Ionicons name="checkmark-circle" size={24} color={palette.success} accessible={false} />
      <View style={styles.information}><Text style={styles.selected} accessibilityLiveRegion="polite">Equipo seleccionado</Text>
        <Text style={styles.body}>{props.selected.label}</Text>
        {props.selected.internalNumber || props.selected.identifier ? <Text style={styles.hint}>{[props.selected.internalNumber ? `N.º interno: ${props.selected.internalNumber}` : "", props.selected.identifier ? `Identificación: ${props.selected.identifier}` : ""].filter(Boolean).join(" · ")}</Text> : null}
      </View>
    </View> : <Button title="Asociar equipo" icon="add-outline" variant="secondary" disabled={props.disabled} onPress={begin} />}
    {props.error ? <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text> : null}
    {open && openedFor.current?.owner === owner && !props.disabled && !security?.blocked ? <CreationModal title={props.selected ? "Cambiar equipo" : "Asociar equipo"} onClose={close}>
      <CreationCatalogSelector embedded resource="equipment" companyBranchId={props.companyBranchId} userId={props.userId} workerId={props.workerId} selected={props.selected} cache={props.cache} onLoadOptions={props.onLoadOptions} onSelect={select} onClose={close} />
    </CreationModal> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10, minWidth: 0 }, heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 1 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  badgeOk: { backgroundColor: palette.successSoft, borderColor: palette.success }, badgeMissing: { backgroundColor: palette.orangeSoft, borderColor: palette.orange },
  badgeText: { ...typography.caption, fontWeight: "700" }, badgeTextOk: { color: palette.success }, badgeTextMissing: { color: palette.orange },
  summaryCard: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.success, backgroundColor: palette.successSoft },
  actions: { flexDirection: "row", gap: 4 }, summary: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, information: { flex: 1, minWidth: 0, gap: 4 },
  label: { ...typography.label, color: palette.text, flexShrink: 1 }, body: { ...typography.body, color: palette.text, flexShrink: 1 },
  selected: { ...typography.caption, fontWeight: "700", color: palette.success }, hint: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.caption, color: palette.danger },
});