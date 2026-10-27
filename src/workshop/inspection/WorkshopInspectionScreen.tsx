import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";
import { useTrustedNativePicker } from "../../security/DeviceSecurityContext";
import { pickAvatar } from "../../screens/profile/pickAvatar";
import { scaledJpeg } from "../../infrastructure/avatarImage";
import { CameraPermissionError } from "../../domain/cameraErrors";
import { inspectionRequirementLabel } from "../../domain/workshopEntry";
import {
  INSPECTION_PHOTO_MAX_BYTES, RESPONSIBILITY_LABELS, SEVERITY_LABELS, inspectionPending, isInspectionStepCompleted, isValidInspectionResponse,
  type InspectionChecklist, type InspectionDamage, type InspectionSlot, type InspectionDamageInput, type InspectionKind, type InspectionStep, type WorkshopInspectionState
} from "../../domain/workshopInspection";
import type { useWorkshopBoard } from "../useWorkshopBoard";
import { MultiPicker, OptionRow, PickerSheet } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";
import { StepAnswerControl } from "./StepAnswerControl";
import { DamageEditor, type DamagePhoto } from "./DamageEditor";
import { AddPhotoSheet, GuidedCapture, InspectionChecklistPanel, InspectionPhotoPanel, InspectionPhotoSummary, PhotoActionsSheet, PhotoViewer, ShareSheet } from "./InspectionPhotos";
import { InspectionChecklistScreen } from "./InspectionChecklistScreen";

type InspectionApi = ReturnType<typeof useWorkshopBoard>["inspection"];
type PhotoTarget = { kind: "slot"; key: string; name: string; hasPhoto: boolean } | { kind: "custom"; label: string } | { kind: "step"; stepId: number; title: string } | { kind: "damage"; damageId: number };
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

