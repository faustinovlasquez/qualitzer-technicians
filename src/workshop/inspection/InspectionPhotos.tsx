import { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import { PrivateModal } from "../../security/DeviceSecurityContext";
import { Button, IconButton, type IconName } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";
import type { InspectionChecklist, InspectionKind, InspectionShare, InspectionSlot } from "../../domain/workshopInspection";
import { inspectionHint, inspectionSilhouette } from "../../domain/inspectionGuide";
import { OptionRow, PickerSheet, SearchBox } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";
import { QrCode } from "./QrCode";

type Filter = "all" | "loaded" | "missing" | "required";
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Badge({ slot }: { slot: InspectionSlot }) {
  const [label, color, soft] = slot.custom ? ["Adicional", palette.info, palette.infoSoft] : slot.isRequired ? ["Oblig.", palette.orange, palette.orangeSoft] : ["Opcional", palette.textSecondary, palette.track];
  return <Text style={[styles.badge, { color, backgroundColor: soft }]}>{label}</Text>;
}

/** Fotos de la inspección como en la web: avance, contadores que filtran, búsqueda, herramientas y la grilla de ángulos. */
export function InspectionPhotoPanel({ slots, kind, busy, downloading, onSlot, onAdd, onGuide, onDownload, onShare }: {
  slots: InspectionSlot[]; kind: InspectionKind; busy: Record<string, boolean>; downloading: boolean;
  onSlot: (slot: InspectionSlot) => void; onAdd: () => void; onGuide: () => void; onDownload: () => void; onShare: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const loaded = slots.filter((slot) => slot.photo).length;
  const required = slots.filter((slot) => slot.isRequired);
  const base = required.length > 0 ? required : slots;
  const done = base.filter((slot) => slot.photo).length;
  const percent = base.length === 0 ? 0 : Math.round((done / base.length) * 100);
  const chips: Array<{ id: Filter; label: string; count: number; icon: IconName; tone: string }> = [
    { id: "all", label: "Todas", count: slots.length, icon: "grid-outline", tone: palette.text },
    { id: "loaded", label: "Cargadas", count: loaded, icon: "checkmark-circle-outline", tone: palette.success },
    { id: "missing", label: "Faltantes", count: slots.length - loaded, icon: "image-outline", tone: palette.orange },
    { id: "required", label: "Obligatorias", count: required.length, icon: "alert-circle-outline", tone: palette.danger }
  ];
  const visible = useMemo(() => {
    const term = normalize(query.trim());
    return slots.filter((slot) => (filter === "loaded" ? Boolean(slot.photo) : filter === "missing" ? !slot.photo : filter === "required" ? slot.isRequired : true)
      && (!term || normalize(slot.name).includes(term)));
  }, [slots, filter, query]);
  return <View style={styles.section}>
    <View style={styles.headRow}>
      <View style={styles.ring}><Text style={styles.ringValue}>{percent}%</Text></View>
      <View style={styles.grow}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Fotos de la inspección</Text>
        <Text style={styles.hint}>{done}/{base.length} {required.length > 0 ? "obligatorias cargadas" : "fotos cargadas"}</Text>
        <View style={styles.bar}><View style={[styles.barFill, { width: `${percent}%` }]} /></View>
      </View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {chips.map((chip) => <Pressable key={chip.id} accessibilityRole="button" accessibilityState={{ selected: filter === chip.id }}
        onPress={() => setFilter((current) => current === chip.id && chip.id !== "all" ? "all" : chip.id)} style={[styles.chip, filter === chip.id && styles.chipOn]}>
        <Ionicons name={chip.icon} size={15} color={filter === chip.id ? palette.white : chip.tone} accessible={false} />
        <Text style={[styles.chipCount, filter === chip.id && styles.chipTextOn]}>{chip.count}</Text>
        <Text style={[styles.chipText, filter === chip.id && styles.chipTextOn]}>{chip.label}</Text>
      </Pressable>)}
    </ScrollView>
    <SearchBox value={query} onChange={setQuery} placeholder="Buscar foto" />
    <View style={styles.tools}>
      <Tool icon="add" label="Agregar foto" onPress={onAdd} />
      <Tool icon="camera-outline" label="Guía" onPress={onGuide} primary />
      <Tool icon="download-outline" label="Comprimido" onPress={onDownload} loading={downloading} />
      <Tool icon="qr-code-outline" label="Compartir" onPress={onShare} />
    </View>
    {visible.length === 0 ? <Text style={styles.empty}>{query ? "Sin fotos con ese nombre." : "No hay fotos en este filtro."}</Text> : null}
    <View style={styles.grid}>
      {visible.map((slot) => {
        const loading = busy[`slot:${slot.key}`];
        return <Pressable key={slot.key} accessibilityRole="button" accessibilityLabel={`Foto ${slot.name}${slot.photo ? ", cargada" : ", pendiente"}`} disabled={loading}
          onPress={() => onSlot(slot)} style={({ pressed }) => [styles.slot, !slot.photo && slot.isRequired && styles.slotRequired, pressed && styles.pressed]}>
          <View style={styles.slotImage}>
            {loading ? <ActivityIndicator color={palette.primary} />
              : slot.photo ? <Image source={{ uri: slot.photo.url }} style={styles.slotPhoto} accessible={false} />
              : <SvgXml xml={inspectionSilhouette(slot.key, palette.textMuted)} width={46} height={80} />}
            {kind === "exit" && slot.reference ? <View style={styles.referenceTag}><Image source={{ uri: slot.reference.url }} style={styles.referenceImage} accessible={false} />
              <Text style={styles.referenceText}>Ingreso</Text></View> : null}
          </View>
          <View style={styles.slotFooter}>
            <Ionicons name={slot.photo ? "checkmark-circle" : "camera-outline"} size={16} color={slot.photo ? palette.success : palette.textMuted} accessible={false} />
            <Text style={styles.slotName} numberOfLines={1}>{slot.name}</Text>
          </View>
          <View style={styles.slotBadge}><Badge slot={slot} /></View>
        </Pressable>;
      })}
    </View>
  </View>;
}

function Tool({ icon, label, onPress, primary, loading }: { icon: IconName; label: string; onPress: () => void; primary?: boolean; loading?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={loading} onPress={onPress} style={({ pressed }) => [styles.tool, primary && styles.toolPrimary, pressed && styles.pressed]}>
    {loading ? <ActivityIndicator size="small" color={primary ? palette.white : palette.primary} />
      : <Ionicons name={icon} size={18} color={primary ? palette.white : palette.primary} accessible={false} />}
    <Text style={[styles.toolText, primary && styles.toolTextPrimary]} numberOfLines={2}>{label}</Text>
  </Pressable>;
}

/** Qué hacer con una foto: ver, tomar, elegir, comparar con el ingreso, registrar daño o quitar. */
export function PhotoActionsSheet({ slot, kind, onView, onCompare, onCapture, onDamage, onRemove, onClose }: {
  slot: InspectionSlot; kind: InspectionKind; onView: () => void; onCompare: () => void; onCapture: (source: "camera" | "library") => void;
  onDamage: () => void; onRemove: () => void; onClose: () => void;
}) {
  return <PickerSheet title={slot.name} onClose={onClose}>
    {slot.photo ? <OptionRow title="Ver foto" selected={false} onPress={onView} leading={<Ionicons name="expand-outline" size={22} color={palette.primary} />} /> : null}
    {kind === "exit" && slot.reference ? <OptionRow title="Comparar con el ingreso" subtitle="La foto de este ángulo al recibir el equipo" selected={false} onPress={onCompare}
      leading={<Ionicons name="git-compare-outline" size={22} color={palette.primary} />} /> : null}
    <OptionRow title={slot.photo ? "Reemplazar con la cámara" : "Tomar foto"} subtitle="Con la cámara del teléfono" selected={false} onPress={() => onCapture("camera")}
      leading={<Ionicons name="camera" size={22} color={palette.primary} />} />
    <OptionRow title="Elegir de la galería" selected={false} onPress={() => onCapture("library")} leading={<Ionicons name="images-outline" size={22} color={palette.primary} />} />
    {kind === "exit" ? <OptionRow title="Registrar un daño aquí" subtitle="Queda asociado a este ángulo" selected={false} onPress={onDamage}
      leading={<Ionicons name="warning-outline" size={22} color={palette.orange} />} /> : null}
    {slot.photo ? <OptionRow title={slot.custom ? "Quitar foto adicional" : "Quitar foto"} selected={false} onPress={onRemove} leading={<Ionicons name="trash-outline" size={22} color={palette.danger} />} /> : null}
  </PickerSheet>;
}

/** Foto en grande; con `reference` muestra el ingreso y la entrega juntos para comparar. */
export function PhotoViewer({ title, photo, reference, onClose }: { title: string; photo: string | null; reference?: string | null; onClose: () => void }) {
  return <PrivateModal visible transparent animationType="fade" onRequestClose={onClose}>
    <SafeAreaView style={styles.viewer}>
      <View style={styles.viewerBar}>
        <Text style={styles.viewerTitle} numberOfLines={1}>{title}</Text>
        <IconButton name="close" label="Cerrar" onPress={onClose} />
      </View>
      {reference !== undefined ? <View style={styles.compare}>
        <Text style={styles.compareLabel}>Al ingreso</Text>
        {reference ? <Image source={{ uri: reference }} style={styles.compareImage} resizeMode="contain" accessibilityLabel="Foto del ingreso" /> : <Text style={styles.compareEmpty}>Sin foto al ingreso</Text>}
        <Text style={styles.compareLabel}>En la entrega</Text>
        {photo ? <Image source={{ uri: photo }} style={styles.compareImage} resizeMode="contain" accessibilityLabel="Foto de la entrega" /> : <Text style={styles.compareEmpty}>Todavía sin foto en la entrega</Text>}
      </View> : photo ? <Image source={{ uri: photo }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={title} /> : null}
    </SafeAreaView>
  </PrivateModal>;
}

/** Foto adicional con nombre libre ("Agregar foto" de la web). */
export function AddPhotoSheet({ onCapture, onClose }: { onCapture: (label: string, source: "camera" | "library") => void; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const go = (source: "camera" | "library") => { if (!label.trim()) { setError("Escribe un nombre para la foto."); return; } onCapture(label.trim(), source); };
  return <PickerSheet title="Agregar foto" onClose={onClose}
    footer={<View style={styles.footer}>
      <Button title="Tomar foto" icon="camera" onPress={() => go("camera")} />
      <Button title="Elegir de la galería" variant="secondary" icon="images-outline" onPress={() => go("library")} />
    </View>}>
    <Text style={styles.hint}>Una foto que no está en la lista de ángulos, por ejemplo un detalle o un accesorio.</Text>
    <Text style={styles.label}>Nombre de la foto *</Text>
    <TextInput value={label} onChangeText={(value) => { setLabel(value); setError(""); }} maxLength={150} placeholder="Ej.: Golpe en tapa lateral" placeholderTextColor={palette.textMuted}
      style={[styles.input, Boolean(error) && styles.inputInvalid]} accessibilityLabel="Nombre de la foto" />
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Guía paso a paso por cada ángulo, con la silueta y el consejo de la web; al tomar una foto pasa a la siguiente pendiente. */
export function GuidedCapture({ slots, busy, onCapture, onClose }: {
  slots: InspectionSlot[]; busy: Record<string, boolean>; onCapture: (slot: InspectionSlot, source: "camera" | "library") => Promise<boolean>; onClose: () => void;
}) {
  const firstPending = Math.max(0, slots.findIndex((slot) => !slot.photo));
  const [index, setIndex] = useState(firstPending);
  const slot = slots[Math.min(index, slots.length - 1)];
  const latest = useRef(slots);
  latest.current = slots;
  useEffect(() => { if (index >= slots.length) setIndex(Math.max(0, slots.length - 1)); }, [slots.length]);
  async function capture(source: "camera" | "library") {
    if (!slot) return;
    if (!(await onCapture(slot, source))) return;
    // Siguiente pendiente después de esta (o la primera pendiente desde el inicio).
    const after = latest.current.findIndex((item, position) => position > index && !item.photo && item.key !== slot.key);
    const any = latest.current.findIndex((item) => !item.photo && item.key !== slot.key);
    if (after >= 0) setIndex(after); else if (any >= 0) setIndex(any);
  }
  const pending = slots.filter((item) => !item.photo).length;
  return <PrivateModal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.guide}>
      <View style={styles.viewerBar}>
        <View style={styles.grow}>
          <Text style={styles.guideStep}>{slots.length === 0 ? "Sin fotos" : `${Math.min(index, slots.length - 1) + 1} / ${slots.length}`} · {pending === 0 ? "todas cargadas" : `${pending} pendiente(s)`}</Text>
          <Text style={styles.viewerTitle} numberOfLines={1}>{slot?.name ?? "Guía de fotos"}</Text>
        </View>
        <IconButton name="close" label="Cerrar guía" onPress={onClose} />
      </View>
      {slot ? <ScrollView contentContainerStyle={styles.guideBody}>
        <View style={styles.guideFrame}>
          {busy[`slot:${slot.key}`] ? <ActivityIndicator color={palette.white} size="large" />
            : slot.photo ? <Image source={{ uri: slot.photo.url }} style={styles.guidePhoto} resizeMode="cover" accessibilityLabel={`Foto ${slot.name}`} />
            : <SvgXml xml={inspectionSilhouette(slot.key, "#E2E8F0")} width={150} height={262} />}
          <View style={styles.guideBadge}><Badge slot={slot} /></View>
        </View>
        <View style={styles.guideHint}><Ionicons name="bulb-outline" size={18} color={palette.orange} accessible={false} /><Text style={styles.guideHintText}>{inspectionHint(slot.key)}</Text></View>
        <Button title={slot.photo ? "Reemplazar con la cámara" : "Tomar foto"} icon="camera" disabled={busy[`slot:${slot.key}`]} onPress={() => void capture("camera")} />
        <Button title="Subir desde la galería" icon="images-outline" variant="secondary" disabled={busy[`slot:${slot.key}`]} onPress={() => void capture("library")} />
        <View style={styles.guideNav}>
          <View style={styles.grow}><Button title="Anterior" icon="chevron-back" variant="ghost" disabled={index === 0} onPress={() => setIndex((value) => Math.max(0, value - 1))} /></View>
          <View style={styles.grow}><Button title="Siguiente" icon="chevron-forward" variant="ghost" disabled={index >= slots.length - 1} onPress={() => setIndex((value) => Math.min(slots.length - 1, value + 1))} /></View>
        </View>
        {pending === 0 ? <Button title="Listo" icon="checkmark-done-outline" onPress={onClose} /> : null}
      </ScrollView> : <Text style={styles.compareEmpty}>Este equipo no tiene fotos definidas.</Text>}
    </SafeAreaView>
  </PrivateModal>;
}

/**
 * Listas de revisión como en la web: puntos obligatorios completados, una fila por lista con su avance y el botón para
 * agregar o quitar listas. Tocar una lista la abre para completarla.
 */
export function InspectionChecklistPanel({ checklists, managing, onManage, onOpen }: {
  checklists: InspectionChecklist[]; managing: boolean; onManage: () => void; onOpen: (checklistId: number) => void;
}) {
  const required = checklists.flatMap((checklist) => checklist.steps.filter((step) => step.isRequired));
  const done = required.filter((step) => step.answer?.isCompleted).length;
  const total = checklists.reduce((sum, checklist) => sum + checklist.steps.length, 0);
  return <View style={styles.section}>
    <View style={styles.headRow}>
      <View style={[styles.ring, styles.ringChecklist]}><Ionicons name="checkbox-outline" size={24} color={palette.success} accessible={false} /></View>
      <View style={styles.grow}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Listas de revisión</Text>
        <Text style={styles.hint}>{checklists.length === 0 ? "Agrega una lista para completar la revisión." : "Toca una lista para completarla."}</Text>
      </View>
    </View>
    {checklists.length === 0 ? <View style={styles.emptyLists}>
      <Text style={styles.emptyTitle}>No hay listas asociadas</Text>
      <Text style={styles.hint}>Agrega una lista de revisión para habilitar sus preguntas en esta inspección.</Text>
    </View> : <>
      <View style={styles.points}>
        <Text style={styles.pointsValue}>{done}/{required.length}</Text>
        <View style={styles.grow}>
          <Text style={styles.pointsLabel}>OBLIGATORIOS COMPLETADOS</Text>
          <Text style={styles.hint}>de {total} preguntas en total</Text>
        </View>
        <Text style={styles.listsChip}>{checklists.length} lista(s)</Text>
      </View>
      <View style={styles.bar}><View style={[styles.barFill, { width: `${required.length === 0 ? 0 : Math.round((done / required.length) * 100)}%` }]} /></View>
      {checklists.map((checklist) => {
        const own = checklist.steps.filter((step) => step.isRequired);
        const base = own.length > 0 ? own : checklist.steps;
        const ready = base.filter((step) => own.length > 0 ? step.answer?.isCompleted : step.answer?.responseValue != null).length;
        const percent = base.length === 0 ? 0 : Math.round((ready / base.length) * 100);
        return <Pressable key={checklist.checklistId} accessibilityRole="button" accessibilityLabel={`${checklist.name}, ${percent} por ciento`} onPress={() => onOpen(checklist.checklistId)}
          style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <View style={styles.listTop}>
            <Text style={styles.listName} numberOfLines={2}>{checklist.name}</Text>
            <Text style={[styles.listPercent, percent === 100 && styles.listDone]}>{percent}%</Text>
          </View>
          <Text style={styles.listMeta}>{checklist.steps.length} PREGUNTAS{checklist.isRequired || checklist.locked ? " · OBLIGATORIA" : ""}</Text>
          <View style={styles.bar}><View style={[styles.barFill, percent === 100 && styles.barDone, { width: `${percent}%` }]} /></View>
        </Pressable>;
      })}
    </>}
    <Pressable accessibilityRole="button" accessibilityLabel="Agregar o quitar listas" disabled={managing} onPress={onManage} style={({ pressed }) => [styles.manage, pressed && styles.pressed]}>
      {managing ? <ActivityIndicator size="small" color={palette.primary} /> : <Ionicons name="list-outline" size={18} color={palette.text} accessible={false} />}
      <Text style={styles.manageText}>{checklists.length === 0 ? "Agregar lista de revisión" : "Agregar o quitar listas"}</Text>
    </Pressable>
  </View>;
}

const remainingText = (seconds: number) => {
  if (seconds <= 0) return "Vencido";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `Vence en ${hours} h ${minutes} min` : `Vence en ${minutes} min`;
};

/** Compartir como en la web: enlace público con QR para que otra persona suba fotos sin iniciar sesión, mientras no venza. */
export function ShareSheet({ load, extend, onClose }: { load: () => Promise<InspectionShare>; extend: () => Promise<InspectionShare>; onClose: () => void }) {
  const [share, setShare] = useState<InspectionShare | null>(null);
  const [error, setError] = useState("");
  const [extending, setExtending] = useState(false);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const loader = useRef(load);
  loader.current = load;
  const fetchShare = () => { setError(""); loader.current().then((value) => { setShare(value); setLoadedAt(Date.now()); }, (failure: unknown) => setError(failureText(failure, "No se pudo obtener el enlace."))); };
  useEffect(fetchShare, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const remaining = share ? Math.max(0, share.remainingSeconds - Math.floor((now - loadedAt) / 1000)) : 0;
  async function renew() {
    setExtending(true); setError("");
    try { setShare(await extend()); setLoadedAt(Date.now()); setNow(Date.now()); }
    catch (failure) { setError(failureText(failure, "No se pudo extender el enlace.")); }
    finally { setExtending(false); }
  }
  return <PickerSheet title="Compartir inspección" onClose={onClose}
    footer={share ? <View style={styles.footer}>
      {remaining > 0 ? <Button title="Enviar enlace" icon="share-social-outline" onPress={() => void Share.share({ message: `Inspección del equipo: sube las fotos desde este enlace\n${share.url}` })} /> : null}
      <Button title={remaining > 0 ? "Extender 24 horas" : "Activar por 24 horas"} variant={remaining > 0 ? "secondary" : "primary"} icon="time-outline" loading={extending} disabled={extending} onPress={() => void renew()} />
    </View> : null}>
    {!share && !error ? <View style={styles.center}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Preparando el enlace…</Text></View> : null}
    {error ? <View style={styles.footer}><Notice tone="danger" icon="alert-circle-outline" message={error} />{!share ? <Button title="Reintentar" variant="secondary" icon="refresh" onPress={fetchShare} /> : null}</View> : null}
    {share ? <>
      <Text style={styles.hint}>Quien escanee este código puede subir fotos, responder la lista y completar la inspección desde su teléfono, sin iniciar sesión.</Text>
      <View style={[styles.qr, remaining <= 0 && styles.qrExpired]}><QrCode value={share.url} size={220} /></View>
      <Text style={[styles.expiry, remaining <= 0 && styles.expiryOff]}>{remainingText(remaining)}</Text>
      <Text style={styles.link} selectable numberOfLines={3}>{share.url}</Text>
    </> : null}
  </PickerSheet>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 5, borderColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  ringValue: { fontSize: 15, fontWeight: "800", color: palette.heading },
  grow: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: palette.heading },
  hint: { ...typography.caption, color: palette.textSecondary },
  bar: { height: 6, borderRadius: 3, marginTop: 6, backgroundColor: palette.track, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: palette.primary },
  chips: { gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipCount: { fontSize: 13, fontWeight: "800", color: palette.heading },
  chipText: { fontSize: 13, fontWeight: "600", color: palette.textSecondary },
  chipTextOn: { color: palette.white },
  tools: { flexDirection: "row", gap: 8 },
  tool: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 58, paddingHorizontal: 4, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  toolPrimary: { backgroundColor: palette.primary, borderColor: palette.primary },
  toolText: { fontSize: 11, lineHeight: 13, fontWeight: "800", color: palette.primary, textAlign: "center" },
  toolTextPrimary: { color: palette.white },
  pressed: { opacity: 0.8 },
  empty: { ...typography.caption, color: palette.textSecondary, textAlign: "center", paddingVertical: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slot: { width: "47%", flexGrow: 1, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, overflow: "hidden", backgroundColor: palette.background },
  slotRequired: { borderColor: palette.orange, borderStyle: "dashed" },
  slotImage: { height: 112, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  slotPhoto: { width: "100%", height: 112 },
  slotFooter: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 8 },
  slotName: { flex: 1, fontSize: 13, fontWeight: "700", color: palette.text },
  slotBadge: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 8, paddingTop: 4 },
  badge: { overflow: "hidden", fontSize: 10, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  referenceTag: { position: "absolute", left: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 4, padding: 3, paddingRight: 7, borderRadius: 8, backgroundColor: "rgba(15,23,42,0.75)" },
  referenceImage: { width: 26, height: 26, borderRadius: 5 },
  referenceText: { fontSize: 10, fontWeight: "800", color: palette.white },
  viewer: { flex: 1, backgroundColor: "rgba(2,6,23,0.94)" },
  viewerBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: palette.surface },
  viewerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: palette.heading },
  viewerImage: { flex: 1, width: "100%" },
  compare: { flex: 1, gap: 6, padding: 12 },
  compareLabel: { fontSize: 13, fontWeight: "800", color: palette.white },
  compareImage: { flex: 1, width: "100%", borderRadius: radius.md },
  compareEmpty: { ...typography.caption, color: palette.textMuted, textAlign: "center", paddingVertical: 24 },
  footer: { gap: 8 },
  label: { ...typography.label, color: palette.text },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  inputInvalid: { borderColor: palette.danger },
  error: { ...typography.caption, color: palette.danger },
  guide: { flex: 1, backgroundColor: palette.background },
  guideStep: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
  guideBody: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 12 },
  guideFrame: { height: 320, borderRadius: radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#1E293B" },
  guidePhoto: { width: "100%", height: 320 },
  guideBadge: { position: "absolute", top: 10, right: 10 },
  guideHint: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: palette.orangeSoft },
  guideHintText: { flex: 1, ...typography.caption, color: palette.text },
  guideNav: { flexDirection: "row", gap: 8 },
  center: { alignItems: "center", gap: 8, paddingVertical: 24 },
  ringChecklist: { borderColor: palette.successSoft },
  emptyLists: { gap: 4, alignItems: "center", padding: 16, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: palette.orange, backgroundColor: palette.orangeSoft },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: palette.heading },
  points: { flexDirection: "row", alignItems: "center", gap: 10 },
  pointsValue: { fontSize: 26, fontWeight: "800", color: palette.heading, fontVariant: ["tabular-nums"] },
  pointsLabel: { fontSize: 11, fontWeight: "800", color: palette.text },
  listsChip: { overflow: "hidden", fontSize: 12, fontWeight: "800", color: palette.text, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
  listRow: { gap: 6, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  listTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  listName: { flex: 1, fontSize: 14, fontWeight: "800", color: palette.heading },
  listPercent: { fontSize: 15, fontWeight: "800", color: palette.primary },
  listDone: { color: palette.success },
  listMeta: { fontSize: 11, fontWeight: "700", color: palette.textSecondary },
  barDone: { backgroundColor: palette.success },
  manage: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  manageText: { fontSize: 14, fontWeight: "800", color: palette.text },
  qr: { alignSelf: "center", padding: 10, borderRadius: radius.md, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border },
  qrExpired: { opacity: 0.25 },
  expiry: { textAlign: "center", fontSize: 14, fontWeight: "800", color: palette.success },
  expiryOff: { color: palette.danger },
  link: { ...typography.caption, color: palette.textSecondary, textAlign: "center" }
});
