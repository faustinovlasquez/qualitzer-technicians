import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CreationOptions, CreationOptionsQuery } from "../../domain/creation";
import { Button, Field } from "../../ui/components";
import { palette, typography } from "../../ui/theme";
import type { CreationCatalogCache } from "./CreationCatalogSelector";
import type { CatalogItem } from "./creationForm";
import { lookupEquipment, type EquipmentLookupContext, type EquipmentLookupResult } from "./equipmentLookup";

interface Props extends EquipmentLookupContext {
  required: boolean;
  disabled: boolean;
  selected: CatalogItem | null;
  error?: string;
  cache: CreationCatalogCache;
  onLoadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>;
  onSelect: (item: CatalogItem | null) => void;
  onBrowse: () => void;
}

export function CreationEquipmentLookup(props: Props) {
  const [text, setText] = useState("");
  const [searched, setSearched] = useState("");
  const [result, setResult] = useState<EquipmentLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);
  const disabled = useRef(props.disabled);
  disabled.current = props.disabled;
  useEffect(() => () => { ticket.current += 1; }, []);

  async function search(page = 0): Promise<void> {
    if (disabled.current || loading || !text.trim()) return;
    const request = ++ticket.current;
    const query = page === 0 ? text.trim() : searched;
    setLoading(true);
    setError("");
    if (page === 0) { setResult(null); setSearched(query); }
    try {
      const next = await lookupEquipment(props, query, page, props.cache, props.onLoadOptions);
      if (ticket.current !== request || disabled.current) return;
      setResult((previous) => ({ ...next, items: [...new Map([...(page === 0 ? [] : previous?.items ?? []), ...next.items].map((item) => [item.id, item])).values()] }));
    } catch {
      if (ticket.current === request && !disabled.current) setError("No se pudo verificar el número interno. Reintenta o abre el catálogo. Tu selección anterior se conserva.");
    } finally {
      if (ticket.current === request) setLoading(false);
    }
  }

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.label}>{props.required ? "Equipo *" : "Equipo (opcional)"}</Text>
    <Field label="Número interno del equipo" value={text} maxLength={100} autoCapitalize="none" editable={!props.disabled}
      placeholder="Escribe el número interno completo" returnKeyType="search"
      onChangeText={(value) => { ticket.current += 1; setText(value.replace(/[\x00-\x1f\x7f]/g, "")); setResult(null); setError(""); setLoading(false); }}
      onSubmitEditing={() => void search()} hint="Busca un equipo existente por su número interno exacto. Escribir aquí no lo asocia ni crea uno nuevo." />
    <Button title="Buscar equipo" icon="search-outline" loading={loading} disabled={props.disabled || !text.trim()} onPress={() => void search()} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {result ? <View style={styles.section}>
      <Text accessibilityLiveRegion="polite" style={styles.body}>Número consultado: {searched}</Text>
      {result.cachedOnly ? <Text style={styles.hint}>Sin conexión: solo se revisaron páginas guardadas. No se puede verificar un equipo no almacenado ni descartar otras coincidencias.</Text> : null}
      <Text style={styles.body}>{result.items.length === 0
        ? result.cachedOnly ? "No hay coincidencias exactas en las páginas guardadas. Conéctate para verificarlo." : "Esta consulta no contiene coincidencias exactas. Si estás sin conexión, no permite descartar equipos no almacenados. No se creará ningún equipo."
        : result.items.length === 1 && !result.hasMore ? "Coincidencia exacta encontrada. Confirma el equipo que quieres asociar:" : "Hay varias coincidencias o más resultados. Elige explícitamente el equipo correcto:"}</Text>
      {result.items.map((item) => <Button key={item.id} title={`Seleccionar: ${item.label} · ID ${item.id}`} variant="secondary" disabled={props.disabled || loading}
        onPress={() => { if (!disabled.current) { props.onSelect({ id: item.id, label: item.label }); setResult(null); } }} />)}
      {result.hasMore ? <Button title="Ver más coincidencias" variant="secondary" disabled={props.disabled || loading} onPress={() => void search(result.page + 1)} /> : null}
    </View> : null}
    <Button title="Abrir catálogo de equipos" variant="secondary" icon="car-outline" disabled={props.disabled} onPress={props.onBrowse} />
    <Text style={styles.hint}>El catálogo permite buscar también por identificación, tipo o modelo. Sin conexión solo están disponibles consultas guardadas; la disponibilidad se valida de nuevo al crear o sincronizar.</Text>
    {props.selected ? <View style={styles.section}>
      <Text accessibilityLiveRegion="polite" style={styles.selected}>Equipo seleccionado: {props.selected.label} · ID {props.selected.id}</Text>
      <Button title="Quitar equipo" variant="secondary" disabled={props.disabled} onPress={() => { if (!disabled.current) props.onSelect(null); }} />
      <Text style={styles.hint}>Buscar otro número no cambia este equipo. Solo Seleccionar o Quitar equipo modifica la asociación.</Text>
    </View> : <Text style={styles.hint}>Sin equipo seleccionado{props.required ? ". Selecciona uno para continuar." : ": el trabajo se creará sin equipo asociado."}</Text>}
    {props.error ? <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, label: { ...typography.label, color: palette.text }, body: { ...typography.body, color: palette.text },
  selected: { ...typography.label, color: palette.primary }, hint: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.caption, color: palette.danger },
});