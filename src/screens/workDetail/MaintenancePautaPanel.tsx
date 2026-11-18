import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_PAUTA_ITEMS_PER_ADD, pautaGroupLabel, pautaGroups, type Pauta, type PautaAddResult, type PautaItem } from "../../domain/maintenancePauta";
import type { AssignmentGroup, AssignmentWork } from "../../domain/models";
import { Badge, Button, Card } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { Notice } from "./DetailUi";

export interface MaintenancePautaActions {
  load: (group: AssignmentGroup, work: AssignmentWork) => Promise<Pauta>;
  add: (group: AssignmentGroup, work: AssignmentWork, itemIds: number[]) => Promise<PautaAddResult>;
}

interface Props {
  group: AssignmentGroup;
  work: AssignmentWork;
  actions: MaintenancePautaActions;
  online: boolean;
  disabled: boolean;
}

/** Solo en mantenimientos preventivos: muestra la pauta del equipo y agrega sus ítems como trabajos, como en la web. */
export function isPreventiveMaintenance(group: AssignmentGroup): boolean {
  return group.type === "internal_maintenance" && /^(?:preventivo|preventive)$/i.test(group.maintenanceType ?? "");
}

export function MaintenancePautaPanel({ group, work, actions, online, disabled }: Props) {
  const [opened, setOpened] = useState(false);
  const [pauta, setPauta] = useState<Pauta | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const ticket = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ticket.current++; }; }, []);
  useEffect(() => { ticket.current++; setOpened(false); setPauta(null); setSelected(new Set()); setError(null); setMessage(null); }, [group.id, work.id]);

  async function load(): Promise<void> {
    const current = ++ticket.current;
    setLoading(true); setError(null);
    try {
      const result = await actions.load(group, work);
      if (!mounted.current || current !== ticket.current) return;
      setPauta(result);
      setSelected(previous => new Set([...previous].filter(id => result.items.some(item => item.id === id && !item.linked))));
    } catch (cause) {
      if (mounted.current && current === ticket.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar la pauta.");
    } finally { if (mounted.current && current === ticket.current) setLoading(false); }
  }

  async function add(): Promise<void> {
    const ids = [...selected];
    if (!pauta || ids.length === 0 || saving) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const result = await actions.add(group, work, ids);
      if (!mounted.current) return;
      setSelected(new Set());
      setMessage(result.added === 0 ? "Esos ítems ya estaban agregados." : result.added === 1 ? "Se agregó 1 trabajo desde la pauta." : `Se agregaron ${result.added} trabajos desde la pauta.`);
      await load();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "No se pudieron agregar los ítems.");
    } finally { if (mounted.current) setSaving(false); }
  }

  function toggle(item: PautaItem): void {
    if (item.linked) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size < MAX_PAUTA_ITEMS_PER_ADD) next.add(item.id);
      return next;
    });
  }

  function selectMissing(items: PautaItem[]): void {
    setSelected(previous => {
      const next = new Set(previous);
      for (const item of items) if (!item.linked && next.size < MAX_PAUTA_ITEMS_PER_ADD) next.add(item.id);
      return next;
    });
  }

  const editable = Boolean(pauta?.canEdit) && online && !disabled;
  const groups = pauta ? pautaGroups(pauta.items) : [];
  const linkedCount = pauta?.items.filter(item => item.linked).length ?? 0;
  return <Card style={styles.panel}>
    <View style={styles.head}>
      <View style={styles.headIcon}><Ionicons name="list-circle-outline" size={22} color={palette.primary} accessible={false} /></View>
      <View style={styles.headText}>
        <Text style={styles.title} accessibilityRole="header">Pauta del equipo</Text>
        <Text style={styles.hint}>{pauta ? `${pauta.planName ?? "Pauta sin nombre"} · ${linkedCount} de ${pauta.items.length} ítems agregados` : "Agrega los ítems de la pauta como trabajos del mantenimiento."}</Text>
      </View>
    </View>
    {!online ? <Notice message="Sin conexión: la pauta se consulta en el servidor. Conéctate para verla." tone="warning" /> : null}
    {!opened ? <Button title="Ver pauta" icon="eye-outline" variant="secondary" disabled={!online || disabled} onPress={() => { setOpened(true); void load(); }} /> : null}
    {opened && loading && !pauta ? <ActivityIndicator accessibilityLabel="Cargando pauta" color={palette.primary} /> : null}
    {error ? <Notice message={error} tone="error" onDismiss={() => setError(null)} /> : null}
    {message ? <Notice message={message} tone="success" onDismiss={() => setMessage(null)} /> : null}
    {opened && pauta ? <>
      {pauta.items.length === 0 ? <Text style={styles.hint}>El equipo no tiene una pauta con ítems configurada. Se configura en la web, en Pautas de mantenimiento.</Text> : null}
      {!pauta.canEdit && pauta.items.length > 0 ? <Text style={styles.hint}>El mantenimiento o el trabajo está cerrado: solo puedes revisar la pauta.</Text> : null}
      {groups.map(({ value, items }) => {
        const missing = items.filter(item => !item.linked);
        return <View key={value} style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupTitle}>{pautaGroupLabel(value, pauta.measurementType)}</Text>
            {editable && missing.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Marcar los ${missing.length} ítems faltantes de ${pautaGroupLabel(value, pauta.measurementType)}`} hitSlop={8} onPress={() => selectMissing(missing)}>
              <Text style={styles.link}>Marcar faltantes</Text>
            </Pressable> : null}
          </View>
          {items.map(item => {
            const checked = selected.has(item.id);
            return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityLabel={item.title} accessibilityState={{ checked: item.linked || checked, disabled: item.linked || !editable }}
              disabled={item.linked || !editable || saving} onPress={() => toggle(item)} style={({ pressed }) => [styles.item, checked && styles.itemChecked, pressed && styles.pressed]}>
              <Ionicons name={item.linked ? "checkmark-circle" : checked ? "checkbox" : "square-outline"} size={22} color={item.linked ? palette.success : checked ? palette.primary : palette.textMuted} accessible={false} />
              <View style={styles.itemText}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.system ? <Text style={styles.itemDetail}>{item.system}</Text> : null}
                {item.product ? <Text style={styles.itemDetail}>{`Repuesto: ${[item.product.code, item.product.name].filter(Boolean).join(" · ")} × ${item.quantity}`}</Text> : null}
              </View>
              {item.linked ? <Badge label="Agregado" tone="success" /> : null}
            </Pressable>;
          })}
        </View>;
      })}
      {editable && pauta.items.some(item => !item.linked) ? <Button title={selected.size ? `Agregar ${selected.size} ${selected.size === 1 ? "ítem" : "ítems"} como trabajos` : "Marca los ítems a agregar"} icon="add-circle-outline"
        disabled={selected.size === 0} loading={saving} onPress={() => void add()} /> : null}
      <Button title="Actualizar pauta" icon="refresh-outline" variant="ghost" disabled={loading || saving || !online} onPress={() => void load()} />
    </> : null}
  </Card>;
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "800", color: palette.heading },
  hint: { ...typography.caption, color: palette.textSecondary },
  group: { gap: 8 },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  groupTitle: { ...typography.label, color: palette.heading },
  link: { ...typography.label, color: palette.primary },
  item: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  itemChecked: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  pressed: { opacity: 0.8 },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15, fontWeight: "700", color: palette.heading },
  itemDetail: { ...typography.caption, color: palette.textSecondary },
});
