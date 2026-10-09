import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ActiveTimer } from "../../domain/notifications";
import { palette, radius } from "../../ui/theme";
import { activeTimerElapsed, activeTimerReference, type SnapshotActiveTimer } from "../../notifications/runningTimers";

type RowAction = "open" | "pause";
interface BannerRow { key: string; workKey: string; name: string; reference: string; startedAt: string; open: () => unknown; pause?: () => Promise<boolean>; }

// Con muchos cronómetros la lista expandida se desplaza dentro del aviso para no tapar la jornada.
const MAX_LIST_HEIGHT = 360;

// Avisos cerrados por el técnico. Se guardan fuera del componente para que no reaparezcan al volver a la jornada;
// un cronómetro que se detiene y vuelve a iniciarse aparece de nuevo.
const dismissedKeys = new Set<string>();

// Trabajos pausados desde el aviso, por trabajo y no por fila: al pausar, el servidor deja de informarlo pero la jornada
// cargada aún lo muestra en curso hasta actualizarse, y sin esto volvía a aparecer como otra fila. Se olvida cuando
// ninguna lista lo informa o a los 10 minutos.
const PAUSED_TTL_MS = 10 * 60 * 1000;
const pausedWorks = new Map<string, number>();
function isPaused(workKey: string, now: number): boolean {
  const at = pausedWorks.get(workKey);
  return at !== undefined && now - at < PAUSED_TTL_MS;
}

function animate(): void {
  if (LayoutAnimation?.configureNext) LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}

/**
 * Alerta fija de cronómetros en curso. Usa el listado del servidor, que incluye trabajos planificados en otras fechas,
 * y completa con los cronómetros de la jornada cargada que el servidor aún no informa. "Ver" abre el trabajo y "Pausar"
 * lo pausa desde aquí; un cronómetro pausado sale de la lista con una transición.
 */
