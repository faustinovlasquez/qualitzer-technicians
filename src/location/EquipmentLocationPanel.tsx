import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { equipmentLocationSchema, equipmentLocationUpdateSchema, type EquipmentAddress, type EquipmentLocation, type EquipmentLocationPort, type EquipmentLocationTarget } from "../domain/equipmentLocation";
import { BodyText, Button, Field } from "../ui/components";
import { CreationModal } from "../screens/creation/CreationModal";
import { useTrustedNativePicker } from "../security/useTrustedNativePicker";
import { useDeviceSecurity } from "../security/DeviceSecurityContext";
import { GoogleMap } from "./GoogleMap";
import { requestEquipmentPosition } from "./equipmentPosition";
import type { GoogleMapPoint } from "./googleMapProtocol";
import { palette } from "../ui/theme";

const emptyAddress: EquipmentAddress = { address: "", country: "", region: "", county: "", city: "", postalCode: "", lat: null, lon: null };
function pointOf(address: EquipmentAddress | null): GoogleMapPoint | null {
  return address?.lat != null && address.lon != null ? { lat: Number(address.lat), lng: Number(address.lon) } : null;
}
function addressLabel(address: EquipmentAddress | null): string {
  if (!address) return "";
  const seen = new Set<string>();
  return [address.address, address.city, address.county, address.region, address.country].flatMap(value => value.split(","))
    .map(value => value.trim()).filter(value => {
      const key = value.toLocaleLowerCase("es");
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).join(", ");
}
export function EquipmentLocationPanel({ port, target, identity, disabled, online }: { port: EquipmentLocationPort; target: EquipmentLocationTarget; identity: string; disabled: boolean; online: boolean }) {
  const [location, setLocation] = useState<EquipmentLocation | null>(null);
  const [draft, setDraft] = useState<EquipmentAddress | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [selection, setSelection] = useState<GoogleMapPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const latest = useRef({ port, identity, disabled, online }); latest.current = { port, identity, disabled, online };
  const generation = useRef(0);
  const action = useRef(false);
  const mounted = useRef(true);
  const security = useDeviceSecurity();
  const runNativePicker = useTrustedNativePicker();
  const access = useRef(security); access.current = security;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    const current = ++generation.current;
    setLocation(null); setDraft(null); setMapOpen(false); setError(null); setSaved(false);
    if (!online) { setBusy(false); setError("Conecta la app para consultar la ubicación actual del equipo."); return; }
    setBusy(true);
    void latest.current.port.load(target).then(value => {
      if (mounted.current && current === generation.current && access.current.isUnlocked()) setLocation(equipmentLocationSchema.parse(value));
    }).catch((failure: unknown) => {
      if (mounted.current && current === generation.current) setError(failure instanceof Error ? failure.message : "No se pudo consultar la ubicación del equipo.");
    }).finally(() => { if (mounted.current && current === generation.current) setBusy(false); });
  }, [identity, target]);
  const frozen = disabled || busy || !online || security.blocked;
  const currentAddress = location?.address ?? null;
  const currentLabel = addressLabel(currentAddress);
  const changeText = (field: "address" | "region" | "county" | "city" | "country" | "postalCode", value: string) => {
    if (action.current || latest.current.disabled || !latest.current.online || !access.current.isUnlocked()) return;
    setSelection(null);
    setDraft(current => current && current[field] !== value ? { ...current, [field]: value, lat: null, lon: null } : current);
  };
  const save = async () => {
    if (action.current || frozen || !draft || !location?.canEdit) return;
    const parsed = equipmentLocationUpdateSchema.safeParse({ expected: location.address, address: draft });
    if (!parsed.success) { setError("Completa la dirección y revisa las coordenadas seleccionadas."); return; }
    action.current = true; setBusy(true); setError(null);
    const current = generation.current;
    try {
      const confirmed = equipmentLocationSchema.parse(await latest.current.port.save(target, parsed.data));
      if (!mounted.current || current !== generation.current) return;
      if (confirmed.equipmentId !== location.equipmentId || confirmed.equipmentContext !== location.equipmentContext) throw new Error("La respuesta no corresponde al equipo seleccionado. Vuelve a abrir la pestaña Equipo.");
      setLocation(confirmed); setDraft(null); setSaved(true);
    } catch (failure: unknown) {
      if (mounted.current && current === generation.current) setError(`${failure instanceof Error ? failure.message : "No se pudo confirmar el guardado."} Si perdiste la conexión, vuelve a abrir la pestaña Equipo antes de repetir el envío.`);
    } finally { action.current = false; if (mounted.current && current === generation.current) setBusy(false); }
  };
  const locate = async () => {
    if (action.current || frozen) return;
    action.current = true; setBusy(true); setError(null);
    const current = generation.current;
    try {
      const point = await runNativePicker(requestEquipmentPosition);
      if (mounted.current && current === generation.current && access.current.isUnlocked()) {
        setDraft(value => value ? { ...value, lat: String(point.lat), lon: String(point.lng) } : null);
        setSelection(point);
      }
    } catch (failure: unknown) { if (mounted.current && current === generation.current) setError(failure instanceof Error ? failure.message : "No se pudo obtener tu posición."); }
    finally { action.current = false; if (mounted.current && current === generation.current) setBusy(false); }
  };
  // Sin ubicación cargada (el servidor no tiene una para este equipo) se muestra como aviso neutro, no como error.
  const info = !location && error && !draft ? error : !online ? "Sin conexión: la ubicación se consulta y cambia con señal." : null;
  return <View style={panelStyles.panel} testID={`equipment-location-${target}`}>
    <View style={panelStyles.head}>
      <View style={panelStyles.icon}><Ionicons name="location" size={18} color={palette.primary} accessible={false} /></View>
      <View style={panelStyles.grow}>
        <Text accessibilityRole="header" style={panelStyles.title}>Ubicación del equipo</Text>
        <Text selectable style={[panelStyles.value, !currentLabel && panelStyles.muted]}>{currentLabel || (busy ? "Consultando ubicación…" : "Sin ubicación registrada")}</Text>
        {currentAddress?.lat != null && currentAddress.lon != null ? <Text style={panelStyles.coords}>{currentAddress.lat}, {currentAddress.lon}</Text> : null}
      </View>
      {busy && !draft ? <ActivityIndicator size="small" color={palette.primary} /> : null}
    </View>
    {info ? <View style={panelStyles.info}><Ionicons name="information-circle-outline" size={16} color={palette.textSecondary} accessible={false} /><Text style={panelStyles.infoText}>{info}</Text></View> : null}
    {saved ? <View style={panelStyles.info}><Ionicons name="checkmark-circle" size={16} color={palette.success} accessible={false} /><Text style={[panelStyles.infoText, { color: palette.success }]}>Ubicación actualizada en Qualitzer.</Text></View> : null}
    {error && location && !draft ? <Text accessibilityRole="alert" style={panelStyles.error}>{error}</Text> : null}
    {currentAddress?.lat != null && currentAddress.lon != null || location?.canEdit ? <View style={panelStyles.actions}>
      {currentAddress?.lat != null && currentAddress.lon != null ? <View style={panelStyles.grow}><Button title="Ver ubicación en el mapa" icon="map-outline" variant="secondary" disabled={frozen} onPress={() => setMapOpen(true)} /></View> : null}
      {location?.canEdit ? <View style={panelStyles.grow}><Button title="Editar ubicación actual" icon="create-outline" variant="secondary" disabled={frozen} onPress={() => { setDraft({ ...(location.address ?? emptyAddress) }); setSelection(null); setError(null); setSaved(false); }} /></View> : null}
    </View> : null}
    {location && !location.canEdit ? <Text style={panelStyles.infoText}>Sin permiso para editar la ubicación del equipo.</Text> : null}
    {mapOpen && location ? <CreationModal title="Ubicación actual del equipo" onClose={() => setMapOpen(false)}><BodyText>{currentLabel}</BodyText><GoogleMap point={pointOf(currentAddress)} /></CreationModal> : null}
    {draft ? <CreationModal title="Editar ubicación actual" onClose={() => { if (!action.current) setDraft(null); }}>
      <View pointerEvents={frozen ? "none" : "auto"} accessibilityElementsHidden={frozen} importantForAccessibility={frozen ? "no-hide-descendants" : "auto"}>
        <GoogleMap point={pointOf(draft)} selection={selection} editable disabled={frozen}
          onPoint={point => { if (!action.current && !latest.current.disabled && latest.current.online && access.current.isUnlocked()) setDraft(value => value ? { ...value, lat: String(point.lat), lon: String(point.lng) } : null); }}
          onAddress={address => { if (!action.current && !latest.current.disabled && latest.current.online && access.current.isUnlocked()) setDraft(address); }} />
      </View>
      <Button title="Usar mi ubicación" icon="locate-outline" variant="secondary" disabled={frozen} onPress={() => { void locate(); }} />
      <Field label="Dirección" value={draft.address} editable={!frozen} maxLength={255} onChangeText={value => changeText("address", value)} />
      <Field label="Región / Estado" value={draft.region} editable={!frozen} maxLength={255} onChangeText={value => changeText("region", value)} />
      <Field label="Comuna / Municipio" value={draft.county} editable={!frozen} maxLength={255} onChangeText={value => changeText("county", value)} />
      <Field label="Ciudad / Provincia" value={draft.city} editable={!frozen} maxLength={255} onChangeText={value => changeText("city", value)} />
      <Field label="País" value={draft.country} editable={!frozen} maxLength={255} onChangeText={value => changeText("country", value)} />
      <Field label="Código postal" value={draft.postalCode} editable={!frozen} maxLength={32} onChangeText={value => changeText("postalCode", value)} />
      <BodyText>{draft.lat !== null && draft.lon !== null ? `${draft.lat}, ${draft.lon}` : "Sin punto seleccionado"}</BodyText>
      {error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{error}</Text> : null}
      <Button title="Guardar ubicación" icon="save-outline" loading={busy} disabled={frozen || !draft.address.trim() || JSON.stringify(draft) === JSON.stringify(location?.address)} onPress={() => { void save(); }} />
      <Button title="Cancelar" variant="secondary" disabled={busy} onPress={() => setDraft(null)} />
    </CreationModal> : null}
  </View>;
}

const panelStyles = StyleSheet.create({
  panel: { gap: 10 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", color: palette.textSecondary },
  value: { marginTop: 2, fontSize: 15, lineHeight: 21, fontWeight: "700", color: palette.heading },
  muted: { fontWeight: "500", color: palette.textMuted },
  coords: { marginTop: 2, fontSize: 12, color: palette.textSecondary },
  info: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, backgroundColor: palette.background },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18, color: palette.textSecondary },
  error: { fontSize: 13, color: palette.danger },
  actions: { gap: 8 }
});