import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActivityIndicator, BackHandler, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { TimeField } from "../../ui/time/TimeField";
import { CreationDatePicker } from "../../screens/creation/CreationDatePicker";
import { useTrustedNativePicker } from "../../security/DeviceSecurityContext";
import { pickAvatar } from "../../screens/profile/pickAvatar";
import { squareJpeg } from "../../infrastructure/avatarImage";
import { CameraPermissionError } from "../../domain/cameraErrors";
import {
  WORKSHOP_IMAGE_MAX_BYTES, workshopIntakeIssues,
  type WorkshopBranchOption, type WorkshopContact, type WorkshopCustomerDetail, type WorkshopCustomerOption, type WorkshopEquipmentOption, type WorkshopIntakeInput
} from "../../domain/workshopIntake";
import type { useWorkshopBoard } from "../useWorkshopBoard";
import { LocalPicker, MultiPicker, RemotePicker } from "./IntakePickers";
import { NewBranchSheet, NewContactSheet, NewCustomerSheet, NewEquipmentSheet } from "./CustomerForms";
import { Notice } from "../entry/EntrySections";
import { useAppPermission } from "../../application/appPermissions";

type Intake = ReturnType<typeof useWorkshopBoard>["intake"];
type Picker = "customer" | "equipment" | "area" | "branches" | "contacts" | "entryDate" | "deliveryDate" | "newCustomer" | "newBranch" | "newContact" | "newEquipment" | null;

interface Values {
  title: string; notes: string; isInternalEntry: boolean;
  customer: { id: number; name: string; document?: string | null } | null; equipment: WorkshopEquipmentOption | null;
  branchIds: number[]; contactIds: number[]; areaId: number | null; areaTitle: string | null;
  entryDate: string; entryTime: string; deliveryDate: string;
}

const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const prettyDate = (value: string) => value ? new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "";
const prettyDateTime = (iso: string | null) => iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "Sin fecha";
const emptyValues = (areaId: number | null, areaTitle: string | null): Values => {
  const now = new Date();
  return { title: "", notes: "", isInternalEntry: false, customer: null, equipment: null, branchIds: [], contactIds: [], areaId, areaTitle, entryDate: localDate(now), entryTime: localTime(now), deliveryDate: "" };
};
const hasContent = (values: Values) => Boolean(values.title.trim() || values.notes.trim() || values.customer || values.equipment);

