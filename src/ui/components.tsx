import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState, type ComponentProps, type ReactNode, type Ref } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { Tenant } from "../domain/models";
import { palette, radius, theme, typography } from "./theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];
export type BadgeTone = "neutral" | "teal" | "success" | "warning" | "danger" | "info";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const buttonColors: { [K in ButtonVariant]: { background: string; foreground: string; border: string } } = {
  primary: { background: palette.primary, foreground: palette.white, border: palette.primary },
  secondary: { background: palette.surface, foreground: palette.navy, border: palette.border },
  ghost: { background: "transparent", foreground: palette.primary, border: "transparent" },
  danger: { background: palette.danger, foreground: palette.white, border: palette.danger },
};

const badgeColors: { [K in BadgeTone]: { background: string; foreground: string } } = {
  neutral: { background: palette.track, foreground: palette.textSecondary },
  teal: { background: palette.primarySoft, foreground: palette.primary },
  success: { background: palette.successSoft, foreground: palette.success },
  warning: { background: palette.amberSoft, foreground: palette.amber },
  danger: { background: palette.dangerSoft, foreground: palette.danger },
  info: { background: palette.infoSoft, foreground: palette.info },
};

export function Button({ title, onPress, variant = "primary", disabled = false, loading = false, icon, style, accessibilityLabel }: ButtonProps) {
  const colors = buttonColors[variant];
  const unavailable = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.background, borderColor: colors.border },
        style,
        unavailable && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.foreground} /> : icon ? <Ionicons name={icon} size={20} color={colors.foreground} accessible={false} /> : null}
      <Text style={[styles.buttonText, { color: colors.foreground }]}>{title}</Text>
    </Pressable>
  );
}

export interface CardProps { children: ReactNode; style?: StyleProp<ViewStyle>; }

export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export interface BadgeProps { label: string; tone?: BadgeTone; }

export function Badge({ label, tone = "neutral" }: BadgeProps) {
  const colors = badgeColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.background }]}>
      <Text style={[styles.badgeText, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

export interface FieldProps extends TextInputProps {
  label: string;
  icon?: IconName;
  trailing?: ReactNode;
  error?: string | null;
  hint?: string;
  containerStyle?: StyleProp<ViewStyle>;
  ref?: Ref<TextInput>;
}

export function Field({ label, icon, trailing, error, hint, containerStyle, ref, style, onFocus, onBlur, editable = true, ...inputProps }: FieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputShell, focused && styles.inputFocused, Boolean(error) && styles.inputError, !editable && styles.disabled]}>
        {icon ? <Ionicons name={icon} size={20} color={focused ? palette.primary : palette.textMuted} style={styles.inputIcon} accessible={false} /> : null}
        <TextInput
          {...inputProps}
          ref={ref}
          editable={editable}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          accessibilityHint={error ?? inputProps.accessibilityHint ?? hint}
          placeholderTextColor={palette.textMuted}
          selectionColor={palette.primary}
          cursorColor={palette.primary}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          style={[styles.input, style]}
        />
        {trailing}
      </View>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.fieldError}>{error}</Text> : hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export interface SectionTitleProps { title: string; subtitle?: string; }

export function SectionTitle({ title, subtitle }: SectionTitleProps) {
  return (
    <View style={styles.sectionTitle}>
      <Text accessibilityRole="header" style={styles.sectionHeading}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export interface EmptyStateProps { title: string; message: string; icon?: IconName; }

export function EmptyState({ title, message, icon = "clipboard-outline" }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={30} color={palette.primary} accessible={false} /></View>
      <Text accessibilityRole="header" style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

export interface IconButtonProps {
  name: IconName;
  onPress: () => void;
  label: string;
  disabled?: boolean;
}

export function IconButton({ name, onPress, label, disabled = false }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.iconButton, disabled && styles.disabled, pressed && styles.iconPressed]}
    >
      <Ionicons name={name} size={22} color={palette.navy} accessible={false} />
    </Pressable>
  );
}

