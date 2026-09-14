import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Tenant, TenantLoginChallenge } from "../domain/models";
import { getTenantChallengeRemaining } from "../infrastructure/tenantChallengeClock";
import { BodyText, Brand, Button, Card, SectionTitle } from "../ui/components";
import { palette, radius, typography } from "../ui/theme";
import { TenantPicker } from "./TenantPicker";

export interface TenantSelectionScreenProps {
  challenge: TenantLoginChallenge;
  busy: boolean;
  error: string | null;
  onSelect: (tenant: Tenant) => void;
  onCancel: () => void;
}

export function TenantSelectionScreen({ challenge, busy, error, onSelect, onCancel }: TenantSelectionScreenProps) {
  const [, refreshClock] = useState(0);
  const timing = getTenantChallengeRemaining(challenge);
  const secondsRemaining = Math.ceil(timing.remainingMs / 1000);
  const expired = secondsRemaining === 0;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function updateClock(): void {
      if (timer !== undefined) clearTimeout(timer);
      const current = getTenantChallengeRemaining(challenge);
      refreshClock((revision) => revision + 1);
      if (current.remainingMs > 0) {
        timer = setTimeout(updateClock, Math.min(1000, current.remainingMs));
      }
    }
    updateClock();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updateClock();
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }, [challenge]);

  function handleSelect(tenant: Tenant): void {
    const current = getTenantChallengeRemaining(challenge);
    refreshClock((revision) => revision + 1);
    if (busy || current.remainingMs === 0) return;
    onSelect(tenant);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Brand />
        <Card style={styles.card}>
          <View style={styles.verified}>
            <Ionicons name="shield-checkmark-outline" size={20} color={palette.primary} accessible={false} />
            <Text style={styles.verifiedText}>Credenciales verificadas</Text>
          </View>
          <SectionTitle title="Elige la empresa para esta sesión" subtitle="Estas son las empresas a las que tienes acceso con tu cuenta." />
          <BodyText>La sesión quedará vinculada únicamente a la empresa que elijas.</BodyText>
          {expired ? (
            <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.expired}>
              <Ionicons name="time-outline" size={20} color={palette.danger} accessible={false} />
              <Text style={styles.expiredText}>{timing.source === "invalid"
                ? "No se pudo validar el tiempo de esta selección. Vuelve al acceso para iniciar sesión de nuevo."
                : timing.source === "unverified" ? "Se agotó el tiempo local para seleccionar la empresa. Vuelve al acceso para iniciar sesión de nuevo."
                  : "La selección de empresa venció. Vuelve al acceso para iniciar sesión de nuevo."}</Text>
            </View>
          ) : (
            <View style={styles.countdown}>
              <Ionicons name="time-outline" size={18} color={palette.textSecondary} accessible={false} />
              <Text accessibilityLiveRegion="none" style={styles.countdownText}>{timing.source === "unverified"
                ? "El servidor validará la vigencia al elegir la empresa. Selecciona una ahora; el tiempo disponible puede ser menor."
                : `Tiempo estimado para elegir: ${secondsRemaining} ${secondsRemaining === 1 ? "segundo" : "segundos"}. El servidor validará la vigencia.`}</Text>
            </View>
          )}
          <Button title="Volver al acceso" variant="secondary" icon="arrow-back-outline" disabled={busy} onPress={onCancel} />
          {!expired ? <TenantPicker tenants={challenge.tenants} busy={busy} onSelect={handleSelect} /> : null}
          {busy ? (
            <View accessibilityLiveRegion="polite" style={styles.status}>
              <ActivityIndicator color={palette.primary} />
              <Text style={styles.statusText}>Abriendo la empresa seleccionada…</Text>
            </View>
          ) : null}
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { flexGrow: 1, justifyContent: "center", padding: 22, gap: 24, width: "100%", maxWidth: 600, alignSelf: "center" },
  card: { gap: 20 },
  verified: { flexDirection: "row", alignItems: "center", gap: 8 },
  verifiedText: { ...typography.label, color: palette.primary, flexShrink: 1 },
  countdown: { flexDirection: "row", alignItems: "center", gap: 8 },
  countdownText: { ...typography.caption, color: palette.textSecondary, flexShrink: 1 },
  expired: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: radius.sm, backgroundColor: palette.dangerSoft },
  expiredText: { ...typography.label, color: palette.danger, flex: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusText: { ...typography.label, color: palette.primary, flex: 1 },
  error: { ...typography.body, color: palette.danger },
});