function Thumb({ uri, onRemove, label }: { uri: string; onRemove?: () => void; label: string }) {
  return <View style={styles.thumb}>
    <Image source={{ uri }} style={styles.thumbImage} accessibilityLabel={label} />
    {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${label}`} hitSlop={6} onPress={onRemove} style={styles.thumbRemove}>
      <Ionicons name="close" size={14} color={palette.white} />
    </Pressable> : null}
  </View>;
}

/** Paso 2 del ingreso (o paso 1 de la entrega): inspección con fotos por ángulo, listas de revisión y daños. Guarda a medida que se responde. */
export function WorkshopInspectionScreen({ api, entryId, kind, onClose, onDone }: {
  api: InspectionApi; entryId: number; kind: InspectionKind; onClose: () => void; onDone: () => void;
}) {
  const picker = useTrustedNativePicker();
  const [state, setState] = useState<WorkshopInspectionState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [pendingSaves, setPendingSaves] = useState(0);
  const [photoTarget, setPhotoTarget] = useState<PhotoTarget | null>(null);
  const [checklistPicker, setChecklistPicker] = useState<{ id: number; name: string }[] | null>(null);
  const [damageEditor, setDamageEditor] = useState<{ damage: InspectionDamage | null; error: string; location?: string } | null>(null);
  // Herramientas de fotos (como en la web): acciones por foto, ver/comparar, agregar, guía, compartir y comprimido.
  const [slotActions, setSlotActions] = useState<InspectionSlot | null>(null);
  const [viewer, setViewer] = useState<{ title: string; photo: string | null; reference?: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [openChecklist, setOpenChecklist] = useState<number | null>(null);
  // La portada muestra el resumen de fotos y listas; las fotos se trabajan en su propia vista.
  const [photosOpen, setPhotosOpen] = useState(false);
  const [comments, setComments] = useState<Record<number, boolean>>({});
  const [observation, setObservation] = useState("");
  const [finishing, setFinishing] = useState(false);
  const timers = useRef(new Map<number, { timer: ReturnType<typeof setTimeout>; run: () => Promise<boolean> }>());
  // Guardados por pregunta, en cadena para que lleguen en orden; los fallidos se reintentan al terminar.
  const chains = useRef(new Map<number, Promise<boolean>>());
  const retries = useRef(new Map<number, () => Promise<boolean>>());
  const loads = useRef(0);
  const current = useRef(state);
  current.current = state;
  const mark = (key: string, value: boolean) => setBusy((previous) => ({ ...previous, [key]: value }));

  const leave = useRef<() => void>(() => undefined);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { leave.current(); return true; });
    return () => subscription.remove();
  }, []);

  /** Envía lo que estaba esperando, reintenta lo fallido y espera a que todo llegue. Devuelve si quedó todo guardado. */
  async function flush(): Promise<boolean> {
    for (const pending of [...timers.current.values()]) { clearTimeout(pending.timer); void pending.run(); }
    timers.current.clear();
    for (const retry of [...retries.current.values()]) void retry();
    retries.current.clear();
    return (await Promise.all([...chains.current.values()])).every(Boolean);
  }

  async function open() {
    setLoadError("");
    try {
      const opened = await api.open(entryId, kind);
      setState(opened); setObservation(opened.observation ?? "");
    } catch (failure) { setLoadError(failureText(failure, "No se pudo abrir la inspección. Revisa tu conexión.")); }
  }
  async function reload() {
    const inspection = current.current;
    if (!inspection) return;
    const read = ++loads.current;
    try {
      // Primero llegan las respuestas pendientes, así lo recargado ya las trae.
      await flush();
      const loaded = await api.load(entryId, inspection.inspectionId);
      if (read !== loads.current) return;
      // Lo que se escribió mientras se recargaba se conserva.
      setState((local) => !local ? loaded : { ...loaded, checklists: loaded.checklists.map((checklist) => ({ ...checklist, steps: checklist.steps.map((step) => {
        if (!timers.current.has(step.checklistStepId)) return step;
        const mine = local.checklists.find((item) => item.checklistId === checklist.checklistId)?.steps.find((item) => item.checklistStepId === step.checklistStepId);
        return mine?.answer ? { ...step, answer: { ...mine.answer, stepId: step.answer?.stepId ?? mine.answer.stepId, files: step.answer?.files ?? mine.answer.files } } : step;
      }) })) });
    } catch (failure) { setMessage(failureText(failure, "No se pudo actualizar la inspección.")); }
  }
  useEffect(() => {
    void open();
    // Al salir se guardan de inmediato las respuestas que estaban esperando.
    return () => { void flush(); };
  }, []);

  // Respuestas: se ven al instante y se guardan (texto con una pequeña espera; botones de inmediato).
  function updateStep(checklistId: number, checklistStepId: number, patch: (step: InspectionStep) => InspectionStep) {
    setState((previous) => previous && ({ ...previous, checklists: previous.checklists.map((checklist) => checklist.checklistId !== checklistId ? checklist
      : { ...checklist, steps: checklist.steps.map((step) => step.checklistStepId === checklistStepId ? patch(step) : step) }) }));
  }
  function answer(checklist: InspectionChecklist, step: InspectionStep, responseValue: string | null, comment: string | null, immediate: boolean) {
    const files = step.answer?.files ?? [];
    // Un número a medio escribir (p. ej. "12.") no se envía: el servidor lo rechazaría.
    const valid = isValidInspectionResponse(step, responseValue);
    updateStep(checklist.checklistId, step.checklistStepId, (item) => ({ ...item, answer: {
      stepId: item.answer?.stepId ?? 0, responseValue, comment, files, isCompleted: valid && isInspectionStepCompleted(item, responseValue, files.length)
    } }));
    const inspection = current.current;
    const key = step.checklistStepId;
    const previous = timers.current.get(key);
    if (previous) clearTimeout(previous.timer);
    timers.current.delete(key);
    retries.current.delete(key);
    if (!inspection || !valid) return;
    const run = (): Promise<boolean> => {
      timers.current.delete(key);
      setPendingSaves((count) => count + 1);
      const save = (chains.current.get(key) ?? Promise.resolve(true))
        .then(() => api.answer(entryId, inspection.inspectionId, { checklistId: checklist.checklistId, checklistStepId: key, responseValue, comment }))
        .then((saved) => { updateStep(checklist.checklistId, key, (item) => item.answer ? { ...item, answer: { ...item.answer, stepId: saved.id } } : item); return true; },
          (failure: unknown) => { retries.current.set(key, run); setMessage(failureText(failure, "No se pudo guardar una respuesta. Revisa tu conexión.")); return false; })
        .finally(() => setPendingSaves((count) => count - 1));
      chains.current.set(key, save);
      return save;
    };
    timers.current.set(key, { timer: setTimeout(() => void run(), immediate ? 0 : 700), run });
  }

  /** Toma o elige la foto, la sube y recarga. Devuelve si quedó guardada (la guía pasa a la siguiente solo entonces). */
  async function takePhoto(target: PhotoTarget, source: "camera" | "library"): Promise<boolean> {
    const inspection = current.current;
    setPhotoTarget(null);
    if (!inspection) return false;
    const key = target.kind === "slot" ? `slot:${target.key}` : target.kind === "custom" ? "custom" : target.kind === "step" ? `step:${target.stepId}` : `damage:${target.damageId}`;
    setMessage("");
    try {
      const uri = await pickAvatar(source, picker, () => true, { camera: "back", square: false });
      if (!uri) return false;
      mark(key, true);
      const image = await scaledJpeg(uri, 1600, INSPECTION_PHOTO_MAX_BYTES);
      const origin = source === "camera" ? "camera" : "gallery";
      if (target.kind === "slot") await api.uploadPhoto(entryId, inspection.inspectionId, target.key, image, origin);
      else if (target.kind === "custom") await api.uploadCustomPhoto(entryId, inspection.inspectionId, target.label, image, origin);
      else if (target.kind === "step") await api.uploadStepFile(entryId, inspection.inspectionId, target.stepId, image, origin);
      else await api.uploadDamagePhoto(entryId, inspection.inspectionId, target.damageId, image, origin);
      await reload();
      return true;
    } catch (failure) {
      setMessage(failure instanceof CameraPermissionError ? "La app no tiene permiso para usar la cámara. Actívalo en los ajustes del teléfono." : failureText(failure, "No se pudo subir la foto."));
      return false;
    } finally { mark(key, false); }
  }
  async function downloadPhotos() {
    const inspection = current.current;
    if (!inspection || downloading) return;
    setDownloading(true); setMessage("");
    try { await api.downloadPhotos(entryId, inspection.inspectionId, `inspeccion-ING-${String(entryId).padStart(5, "0")}-${kind === "entry" ? "ingreso" : "entrega"}`); }
    catch (failure) { setMessage(failureText(failure, "No se pudo descargar el comprimido.")); }
    finally { setDownloading(false); }
  }
  async function removeSlotPhoto(slotKey: string) {
    const inspection = current.current;
    setPhotoTarget(null);
    if (!inspection) return;
    mark(`slot:${slotKey}`, true);
    try { await api.deletePhoto(entryId, inspection.inspectionId, slotKey); await reload(); }
    catch (failure) { setMessage(failureText(failure, "No se pudo quitar la foto.")); }
    finally { mark(`slot:${slotKey}`, false); }
  }
  async function removeStepFile(stepId: number, fileId: number) {
    const inspection = current.current;
    if (!inspection) return;
    mark(`step:${stepId}`, true);
    try { await api.deleteStepFile(entryId, inspection.inspectionId, fileId); await reload(); }
    catch (failure) { setMessage(failureText(failure, "No se pudo quitar la foto.")); }
    finally { mark(`step:${stepId}`, false); }
  }

  async function openChecklistPicker() {
    setMessage("");
    try { setChecklistPicker((await api.checklistOptions()).items); }
    catch (failure) { setMessage(failureText(failure, "No se pudieron cargar las listas de revisión.")); }
  }
  async function saveChecklists(ids: number[]) {
    const inspection = current.current;
    setChecklistPicker(null);
    if (!inspection) return;
    mark("checklists", true);
    try { setState(await api.setChecklists(entryId, inspection.inspectionId, ids)); }
    catch (failure) { setMessage(failureText(failure, "No se pudieron cambiar las listas.")); }
    finally { mark("checklists", false); }
  }

  async function saveDamage(input: Omit<InspectionDamageInput, "companyBranchId">, photo: DamagePhoto | null) {
    const inspection = current.current;
    if (!inspection) return;
    mark("damage", true);
    try {
      const saved = await api.saveDamage(entryId, inspection.inspectionId, input);
      const damageId = input.id ?? saved.id;
      if (photo && damageId) {
        const image = await scaledJpeg(photo.uri, 1600, INSPECTION_PHOTO_MAX_BYTES);
        await api.uploadDamagePhoto(entryId, inspection.inspectionId, damageId, image, photo.source === "camera" ? "camera" : "gallery");
      }
      setDamageEditor(null); await reload();
    }
    catch (failure) { setDamageEditor((editor) => editor && { ...editor, error: failureText(failure, "No se pudo guardar el daño.") }); }
    finally { mark("damage", false); }
  }
  async function pickDamagePhoto(source: DamagePhoto["source"]): Promise<string | null> {
    try { return await pickAvatar(source, picker, () => true, { camera: "back", square: false }) ?? null; }
    catch (failure) {
      setDamageEditor((editor) => editor && { ...editor, error: failure instanceof CameraPermissionError ? "La app no tiene permiso para usar la cámara. Actívalo en los ajustes del teléfono." : failureText(failure, "No se pudo obtener la foto.") });
      return null;
    }
  }
  async function deleteDamage(damageId: number) {
    const inspection = current.current;
    if (!inspection) return;
    mark(`damage:${damageId}`, true);
    try { await api.deleteDamage(entryId, inspection.inspectionId, damageId); await reload(); }
    catch (failure) { setMessage(failureText(failure, "No se pudo quitar el daño.")); }
    finally { mark(`damage:${damageId}`, false); }
  }

  /** Terminar (marca la inspección como hecha), omitir (sigue sin terminarla) o salir para seguir después. */
  async function finish(mode: "complete" | "skip" | "leave") {
    const inspection = current.current;
    if (!inspection || finishing) return;
    setFinishing(true); setMessage("");
    try {
      if (!(await flush())) { setMessage("Una respuesta no se pudo guardar. Revisa tu conexión y vuelve a intentarlo."); return; }
      if ((inspection.observation ?? "") !== observation.trim()) await api.saveObservation(entryId, inspection.inspectionId, observation.trim() || null);
      if (mode === "complete") await api.complete(entryId, inspection.inspectionId);
      if (mode === "leave") onClose(); else onDone();
    } catch (failure) { setMessage(failureText(failure, "No se pudo guardar la inspección.")); }
    finally { setFinishing(false); }
  }

  // Atrás (flecha o botón del teléfono) guarda lo pendiente y la observación antes de salir; si aún no abre, solo sale.
  leave.current = () => {
    if (finishing) return;
    if (photosOpen) { setPhotosOpen(false); return; }
    if (current.current) void finish("leave"); else onClose();
  };

  const title = kind === "entry" ? "Inspección de ingreso" : "Inspección de entrega";
  const pending = state ? inspectionPending(state) : [];
  const started = state ? state.slots.some((slot) => slot.photo) || state.checklists.some((checklist) => checklist.steps.some((step) => step.answer)) || state.damages.length > 0 : false;
  const requiredSteps = state?.checklists.flatMap((checklist) => checklist.steps.filter((step) => step.isRequired)) ?? [];
  const doneSteps = requiredSteps.filter((step) => step.answer?.isCompleted).length;
  const photosDone = state?.slots.filter((slot) => slot.photo).length ?? 0;

  return <View style={styles.screen}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label={photosOpen ? "Volver al resumen de la inspección" : "Salir de la inspección"} disabled={finishing} onPress={() => leave.current()} />
      <View style={styles.barText}>
        <Text style={styles.barTitle}>{photosOpen ? "Fotos de la inspección" : title}</Text>
        <Text style={styles.barStep}>{photosOpen ? `${title} · Se guarda al subir cada foto`
          : kind === "entry" ? "Paso 2 de 3 · Se guarda a medida que respondes" : "Paso 1 de 2 · Se guarda a medida que respondes"}</Text>
      </View>
      {pendingSaves > 0 ? <View style={styles.saving}><ActivityIndicator size="small" color={palette.primary} /><Text style={styles.savingText}>Guardando</Text></View> : null}
    </View>
    {kind === "entry" ? <View style={styles.progress}><View style={[styles.progressStep, styles.progressOn]} /><View style={[styles.progressStep, styles.progressOn]} /><View style={styles.progressStep} /></View> : null}

    {!state ? <View style={styles.loading}>
      {loadError ? <><Notice tone="danger" icon="cloud-offline-outline" message={loadError} /><Button title="Reintentar" icon="refresh" variant="secondary" onPress={() => void open()} /></>
        : <><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Abriendo la inspección…</Text></>}
    </View> : photosOpen ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <InspectionPhotoPanel slots={state.slots} kind={kind} busy={busy} downloading={downloading} onSlot={setSlotActions}
        damageCounts={state.damages.reduce<Record<string, number>>((counts, damage) => {
          if (!damage.isAdditional && damage.location) counts[damage.location] = (counts[damage.location] ?? 0) + 1;
          return counts;
        }, {})}
        onCompare={(slot) => setViewer({ title: `Comparar: ${slot.name}`, photo: slot.photo?.fullUrl ?? slot.photo?.url ?? null, reference: slot.reference?.fullUrl ?? slot.reference?.url ?? null })}
        onDamage={(slot) => setDamageEditor({ damage: null, error: "", location: slot.key })}
        onAdd={() => setAdding(true)} onGuide={() => setGuiding(true)} onDownload={() => void downloadPhotos()} onShare={() => setSharing(true)} />
      {busy.custom ? <View style={styles.saving}><ActivityIndicator size="small" color={palette.primary} /><Text style={styles.savingText}>Subiendo foto adicional…</Text></View> : null}
      {message ? <Notice tone="danger" icon="alert-circle-outline" message={message} /> : null}
      <Button title="Volver al resumen" icon="arrow-back" variant="secondary" onPress={() => setPhotosOpen(false)} />
    </ScrollView> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Ionicons name="shield-checkmark-outline" size={20} color={palette.primary} accessible={false} />
          <Text style={styles.summaryTitle}>La sucursal exige: {inspectionRequirementLabel(state.requirement).toLowerCase()}</Text>
        </View>
        <View style={styles.counters}>
          <Text style={styles.counter}><Text style={styles.counterValue}>{photosDone}/{state.slots.length}</Text> fotos</Text>
          <Text style={styles.counter}><Text style={styles.counterValue}>{doneSteps}/{requiredSteps.length}</Text> preguntas obligatorias</Text>
          <Text style={styles.counter}><Text style={styles.counterValue}>{state.damages.length}</Text> daños</Text>
        </View>
        {state.completedAt ? <Text style={styles.done}>Inspección terminada. Puedes seguir corrigiéndola.</Text>
          : pending.length > 0 ? <Text style={styles.pendingText}>{pending.join(" · ")}</Text> : <Text style={styles.done}>Cumple lo exigido. Ya puedes terminarla.</Text>}
      </View>

      <InspectionPhotoSummary slots={state.slots} onOpen={() => setPhotosOpen(true)} />

      <InspectionChecklistPanel checklists={state.checklists} managing={Boolean(busy.checklists)} onManage={() => void openChecklistPicker()} onOpen={setOpenChecklist} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, styles.grow]} accessibilityRole="header">Daños</Text>
          <Button title="Agregar daño" icon="add" variant="ghost" onPress={() => setDamageEditor({ damage: null, error: "" })} />
        </View>
        {state.damages.length === 0 ? <Text style={styles.hint}>Sin daños registrados.</Text> : null}
        {state.damages.map((damage) => <View key={damage.id} style={styles.damage}>
          <View style={styles.damageTop}>
            <Text style={[styles.badge, damage.severity === "HIGH" ? styles.badgeHigh : damage.severity === "LOW" ? styles.badgeLow : styles.badgeMedium]}>{SEVERITY_LABELS[damage.severity]}</Text>
            <Text style={styles.damageMeta} numberOfLines={1}>{RESPONSIBILITY_LABELS[damage.responsibility]}{damage.location ? ` · ${state.slots.find((slot) => slot.key === damage.location)?.name ?? damage.location}` : ""}</Text>
          </View>
          <Text style={styles.damageText}>{damage.description}</Text>
          {damage.photos.length > 0 ? <View style={styles.thumbs}>{damage.photos.map((photo) => <Thumb key={photo.fileId} uri={photo.url} label="foto del daño" />)}</View> : null}
          <View style={styles.stepActions}>
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setPhotoTarget({ kind: "damage", damageId: damage.id })}><Text style={styles.link}>Agregar foto</Text></Pressable>
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setDamageEditor({ damage, error: "" })}><Text style={styles.link}>Editar</Text></Pressable>
            <Pressable accessibilityRole="button" hitSlop={6} disabled={busy[`damage:${damage.id}`]} onPress={() => void deleteDamage(damage.id)}><Text style={[styles.link, styles.linkDanger]}>Quitar</Text></Pressable>
            {busy[`damage:${damage.id}`] ? <ActivityIndicator size="small" color={palette.primary} /> : null}
          </View>
        </View>)}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Observaciones de la inspección</Text>
        <TextInput value={observation} onChangeText={setObservation} placeholder="Opcional" placeholderTextColor={palette.textMuted} maxLength={2000} multiline
          style={styles.comment} accessibilityLabel="Observaciones de la inspección" textAlignVertical="top" />
      </View>

      {message ? <Notice tone="danger" icon="alert-circle-outline" message={message} /> : null}
      <Button title={state.completedAt ? "Guardar y continuar" : "Terminar inspección"} icon="checkmark-done-outline" loading={finishing}
        disabled={finishing || (!state.completedAt && pending.length > 0)} onPress={() => void finish(state.completedAt ? "skip" : "complete")} />
      {pending.length > 0 && state.requirement !== "none" && !state.completedAt ? <Text style={styles.footnote}>Para terminarla falta: {pending.join(" · ")}</Text> : null}
      {state.requirement === "none" && !started && !state.completedAt ? <Button title="Omitir y continuar" variant="ghost" icon="play-skip-forward-outline" disabled={finishing} onPress={() => void finish("skip")} /> : null}
      <Button title="Salir y seguir después" variant="secondary" disabled={finishing} onPress={() => void finish("leave")} />
    </ScrollView>}

    {photoTarget ? <PickerSheet title={photoTarget.kind === "slot" ? `Foto: ${photoTarget.name}` : photoTarget.kind === "step" ? "Foto de la pregunta" : "Foto del daño"} onClose={() => setPhotoTarget(null)}>
      <OptionRow title="Tomar foto" subtitle="Con la cámara del teléfono" selected={false} onPress={() => void takePhoto(photoTarget, "camera")}
        leading={<Ionicons name="camera" size={22} color={palette.primary} />} />
      <OptionRow title="Elegir de la galería" selected={false} onPress={() => void takePhoto(photoTarget, "library")} leading={<Ionicons name="images-outline" size={22} color={palette.primary} />} />
      {photoTarget.kind === "slot" && photoTarget.hasPhoto ? <OptionRow title="Quitar foto" selected={false} onPress={() => void removeSlotPhoto(photoTarget.key)}
        leading={<Ionicons name="trash-outline" size={22} color={palette.danger} />} /> : null}
    </PickerSheet> : null}
    {checklistPicker && state ? <MultiPicker<{ id: number; name: string }> title="Listas de revisión" items={checklistPicker} label={(item) => item.name}
      detail={(item) => state.checklists.find((checklist) => checklist.checklistId === item.id)?.locked ? "Obligatoria de la sucursal" : null}
      selected={state.checklists.map((checklist) => checklist.checklistId)} emptyText="No hay listas de revisión disponibles."
      onClose={() => setChecklistPicker(null)} onConfirm={(ids) => void saveChecklists(ids)} /> : null}
    {damageEditor && state ? <DamageEditor damage={damageEditor.damage} slots={state.slots} saving={Boolean(busy.damage)} error={damageEditor.error}
      initialLocation={damageEditor.location} onClose={() => setDamageEditor(null)} onSave={(input, photo) => void saveDamage(input, photo)}
      onPickPhoto={pickDamagePhoto} /> : null}
    {slotActions ? <PhotoActionsSheet slot={slotActions} kind={kind} onClose={() => setSlotActions(null)}
      onView={() => { setSlotActions(null); setViewer({ title: slotActions.name, photo: slotActions.photo?.fullUrl ?? slotActions.photo?.url ?? null }); }}
      onCompare={() => { setSlotActions(null); setViewer({ title: `Comparar: ${slotActions.name}`, photo: slotActions.photo?.fullUrl ?? slotActions.photo?.url ?? null,
        reference: slotActions.reference?.fullUrl ?? slotActions.reference?.url ?? null }); }}
      onCapture={(source) => { const slot = slotActions; setSlotActions(null); void takePhoto({ kind: "slot", key: slot.key, name: slot.name, hasPhoto: slot.photo !== null }, source); }}
      onDamage={() => { const slot = slotActions; setSlotActions(null); setDamageEditor({ damage: null, error: "", location: slot.key }); }}
      onRemove={() => { const slot = slotActions; setSlotActions(null); void removeSlotPhoto(slot.key); }} /> : null}
    {viewer ? <PhotoViewer title={viewer.title} photo={viewer.photo} reference={viewer.reference} onClose={() => setViewer(null)} /> : null}
    {adding ? <AddPhotoSheet onClose={() => setAdding(false)} onCapture={(label, source) => { setAdding(false); void takePhoto({ kind: "custom", label }, source); }} /> : null}
    {guiding && state ? <GuidedCapture slots={state.slots} busy={busy} onClose={() => setGuiding(false)}
      onCapture={(slot, source) => takePhoto({ kind: "slot", key: slot.key, name: slot.name, hasPhoto: slot.photo !== null }, source)} /> : null}
    {openChecklist !== null && state ? <InspectionChecklistScreen inspectionId={state.inspectionId} checklists={state.checklists} checklistId={openChecklist} mode="live"
      onClose={() => setOpenChecklist(null)}
      onSave={async (checklistId, checklistStepId, responseValue, comment) => {
        await api.answer(entryId, state.inspectionId, { checklistId, checklistStepId, responseValue, comment });
        await reload();
      }}
      onAddPhoto={(stepId, source) => takePhoto({ kind: "step", stepId, title: "Pregunta" }, source)} /> : null}
    {sharing && state ? <ShareSheet load={() => api.share(entryId, state.inspectionId)} extend={() => api.extendShare(entryId, state.inspectionId)} onClose={() => setSharing(false)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  barStep: { ...typography.caption, color: palette.textSecondary },
  saving: { flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 8 },
  savingText: { fontSize: 12, fontWeight: "700", color: palette.primary },
  progress: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  progressStep: { flex: 1, height: 4, borderRadius: 2, backgroundColor: palette.track },
  progressOn: { backgroundColor: palette.primary },
  loading: { alignItems: "center", gap: 10, padding: 32 },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 14, paddingBottom: 40 },
  summary: { gap: 8, padding: 14, borderRadius: radius.lg, backgroundColor: palette.primarySoft, borderWidth: 1, borderColor: palette.primaryBorder },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: palette.heading },
  counters: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  counter: { ...typography.caption, color: palette.textSecondary },
  counterValue: { fontWeight: "800", color: palette.text },
  pendingText: { ...typography.caption, color: palette.orange, fontWeight: "700" },
  done: { ...typography.caption, color: palette.success, fontWeight: "700" },
  section: { gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: palette.heading },
  grow: { flex: 1 },
  hint: { ...typography.caption, color: palette.textSecondary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slot: { width: "47%", flexGrow: 1, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, overflow: "hidden", backgroundColor: palette.background },
  slotRequired: { borderColor: palette.orange, borderStyle: "dashed" },
  slotImage: { height: 110, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  slotPhoto: { width: "100%", height: 110 },
  slotFooter: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8 },
  slotName: { flex: 1, fontSize: 13, fontWeight: "700", color: palette.text },
  required: { fontSize: 14, fontWeight: "800", color: palette.orange },
  checklist: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: palette.background },
  checklistHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  checklistName: { flex: 1, fontSize: 14, fontWeight: "800", color: palette.primary },
  checklistCount: { fontSize: 12, fontWeight: "800", color: palette.textSecondary },
  step: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.border },
  stepHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  stepTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: palette.text },
  stepActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 16 },
  link: { fontSize: 13, fontWeight: "700", color: palette.primary },
  linkWarn: { color: palette.orange },
  linkDanger: { color: palette.danger },
  comment: { minHeight: 60, paddingHorizontal: 12, paddingTop: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, fontSize: 14, color: palette.text },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 10, overflow: "hidden", backgroundColor: palette.track },
  thumbImage: { width: 64, height: 64 },
  thumbRemove: { position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" },
  damage: { gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: palette.background },
  damageTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, fontSize: 11, fontWeight: "800", color: palette.white },
  badgeHigh: { backgroundColor: palette.danger }, badgeMedium: { backgroundColor: palette.orange }, badgeLow: { backgroundColor: palette.success },
  damageMeta: { flex: 1, ...typography.caption, color: palette.textSecondary },
  damageText: { fontSize: 14, color: palette.text },
  footnote: { ...typography.caption, color: palette.textSecondary, textAlign: "center" }
});