export function ActiveTimersBanner({ timers, localTimers = [], disabled, compact = false, onOpen, onOpenLocal, onPause, onPauseLocal }: {
  timers: ActiveTimer[]; localTimers?: SnapshotActiveTimer[]; disabled: boolean;
  /** Al desplazar la jornada hacia abajo el aviso se reduce a una sola línea. */
  compact?: boolean;
  onOpen: (timer: ActiveTimer) => unknown; onOpenLocal?: (timer: SnapshotActiveTimer) => unknown;
  onPause?: (timer: ActiveTimer) => Promise<boolean>; onPauseLocal?: (timer: SnapshotActiveTimer) => Promise<boolean>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  // Varias pausas a la vez: la app las envía en orden y cada fila muestra su propio avance.
  const [pausing, setPausing] = useState<Set<string>>(() => new Set());
  const [, setPausedVersion] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(dismissedKeys));
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const rows: BannerRow[] = [
    ...timers.map((timer) => ({ key: `${timer.groupType}:${timer.groupId}:${timer.workId}`, workKey: `work:${timer.workId}`, name: timer.title || activeTimerReference(timer),
      reference: timer.title ? activeTimerReference(timer) : "", startedAt: timer.startedAt, open: () => onOpen(timer),
      pause: onPause ? () => onPause(timer) : undefined })),
    ...localTimers.map((timer) => ({ key: `local:${timer.groupId}:${timer.workId}`, workKey: `work:${timer.workId}`, name: timer.title || `Trabajo #${timer.workId}`,
      reference: timer.title ? `Trabajo #${timer.workId}` : "", startedAt: timer.startedAt, open: () => onOpenLocal?.(timer),
      pause: onPauseLocal ? () => onPauseLocal(timer) : undefined })),
  ].filter((row) => !isPaused(row.workKey, Date.now()) && !dismissed.has(row.key));
  const rowKeys = rows.map((row) => row.key).join("|");
  // Un cronómetro que vuelve a iniciarse después de pausarlo aquí debe mostrarse de nuevo.
  useEffect(() => {
    const liveWorks = new Set([...timers.map((timer) => `work:${timer.workId}`), ...localTimers.map((timer) => `work:${timer.workId}`)]);
    const at = Date.now();
    let forgot = false;
    for (const [key, pausedAt] of [...pausedWorks]) if (!liveWorks.has(key) || at - pausedAt >= PAUSED_TTL_MS) { pausedWorks.delete(key); forgot = true; }
    if (forgot) setPausedVersion((value) => value + 1);
    const live = new Set([...timers.map((timer) => `${timer.groupType}:${timer.groupId}:${timer.workId}`), ...localTimers.map((timer) => `local:${timer.groupId}:${timer.workId}`)]);
    // Sin cronómetros cargados (aún sin datos) no se olvida nada.
    if (live.size > 0) for (const key of [...dismissedKeys]) if (!live.has(key)) dismissedKeys.delete(key);
    setDismissed((previous) => previous.size === dismissedKeys.size && [...previous].every((key) => dismissedKeys.has(key)) ? previous : new Set(dismissedKeys));
  }, [timers, localTimers]);
  useEffect(() => {
    if (rows.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [rows.length]);
  useEffect(() => { if ((rows.length <= 1 || compact) && expanded) setExpanded(false); }, [rowKeys, compact]);
  if (rows.length === 0) return null;
  const visible = expanded && !compact ? rows : rows.slice(0, 1);
  const openLocked = disabled || opening !== null;

  function dismiss(keys: string[]): void {
    animate();
    for (const key of keys) dismissedKeys.add(key);
    setDismissed(new Set(dismissedKeys));
  }

  async function run(row: BannerRow, action: RowAction): Promise<void> {
    if (action === "open") {
      if (openLocked || pausing.has(row.key)) return;
      setOpening(row.key);
      try { await row.open(); } finally { if (mounted.current) setOpening(null); }
      return;
    }
    if (pausing.has(row.key) || opening === row.key) return;
    setPausing((previous) => new Set(previous).add(row.key));
    let done = false;
    try { done = await row.pause?.() === true; }
    finally {
      if (mounted.current) {
        if (done) { animate(); pausedWorks.set(row.workKey, Date.now()); setPausedVersion((value) => value + 1); }
        setPausing((previous) => { const next = new Set(previous); next.delete(row.key); return next; });
      }
    }
  }

  const list = visible.map((row, index) => {
    const busyOpen = opening === row.key;
    const busyPause = pausing.has(row.key);
    const status = busyOpen ? "Abriendo el trabajo…" : busyPause ? "Pausando…" : `${row.reference ? `${row.reference} · ` : ""}${activeTimerElapsed(row.startedAt, now)}`;
    const others = rows.length > 1 && index === 0 && (!expanded || compact) ? ` · +${rows.length - 1}` : "";
    return <View key={row.key} style={[styles.row, compact && styles.rowCompact, index > 0 && styles.divider]}>
      <View style={[styles.icon, compact && styles.iconCompact]}><Ionicons name="timer-outline" size={compact ? 14 : 16} color={palette.white} accessible={false} /></View>
      {compact ? <Text style={[styles.text, styles.name]} numberOfLines={1}>{row.name}<Text style={styles.meta}>{` · ${busyOpen || busyPause ? status : activeTimerElapsed(row.startedAt, now)}${others}`}</Text></Text>
        : <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>{status}{others}</Text>
        </View>}
      {row.pause ? <Pressable accessibilityRole="button" accessibilityLabel={`Pausar cronómetro de ${row.name}`} accessibilityState={{ disabled: busyPause || busyOpen, busy: busyPause }}
        disabled={busyPause || busyOpen} onPress={() => void run(row, "pause")} hitSlop={4}
        style={({ pressed }) => [styles.pause, compact && styles.pauseCompact, busyOpen && styles.disabled, pressed && styles.pressed]}>
        {busyPause ? <ActivityIndicator size="small" color={palette.amber} /> : <Ionicons name="pause" size={compact ? 13 : 15} color={palette.amber} accessible={false} />}
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Ver cronómetro de ${row.name}`} accessibilityState={{ disabled: openLocked || busyPause, busy: busyOpen }}
        disabled={openLocked || busyPause} onPress={() => void run(row, "open")}
        style={({ pressed }) => [styles.action, compact && styles.actionCompact, (openLocked || busyPause) && !busyOpen && styles.disabled, pressed && styles.pressed]}>
        {busyOpen ? <ActivityIndicator size="small" color={palette.white} /> : <Text style={styles.actionText}>Ver</Text>}
      </Pressable>
      {/* Cerrar el aviso: con varios cronómetros contraídos cierra todos; expandido, solo esa fila. */}
      <Pressable accessibilityRole="button" accessibilityLabel={others ? "Cerrar todos los avisos de cronómetro" : `Cerrar aviso de ${row.name}`} hitSlop={8}
        onPress={() => dismiss(others ? rows.map((item) => item.key) : [row.key])} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
        <Ionicons name="close" size={compact ? 15 : 17} color={palette.textSecondary} accessible={false} />
      </Pressable>
    </View>;
  });

  return <View accessibilityRole="alert" style={styles.banner}>
    {expanded && !compact ? <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator>{list}</ScrollView> : list}
    {rows.length > 1 && !compact ? <View style={styles.footer}>
      <Pressable accessibilityRole="button" onPress={() => { animate(); setExpanded(value => !value); }} style={styles.more}>
        <Text style={styles.moreText}>{expanded ? "Ver menos" : `Ver los ${rows.length}`}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color={palette.amber} accessible={false} />
      </Pressable>
      {expanded ? <Pressable accessibilityRole="button" onPress={() => dismiss(rows.map((item) => item.key))} style={styles.more}>
        <Text style={styles.moreText}>Cerrar todos</Text>
      </Pressable> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: 12, marginTop: 6, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.amber, backgroundColor: palette.amberSoft, overflow: "hidden" },
  list: { maxHeight: MAX_LIST_HEIGHT },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  rowCompact: { paddingVertical: 3, gap: 6 },
  divider: { borderTopWidth: 1, borderColor: palette.amber },
  icon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: palette.amber },
  iconCompact: { width: 22, height: 22, borderRadius: 11 },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, lineHeight: 17, fontWeight: "800", color: palette.heading },
  meta: { fontSize: 11, lineHeight: 15, fontWeight: "400", color: palette.textSecondary },
  pause: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: palette.amber },
  pauseCompact: { width: 26, height: 26, borderRadius: 13 },
  action: { minWidth: 48, minHeight: 30, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: palette.amber },
  actionCompact: { minHeight: 24, minWidth: 40, paddingHorizontal: 10 },
  actionText: { fontSize: 12, fontWeight: "800", color: palette.white },
  close: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", justifyContent: "center", gap: 16, borderTopWidth: 1, borderColor: palette.amber },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 5 },
  moreText: { fontSize: 12, fontWeight: "800", color: palette.amber },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.8 },
});
