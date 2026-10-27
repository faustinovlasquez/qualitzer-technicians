import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Crypto from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { DUPLICATE_REASON_LABELS, EQUIPMENT_DUPLICATE_REASON_LABELS, EQUIPMENT_IDENTIFICATION_TYPES, findSimilarMasters, type WorkshopEquipmentDuplicate, cleanRut, formatRut, isValidContactEmail, isValidPhone, isValidRut, type WorkshopDuplicateMatch, type WorkshopEquipmentMasters,
  type WorkshopIdentificationTypes, type WorkshopNewBranch, type WorkshopNewContact, type WorkshopNewCustomer, type WorkshopNewEquipment } from "../../domain/workshopCustomers";
import type { WorkshopBranchOption, WorkshopContact, WorkshopCustomerOption, WorkshopEquipmentOption } from "../../domain/workshopIntake";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { LocalPicker, PickerSheet } from "./IntakePickers";
import { GoogleMap } from "../../location/GoogleMap";
import type { GoogleMapPoint } from "../../location/googleMapProtocol";
import { requestEquipmentPosition } from "../../location/equipmentPosition";
import type { EquipmentAddress } from "../../domain/equipmentLocation";
import { useTrustedNativePicker } from "../../security/useTrustedNativePicker";

const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

function Field({ label, value, onChange, error, placeholder, multiline, maxLength, keyboardType, autoCapitalize }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; placeholder?: string; multiline?: boolean; maxLength: number;
  keyboardType?: "default" | "email-address" | "phone-pad"; autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={palette.textMuted} maxLength={maxLength} multiline={multiline}
      keyboardType={keyboardType} autoCapitalize={autoCapitalize} autoCorrect={false} accessibilityLabel={label.replace(" *", "")}
      style={[styles.input, multiline && styles.multiline, Boolean(error) && styles.inputInvalid]} textAlignVertical={multiline ? "top" : "center"} />
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </View>;
}

function Choice<T extends string | number>({ label, options, value, onChange }: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.chips}>{options.map((option) => <Pressable key={String(option.value)} accessibilityRole="radio" accessibilityState={{ checked: value === option.value }}
      onPress={() => onChange(option.value)} style={[styles.chip, value === option.value && styles.chipOn]}>
      <Text style={[styles.chipText, value === option.value && styles.chipTextOn]}>{option.label}</Text>
    </Pressable>)}</View>
  </View>;
}

/** Guarda con un identificador de intento: si se reintenta con los mismos datos no se duplica. */
function useSave<T>(save: (requestId: string) => Promise<T>, onDone: (result: T) => void, fallback: string) {
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function run(fingerprint: string) {
    if (saving) return;
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: Crypto.randomUUID() };
    setSaving(true); setError("");
    try { const result = await save(attempt.current.requestId); attempt.current = null; onDone(result); }
    catch (failure) { setError(failureText(failure, fallback)); }
    finally { setSaving(false); }
  }
  return { saving, error, run };
}

/**
 * Aviso de posibles duplicados antes de crear: muestra los parecidos que ya existen y permite usar uno o crear igual.
 * Si alguno es casi seguro el mismo (RUT, correo o teléfono), crear de todos modos pide una confirmación extra.
 */
