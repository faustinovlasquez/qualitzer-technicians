import { useEffect, useRef, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { googlePlaces, type GoogleMapsConfiguration, type GoogleMapsDiagnostic } from "./googlePlaces";
import { palette, typography } from "../ui/theme";
import { Button } from "../ui/components";

export function GoogleMapConfiguration({ configuration, loaded, placesError }: { configuration: GoogleMapsConfiguration | null; loaded: boolean; placesError?: string | null }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<GoogleMapsDiagnostic | null>(null);
  const active = useRef(true);
  const flight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function check() {
    if (flight.current) return;
    flight.current = true; setChecking(true);
    try { const value = await googlePlaces.diagnose(); if (active.current) setResult(value); }
    catch { if (active.current) setResult({ status: 0, accepted: false, reasons: ["NETWORK_OR_RESPONSE_ERROR"] }); }
    finally { flight.current = false; if (active.current) setChecking(false); }
  }
  return <View style={styles.section} testID="google-map-configuration">
    <Text accessibilityRole="header" style={styles.title}>Configuración de Google</Text>
    <Text style={styles.body}>{loaded ? "Mapa cargado" : "Mapa sin cargar: autorización de Google no confirmada"}</Text>
    <Text style={styles.body}>{configuration ? configuration.keyConfigured ? "Clave incluida en la APK" : "Falta GOOGLE_MAPS_API_KEY al compilar la app" : "Diagnóstico nativo no disponible en esta instalación"}</Text>
    {configuration ? <>
      <Text selectable style={styles.body}>Paquete Android: {configuration.packageName}</Text>
      <Text style={styles.body}>{configuration.playServicesStatus === 0 ? "Google Play Services disponible" : `Revisar Google Play Services (código ${configuration.playServicesStatus})`}</Text>
      <Text style={styles.body}>Certificado SHA-1 de esta instalación:</Text>
      {configuration.certificateSha1.map(value => <Text selectable key={value} style={styles.fingerprint}>{value}</Text>)}
      {configuration.certificateSha1.length === 0 ? <Text style={styles.body}>No se pudo leer el certificado.</Text> : null}
    </> : null}
    {placesError ? <Text selectable style={styles.error}>Respuesta de Places: {placesError}</Text> : null}
    <Button title="Comprobar acceso a Google" icon="refresh-outline" variant="secondary" loading={checking} disabled={!configuration?.keyConfigured} onPress={() => void check()} />
    {result ? <>
      <Text accessibilityRole="alert" style={result.accepted ? styles.body : styles.error}>{result.accepted ? "Places API (New) respondió correctamente. Esto no verifica las teselas de Maps." : result.reasons.includes("SERVICE_DISABLED") ? "Falta habilitar Places API (New) en el proyecto de esta clave." : result.reasons.includes("API_KEY_ANDROID_APP_BLOCKED") ? "Google rechaza el paquete o certificado Android. Revisa las restricciones de la clave." : result.reasons.includes("API_KEY_SERVICE_BLOCKED") ? "La clave no permite Places API (New). Revisa las APIs autorizadas." : result.reasons.includes("BILLING_DISABLED") ? "Google informa facturación deshabilitada." : "Google no confirmó el acceso. Revisa los códigos y la configuración indicada."}</Text>
      <Text selectable style={styles.body}>HTTP: {result.status || "Sin respuesta"} · {result.reasons.join(", ") || (result.accepted ? "OK" : "ERROR_NO_CLASIFICADO")}</Text>
    </> : null}
    <Text style={styles.title}>Pendiente de verificar en Google Cloud</Text>
    <Text style={styles.body}>1. Maps SDK for Android habilitado en el proyecto de la clave.</Text>
    <Text style={styles.body}>2. Places API (New) habilitada para buscar direcciones.</Text>
    <Text style={styles.body}>3. Facturación activa y cuota disponible.</Text>
    <Text style={styles.body}>4. Restricción de aplicación Android con este paquete y SHA-1; permitir ambas APIs.</Text>
    <Text style={styles.body}>La app no puede consultar los ajustes privados de Google Cloud. El permiso GPS no autoriza el mapa. Si la clave es de la web, usa otra para Android; no retires sus restricciones.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 10, width: "100%", minWidth: 0, paddingVertical: 12 }, title: { ...typography.label, color: palette.text }, body: { ...typography.body, color: palette.text }, fingerprint: { ...typography.caption, color: palette.text, flexShrink: 1 }, error: { ...typography.body, color: palette.danger } });