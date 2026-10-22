import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { Button } from "../../ui/components";
import { palette } from "../../ui/theme";
import type { WorkshopFreeWork } from "../../domain/workshopWorks";
import { OptionRow, PickerSheet, PickerState, SearchBox } from "../intake/IntakePickers";

/** Elegir trabajos libres (sin OT ni ingreso) para unirlos al ingreso. */
export function LinkWorksSheet({ load, onLink, onClose }: {
  load: (search: string) => Promise<{ items: WorkshopFreeWork[] }>; onLink: (workIds: number[]) => Promise<void>; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WorkshopFreeWork[] | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  // Se guardan los trabajos elegidos completos para seguir mostrándolos aunque la búsqueda cambie.
  const [picked, setPicked] = useState<WorkshopFreeWork[]>([]);
  const chosen = picked.map((item) => item.id);
  const toggle = (item: WorkshopFreeWork) => setPicked((list) => list.some((value) => value.id === item.id) ? list.filter((value) => value.id !== item.id) : [...list, item]);
  const hidden = picked.filter((item) => !(items ?? []).some((value) => value.id === item.id));
  const [saving, setSaving] = useState(false);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setItems(null); setError("");
      loader.current(query.trim()).then((result) => { if (active) setItems(result.items); },
        (failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "No se pudieron cargar los trabajos."); });
    }, query ? 350 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  async function link() {
    setSaving(true); setSaveError("");
    try { await onLink(chosen); }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : "No se pudieron unir los trabajos."); }
    finally { setSaving(false); }
  }

  return <PickerSheet title="Unir trabajos existentes" onClose={saving ? () => undefined : onClose} search={<SearchBox value={query} onChange={setQuery} placeholder="Buscar trabajo" />}
    footer={<Button title={chosen.length === 0 ? "Elige trabajos" : `Unir ${chosen.length} trabajo(s)`} icon="link-outline" loading={saving} disabled={saving || chosen.length === 0} onPress={() => void link()} />}>
    <Text style={{ fontSize: 12, color: palette.textSecondary }}>Trabajos tuyos que no están en ninguna OT ni en otro ingreso.</Text>
    <PickerState loading={items === null && !error} error={error} empty={items !== null && items.length === 0 ? "No hay trabajos libres para unir." : null} />
    {hidden.map((item) => <OptionRow key={`picked-${item.id}`} multiple title={`${item.code} · ${item.title}`} subtitle="Elegido" selected onPress={() => toggle(item)} />)}
    {(items ?? []).map((item) => <OptionRow key={item.id} multiple title={`${item.code} · ${item.title}`} subtitle={item.statusName} selected={chosen.includes(item.id)}
      onPress={() => toggle(item)} />)}
    {saveError ? <Text style={{ fontSize: 12, color: palette.danger }} accessibilityRole="alert">{saveError}</Text> : null}
  </PickerSheet>;
}
