import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { creationOptionsSchema, type CatalogResource, type CreationOptions, type CreationOptionsQuery } from "../../domain/creation";
import { Button, Field } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { CatalogItem } from "./creationForm";
import { CreationModal } from "./CreationModal";

/** Pausa al escribir antes de filtrar el catálogo. */
export const SEARCH_DELAY_MS = 350;
export type CreationCatalogPage = NonNullable<CreationOptions["equipment"]>;
export type CreationCatalogCache = Map<string, CreationCatalogPage>;
const catalogTitles: { [Resource in CatalogResource]: string } = {
  equipment: "Seleccionar equipo", specialties: "Seleccionar especialidad", systems: "Seleccionar sistema", components: "Seleccionar subsistema",
  checklists: "Agregar lista de chequeo",
  workTypes: "Tipo de trabajo", actions: "Acción", interventionReasons: "Motivo de intervención",
  failureCauses: "Causa de falla", detectionMethods: "Método de detección", causedDamageTypes: "Tipo de daño causado",
};
interface Props {
  embedded?: boolean;
  resource: CatalogResource;
  /** Ids que no se ofrecen (por ejemplo, el equipo principal en "activos afectados"). */
  excludeIds?: number[];
  /** Título propio del selector (por defecto, el del catálogo). */
  title?: string;
  systemId?: number;
  companyBranchId: number;
  userId: number;
  workerId: number | null;
  selected: CatalogItem | null;
  cache: CreationCatalogCache;
  onLoadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>;
  onSelect: (item: CatalogItem) => void;
  onClose: () => void;
}

export function CreationCatalogSelector({ resource, systemId, companyBranchId, userId, workerId, selected, cache, onLoadOptions, onSelect, onClose, embedded = false, excludeIds = [], title }: Props) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [items, setItems] = useState<Array<CatalogItem & { equipmentKind?: "equipment" | "implement" }>>([]);
  const [page, setPage] = useState(-1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const request = useRef(0);
  const loader = useRef(onLoadOptions);
  loader.current = onLoadOptions;

  async function load(query: string, nextPage: number): Promise<void> {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    if (nextPage === 0) { setItems([]); setHasMore(false); setPage(-1); setAppliedSearch(query); }
    try {
      const scopedSystemId = resource === "components" ? systemId : undefined;
      if (resource === "components" && scopedSystemId === undefined) throw new Error("CREATION_SYSTEM_REQUIRED");
      const key = JSON.stringify(scopedSystemId === undefined ? [resource, query, nextPage] : [resource, scopedSystemId, query, nextPage]);
      let result = cache.get(key);
      if (!result) {
        const options = creationOptionsSchema.parse(await loader.current({ companyBranchId, kind: resource, search: query, page: nextPage, ...(scopedSystemId === undefined ? {} : { systemId: scopedSystemId }) }));
        if (options.companyBranchId !== companyBranchId || options.userId !== userId || options.workerId !== workerId) throw new Error("CREATION_OPTIONS_CONTEXT_MISMATCH");
        result = options[resource];
        if (!result || result.page !== nextPage) throw new Error("CREATION_CATALOG_UNAVAILABLE");
        if (cache.size >= 40) cache.clear();
        cache.set(key, result);
      }
      if (!active.current || request.current !== ticket) return;
      const loadedPage = result;
      setItems((previous) => [...new Map([...(nextPage === 0 ? [] : previous), ...loadedPage.items].map((item) => [item.id, item])).values()]);
      setPage(loadedPage.page);
      setHasMore(loadedPage.hasMore && loadedPage.page < 1000);
    } catch {
      if (active.current && request.current === ticket) setError("No se pudo cargar el catálogo. Reintenta sin perder tu selección.");
    } finally {
      if (active.current && request.current === ticket) setLoading(false);
    }
  }

  useEffect(() => {
    active.current = true;
    void load("", 0);
    return () => { active.current = false; request.current += 1; };
  }, [resource, systemId, companyBranchId, userId, workerId]);

  // Filtra mientras se escribe: espera una pausa breve para no consultar en cada letra.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const query = search.trim();
    const timer = setTimeout(() => { if (active.current && query !== appliedSearch) void load(query, 0); }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const content = <>
    <Field label={resource === "equipment" ? "Buscar por número interno, identificación, tipo o modelo" : "Buscar en el catálogo"} value={search} maxLength={100} onChangeText={(value) => { typed.current = true; setSearch(value.replace(/[\x00-\x1f\x7f]/g, "")); }}
      returnKeyType="search" onSubmitEditing={() => { if (!loading) void load(search.trim(), 0); }} />
    {loading ? <ActivityIndicator accessibilityLabel="Cargando catálogo" color={palette.primary} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {error ? <Button title="Reintentar catálogo" variant="secondary" onPress={() => void load(appliedSearch, page < 0 ? 0 : page + 1)} /> : null}
    {!loading && !error && items.length === 0 ? <Text style={styles.hint}>No se encontraron resultados.</Text> : null}
    <View style={styles.list}>
      {items.filter((item) => !excludeIds.includes(item.id)).map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label}
        accessibilityState={{ selected: item.id === selected?.id }} onPress={() => {
          if (!active.current || loading) return;
          // El tipo (equipo o implemento) solo se usa para mostrar el ícono: no se guarda en el formulario.
          onSelect(resource === "equipment" ? { id: item.id, label: item.label, internalNumber: item.internalNumber, identifier: item.identifier, equipmentType: item.equipmentType } : { id: item.id, label: item.label });
          onClose();
        }} style={[styles.item, styles.itemRow, item.id === selected?.id && styles.selected]}>
        {resource === "equipment" && item.equipmentKind ? <View style={[styles.kindIcon, item.equipmentKind === "implement" && styles.kindImplement]}>
          <Ionicons name={item.equipmentKind === "implement" ? "construct-outline" : "car-outline"} size={18} color={item.equipmentKind === "implement" ? palette.orange : palette.primary}
            accessibilityLabel={item.equipmentKind === "implement" ? "Implemento" : "Equipo"} />
        </View> : null}
        <Text style={[styles.label, styles.labelFlex]}>{item.label}</Text>
      </Pressable>)}
    </View>
    {hasMore ? <Button title="Cargar más" variant="secondary" disabled={loading} onPress={() => void load(appliedSearch, page + 1)} /> : null}
  </>;
  return embedded ? <View style={styles.content}>{content}</View> : <CreationModal title={title ?? catalogTitles[resource]} onClose={onClose}>{content}</CreationModal>;
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  list: { gap: 8 }, item: { minHeight: 54, justifyContent: "center", padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  selected: { backgroundColor: palette.primarySoft, borderColor: palette.primary }, label: { ...typography.body, color: palette.text },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12 }, labelFlex: { flex: 1 },
  kindIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  kindImplement: { backgroundColor: palette.orangeSoft },
  error: { ...typography.body, color: palette.danger }, hint: { ...typography.caption, color: palette.textSecondary },
});