export interface BodyTextProps { children: ReactNode; style?: StyleProp<TextStyle>; }

export function BodyText({ children, style }: BodyTextProps) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export interface BrandProps { tenant?: Tenant; compact?: boolean; showTag?: boolean; singleLine?: boolean; }

function safeBrandLogo(logo: Tenant["logo"]): string | null {
  if (!logo || /[\s\u0000-\u001f\u007f\\]/.test(logo)) return null;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(logo)) return logo;
  if (!/^https?:\/\//i.test(logo)) return null;
  try {
    const url = new URL(logo);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function Brand({ tenant, compact = false, showTag = true, singleLine = false }: BrandProps = {}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const name = tenant?.name.trim() || "qualitzer";
  const logo = useMemo(() => safeBrandLogo(tenant?.logo), [tenant?.logo]);
  const showLogo = logo !== null && logo !== failedLogo;

  return (
    <View style={styles.brand} accessible accessibilityLabel={showTag ? `${name} Field` : name}>
      <View style={[styles.brandMark, showLogo && styles.brandImageMark]}>
        {showLogo ? <Image key={logo} source={{ uri: logo }} resizeMode="contain" style={styles.brandLogo} onError={() => setFailedLogo(logo)} accessible={false} /> : <Ionicons name="construct-outline" size={18} color={palette.primary} accessible={false} />}
      </View>
      <Text numberOfLines={singleLine ? 1 : 2} ellipsizeMode="tail" style={[styles.brandName, compact && styles.brandNameCompact]}>{name}</Text>
      {showTag ? <View style={styles.brandTag}><Text style={styles.brandTagText}>FIELD</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 54, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  buttonText: { fontSize: 15, lineHeight: 22, fontWeight: "700", flexShrink: 1, textAlign: "center" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  card: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: palette.border, ...theme.shadow },
  badge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, maxWidth: "100%" },
  badgeText: { ...typography.caption, fontWeight: "700" },
  field: { gap: 8 },
  fieldLabel: { ...typography.label, color: palette.text },
  inputShell: { minHeight: 56, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.background, paddingRight: 4 },
  inputFocused: { borderColor: palette.primary, backgroundColor: palette.surface },
  inputError: { borderColor: palette.danger },
  inputIcon: { marginLeft: 15 },
  input: { minHeight: 54, flex: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: palette.text },
  fieldError: { ...typography.caption, color: palette.danger },
  fieldHint: { ...typography.caption, color: palette.textSecondary },
  sectionTitle: { gap: 4 },
  sectionHeading: { ...typography.heading, color: palette.text },
  sectionSubtitle: { ...typography.body, fontSize: 14, color: palette.textSecondary },
  empty: { paddingVertical: 24, paddingHorizontal: 12, alignItems: "center", gap: 12 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft, marginBottom: 4 },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: "center" },
  emptyMessage: { ...typography.body, color: palette.textSecondary, textAlign: "center", maxWidth: 380 },
  iconButton: { minWidth: theme.touchTarget, minHeight: theme.touchTarget, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  iconPressed: { backgroundColor: palette.track },
  body: { ...typography.body, color: palette.textSecondary },
  brand: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 },
  brandMark: { width: 32, height: 32, borderRadius: 10, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" },
  brandImageMark: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  brandLogo: { width: 28, height: 28 },
  brandName: { color: palette.navy, fontSize: 23, lineHeight: 30, fontWeight: "800", letterSpacing: -1, flexShrink: 1 },
  brandNameCompact: { fontSize: 14, lineHeight: 20, fontWeight: "700", letterSpacing: 0 },
  brandTag: { borderWidth: 1, borderColor: "#C8E3DF", backgroundColor: palette.primarySoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 2 },
  brandTagText: { ...typography.overline, color: palette.primary, fontSize: 9, letterSpacing: 1.4 },
});