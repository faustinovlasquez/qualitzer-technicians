import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { type GoogleMapPoint, type GoogleMapProps, validMapPoint } from "./googleMapProtocol";
import { googlePlaces, type GooglePlaceSuggestion } from "./googlePlaces";
import { palette } from "../ui/theme";
import { BodyText, Button, Field, IconButton } from "../ui/components";

export function GoogleMap(props: GoogleMapProps) {
  const map = useRef<MapView>(null);
  const [point, setPoint] = useState(props.point);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GooglePlaceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const generation = useRef(0);
  const latest = useRef(props); latest.current = props;
  const alive = useRef(true);
  const initial = validMapPoint(props.point) ? props.point : { lat: -33.4489, lng: -70.6693 };
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; googlePlaces.endSession(); }; }, []);
  useEffect(() => {
    if (!props.disabled) return;
    generation.current++; setBusy(false);
  }, [props.disabled]);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setMapError("Google no cargó el mapa. Revisa conexión, Maps SDK for Android y la autorización del paquete y certificado de esta app."), 20000);
    return () => clearTimeout(timer);
  }, [loaded, attempt]);
  const current = (version: number) => alive.current && version === generation.current && latest.current.editable && !latest.current.disabled;
  const center = (next: GoogleMapPoint) => {
    setPoint(next);
    map.current?.animateToRegion({ latitude: next.lat, longitude: next.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 250);
  };
  const selectPoint = async (next: GoogleMapPoint) => {
    if (!latest.current.editable || latest.current.disabled || !validMapPoint(next)) return;
    const version = ++generation.current;
    center(next); setSuggestions([]); setError(null); setBusy(true); latest.current.onPoint?.(next);
    try { const address = await googlePlaces.reverse(next); if (current(version) && address.address) { latest.current.onAddress?.(address); setQuery(address.address); } }
    catch { if (current(version)) setError("Punto seleccionado. No se pudo resolver su dirección; puedes completarla en el formulario."); }
    finally { if (alive.current && version === generation.current) setBusy(false); }
  };
  useEffect(() => { if (props.selection) void selectPoint(props.selection); }, [props.selection]);
  const search = async () => {
    if (busy || props.disabled || !props.editable || query.trim().length < 3) return;
    const version = ++generation.current; setBusy(true); setError(null);
    try { const found = await googlePlaces.search(query); if (current(version)) { setSuggestions(found); if (!found.length) setError("No se encontraron direcciones para esa búsqueda."); } }
    catch { if (current(version)) setError("No se pudo buscar en Google. Revisa conexión, Places API y restricciones de la clave Android."); }
    finally { if (alive.current && version === generation.current) setBusy(false); }
  };
  const selectAddress = async (id: string) => {
    if (busy || props.disabled || !props.editable) return;
    const version = ++generation.current; setBusy(true); setError(null);
    try {
      const address = await googlePlaces.details(id);
      if (current(version) && address.lat !== null && address.lon !== null) {
        center({ lat: Number(address.lat), lng: Number(address.lon) }); latest.current.onAddress?.(address); setQuery(address.address); setSuggestions([]);
      }
    } catch { if (current(version)) setError("Google no devolvió una dirección válida. Vuelve a seleccionar el resultado."); }
    finally { if (alive.current && version === generation.current) setBusy(false); }
  };
  if (!googlePlaces.available()) return <Text accessibilityRole="alert" style={styles.error}>Google Maps no está configurado en esta instalación de la app.</Text>;
  return <View style={styles.container}>
    {props.editable ? <>
      <View style={styles.search}><View style={{ flex: 1 }}><Field label="Buscar dirección en Google" value={query} maxLength={200} editable={!props.disabled} onChangeText={value => { generation.current++; setBusy(false); setQuery(value); setSuggestions([]); }} onSubmitEditing={() => void search()} returnKeyType="search" /></View>
        <IconButton name="search-outline" label="Buscar dirección" disabled={busy || props.disabled || query.trim().length < 3} onPress={() => void search()} /></View>
      {suggestions.map(item => <Button key={item.id} title={item.label} icon="location-outline" variant="secondary" disabled={busy || props.disabled} onPress={() => void selectAddress(item.id)} />)}
      {suggestions.length > 0 ? <BodyText>Google Maps</BodyText> : null}
    </> : null}
    <View style={styles.frame}>
      <MapView key={attempt} ref={map} testID="google-native-map" style={styles.map} provider={PROVIDER_GOOGLE}
        userInterfaceStyle="light"
        initialRegion={{ latitude: initial.lat, longitude: initial.lng, latitudeDelta: props.point ? 0.008 : 3, longitudeDelta: props.point ? 0.008 : 3 }}
        showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} zoomControlEnabled scrollEnabled={!props.disabled} zoomEnabled={!props.disabled}
        onMapLoaded={() => { setLoaded(true); setMapError(null); }} onMapReady={() => { if (point) center(point); }}
        onPress={event => { if (event.nativeEvent.action !== "marker-press") void selectPoint({ lat: event.nativeEvent.coordinate.latitude, lng: event.nativeEvent.coordinate.longitude }); }}>
        {validMapPoint(point) ? <Marker coordinate={{ latitude: point.lat, longitude: point.lng }} draggable={props.editable && !props.disabled}
          onDragEnd={event => void selectPoint({ lat: event.nativeEvent.coordinate.latitude, lng: event.nativeEvent.coordinate.longitude })} /> : null}
        {validMapPoint(point) && point.accuracy !== undefined && point.accuracy > 0 ? <Circle center={{ latitude: point.lat, longitude: point.lng }} radius={point.accuracy} strokeColor={palette.primary} fillColor="rgba(0,127,128,0.12)" /> : null}
      </MapView>
      {mapError ? <View style={styles.mapFailure}><Text accessibilityRole="alert" style={styles.error}>{mapError}</Text><Button title="Reintentar mapa" icon="refresh-outline" variant="secondary" onPress={() => { setLoaded(false); setMapError(null); setAttempt(value => value + 1); }} /></View> : null}
    </View>
    {busy ? <BodyText>Consultando dirección…</BodyText> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ container: { gap: 8, width: "100%", minWidth: 0 }, frame: { height: 300, width: "100%" }, map: { flex: 1 }, mapFailure: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: palette.surface, padding: 16, justifyContent: "center", gap: 10 }, search: { flexDirection: "row", alignItems: "flex-end", gap: 8 }, error: { color: palette.danger } });