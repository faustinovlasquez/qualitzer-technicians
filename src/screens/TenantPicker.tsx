import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Tenant } from "../domain/models";
import { Badge, Brand } from "../ui/components";
import { palette, radius, typography } from "../ui/theme";

export interface TenantPickerProps {
  tenants: Tenant[];
  onSelect: (tenant: Tenant) => void;
  busy: boolean;
  disabled?: boolean;
}

export function TenantPicker({ tenants, onSelect, busy, disabled = false }: TenantPickerProps) {
  const unavailable = busy || disabled;

  return (
    <View accessibilityLabel="Empresas disponibles para esta sesión" style={styles.options}>
      {tenants.length === 0 ? (
        <View style={styles.empty}>
          <Text accessibilityLiveRegion="polite" style={styles.emptyTitle}>No hay empresas disponibles para esta sesión.</Text>
          <Text style={styles.status}>Vuelve al acceso para iniciar sesión de nuevo.</Text>
        </View>
      ) : null}
      {tenants.map((tenant) => {
        const environmentLabel = tenant.environment === "development" ? "Entorno local" : "Producción";
        return (
          <Pressable
            key={tenant.id}
            accessibilityRole="button"
            accessibilityLabel={`Entrar a ${tenant.name}, ${tenant.portalOrigin}, ${environmentLabel}`}
            accessibilityHint="Abre tu sesión en esta empresa sin volver a enviar tu contraseña."
            accessibilityState={{ disabled: unavailable, busy }}
            disabled={unavailable}
            onPress={() => onSelect(tenant)}
            style={({ pressed }) => [styles.option, unavailable && styles.disabled, pressed && styles.pressed]}
          >
            <View style={styles.company}>
              <Brand tenant={tenant} compact />
              <Text style={styles.portal}>{tenant.portalOrigin}</Text>
              <Badge label={environmentLabel} tone={tenant.environment === "development" ? "warning" : "teal"} />
            </View>
            <Ionicons name="arrow-forward-outline" size={22} color={palette.primary} accessible={false} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  options: { gap: 10 },
  option: { minHeight: 64, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface },
  company: { flex: 1, minWidth: 0, gap: 8 },
  portal: { ...typography.caption, color: palette.textSecondary, flexShrink: 1 },
  status: { ...typography.caption, color: palette.textSecondary },
  empty: { padding: 14, gap: 8, borderRadius: radius.sm, backgroundColor: palette.background },
  emptyTitle: { ...typography.label, color: palette.text },
  disabled: { opacity: 0.55 },
  pressed: { backgroundColor: palette.primarySoft, borderColor: palette.primary },
});