function DuplicateDialog({ what, matches, onUse, onCreate, onClose }: {
  what: "cliente" | "sucursal" | "contacto"; matches: WorkshopDuplicateMatch[];
  onUse: (match: WorkshopDuplicateMatch) => void; onCreate: () => void; onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const strong = matches.some((match) => match.strength === "strong");
  const article = what === "sucursal" ? "una" : "un";
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.dialog}>
        <View style={styles.dialogHead}>
          <Ionicons name="copy-outline" size={20} color={palette.orange} accessible={false} />
          <Text style={styles.dialogTitle} accessibilityRole="header">Ya existe {article} {what} parecid{what === "sucursal" ? "a" : "o"}</Text>
        </View>
        <Text style={styles.hint}>Para no duplicar datos, revisa si es {what === "sucursal" ? "alguna" : "alguno"} de {what === "sucursal" ? "estas" : "estos"}:</Text>
        <ScrollView style={styles.matchList} contentContainerStyle={styles.matchListContent}>
          {matches.map((match) => <View key={match.id} style={[styles.match, match.strength === "strong" && styles.matchStrong]}>
            <View style={styles.grow}>
              <Text style={styles.matchName} numberOfLines={2}>{match.name}</Text>
              {match.detail ? <Text style={styles.hint} numberOfLines={1}>{match.detail}</Text> : null}
              <View style={styles.reasons}>{match.reasons.map((reason) => <Text key={reason}
                style={[styles.reason, match.strength === "strong" ? styles.reasonStrong : styles.reasonPossible]}>{DUPLICATE_REASON_LABELS[reason]}</Text>)}</View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${match.name}`} onPress={() => onUse(match)} style={({ pressed }) => [styles.useButton, pressed && styles.pressed]}>
              <Text style={styles.useText}>Usar este</Text>
            </Pressable>
          </View>)}
        </ScrollView>
        {confirming ? <Text style={styles.confirmText} accessibilityRole="alert">
          Hay {article} {what} con datos iguales. ¿Seguro que quieres crear otr{what === "sucursal" ? "a" : "o"}?
        </Text> : null}
        <View style={styles.actions}>
          <View style={styles.grow}><Button title="Volver" variant="secondary" onPress={onClose} /></View>
          <View style={styles.grow}><Button title={confirming ? "Sí, crear igual" : "Crear de todos modos"} variant={confirming ? "danger" : "secondary"}
            onPress={() => { if (strong && !confirming) setConfirming(true); else onCreate(); }} /></View>
        </View>
      </View>
    </View>
  </Modal>;
}

/** Busca parecidos antes de guardar: si hay, abre el aviso; si no (o la búsqueda falla), guarda directo. */
function useDuplicateCheck(find: () => Promise<WorkshopDuplicateMatch[]>, create: () => void) {
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState<WorkshopDuplicateMatch[] | null>(null);
  async function check() {
    if (checking) return;
    setChecking(true);
    try {
      const found = await find().catch(() => []);
      if (found.length > 0) setMatches(found); else create();
    } finally { setChecking(false); }
  }
  return { checking, matches, check, dismiss: () => setMatches(null) };
}

function FormSheet({ title, saving, error, onSave, onClose, children }: { title: string; saving: boolean; error: string; onSave: () => void; onClose: () => void; children: ReactNode }) {
  return <PickerSheet title={title} onClose={saving ? () => undefined : onClose}
    footer={<View style={styles.footer}>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.actions}>
        <View style={styles.grow}><Button title="Cancelar" variant="secondary" disabled={saving} onPress={onClose} /></View>
        <View style={styles.grow}><Button title="Guardar" icon="checkmark" loading={saving} disabled={saving} onPress={onSave} /></View>
      </View>
    </View>}>
    {children}
  </PickerSheet>;
}

/** Nuevo cliente: mismos campos y validación de RUT que el formulario rápido de la web. */
export function NewCustomerSheet({ loadTypes, create, findDuplicates, onCreated, onClose }: {
  loadTypes: () => Promise<WorkshopIdentificationTypes>; create: (input: Omit<WorkshopNewCustomer, "companyBranchId">) => Promise<WorkshopCustomerOption>;
  findDuplicates?: (query: { documentIdentification: string | null; name: string | null; fantasyName: string | null }) => Promise<WorkshopDuplicateMatch[]>;
  onCreated: (customer: WorkshopCustomerOption) => void; onClose: () => void;
}) {
  const [types, setTypes] = useState<WorkshopIdentificationTypes["items"] | null>(null);
  const [typesError, setTypesError] = useState("");
  const [customerType, setCustomerType] = useState<"company" | "person" | "consignment">("company");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [fantasyName, setFantasyName] = useState("");
  const [activity, setActivity] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const loader = useRef(loadTypes);
  loader.current = loadTypes;
  const fetchTypes = () => { setTypesError(""); loader.current().then(({ items }) => { setTypes(items); setTypeId((current) => current ?? (items.find((item) => item.isRut) ?? items[0])?.id ?? null); },
    (failure: unknown) => setTypesError(failureText(failure, "No se pudieron cargar los tipos de identificación."))); };
  useEffect(fetchTypes, []);
  const isRut = types?.find((item) => item.id === typeId)?.isRut ?? false;
  const { saving, error, run } = useSave((requestId) => create({ requestId, customerType, identificationTypeId: typeId!, number: !number.trim() ? null : isRut ? formatRut(number) : number.trim(),
    name: name.trim(), fantasyName: fantasyName.trim() || null, businessActivity: activity.trim() || null }), onCreated, "No se pudo crear el cliente.");
  const createNow = () => void run(JSON.stringify([customerType, typeId, number, name, fantasyName, activity]));
  const duplicates = useDuplicateCheck(async () => findDuplicates ? findDuplicates({
    documentIdentification: number.trim() || null, name: name.trim() || null, fantasyName: fantasyName.trim() || null
  }) : [], createNow);
  function save() {
    const found: Record<string, string> = {};
    if (typeId === null) found.type = "Elige el tipo de identificación.";
    if (number.trim() && isRut && !isValidRut(number)) found.number = "El RUT no es válido. Revisa el número y el dígito verificador.";
    if (!name.trim()) found.name = customerType === "person" ? "Escribe el nombre." : "Escribe la razón social.";
    setIssues(found);
    if (Object.keys(found).length === 0) void duplicates.check();
  }
  return <FormSheet title="Nuevo cliente" saving={saving || duplicates.checking} error={error} onSave={save} onClose={onClose}>
    {duplicates.matches ? <DuplicateDialog what="cliente" matches={duplicates.matches} onClose={duplicates.dismiss}
      onUse={(match) => { duplicates.dismiss(); onCreated({ id: match.id, name: match.name, document: match.detail }); }}
      onCreate={() => { duplicates.dismiss(); createNow(); }} /> : null}
    <Choice label="Tipo de cliente *" value={customerType} onChange={setCustomerType}
      options={[{ value: "company", label: "Empresa" }, { value: "person", label: "Persona" }, { value: "consignment", label: "Consignado" }]} />
    {!types && !typesError ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando tipos de identificación…</Text></View> : null}
    {typesError ? <View style={styles.field}><Text style={styles.error}>{typesError}</Text><Button title="Reintentar" variant="secondary" icon="refresh" onPress={fetchTypes} /></View> : null}
    {types && typeId !== null ? <Choice label="Tipo de identificación *" value={typeId} onChange={(value) => { setTypeId(value); setIssues({}); }}
      options={types.map((item) => ({ value: item.id, label: item.label }))} /> : null}
    <Field label="Número de identificación" value={number} onChange={(value) => { setNumber(isRut ? formatRut(value).slice(0, 12) : value); setIssues(({ number: _, ...rest }) => rest); }} error={issues.number}
      placeholder={isRut ? "76.123.456-7" : "Número"} maxLength={isRut ? 12 : 30} autoCapitalize="characters" />
    {isRut && number && !isValidRut(number) && cleanRut(number).length >= 8 ? <Text style={styles.error}>El dígito verificador no coincide. Revisa el RUT.</Text> : null}
    <Field label={customerType === "person" ? "Nombre completo *" : "Razón social *"} value={name} onChange={(value) => { setName(value); setIssues(({ name: _, ...rest }) => rest); }} error={issues.name} maxLength={255} autoCapitalize="words" />
    <Field label="Nombre de fantasía" value={fantasyName} onChange={setFantasyName} placeholder="Ingrese el nombre de fantasía" maxLength={255} />
    <Field label="Giro" value={activity} onChange={setActivity} maxLength={255} />
  </FormSheet>;
}

/** Nueva sucursal del cliente, con su dirección escrita (sin mapa). */
export function NewBranchSheet({ customerName, create, findDuplicates, onCreated, onUseExisting, onClose }: {
  customerName: string; create: (input: Omit<WorkshopNewBranch, "companyBranchId">) => Promise<WorkshopBranchOption>;
  findDuplicates?: (query: { name: string | null; address: string | null }) => Promise<WorkshopDuplicateMatch[]>;
  onCreated: (branch: WorkshopBranchOption) => void; onUseExisting?: (branch: WorkshopBranchOption) => void; onClose: () => void;
}) {
  const [values, setValues] = useState({ name: "", contactName: "", address: "", apartment: "", noStreetNumber: false, region: "", county: "", city: "", country: "", postalCode: "" });
  // Punto del mapa de Google (igual que la web): se completa la dirección al buscar o tocar el mapa.
  const [point, setPoint] = useState<GoogleMapPoint | null>(null);
  const [selection, setSelection] = useState<GoogleMapPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const runNativePicker = useTrustedNativePicker();
  const [issues, setIssues] = useState<Record<string, string>>({});
  const set = (patch: Partial<typeof values>) => { setValues((current) => ({ ...current, ...patch })); setIssues({}); };
  const blank = (value: string) => value.trim() || null;
  const fromMap = (address: EquipmentAddress) => {
    set({ address: address.address, region: address.region, county: address.county, city: address.city, country: address.country, postalCode: address.postalCode });
    if (address.lat !== null && address.lon !== null) setPoint({ lat: Number(address.lat), lng: Number(address.lon) });
  };
  async function locate() {
    if (locating) return;
    setLocating(true); setLocateError("");
    try { const position = await runNativePicker(requestEquipmentPosition); setSelection(position); setPoint(position); }
    catch (failure) { setLocateError(failureText(failure, "No se pudo obtener tu posición.")); }
    finally { setLocating(false); }
  }
  const { saving, error, run } = useSave((requestId) => create({ requestId, name: values.name.trim(), contactName: blank(values.contactName), address: blank(values.address),
    apartment: blank(values.apartment), noStreetNumber: values.noStreetNumber, region: blank(values.region), county: blank(values.county), city: blank(values.city),
    country: blank(values.country), postalCode: blank(values.postalCode),
    lat: point ? point.lat.toFixed(7) : null, lon: point ? point.lng.toFixed(7) : null }), onCreated, "No se pudo crear la sucursal.");
  const createNow = () => void run(JSON.stringify(values));
  const duplicates = useDuplicateCheck(async () => findDuplicates ? findDuplicates({ name: blank(values.name), address: blank(values.address) }) : [], createNow);
  function save() {
    const found: Record<string, string> = values.name.trim() ? {} : { name: "Escribe el nombre de la sucursal." };
    setIssues(found);
    if (!found.name) void duplicates.check();
  }
  return <FormSheet title="Nueva sucursal" saving={saving || duplicates.checking} error={error} onSave={save} onClose={onClose}>
    {duplicates.matches ? <DuplicateDialog what="sucursal" matches={duplicates.matches} onClose={duplicates.dismiss}
      onUse={(match) => { duplicates.dismiss(); (onUseExisting ?? onCreated)({ id: match.id, name: match.name }); }}
      onCreate={() => { duplicates.dismiss(); createNow(); }} /> : null}
    <Text style={styles.hint}>Cliente: {customerName}</Text>
    <Field label="Nombre *" value={values.name} onChange={(name) => set({ name })} error={issues.name} maxLength={255} placeholder="Ej.: Planta Lampa" />
    <Field label="Contacto" value={values.contactName} onChange={(contactName) => set({ contactName })} maxLength={255} placeholder="Persona de referencia" autoCapitalize="words" />
    {/* Igual que la web: mapa con buscador y solo calle, departamento, región y comuna (ciudad, país y código postal salen del mapa). */}
    <Text style={styles.section}>Dirección</Text>
    <GoogleMap point={point} selection={selection} editable disabled={saving}
      onPoint={(next) => setPoint(next)} onAddress={fromMap} />
    <Button title="Usar mi ubicación" icon="locate-outline" variant="secondary" loading={locating} disabled={saving || locating} onPress={() => void locate()} />
    <Text style={styles.hint}>Busca una dirección o toca el mapa.</Text>
    {locateError ? <Text style={styles.error} accessibilityRole="alert">{locateError}</Text> : null}
    <Field label="Calle y número" value={values.address} onChange={(address) => set({ address })} maxLength={255} placeholder="Ej: Av. Apoquindo 4501" />
    <View style={styles.switchRow}>
      <Text style={[styles.label, styles.grow]}>Sin numeración</Text>
      <Switch value={values.noStreetNumber} onValueChange={(noStreetNumber) => set({ noStreetNumber })} trackColor={{ true: palette.primary, false: palette.track }} accessibilityLabel="Sin numeración" />
    </View>
    <Field label="Departamento" value={values.apartment} onChange={(apartment) => set({ apartment })} maxLength={60} placeholder="Ej: 302" />
    <Field label="Departamento/Región/Estado" value={values.region} onChange={(region) => set({ region })} maxLength={120} placeholder="Departamento/Región/Estado" autoCapitalize="words" />
    <Field label="Comuna/Municipio/Condado" value={values.county} onChange={(county) => set({ county })} maxLength={120} placeholder="Ingresa el condado" autoCapitalize="words" />
  </FormSheet>;
}

/** Nuevo contacto del cliente: mismos campos que la web, con el correo y el teléfono validados. */
export function NewContactSheet({ customerName, create, findDuplicates, onCreated, onUseExisting, onClose }: {
  customerName: string; create: (input: Omit<WorkshopNewContact, "companyBranchId">) => Promise<WorkshopContact>;
  findDuplicates?: (query: { name: string | null; email: string | null; phone: string | null }) => Promise<WorkshopDuplicateMatch[]>;
  onCreated: (contact: WorkshopContact) => void; onUseExisting?: (contact: WorkshopContact) => void; onClose: () => void;
}) {
  const [values, setValues] = useState({ firstName: "", lastName: "", position: "", email: "", phone: "+56 ", notes: "" });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const set = (patch: Partial<typeof values>) => {
    setValues((current) => ({ ...current, ...patch }));
    setIssues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch))));
  };
  const phone = values.phone.replace(/[^\d]/g, "") === "56" ? "" : values.phone.trim();
  const { saving, error, run } = useSave((requestId) => create({ requestId, firstName: values.firstName.trim(), lastName: values.lastName.trim(),
    position: values.position.trim() || null, email: values.email.trim() || null, phone: phone || null, notes: values.notes.trim() || null }), onCreated, "No se pudo crear el contacto.");
  const createNow = () => void run(JSON.stringify({ ...values, phone }));
  const duplicates = useDuplicateCheck(async () => findDuplicates ? findDuplicates({
    name: `${values.firstName.trim()} ${values.lastName.trim()}`.trim() || null, email: values.email.trim() || null, phone: phone || null
  }) : [], createNow);
  function save() {
    const found: Record<string, string> = {};
    if (!values.firstName.trim()) found.firstName = "Escribe el nombre.";
    if (!values.lastName.trim()) found.lastName = "Escribe el apellido.";
    if (values.email.trim() && !isValidContactEmail(values.email)) found.email = "Revisa el correo.";
    if (phone && !isValidPhone(phone)) found.phone = "Escribe el teléfono con código de país, por ejemplo +56 9 1234 5678.";
    setIssues(found);
    if (Object.keys(found).length === 0) void duplicates.check();
  }
  return <FormSheet title="Nuevo contacto" saving={saving || duplicates.checking} error={error} onSave={save} onClose={onClose}>
    {duplicates.matches ? <DuplicateDialog what="contacto" matches={duplicates.matches} onClose={duplicates.dismiss}
      onUse={(match) => { duplicates.dismiss(); (onUseExisting ?? onCreated)({ id: match.id, fullName: match.name, email: null, phone: null, position: null }); }}
      onCreate={() => { duplicates.dismiss(); createNow(); }} /> : null}
    <Text style={styles.hint}>Cliente: {customerName}</Text>
    <Field label="Nombre *" value={values.firstName} onChange={(firstName) => set({ firstName })} error={issues.firstName} maxLength={120} autoCapitalize="words" />
    <Field label="Apellido *" value={values.lastName} onChange={(lastName) => set({ lastName })} error={issues.lastName} maxLength={120} autoCapitalize="words" />
    <Field label="Cargo" value={values.position} onChange={(position) => set({ position })} maxLength={200} />
    <Field label="Correo electrónico" value={values.email} onChange={(email) => set({ email })} error={issues.email} maxLength={200} keyboardType="email-address" autoCapitalize="none" />
    <Field label="Teléfono" value={values.phone} onChange={(value) => set({ phone: value })} error={issues.phone} maxLength={30} keyboardType="phone-pad" />
    <Field label="Notas" value={values.notes} onChange={(notes) => set({ notes })} maxLength={2000} multiline />
  </FormSheet>;
}

type MasterKey = "types" | "manufacturers" | "models" | "classifications";
const MASTER_LABELS: Record<MasterKey, { label: string; title: string; placeholder: string }> = {
  types: { label: "Tipo de equipo *", title: "Tipo de equipo", placeholder: "Buscar tipo" },
  manufacturers: { label: "Fabricante (marca) *", title: "Fabricante", placeholder: "Buscar marca" },
  models: { label: "Modelo *", title: "Modelo", placeholder: "Buscar modelo" },
  classifications: { label: "Clasificación (segmento) *", title: "Clasificación", placeholder: "Buscar clasificación" }
};

const MASTER_NEW: Record<MasterKey, { title: string; placeholder: string }> = {
  types: { title: "Nuevo tipo de equipo", placeholder: "Ej.: Grúa horquilla" },
  manufacturers: { title: "Nuevo fabricante", placeholder: "Ej.: Caterpillar" },
  models: { title: "Nuevo modelo", placeholder: "Ej.: 320D" },
  classifications: { title: "Nueva clasificación", placeholder: "Ej.: Maquinaria pesada" }
};
type MasterItem = { id: number; name: string };

/** Crear un tipo, marca, modelo o clasificación sin repetir: el nombre igual se bloquea y los parecidos se ofrecen para usarlos. */
function NewMasterDialog({ kind, items, create, onCreated, onUse, onClose }: {
  kind: MasterKey; items: MasterItem[]; create: (kind: MasterKey, name: string, requestId: string) => Promise<MasterItem>;
  onCreated: (item: MasterItem) => void; onUse: (item: MasterItem) => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [issue, setIssue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { same, similar } = findSimilarMasters(items, name);
  const { saving, error, run } = useSave((requestId) => create(kind, name.trim(), requestId), onCreated, "No se pudo crear.");
  function save() {
    if (!name.trim()) { setIssue("Escribe el nombre."); return; }
    if (same) { setIssue(`Ya existe «${same.name}». Úsalo en vez de crear otro.`); return; }
    if (similar.length > 0 && !confirming) { setConfirming(true); return; }
    void run(name.trim().toLowerCase());
  }
  const suggestions = same ? [same] : similar;
  return <Modal visible transparent animationType="fade" onRequestClose={saving ? () => undefined : onClose}>
    <View style={styles.overlay}>
      <View style={styles.dialog}>
        <View style={styles.dialogHead}>
          <Ionicons name="add-circle-outline" size={20} color={palette.primary} accessible={false} />
          <Text style={styles.dialogTitle} accessibilityRole="header">{MASTER_NEW[kind].title}</Text>
        </View>
        <Field label="Nombre *" value={name} onChange={(value) => { setName(value); setIssue(""); setConfirming(false); }} error={issue}
          placeholder={MASTER_NEW[kind].placeholder} maxLength={255} autoCapitalize="characters" />
        {suggestions.length > 0 ? <>
          <Text style={styles.hint}>{same ? "Ya está registrado:" : "Ya existen nombres parecidos. Revisa si es alguno de estos:"}</Text>
          <ScrollView style={styles.matchList} contentContainerStyle={styles.matchListContent} keyboardShouldPersistTaps="handled">
            {suggestions.map((item) => <View key={item.id} style={[styles.match, same && styles.matchStrong]}>
              <Text style={[styles.matchName, styles.grow]} numberOfLines={2}>{item.name}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${item.name}`} disabled={saving} onPress={() => onUse(item)} style={({ pressed }) => [styles.useButton, pressed && styles.pressed]}>
                <Text style={styles.useText}>Usar este</Text>
              </Pressable>
            </View>)}
          </ScrollView>
        </> : null}
        {confirming ? <Text style={styles.confirmText} accessibilityRole="alert">¿Seguro que no es ninguno de los de arriba? Se creará uno nuevo.</Text> : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <View style={styles.actions}>
          <View style={styles.grow}><Button title="Cancelar" variant="secondary" disabled={saving} onPress={onClose} /></View>
          <View style={styles.grow}><Button title={confirming ? "Sí, crear" : "Crear"} icon="checkmark" loading={saving} disabled={saving || Boolean(same)} onPress={save} /></View>
        </View>
      </View>
    </View>
  </Modal>;
}

