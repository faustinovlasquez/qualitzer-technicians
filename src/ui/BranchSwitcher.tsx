import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Branch, Session } from "../domain/models";
import { PrivateModal as Modal } from "../security/DeviceSecurityContext";
import { safeBrandLogo } from "../domain/branding";
import { CompanyMark } from "./components";
import { palette, radius, theme, typography } from "./theme";

export interface BranchSwitcherProps {
  session: Session;
  busy: boolean;
  /** Mensaje de error de la app tras un intento de cambio (conexión, pendientes, acceso revocado). */
  error: string | null;
  /** Motivo por el que hoy no se puede cambiar (sin conexión o con cambios por sincronizar), si lo hay. */
  blockedReason: string | null;
  onSelect: (branchId: number) => void;
}

export function availableBranches(session: Session): Branch[] {
  return session.user.accessBranchs.filter(branch => branch.isEnabled !== false && branch.isDeleted !== true);
}

function BranchLogo({ branch, size }: { branch: Branch; size: number }) {
  const logo = safeBrandLogo(branch.logoUrl ?? undefined);
  const [failed, setFailed] = useState(false);
  const initials = branch.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase() ?? "").join("") || "S";
  return <View style={[styles.branchLogo, { width: size, height: size, borderRadius: Math.round(size * 0.28) }, (!logo || failed) && styles.branchInitials]}>
    {logo && !failed ? <Image source={{ uri: logo }} resizeMode="contain" style={{ width: size - 6, height: size - 6 }} onError={() => setFailed(true)} accessible={false} />
      : <Text style={[styles.branchInitialsText, { fontSize: Math.round(size * 0.36) }]}>{initials}</Text>}
  </View>;
}