function Section({ title, icon, children, hint }: { title: string; icon: React.ComponentProps<typeof Ionicons>["name"]; children: React.ReactNode; hint?: string }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={18} color={palette.primary} accessible={false} />
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
    </View>
    {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    {children}
  </View>;
}

/** Elegidos como etiquetas que se quitan con la "×", y un botón para agregar más desde la lista del cliente. */
function LinkList({ label, icon, addLabel, createLabel, items, disabled, onAdd, onCreate, onRemove }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; addLabel: string; createLabel: string; items: Array<{ id: number; name: string }>;
  disabled: boolean; onAdd: () => void; onCreate?: () => void; onRemove: (id: number) => void;
}) {
  // Como en la web: un campo que abre la lista (con los elegidos adentro) y, al lado, "+" para crear uno nuevo.
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.linkRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={addLabel} disabled={disabled} onPress={onAdd}
        style={({ pressed }) => [styles.linkInput, pressed && styles.linkAddPressed, disabled && styles.disabled]}>
        <View style={styles.linkChips}>
          {items.length === 0 ? <Text style={styles.linkPlaceholder} numberOfLines={1}>Seleccionar…</Text> : null}
          {items.map((item) => <View key={item.id} style={styles.linkChip}>
            <Ionicons name={icon} size={13} color={palette.primary} accessible={false} />
            <Text style={styles.linkChipText} numberOfLines={1}>{item.name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${item.name}`} disabled={disabled} hitSlop={8} onPress={() => onRemove(item.id)}>
              <Ionicons name="close" size={15} color={palette.textSecondary} accessible={false} />
            </Pressable>
          </View>)}
        </View>
        <Ionicons name="chevron-down" size={18} color={palette.primary} accessible={false} />
      </Pressable>
      {onCreate ? <Pressable accessibilityRole="button" accessibilityLabel={createLabel} disabled={disabled} onPress={onCreate}
        style={({ pressed }) => [styles.linkCreate, pressed && styles.linkAddPressed, disabled && styles.disabled]}>
        <Ionicons name="add" size={22} color={palette.text} accessible={false} />
      </Pressable> : null}
    </View>
  </View>;
}

/** Foto del equipo o sus iniciales (marca y modelo), como en la lista de equipos de la web. */
function EquipmentAvatar({ item }: { item: WorkshopEquipmentOption }) {
  const initials = (item.title || item.label).split(/[\s·]+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return <View style={styles.equipmentAvatar}>
    {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.equipmentAvatarImage} resizeMode="cover" accessible={false} />
      : <Text style={styles.equipmentAvatarText}>{initials || "EQ"}</Text>}
  </View>;
}

function TextField({ label, value, onChange, error, multiline, placeholder, maxLength, showCount }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; multiline?: boolean; placeholder?: string; maxLength: number;
  /** Muestra cuántos caracteres van de los permitidos. */
  showCount?: boolean;
}) {
  return <View style={styles.field}>
    <View style={styles.labelRow}>
      <Text style={[styles.label, styles.labelText]}>{label}</Text>
      {showCount ? <Text style={[styles.counter, value.length >= maxLength && styles.counterFull]} accessibilityLabel={`${value.length} de ${maxLength} caracteres`}>
        {value.length}/{maxLength}
      </Text> : null}
    </View>
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={palette.textMuted} maxLength={maxLength} multiline={multiline}
      style={[styles.input, multiline && styles.inputMultiline, Boolean(error) && styles.inputInvalid]} accessibilityLabel={label} textAlignVertical={multiline ? "top" : "center"} />
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </View>;
}

/** Paso 1 del ingreso: datos del equipo. Crea el ingreso o edita uno ya registrado. Solo con conexión. */
export function WorkshopIntakeScreen({ intake, workshopId, entryId: initialEntryId, areaId, areaTitle, onClose, onSaved, onContinue }: {
  intake: Intake; workshopId: number | null; entryId: number | null; areaId: number | null; areaTitle: string | null;
  /** `next`: seguir con la inspección (y la firma si falta) en vez de volver a la ficha. */
  onClose: () => void; onSaved: (entryId: number, next: boolean) => void;
  /** Ir a la inspección sin guardar (al editar un ingreso que no cambió). */
  onContinue?: (entryId: number) => void;
}) {
  const picker = useTrustedNativePicker();
  // La sucursal puede no permitir crear clientes, sucursales o contactos desde la app.
  const canCreateCustomers = useAppPermission("workshopCustomers");
  const [entryId, setEntryId] = useState(initialEntryId);
  const editing = entryId !== null;
  const [values, setValues] = useState<Values>(() => emptyValues(areaId, areaTitle));
  const [fixedDates, setFixedDates] = useState<{ entryAt: string | null; estimatedDeliveryAt: string | null } | null>(null);
  const [loading, setLoading] = useState(initialEntryId !== null);
  const [loadError, setLoadError] = useState("");
  const [customerDetail, setCustomerDetail] = useState<WorkshopCustomerDetail | null>(null);
  const [known, setKnown] = useState<{ branches: WorkshopBranchOption[]; contacts: WorkshopContact[] }>({ branches: [], contacts: [] });
  const [linksOpen, setLinksOpen] = useState(false);
  const [open, setOpen] = useState<Picker>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [image, setImage] = useState<{ preview: string; dataUri: string } | null>(null);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const update = (patch: Partial<Values>) => { setValues((current) => ({ ...current, ...patch })); setIssues({}); setMessage(""); };

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { if (!saving) close.current(); return true; });
    return () => subscription.remove();
  }, [saving]);

  // Editar: valores actuales del ingreso. Nuevo: borrador guardado en el teléfono, si quedó uno.
  async function loadForm() {
    if (initialEntryId === null) return;
    setLoading(true); setLoadError("");
    try {
      const form = await intake.form(initialEntryId);
      const entryAt = form.entryAt && Number.isFinite(Date.parse(form.entryAt)) ? new Date(form.entryAt) : new Date();
      setValues({ title: form.title, notes: form.notes ?? "", isInternalEntry: form.isInternalEntry, customer: form.customer, equipment: form.equipment,
        branchIds: form.branches.map((item) => item.id), contactIds: form.contacts.map((item) => item.id), areaId: form.operationAreaId, areaTitle: form.areaTitle,
        entryDate: localDate(entryAt), entryTime: localTime(entryAt), deliveryDate: "" });
      setKnown({ branches: form.branches, contacts: form.contacts });
      setLinksOpen(form.branches.length > 0 || form.contacts.length > 0);
      setFixedDates({ entryAt: form.entryAt, estimatedDeliveryAt: form.estimatedDeliveryAt });
      setCurrentImage(form.imageUrl);
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : "No se pudo cargar el ingreso.");
    } finally { setLoading(false); }
  }
  useEffect(() => {
    if (initialEntryId !== null) { void loadForm(); return; }
    let active = true;
    AsyncStorage.getItem(intake.draftKey).then((raw) => {
      if (!active || !raw) return;
      const draft = JSON.parse(raw) as { values?: Values; links?: boolean };
      if (draft.values && hasContent(draft.values)) {
        // La fecha de ingreso vuelve a ser ahora: un borrador de ayer no debe registrar la fecha de ayer.
        const now = new Date();
        setValues({ ...draft.values, entryDate: localDate(now), entryTime: localTime(now),
          areaId: areaId ?? draft.values.areaId, areaTitle: areaId !== null ? areaTitle : draft.values.areaTitle });
        setLinksOpen(draft.links === true);
        setDraftRestored(true);
      }
    }).catch(() => undefined).finally(() => { draftRead.current = true; });
    return () => { active = false; };
  }, []);
  const draftRead = useRef(false);
  useEffect(() => {
    if (editing) return;
    const timer = setTimeout(() => {
      if (hasContent(values)) void AsyncStorage.setItem(intake.draftKey, JSON.stringify({ values, links: linksOpen })).catch(() => undefined);
      // Si se vació todo, el borrador viejo no debe volver la próxima vez.
      else if (draftRead.current) void AsyncStorage.removeItem(intake.draftKey).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [values, linksOpen, editing]);

  // Sucursales y contactos del cliente elegido.
  useEffect(() => {
    setCustomerDetail(null);
    if (!values.customer || values.isInternalEntry) return;
    let active = true;
    intake.customer(values.customer.id).then((detail) => { if (active) setCustomerDetail(detail); }, () => undefined);
    return () => { active = false; };
  }, [values.customer?.id, values.isInternalEntry]);

  const branches = customerDetail?.branches ?? known.branches;
  const contacts = customerDetail?.contacts ?? known.contacts;

  async function chooseImage(source: "camera" | "library") {
    setMessage("");
    try {
      const uri = await pickAvatar(source, picker, () => true, { camera: "back" });
      if (!uri) return;
      setImageBusy(true);
      const dataUri = await squareJpeg(uri, 1280, WORKSHOP_IMAGE_MAX_BYTES);
      // La vista previa usa el archivo elegido: en Android una imagen en texto (base64) tan grande a veces no se dibuja.
      setImage({ preview: uri, dataUri });
      setImageFailed(false);
    } catch (failure) {
      setMessage(failure instanceof CameraPermissionError ? "La app no tiene permiso para usar la cámara. Actívalo en los ajustes del teléfono." : failure instanceof Error ? failure.message : "No se pudo preparar la foto.");
    } finally { setImageBusy(false); }
  }

  function buildInput(): WorkshopIntakeInput {
    const entryAt = new Date(`${values.entryDate}T${values.entryTime || "00:00"}:00`);
    const deliveryAt = values.deliveryDate ? new Date(`${values.deliveryDate}T18:00:00`) : null;
    return {
      companyBranchId: intake.branchId, requestId: "00000000-0000-4000-8000-000000000000", operationAreaId: values.areaId ?? 0,
      title: values.title.trim(), notes: values.notes.trim() || null, isInternalEntry: values.isInternalEntry,
      customerId: values.isInternalEntry ? null : values.customer?.id ?? null,
      customerEquipmentId: !values.isInternalEntry && values.equipment?.source === "customer" ? values.equipment.id : null,
      rentalEquipmentId: values.isInternalEntry && values.equipment?.source === "own" ? values.equipment.id : null,
      branchIds: values.isInternalEntry || !linksOpen ? [] : values.branchIds, contactIds: values.isInternalEntry || !linksOpen ? [] : values.contactIds,
      entryAt: Number.isFinite(entryAt.getTime()) ? entryAt.toISOString() : "", estimatedDeliveryAt: deliveryAt && Number.isFinite(deliveryAt.getTime()) ? deliveryAt.toISOString() : null
    };
  }

  async function uploadImage(savedId: number): Promise<boolean> {
    if (!image) return true;
    try {
      await intake.uploadImage(savedId, image.dataUri);
      setCurrentImage(image.preview); setImage(null); setImageFailed(false);
      return true;
    } catch {
      setImageFailed(true);
      return false;
    }
  }

  // Al editar: «Guardar y seguir» lleva a la inspección; «Guardar y volver» a la ficha. Un ingreso nuevo siempre sigue.
  const [next, setNext] = useState(true);
  async function save(continueFlow = true) {
    if (saving) return;
    setNext(continueFlow);
    const draft = buildInput();
    const found = workshopIntakeIssues(draft);
    if (!values.equipment) found.equipment = values.isInternalEntry ? "Elige el equipo propio." : "Elige el equipo del cliente.";
    if (Object.keys(found).length > 0) { setIssues(found); setMessage("Revisa los datos marcados."); return; }
    const fingerprint = JSON.stringify({ ...draft, entryId });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: Crypto.randomUUID() };
    setSaving(true); setMessage("");
    try {
      const input = { ...draft, requestId: attempt.current.requestId };
      const saved = entryId !== null ? await intake.update(entryId, input) : await intake.create(input);
      attempt.current = null;
      setEntryId(saved.id);
      if (!editing) await AsyncStorage.removeItem(intake.draftKey).catch(() => undefined);
      if (await uploadImage(saved.id)) onSaved(saved.id, continueFlow);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "No se pudo guardar el ingreso. Revisa tu conexión e inténtalo de nuevo.");
    } finally { setSaving(false); }
  }

  async function discardDraft() {
    await AsyncStorage.removeItem(intake.draftKey).catch(() => undefined);
    setValues(emptyValues(areaId, areaTitle)); setLinksOpen(false); setDraftRestored(false);
  }

  const shownImage = image?.preview ?? currentImage;
  const equipmentDisabled = !values.isInternalEntry && !values.customer;

  return <View style={styles.screen}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label="Cerrar formulario" disabled={saving} onPress={onClose} />
      <View style={styles.barText}>
        <Text style={styles.barTitle}>{editing ? "Editar ingreso" : "Nuevo ingreso"}</Text>
        <Text style={styles.barStep}>Paso 1 de 3 · Datos del equipo</Text>
      </View>
    </View>
    <View style={styles.progress}><View style={[styles.progressStep, styles.progressOn]} /><View style={styles.progressStep} /><View style={styles.progressStep} /></View>
    {loading ? <View style={styles.loading}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando el ingreso…</Text></View>
      : loadError ? <View style={styles.content}><Notice tone="danger" icon="cloud-offline-outline" message={loadError} /><Button title="Reintentar" icon="refresh" variant="secondary" onPress={() => void loadForm()} /></View>
      : <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {draftRestored ? <View style={styles.draft}>
            <Ionicons name="document-text-outline" size={18} color={palette.info} accessible={false} />
            <Text style={styles.draftText}>Recuperamos el ingreso que dejaste sin registrar.</Text>
            <Pressable accessibilityRole="button" onPress={() => void discardDraft()} hitSlop={8}><Text style={styles.draftAction}>Descartar</Text></Pressable>
          </View> : null}

          <Section title="Foto del equipo" icon="camera-outline">
            <View style={styles.photoRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={shownImage ? "Cambiar la foto del equipo con la cámara" : "Tomar la foto del equipo"}
                disabled={imageBusy || saving} onPress={() => void chooseImage("camera")}
                style={({ pressed }) => [styles.photo, !shownImage && styles.photoEmpty, pressed && styles.photoPressed]}>
                {imageBusy ? <ActivityIndicator color={palette.primary} />
                  : shownImage ? <>
                    <Image source={{ uri: shownImage }} style={styles.photoImage} resizeMode="cover" accessibilityLabel="Foto del equipo"
                      onError={() => { if (image && shownImage !== image.dataUri) setImage({ ...image, preview: image.dataUri }); }} />
                    <View style={styles.photoEdit}><Ionicons name="camera" size={14} color={palette.white} accessible={false} /></View>
                  </> : <>
                    <Ionicons name="camera-outline" size={28} color={palette.primary} accessible={false} />
                    <Text style={styles.photoEmptyText}>Agregar</Text>
                  </>}
              </Pressable>
              <View style={styles.photoActions}>
                {shownImage ? <View style={styles.photoStatus}>
                  <Ionicons name="checkmark-circle" size={16} color={palette.success} accessible={false} />
                  <Text style={styles.photoStatusText}>Foto lista</Text>
                </View> : <Text style={styles.photoTitle}>Foto principal del equipo</Text>}
                <Text style={styles.photoHint}>{shownImage ? "Se mostrará en el tablero y en la ficha del ingreso." : "Opcional. Ayuda a reconocer el equipo en el tablero."}</Text>
                <View style={styles.photoButtons}>
                  <Pressable accessibilityRole="button" disabled={imageBusy || saving} onPress={() => void chooseImage("camera")}
                    style={({ pressed }) => [styles.photoButton, styles.photoButtonPrimary, (imageBusy || saving) && styles.photoButtonDisabled, pressed && styles.photoPressed]}>
                    <Ionicons name="camera-outline" size={16} color={palette.white} accessible={false} />
                    <Text style={[styles.photoButtonText, styles.photoButtonTextPrimary]}>{shownImage ? "Cambiar" : "Cámara"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={imageBusy || saving} onPress={() => void chooseImage("library")}
                    style={({ pressed }) => [styles.photoButton, (imageBusy || saving) && styles.photoButtonDisabled, pressed && styles.photoPressed]}>
                    <Ionicons name="images-outline" size={16} color={palette.primary} accessible={false} />
                    <Text style={styles.photoButtonText}>Galería</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Section>

          <Section title="Datos del ingreso" icon="create-outline">
            <TextField label="Título (descripción breve) *" value={values.title} onChange={(title) => update({ title })} error={issues.title} maxLength={255} showCount placeholder="Ej.: Reparación de bomba con fuga" />
            <TextField label="Observaciones" value={values.notes} onChange={(notes) => update({ notes })} error={issues.notes} multiline maxLength={2000} showCount placeholder="Estado en que llega el equipo, accesorios, etc." />
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>Equipo propio de la empresa</Text>
                <Text style={styles.hint}>Actívalo si el equipo no es de un cliente.</Text>
              </View>
              <Switch value={values.isInternalEntry} onValueChange={(isInternalEntry) => update({ isInternalEntry, customer: null, equipment: null, branchIds: [], contactIds: [] })}
                trackColor={{ true: palette.primary, false: palette.track }} accessibilityLabel="Equipo propio de la empresa" />
            </View>
          </Section>

          {!values.isInternalEntry ? <Section title="Cliente" icon="person-outline">
            <View style={styles.customerRow}>
              <SelectorTrigger label="Cliente *" value={values.customer?.name ?? ""}
                detail={values.customer ? (customerDetail?.id === values.customer.id ? customerDetail.document : null) ?? values.customer.document ?? null : null} icon="chevron-down" disabled={saving} error={issues.customerId} onPress={() => setOpen("customer")}
                containerStyle={styles.grow} />
              {canCreateCustomers ? <Pressable accessibilityRole="button" accessibilityLabel="Nuevo cliente" disabled={saving} onPress={() => setOpen("newCustomer")}
                style={({ pressed }) => [styles.linkCreate, styles.customerCreate, pressed && styles.linkAddPressed]}>
                <Ionicons name="add" size={22} color={palette.text} accessible={false} />
              </Pressable> : null}
            </View>
            {values.customer ? <View style={styles.switchRow}>
              <View style={styles.switchText}><Text style={styles.label}>Agregar sucursal y contactos</Text><Text style={styles.hint}>A quién avisar de este ingreso.</Text></View>
              <Switch value={linksOpen} onValueChange={(next) => { setLinksOpen(next); if (!next) update({ branchIds: [], contactIds: [] }); }}
                trackColor={{ true: palette.primary, false: palette.track }} accessibilityLabel="Agregar sucursal y contactos" />
            </View> : null}
            {values.customer && linksOpen ? <>
              <LinkList label="Sucursales del cliente" icon="business-outline" addLabel="Agregar sucursal" disabled={saving} createLabel="Nueva sucursal"
                items={values.branchIds.map((id) => ({ id, name: branches.find((item) => item.id === id)?.name ?? `Sucursal ${id}` }))}
                onAdd={() => setOpen("branches")} onCreate={canCreateCustomers ? () => setOpen("newBranch") : undefined} onRemove={(id) => update({ branchIds: values.branchIds.filter((value) => value !== id) })} />
              <LinkList label="Contactos" icon="person-outline" addLabel="Agregar contacto" disabled={saving} createLabel="Nuevo contacto"
                items={values.contactIds.map((id) => ({ id, name: contacts.find((item) => item.id === id)?.fullName ?? `Contacto ${id}` }))}
                onAdd={() => setOpen("contacts")} onCreate={canCreateCustomers ? () => setOpen("newContact") : undefined} onRemove={(id) => update({ contactIds: values.contactIds.filter((value) => value !== id) })} />
            </> : null}
          </Section> : null}

          <Section title="Equipo" icon="construct-outline">
            <Pressable accessibilityRole="button" accessibilityLabel={`Equipo: ${values.equipment?.label ?? "sin elegir"}`} disabled={equipmentDisabled || saving}
              onPress={() => setOpen("equipment")} style={[styles.equipment, Boolean(issues.equipment) && styles.inputInvalid, equipmentDisabled && styles.disabled]}>
              <View style={styles.equipmentIcon}>
                {values.equipment?.imageUrl ? <Image source={{ uri: values.equipment.imageUrl }} style={styles.equipmentImage} accessible={false} />
                  : <Ionicons name="construct-outline" size={22} color={palette.primary} accessible={false} />}
              </View>
              <View style={styles.equipmentText}>
                <Text style={styles.equipmentLabel} numberOfLines={2}>{values.equipment?.label ?? (equipmentDisabled ? "Primero elige el cliente" : values.isInternalEntry ? "Elegir equipo propio" : "Elegir equipo del cliente")}</Text>
                {values.equipment ? <Text style={styles.hint} numberOfLines={1}>{[values.equipment.code, values.equipment.detail].filter(Boolean).join(" · ") || "Sin identificación"}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={20} color={palette.textMuted} accessible={false} />
            </Pressable>
            {values.equipment ? <View style={styles.equipmentActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Cambiar equipo" disabled={saving} hitSlop={6} onPress={() => setOpen("equipment")} style={styles.textAction}>
                <Ionicons name="swap-horizontal" size={16} color={palette.primary} accessible={false} />
                <Text style={styles.textActionLabel}>Cambiar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Quitar equipo" disabled={saving} hitSlop={6} onPress={() => update({ equipment: null })} style={styles.textAction}>
                <Ionicons name="trash-outline" size={16} color={palette.danger} accessible={false} />
                <Text style={[styles.textActionLabel, styles.textActionDanger]}>Quitar</Text>
              </Pressable>
            </View> : null}
            {issues.equipment ? <Text style={styles.error} accessibilityRole="alert">{issues.equipment}</Text> : null}
          </Section>

          <Section title="Nave y fechas" icon="business-outline">
            <SelectorTrigger label="Nave *" value={values.areaTitle ?? ""} icon="chevron-down" disabled={saving || workshopId === null} error={issues.operationAreaId}
              hint={editing ? "Cambiar la nave mueve el equipo." : "Solo aparecen las naves con espacio."} onPress={() => setOpen("area")} />
            {editing && fixedDates ? <View style={styles.fixed}>
              <Text style={styles.hint}>Ingresó: {prettyDateTime(fixedDates.entryAt)}</Text>
              <Text style={styles.hint}>Entrega estimada: {prettyDateTime(fixedDates.estimatedDeliveryAt)}</Text>
              <Text style={styles.hint}>Las fechas se cambian desde la ficha del ingreso.</Text>
            </View> : <>
              <View style={styles.row}>
                <SelectorTrigger label="Fecha de ingreso" value={prettyDate(values.entryDate)} icon="calendar-outline" disabled={saving} error={issues.entryAt}
                  containerStyle={styles.grow} onPress={() => setOpen("entryDate")} />
                <TimeField label="Hora" value={values.entryTime} scopeKey={`workshop-intake-${intake.draftKey}`} disabled={saving}
                  containerStyle={styles.time} onChange={(entryTime) => update({ entryTime })} />
              </View>
              <SelectorTrigger label="Entrega estimada" value={prettyDate(values.deliveryDate)} icon="calendar-outline" disabled={saving} error={issues.estimatedDeliveryAt}
                hint="Opcional." onPress={() => setOpen("deliveryDate")} />
              {values.deliveryDate ? <Pressable accessibilityRole="button" onPress={() => update({ deliveryDate: "" })} hitSlop={8}><Text style={styles.link}>Quitar fecha de entrega</Text></Pressable> : null}
            </>}
          </Section>

          {imageFailed && entryId !== null ? <View style={styles.block}>
            <Notice tone="warning" icon="image-outline" message="El ingreso quedó guardado, pero la foto no se pudo subir." />
            <Button title="Reintentar foto" icon="refresh" variant="secondary" loading={saving} onPress={() => { setSaving(true); void uploadImage(entryId).then((ok) => { setSaving(false); if (ok) onSaved(entryId, next); }); }} />
            <Button title="Continuar sin foto" variant="ghost" disabled={saving} onPress={() => onSaved(entryId, next)} />
          </View> : null}
          {message ? <Notice tone="danger" icon="alert-circle-outline" message={message} /> : null}
          {!imageFailed && !editing ? <Button title="Registrar ingreso" icon="checkmark-circle-outline" loading={saving} disabled={saving} onPress={() => void save()} /> : null}
          {!imageFailed && editing ? <View style={styles.block}>
            <Button title="Guardar y seguir a la inspección" icon="arrow-forward-circle-outline" loading={saving && next} disabled={saving} onPress={() => void save(true)} />
            <Button title="Guardar y volver al ingreso" icon="save-outline" variant="secondary" loading={saving && !next} disabled={saving} onPress={() => void save(false)} />
            {onContinue && entryId !== null ? <Button title="Ir a la inspección sin guardar" icon="clipboard-outline" variant="ghost" disabled={saving} onPress={() => onContinue(entryId)} /> : null}
            <Text style={styles.footnote}>Los pasos son: datos del equipo, inspección de ingreso y firma de recepción.</Text>
          </View> : null}
          {!editing ? <Text style={styles.footnote}>Después de registrar sigue la inspección y la firma de recepción.</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>}

    {open === "customer" ? <RemotePicker<WorkshopCustomerOption> title="Elegir cliente" placeholder="Buscar por nombre o RUT" emptyText="No hay clientes registrados."
      load={(search, page) => intake.customers(search, page)} label={(item) => item.name} detail={(item) => item.document}
      selectedId={values.customer?.id ?? null} onClose={() => setOpen(null)} action={canCreateCustomers ? { label: "Nuevo cliente", onPress: () => setOpen("newCustomer") } : undefined}
      onPick={(item) => { setOpen(null); if (item.id !== values.customer?.id) update({ customer: { id: item.id, name: item.name, document: item.document }, equipment: null, branchIds: [], contactIds: [] }); }} /> : null}
    {open === "equipment" ? <RemotePicker<WorkshopEquipmentOption> title={values.isInternalEntry ? "Equipo propio" : `Equipos de ${values.customer?.name ?? "cliente"}`}
      placeholder="Buscar por marca, modelo o identificación" emptyText={values.isInternalEntry ? "No hay equipos propios disponibles." : "Este cliente no tiene equipos registrados."}
      load={(search, page) => intake.equipment({ source: values.isInternalEntry ? "own" : "customer", customerId: values.customer?.id, search: search || undefined, page })}
      label={(item) => item.title || item.label}
      detail={(item) => item.title ? [item.typeName, item.year, item.color].filter(Boolean).join(" · ") || null : [item.code, item.detail].filter(Boolean).join(" · ") || null}
      leading={(item) => <EquipmentAvatar item={item} />}
      extra={(item) => item.identification || item.internalNumber ? <Text style={styles.equipmentCodes} numberOfLines={1}>
        # {[item.identification, item.internalNumber].filter(Boolean).join(" / ")}</Text> : null}
      action={!values.isInternalEntry && values.customer && canCreateCustomers ? { label: "Nuevo equipo", onPress: () => setOpen("newEquipment") } : undefined}
      selectedId={values.equipment?.id ?? null} onClose={() => setOpen(null)} onPick={(equipment) => { setOpen(null); update({ equipment }); }} /> : null}
    {open === "newEquipment" && values.customer ? <NewEquipmentSheet customerName={values.customer.name} onClose={() => setOpen("equipment")}
      loadMasters={() => intake.equipmentMasters()} create={(input) => intake.createEquipment(values.customer!.id, input)}
      findDuplicates={(identification, internalNumber) => intake.equipmentDuplicates({ customerId: values.customer!.id, identification, internalNumber })}
      createMaster={intake.canCreateEquipmentMaster ? (kind, name, requestId) => intake.createEquipmentMaster(kind, { name, requestId }) : undefined}
      onCreated={(equipment) => { setOpen(null); update({ equipment }); }} /> : null}
    {open === "area" && workshopId !== null ? <LocalPicker<{ id: number; title: string }> title="Elegir nave" placeholder="Buscar nave" emptyText="No hay naves con espacio en este taller."
      load={async () => (await intake.areas(workshopId)).items} label={(item) => item.title} selectedId={values.areaId} onClose={() => setOpen(null)}
      onPick={(area) => { setOpen(null); update({ areaId: area.id, areaTitle: area.title }); }} /> : null}
    {open === "branches" ? <MultiPicker<WorkshopBranchOption> title="Sucursales del cliente" items={branches} label={(item) => item.name} selected={values.branchIds}
      emptyText="El cliente no tiene sucursales registradas." onClose={() => setOpen(null)} onConfirm={(branchIds) => { setOpen(null); update({ branchIds }); }}
      action={canCreateCustomers ? { label: "Nueva sucursal", onPress: () => setOpen("newBranch") } : undefined} /> : null}
    {open === "contacts" ? <MultiPicker<WorkshopContact> title="Contactos del cliente" items={contacts} label={(item) => item.fullName}
      detail={(item) => [item.position, item.email, item.phone].filter(Boolean).join(" · ") || null} selected={values.contactIds}
      emptyText="El cliente no tiene contactos registrados." onClose={() => setOpen(null)} onConfirm={(contactIds) => { setOpen(null); update({ contactIds }); }}
      action={canCreateCustomers ? { label: "Nuevo contacto", onPress: () => setOpen("newContact") } : undefined} /> : null}
    {open === "newCustomer" ? <NewCustomerSheet loadTypes={intake.identificationTypes} create={intake.createCustomer} findDuplicates={intake.customerDuplicates} onClose={() => setOpen("customer")}
      onCreated={(customer) => { setOpen(null); update({ customer: { id: customer.id, name: customer.name, document: customer.document }, equipment: null, branchIds: [], contactIds: [] }); }} /> : null}
    {open === "newBranch" && values.customer ? <NewBranchSheet customerName={values.customer.name} onClose={() => setOpen(null)}
      create={(input) => intake.createBranch(values.customer!.id, input)}
      findDuplicates={(query) => intake.branchDuplicates(values.customer!.id, query)}
      onUseExisting={(branch) => {
        setOpen(null);
        setKnown((current) => current.branches.some((item) => item.id === branch.id) ? current : { ...current, branches: [...current.branches, branch] });
        if (!values.branchIds.includes(branch.id)) update({ branchIds: [...values.branchIds, branch.id] });
      }}
      onCreated={(branch) => {
        setOpen(null);
        setCustomerDetail((detail) => detail && { ...detail, branches: [...detail.branches, branch] });
        setKnown((current) => ({ ...current, branches: [...current.branches, branch] }));
        update({ branchIds: [...values.branchIds, branch.id] });
      }} /> : null}
    {open === "newContact" && values.customer ? <NewContactSheet customerName={values.customer.name} onClose={() => setOpen(null)}
      create={(input) => intake.createContact(values.customer!.id, input)}
      findDuplicates={(query) => intake.contactDuplicates(values.customer!.id, query)}
      onUseExisting={(contact) => {
        setOpen(null);
        setKnown((current) => current.contacts.some((item) => item.id === contact.id) ? current : { ...current, contacts: [...current.contacts, contact] });
        if (!values.contactIds.includes(contact.id)) update({ contactIds: [...values.contactIds, contact.id] });
      }}
      onCreated={(contact) => {
        setOpen(null);
        setCustomerDetail((detail) => detail && { ...detail, contacts: [...detail.contacts, contact] });
        setKnown((current) => ({ ...current, contacts: [...current.contacts, contact] }));
        update({ contactIds: [...values.contactIds, contact.id] });
      }} /> : null}
    {open === "entryDate" ? <CreationDatePicker value={values.entryDate} showInputHint={false} onClose={() => setOpen(null)} onChange={(entryDate) => update({ entryDate })} /> : null}
    {open === "deliveryDate" ? <CreationDatePicker value={values.deliveryDate || values.entryDate} showInputHint={false} onClose={() => setOpen(null)} onChange={(deliveryDate) => update({ deliveryDate })} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  equipmentAvatar: { width: 48, height: 48, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  equipmentAvatarImage: { width: 48, height: 48 },
  equipmentAvatarText: { fontSize: 14, fontWeight: "800", color: palette.white },
  equipmentCodes: { fontSize: 12, fontWeight: "700", color: palette.textSecondary, marginTop: 2 },
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  barStep: { ...typography.caption, color: palette.textSecondary },
  progress: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  progressStep: { flex: 1, height: 4, borderRadius: 2, backgroundColor: palette.track },
  progressOn: { backgroundColor: palette.primary },
  loading: { alignItems: "center", gap: 8, paddingVertical: 40 },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 14, paddingBottom: 40 },
  draft: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: palette.infoSoft },
  draftText: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" },
  draftAction: { fontSize: 13, fontWeight: "800", color: palette.info },
  section: { gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: palette.heading },
  sectionHint: { ...typography.caption, color: palette.textSecondary, marginTop: -6 },
  field: { gap: 6 },
  label: { ...typography.label, color: palette.text },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  labelText: { flex: 1, minWidth: 0 },
  counter: { ...typography.caption, color: palette.textMuted, fontVariant: ["tabular-nums"] },
  counterFull: { color: palette.danger, fontWeight: "800" },
  input: { minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  inputMultiline: { minHeight: 96, paddingTop: 12 },
  inputInvalid: { borderColor: palette.danger },
  error: { ...typography.caption, color: palette.danger },
  hint: { ...typography.caption, color: palette.textSecondary },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchText: { flex: 1, gap: 2 },
  photoRow: { flexDirection: "row", gap: 14, alignItems: "center" },
  photo: { width: 104, height: 104, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  photoImage: { width: 104, height: 104 },
  photoActions: { flex: 1, gap: 6 },
  photoEmpty: { borderWidth: 1.5, borderStyle: "dashed", borderColor: palette.primary, backgroundColor: palette.primarySoft, gap: 4 },
  photoEmptyText: { fontSize: 12, fontWeight: "700", color: palette.primary },
  photoPressed: { opacity: 0.75 },
  photoEdit: { position: "absolute", right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  photoTitle: { fontSize: 14, fontWeight: "700", color: palette.text },
  photoStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  photoStatusText: { fontSize: 14, fontWeight: "700", color: palette.success },
  photoHint: { fontSize: 12, lineHeight: 16, color: palette.textMuted },
  photoButtons: { flexDirection: "row", gap: 8, marginTop: 4 },
  photoButton: { flex: 1, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 999, borderWidth: 1, borderColor: palette.primary, paddingHorizontal: 10 },
  photoButtonPrimary: { backgroundColor: palette.primary },
  photoButtonDisabled: { opacity: 0.5 },
  photoButtonText: { fontSize: 13, fontWeight: "700", color: palette.primary },
  photoButtonTextPrimary: { color: palette.white },
  equipment: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  linkRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  customerRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  customerCreate: { marginTop: 26, height: 52 },
  linkInput: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  linkChips: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  linkPlaceholder: { fontSize: 15, color: palette.textMuted, paddingHorizontal: 2 },
  linkChip: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%", minHeight: 30, paddingLeft: 8, paddingRight: 6, borderRadius: 8, backgroundColor: palette.primarySoft, borderWidth: 1, borderColor: palette.primaryBorder },
  linkChipText: { flexShrink: 1, fontSize: 13, fontWeight: "700", color: palette.text },
  linkAddPressed: { opacity: 0.7 },
  linkCreate: { width: 52, minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  equipmentActions: { flexDirection: "row", justifyContent: "flex-end", gap: 18 },
  textAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  textActionLabel: { fontSize: 13, fontWeight: "800", color: palette.primary },
  textActionDanger: { color: palette.danger },
  equipmentIcon: { width: 44, height: 44, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  equipmentImage: { width: 44, height: 44 },
  equipmentText: { flex: 1, minWidth: 0, gap: 2 },
  equipmentLabel: { fontSize: 15, fontWeight: "700", color: palette.text },
  disabled: { opacity: 0.55 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  grow: { flex: 1 },
  time: { width: 120 },
  fixed: { gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: palette.background },
  link: { fontSize: 13, fontWeight: "700", color: palette.primary },
  block: { gap: 10 },
  footnote: { ...typography.caption, color: palette.textSecondary, textAlign: "center" }
});
