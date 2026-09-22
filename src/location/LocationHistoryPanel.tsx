import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { locationDate, locationEventLabel, locationWorkingDay, type LocationHistoryResource, type LocationPoint, type locationHistorySchema } from "../domain/locationTracking";
import { BodyText, Button, IconButton, SectionTitle } from "../ui/components";
import { ChoiceButton } from "../screens/workDetail/DetailUi";
import { CreationDatePicker } from "../screens/creation/CreationDatePicker";
import { palette } from "../ui/theme";
import type { LocationTrackingUi } from "./useLocationTracking";
import { GoogleMap } from "./GoogleMap";
import { CreationModal } from "../screens/creation/CreationModal";
import { locationTrackingStatus } from "./LocationJournal";

type History = import("zod").infer<typeof locationHistorySchema>;
export function LocationHistoryPanel({ tracking, initialDate, resource, onConfigure }: { tracking: LocationTrackingUi; initialDate: string; resource?: LocationHistoryResource; onConfigure?(): void }) {
  const [date, setDate] = useState(initialDate);
  const [related, setRelated] = useState(Boolean(resource));
  const [calendar, setCalendar] = useState(false);
  const [page, setPage] = useState(0);
  const [localPage, setLocalPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; history?: History; error?: string } | null>(null);
  const [mapPoint, setMapPoint] = useState<{ key: string; point: LocationPoint } | null>(null);
  const filter = related ? resource : undefined;
  const localResource = !!filter && !/^(external|maintenance|direct|direct-np)-[1-9]\d*$/.test(filter.groupId);
  const queryKey = JSON.stringify([tracking.state?.generation, tracking.state?.lastSyncedAt, date, filter?.groupId, filter?.workId, page, revision]);
  const latest = useRef({ tracking, queryKey }); latest.current = { tracking, queryKey };
  useEffect(() => {
    let cancelled = false;
    if (localResource) { setResponse({ key: queryKey, error: "El recurso sigue pendiente de sincronizar. Puedes consultar tus acciones del día." }); return; }
    void latest.current.tracking.history(date, page, filter).then(history => {
      if (!cancelled && latest.current.queryKey === queryKey) setResponse({ key: queryKey, history });
    }).catch((failure: unknown) => {
      if (!cancelled && latest.current.queryKey === queryKey) setResponse({ key: queryKey, error: failure instanceof Error ? failure.message : "No se pudo consultar el historial." });
    });
    return () => { cancelled = true; };
  }, [queryKey]);
  const current = response?.key === queryKey ? response : null;
  const confirmed = current?.history;
  const pending = (tracking.state?.points ?? []).filter(point => (point.kind === "action" ? locationDate(point.schedule, Date.parse(point.capturedAt)) : locationWorkingDay(point.schedule, Date.parse(point.capturedAt))) === date
    && (!filter || point.groupId === filter.groupId && (filter.workId === undefined || point.workId === filter.workId))
    && !confirmed?.items.some(item => item.point.id === point.id));
  const lastLocalPage = Math.max(0, Math.ceil(pending.length / 20) - 1);
  const pendingPage = Math.min(localPage, lastLocalPage);
  const changeDate = (next: string) => { setDate(next); setPage(0); setLocalPage(0); };
  const openMap = (point: LocationPoint) => {
    if (point.outcome !== "located" || point.latitude === null || point.longitude === null) return;
    setMapPoint({ key: queryKey, point });
  };
  const entry = (point: LocationPoint, status: string) => <View key={point.id} style={styles.entry}>
    <View style={styles.row}>
      <Text style={styles.label}>{new Date(point.capturedAt).toLocaleTimeString("es-CL", { timeZone: tracking.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit" })} · {locationEventLabel(point)}</Text>
      {point.outcome === "located" ? <IconButton name="map-outline" label={`Ver en mapa ${new Date(point.capturedAt).toLocaleTimeString("es-CL", { timeZone: tracking.timezone })}`} onPress={() => { void openMap(point); }} /> : null}
    </View>
    <BodyText>{status}{point.mocked ? " · Ubicación simulada" : ""}</BodyText>
    {point.actionState ? <BodyText>{point.actionState === "CONFIRMED" ? "Acción confirmada" : "Acción guardada en cola en el momento de la captura"}</BodyText> : null}
    <BodyText>{point.outcome === "located" ? `${point.latitude?.toFixed(5)}, ${point.longitude?.toFixed(5)} · precisión ${Math.round(point.accuracy ?? 0)} m` : "Sin ubicación disponible"}</BodyText>
  </View>;
  return <View style={styles.section} testID="location-history">
    <View style={styles.row}>
      <Button title={new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))} icon="calendar-outline" variant="secondary" onPress={() => setCalendar(true)} />
      <IconButton name="refresh-outline" label="Actualizar historial" disabled={!current} onPress={() => setRevision(value => value + 1)} />
    </View>
    {resource ? <View style={styles.choices}>
      <ChoiceButton label={resource.workId === undefined ? "Acciones de esta orden" : "Acciones de este trabajo"} selected={related} onPress={() => { setRelated(true); setPage(0); setLocalPage(0); }} />
      <ChoiceButton label="Mis acciones del día" selected={!related} onPress={() => { setRelated(false); setPage(0); setLocalPage(0); }} />
    </View> : null}
    <BodyText>Mi ubicación · {tracking.timezone}</BodyText>
    <BodyText>{locationTrackingStatus(tracking.state)}</BodyText>
    {tracking.error ? <Text accessibilityRole="alert" style={styles.error}>{tracking.error}</Text> : null}
    {onConfigure ? <Button title="Configurar ubicación" icon="settings-outline" variant="secondary" disabled={tracking.busy} onPress={onConfigure} /> : null}
    {pending.length > 0 ? <>
      <SectionTitle title={`Pendientes de sincronizar (${pending.length})`} />
      {pending.slice(pendingPage * 20, (pendingPage + 1) * 20).map(point => entry(point, "Guardado en el teléfono"))}
      {lastLocalPage > 0 ? <View style={styles.row}><IconButton name="chevron-back-outline" label="Pendientes anteriores" disabled={pendingPage === 0} onPress={() => setLocalPage(pendingPage - 1)} /><BodyText>{pendingPage + 1} / {lastLocalPage + 1}</BodyText><IconButton name="chevron-forward-outline" label="Pendientes siguientes" disabled={pendingPage === lastLocalPage} onPress={() => setLocalPage(pendingPage + 1)} /></View> : null}
    </> : null}
    <SectionTitle title="Historial sincronizado" />
    {!current ? <BodyText>Consultando historial…</BodyText> : null}
    {current?.error ? <Text accessibilityRole="alert" style={styles.error}>{current.error}</Text> : null}
    {confirmed?.items.map(({ point }) => entry(point, "Sincronizado"))}
    {confirmed?.items.length === 0 ? <BodyText>{related ? "No hay acciones registradas de este recurso en la fecha seleccionada." : "No hay puntos sincronizados en la fecha seleccionada."}</BodyText> : null}
    {confirmed?.items.length === 0 && !tracking.state?.settings.enabled ? <BodyText>Los registros comienzan al activar el seguimiento y aceptar los permisos. No se generan ubicaciones anteriores.</BodyText> : null}
    {confirmed && (page > 0 || confirmed.hasMore) ? <View style={styles.row}><IconButton name="chevron-back-outline" label="Página anterior" disabled={page === 0} onPress={() => setPage(page - 1)} /><BodyText>Página {page + 1}</BodyText><IconButton name="chevron-forward-outline" label="Página siguiente" disabled={!confirmed.hasMore || page >= 10000} onPress={() => setPage(page + 1)} /></View> : null}
    <BodyText>Datos reportados por el dispositivo, no una certificación de presencia.</BodyText>
    {mapPoint?.key === queryKey && mapPoint.point.latitude !== null && mapPoint.point.longitude !== null ? <CreationModal title="Ubicación registrada" onClose={() => setMapPoint(null)}>
      <BodyText>{new Date(mapPoint.point.capturedAt).toLocaleString("es-CL", { timeZone: tracking.timezone })}</BodyText>
      <GoogleMap point={{ lat: mapPoint.point.latitude, lng: mapPoint.point.longitude, accuracy: mapPoint.point.accuracy ?? undefined }} />
      <BodyText>Precisión: {Math.round(mapPoint.point.accuracy ?? 0)} m{mapPoint.point.mocked ? " · Ubicación simulada" : ""}</BodyText>
    </CreationModal> : null}
    {calendar ? <CreationDatePicker value={date} onChange={changeDate} showInputHint={false} onClose={() => setCalendar(false)} /> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  choices: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, label: { color: palette.text, fontSize: 15, fontWeight: "700", flex: 1 },
  entry: { gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.border }, error: { color: palette.danger, fontSize: 14 } });