/** Logo del encabezado: al tocarlo muestra la sucursal activa y, si hay más de una con acceso, permite cambiar. */
export function BranchSwitcher({ session, busy, error, blockedReason, onSelect }: BranchSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<number | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const branches = availableBranches(session);
  const current = branches.find(branch => branch.id === session.branchId) ?? null;
  const others = branches.filter(branch => branch.id !== session.branchId);

  // El cambio lo confirma la sesión: cuando la sucursal activa pasa a ser la pedida, se cierra el diálogo y se avisa.
  useEffect(() => {
    if (requested === null || busy) return;
    if (session.branchId === requested) {
      const name = branches.find(branch => branch.id === requested)?.name ?? "la sucursal";
      setRequested(null); setOpen(false); setSuccess(`Ahora trabajas en ${name}`);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSuccess(null), 4000);
    } else setRequested(null);
  }, [requested, busy, session.branchId]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function choose(branchId: number): void {
    if (busy || blockedReason || branchId === session.branchId) return;
    setRequested(branchId);
    onSelect(branchId);
  }
  const switching = requested !== null && busy;
  const failure = requested === null && open && error ? error : null;

  return <>
    <Pressable testID="branch-switcher" accessibilityRole="button" accessibilityLabel={`Sucursal: ${current?.name ?? "sin sucursal activa"}. ${others.length ? "Cambiar sucursal" : "Ver sucursal"}`}
      disabled={busy} hitSlop={4} onPress={() => setOpen(true)} style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}>
      <CompanyMark tenant={session.tenant} size={40} />
      {others.length ? <View style={styles.swapBadge}><Ionicons name="swap-horizontal" size={10} color={palette.white} accessible={false} /></View> : null}
    </Pressable>
    {success ? <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.toast} pointerEvents="none">
      <Ionicons name="checkmark-circle" size={18} color={palette.white} accessible={false} /><Text style={styles.toastText}>{success}</Text>
    </View> : null}
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!switching) setOpen(false); }}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Cerrar" disabled={switching} onPress={() => setOpen(false)} />
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>Sucursal</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={8} disabled={switching} onPress={() => setOpen(false)}><Ionicons name="close" size={22} color={palette.textSecondary} /></Pressable>
          </View>
          <Text style={styles.caption}>{session.tenant.name}</Text>
          {current ? <View style={styles.current}>
            <BranchLogo branch={current} size={48} />
            <View style={styles.rowText}><Text style={styles.overline}>SUCURSAL ACTIVA</Text><Text style={styles.currentName}>{current.name}</Text></View>
            <Ionicons name="checkmark-circle" size={22} color={palette.primary} accessible={false} />
          </View> : <Text style={styles.caption}>Tu usuario no tiene una sucursal activa.</Text>}
          {others.length ? <>
            <Text style={styles.sectionLabel}>{`Cambiar a otra sucursal (${others.length})`}</Text>
            {blockedReason ? <View style={styles.notice}><Ionicons name="information-circle-outline" size={18} color={palette.amber} accessible={false} /><Text style={styles.noticeText}>{blockedReason}</Text></View> : null}
            <ScrollView style={styles.list}>
              {others.map(branch => {
                const loading = switching && requested === branch.id;
                return <Pressable key={branch.id} accessibilityRole="button" accessibilityLabel={`Cambiar a ${branch.name}`} accessibilityState={{ disabled: busy || Boolean(blockedReason), busy: loading }}
                  disabled={busy || Boolean(blockedReason)} onPress={() => choose(branch.id)} style={({ pressed }) => [styles.option, pressed && styles.pressed, (busy || blockedReason) && !loading && styles.disabled]}>
                  <BranchLogo branch={branch} size={40} />
                  <View style={styles.rowText}><Text style={styles.optionName} numberOfLines={2}>{branch.name}</Text>{branch.main ? <Text style={styles.caption}>Sucursal principal</Text> : null}</View>
                  {loading ? <ActivityIndicator color={palette.primary} /> : <Ionicons name="chevron-forward" size={18} color={palette.textMuted} accessible={false} />}
                </Pressable>;
              })}
            </ScrollView>
          </> : <Text style={styles.caption}>Tu usuario tiene acceso solo a esta sucursal.</Text>}
          {failure ? <View accessibilityRole="alert" style={[styles.notice, styles.noticeError]}><Ionicons name="alert-circle-outline" size={18} color={palette.danger} accessible={false} /><Text style={[styles.noticeText, { color: palette.danger }]}>{failure}</Text></View> : null}
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { borderRadius: 12 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  swapBadge: { position: "absolute", right: -3, bottom: -3, width: 17, height: 17, borderRadius: 9, backgroundColor: palette.primary, borderWidth: 2, borderColor: palette.white, alignItems: "center", justifyContent: "center" },
  toast: { position: "absolute", top: 60, left: 16, right: 16, zIndex: 1000, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: palette.success, ...theme.shadow },
  toastText: { flex: 1, color: palette.white, fontSize: 14, fontWeight: "700" },
  overlay: { flex: 1, backgroundColor: "rgba(18,44,58,0.55)", justifyContent: "center", padding: 20 },
  dialog: { width: "100%", maxWidth: 440, maxHeight: "85%", alignSelf: "center", gap: 12, padding: 18, borderRadius: radius.lg, backgroundColor: palette.surface, ...theme.shadow },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...typography.heading, color: palette.text },
  caption: { ...typography.caption, color: palette.textSecondary },
  overline: { ...typography.overline, fontSize: 10, color: palette.primary },
  current: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: palette.primarySoft },
  currentName: { fontSize: 16, lineHeight: 21, fontWeight: "800", color: palette.text },
  rowText: { flex: 1, minWidth: 0 },
  sectionLabel: { ...typography.label, color: palette.text, marginTop: 4 },
  list: { flexGrow: 0 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.md, borderBottomWidth: 1, borderColor: palette.border },
  optionName: { fontSize: 15, lineHeight: 20, fontWeight: "700", color: palette.text },
  branchLogo: { alignItems: "center", justifyContent: "center", backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, overflow: "hidden" },
  branchInitials: { backgroundColor: palette.navy, borderColor: palette.navy },
  branchInitialsText: { color: palette.white, fontWeight: "800" },
  notice: { flexDirection: "row", gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: palette.amberSoft },
  noticeError: { backgroundColor: palette.dangerSoft },
  noticeText: { flex: 1, ...typography.caption, color: palette.amber, fontWeight: "600" },
});