/**
 * Aviso de equipo repetido: con la misma patente o serie no se deja crear (si es del mismo cliente, se busca en la lista);
 * si solo se parece, se puede crear con una confirmación.
 */
function EquipmentDuplicateDialog({ matches, onOpenList, onCreate, onClose }: {
  matches: WorkshopEquipmentDuplicate[]; onOpenList: () => void; onCreate: () => void; onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const strong = matches.find((match) => match.strength === "strong") ?? null;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.dialog}>
        <View style={styles.dialogHead}>
          <Ionicons name={strong ? "alert-circle-outline" : "copy-outline"} size={20} color={strong ? palette.danger : palette.orange} accessible={false} />
          <Text style={styles.dialogTitle} accessibilityRole="header">{strong ? "Este equipo ya está registrado" : "Ya existe un equipo parecido"}</Text>
        </View>
        <Text style={styles.hint}>{strong
          ? strong.sameCustomer ? "Ya es un equipo de este cliente. Elígelo de la lista en vez de crearlo otra vez."
            : "La misma patente o serie ya está registrada. No se puede crear otro con esa identificación."
          : "Para no duplicar equipos, revisa si es alguno de estos:"}</Text>
        <ScrollView style={styles.matchList} contentContainerStyle={styles.matchListContent}>
          {matches.map((match) => <View key={`${match.source}-${match.id}`} style={[styles.match, match.strength === "strong" && styles.matchStrong]}>
            <View style={styles.grow}>
              <Text style={styles.matchName} numberOfLines={2}>{match.name}</Text>
              <Text style={styles.hint} numberOfLines={1}>{[match.identification, match.internalNumber ? `N° interno ${match.internalNumber}` : null].filter(Boolean).join(" · ")}</Text>
              <Text style={styles.hint} numberOfLines={2}>{match.source === "rental" ? "Equipo interno" : match.sameCustomer ? "De este cliente" : `Cliente: ${match.owner ?? "sin cliente"}`}</Text>
              <View style={styles.reasons}>{match.reasons.map((reason) => <Text key={reason}
                style={[styles.reason, match.strength === "strong" ? styles.reasonStrong : styles.reasonPossible]}>{EQUIPMENT_DUPLICATE_REASON_LABELS[reason]}</Text>)}</View>
            </View>
          </View>)}
        </ScrollView>
        {confirming ? <Text style={styles.confirmText} accessibilityRole="alert">¿Seguro que es un equipo distinto? Se creará uno nuevo.</Text> : null}
        <View style={styles.actions}>
          <View style={styles.grow}><Button title="Volver" variant="secondary" onPress={onClose} /></View>
          {strong ? strong.sameCustomer ? <View style={styles.grow}><Button title="Ver en la lista" icon="list-outline" onPress={onOpenList} /></View> : null
            : <View style={styles.grow}><Button title={confirming ? "Sí, crear igual" : "Crear de todos modos"} variant={confirming ? "danger" : "secondary"}
              onPress={() => { if (!confirming) setConfirming(true); else onCreate(); }} /></View>}
        </View>
      </View>
    </View>
  </Modal>;
}

