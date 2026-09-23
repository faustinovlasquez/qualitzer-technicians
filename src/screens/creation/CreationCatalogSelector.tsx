import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { creationOptionsSchema, type CreationOptions, type CreationOptionsQuery } from "../../domain/creation";
import { Button, Field } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { CatalogItem } from "./creationForm";
import { CreationModal } from "./CreationModal";

export type CreationCatalogPage = NonNullable<CreationOptions["equipment"]>;
export type CreationCatalogCache = Map<string, CreationCatalogPage>;
interface Props {
  embedded?: boolean;
  resource: "equipment" | "specialties";
  companyBranchId: number;
  userId: number;
  workerId: number | null;
  selected: CatalogItem | null;
  cache: CreationCatalogCache;
  onLoadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>;
  onSelect: (item: CatalogItem) => void;
  onClose: () => void;
}

export function CreationCatalogSelector({ resource, companyBranchId, userId, workerId, selected, cache, onLoadOptions, onSelect, onClose, embedded = false }: Props) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
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
      const key = JSON.stringify([resource, query, nextPage]);
      let result = cache.get(key);
      if (!result) {
        const options = creationOptionsSchema.parse(await loader.current({ companyBranchId, kind: resource, search: query, page: nextPage }));
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
  }, [resource, companyBranchId, userId, workerId]);

  const content = <>
    <Field label={resource === "equipment" ? "Buscar por número interno, identificación, tipo o modelo" : "Buscar en el catálogo"} value={search} maxLength={100} onChangeText={(value) => setSearch(value.replace(/[\x00-\x1f\x7f]/g, ""))}
      returnKeyType="search" onSubmitEditing={() => { if (!loading) void load(search.trim(), 0); }} />
    <Button title="Buscar" icon="search-outline" disabled={loading} onPress={() => void load(search.trim(), 0)} />
    {loading ? <ActivityIndicator accessibilityLabel="Cargando catálogo" color={palette.primary} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {error ? <Button title="Reintentar catálogo" variant="secondary" onPress={() => void load(appliedSearch, page < 0 ? 0 : page + 1)} /> : null}
    {!loading && !error && items.length === 0 ? <Text style={styles.hint}>No se encontraron resultados.</Text> : null}
    <View style={styles.list}>
      {items.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label}
        accessibilityState={{ selected: item.id === selected?.id }} onPress={() => { if (!active.current || loading) return; onSelect(resource === "equipment" ? item : { id: item.id, label: item.label }); onClose(); }} style={[styles.item, item.id === selected?.id && styles.selected]}>
        <Text style={styles.label}>{item.label}</Text>
      </Pressable>)}
    </View>
    {hasMore ? <Button title="Cargar más" variant="secondary" disabled={loading} onPress={() => void load(appliedSearch, page + 1)} /> : null}
  </>;
  return embedded ? <View style={styles.content}>{content}</View> : <CreationModal title={resource === "equipment" ? "Seleccionar equipo" : "Seleccionar especialidad"} onClose={onClose}>{content}</CreationModal>;
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  list: { gap: 8 }, item: { minHeight: 54, justifyContent: "center", padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  selected: { backgroundColor: palette.primarySoft, borderColor: palette.primary }, label: { ...typography.body, color: palette.text },
  error: { ...typography.body, color: palette.danger }, hint: { ...typography.caption, color: palette.textSecondary },
});