/** Nuevo equipo del cliente: mismos campos obligatorios que «Registrar equipo de cliente» de la web. */
export function NewEquipmentSheet({ customerName, loadMasters, create, createMaster, findDuplicates, onCreated, onClose }: {
  customerName: string; loadMasters: () => Promise<WorkshopEquipmentMasters>;
  create: (input: Omit<WorkshopNewEquipment, "companyBranchId">) => Promise<WorkshopEquipmentOption>;
  createMaster?: (kind: MasterKey, name: string, requestId: string) => Promise<MasterItem>;
  findDuplicates?: (identification: string, internalNumber: string | null) => Promise<WorkshopEquipmentDuplicate[]>;
  onCreated: (equipment: WorkshopEquipmentOption) => void; onClose: () => void;
}) {
  const [creating, setCreating] = useState<MasterKey | null>(null);
  const choose = (key: MasterKey, item: MasterItem) => { setChosen((current) => ({ ...current, [key]: item })); setIssues(({ [key]: _, ...rest }) => rest); };
  const [masters, setMasters] = useState<WorkshopEquipmentMasters | null>(null);
  const [mastersError, setMastersError] = useState("");
  const [picker, setPicker] = useState<MasterKey | null>(null);
  const [values, setValues] = useState({ identificationTypeId: 2 as 1 | 2, identification: "", internalNumber: "", year: "", description: "", note: "" });
  const [chosen, setChosen] = useState<Record<MasterKey, { id: number; name: string } | null>>({ types: null, manufacturers: null, models: null, classifications: null });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const loader = useRef(loadMasters);
  loader.current = loadMasters;
  const fetchMasters = () => { setMastersError(""); loader.current().then(setMasters, (failure: unknown) => setMastersError(failureText(failure, "No se pudieron cargar las listas de equipos."))); };
  useEffect(fetchMasters, []);
  const set = (patch: Partial<typeof values>) => {
    setValues((current) => ({ ...current, ...patch }));
    setIssues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch))));
  };
  const { saving, error, run } = useSave((requestId) => create({
    requestId, identificationTypeId: values.identificationTypeId, identification: values.identification.trim(), internalNumber: values.internalNumber.trim() || null,
    typeId: chosen.types!.id, manufacturerId: chosen.manufacturers!.id, modelId: chosen.models!.id, classificationId: chosen.classifications!.id,
    year: values.year.trim() || null, description: values.description.trim() || null, note: values.note.trim() || null
  }), onCreated, "No se pudo registrar el equipo.");
  function save() {
    const found: Record<string, string> = {};
    if (!values.identification.trim()) found.identification = values.identificationTypeId === 2 ? "Escribe la patente." : "Escribe el número de serie.";
    if (values.year.trim() && !/^\d{4}$/.test(values.year.trim())) found.year = "El año debe tener 4 dígitos.";
    for (const key of Object.keys(MASTER_LABELS) as MasterKey[]) if (!chosen[key]) found[key] = `Elige ${MASTER_LABELS[key].title.toLowerCase()}.`;
    setIssues(found);
    if (Object.keys(found).length === 0) void duplicates.check();
  }
  const createNow = () => void run(JSON.stringify({ values, chosen }));
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState<WorkshopEquipmentDuplicate[] | null>(null);
  const duplicates = {
    async check() {
      if (checking) return;
      setChecking(true);
      try {
        const found = findDuplicates ? await findDuplicates(values.identification.trim(), values.internalNumber.trim() || null).catch(() => []) : [];
        if (found.length > 0) setMatches(found); else createNow();
      } finally { setChecking(false); }
    }
  };
  return <FormSheet title="Nuevo equipo del cliente" saving={saving || checking} error={error} onSave={save} onClose={onClose}>
    {matches ? <EquipmentDuplicateDialog matches={matches} onClose={() => setMatches(null)} onOpenList={() => { setMatches(null); onClose(); }}
      onCreate={() => { setMatches(null); createNow(); }} /> : null}
    <Text style={styles.hint}>Cliente: {customerName}</Text>
    <Choice label="Tipo de identificación *" value={values.identificationTypeId} onChange={(identificationTypeId) => set({ identificationTypeId })}
      options={EQUIPMENT_IDENTIFICATION_TYPES.map((item) => ({ value: item.id, label: item.label }))} />
    <Field label={values.identificationTypeId === 2 ? "Patente *" : "Número de serie *"} value={values.identification} onChange={(identification) => set({ identification })}
      error={issues.identification} maxLength={120} autoCapitalize="characters" placeholder={values.identificationTypeId === 2 ? "Ej.: VCRJ13" : "Número de serie"} />
    <Field label="Número interno" value={values.internalNumber} onChange={(internalNumber) => set({ internalNumber })} maxLength={120} autoCapitalize="characters" />
    {!masters && !mastersError ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando tipos, marcas y modelos…</Text></View> : null}
    {mastersError ? <View style={styles.field}><Text style={styles.error}>{mastersError}</Text><Button title="Reintentar" variant="secondary" icon="refresh" onPress={fetchMasters} /></View> : null}
    {masters ? (Object.keys(MASTER_LABELS) as MasterKey[]).map((key) => <View key={key} style={styles.masterRow}>
      <SelectorTrigger label={MASTER_LABELS[key].label} value={chosen[key]?.name ?? ""} icon="chevron-down"
        disabled={saving} error={issues[key]} onPress={() => setPicker(key)} containerStyle={styles.grow} />
      {createMaster ? <Pressable accessibilityRole="button" accessibilityLabel={MASTER_NEW[key].title} disabled={saving} onPress={() => setCreating(key)}
        style={({ pressed }) => [styles.masterAdd, pressed && styles.pressed, saving && styles.disabled]}>
        <Ionicons name="add" size={22} color={palette.text} accessible={false} />
      </Pressable> : null}
    </View>) : null}
    <Field label="Año" value={values.year} onChange={(year) => set({ year: year.replace(/[^\d]/g, "") })} error={issues.year} maxLength={4} placeholder="Ej.: 2020" keyboardType="phone-pad" />
    <Field label="Descripción" value={values.description} onChange={(description) => set({ description })} maxLength={2000} multiline />
    <Field label="Nota" value={values.note} onChange={(note) => set({ note })} maxLength={2000} multiline />
    <Text style={styles.hint}>Se registra activo y con ficha pública, igual que en la web.</Text>
    {picker && masters ? <LocalPicker<{ id: number; name: string }> title={MASTER_LABELS[picker].title} placeholder={MASTER_LABELS[picker].placeholder}
      emptyText={createMaster ? "No hay opciones registradas. Crea una con el botón +." : "No hay opciones registradas. Créalas desde la web."} load={async () => masters[picker]} label={(item) => item.name}
      selectedId={chosen[picker]?.id ?? null} onClose={() => setPicker(null)}
      onPick={(item) => { choose(picker, item); setPicker(null); }} /> : null}
    {creating && masters && createMaster ? <NewMasterDialog kind={creating} items={masters[creating]} create={createMaster} onClose={() => setCreating(null)}
      onUse={(item) => { choose(creating, item); setCreating(null); }}
      onCreated={(item) => {
        setMasters((current) => current && { ...current, [creating]: [...current[creating].filter((entry) => entry.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name, "es")) });
        choose(creating, item); setCreating(null);
      }} /> : null}
  </FormSheet>;
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { ...typography.label, color: palette.text },
  hint: { ...typography.caption, color: palette.textSecondary },
  section: { fontSize: 14, fontWeight: "800", color: palette.primary, marginTop: 4 },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  multiline: { minHeight: 80, paddingTop: 10 },
  inputInvalid: { borderColor: palette.danger },
  error: { ...typography.caption, color: palette.danger },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { borderColor: palette.primary, backgroundColor: palette.primary },
  chipText: { fontSize: 14, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  footer: { gap: 8 },
  actions: { flexDirection: "row", gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "rgba(15,23,42,0.55)" },
  dialog: { width: "100%", maxWidth: 460, maxHeight: "88%", gap: 10, padding: 16, borderRadius: radius.lg, backgroundColor: palette.surface },
  dialogHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dialogTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: palette.heading },
  matchList: { flexGrow: 0 },
  matchListContent: { gap: 8 },
  masterRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  masterAdd: { marginTop: 26, width: 52, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  disabled: { opacity: 0.5 },
  match: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  matchStrong: { borderColor: palette.dangerBorder, backgroundColor: palette.dangerSoft },
  matchName: { fontSize: 14, fontWeight: "800", color: palette.text },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  reason: { overflow: "hidden", fontSize: 10, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  reasonStrong: { color: palette.danger, backgroundColor: palette.surface },
  reasonPossible: { color: palette.orange, backgroundColor: palette.orangeSoft },
  useButton: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: palette.primary },
  useText: { fontSize: 12, fontWeight: "800", color: palette.white },
  confirmText: { ...typography.caption, color: palette.danger, fontWeight: "700" }
});
