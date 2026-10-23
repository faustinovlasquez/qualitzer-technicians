import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { EQUIPMENT_IDENTIFICATION_TYPES, formatRut, isValidContactEmail, isValidPhone, isValidRut, type WorkshopEquipmentMasters, type WorkshopIdentificationTypes, type WorkshopNewBranch,
  type WorkshopNewContact, type WorkshopNewCustomer, type WorkshopNewEquipment } from "../../domain/workshopCustomers";
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
export function NewCustomerSheet({ loadTypes, create, onCreated, onClose }: {
  loadTypes: () => Promise<WorkshopIdentificationTypes>; create: (input: Omit<WorkshopNewCustomer, "companyBranchId">) => Promise<WorkshopCustomerOption>;
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
  const { saving, error, run } = useSave((requestId) => create({ requestId, customerType, identificationTypeId: typeId!, number: isRut ? formatRut(number) : number.trim(),
    name: name.trim(), fantasyName: fantasyName.trim() || null, businessActivity: activity.trim() || null }), onCreated, "No se pudo crear el cliente.");
  function save() {
    const found: Record<string, string> = {};
    if (typeId === null) found.type = "Elige el tipo de identificación.";
    if (!number.trim()) found.number = "Escribe el número de identificación.";
    else if (isRut && !isValidRut(number)) found.number = "El RUT no es válido. Revisa el número y el dígito verificador.";
    if (!name.trim()) found.name = customerType === "person" ? "Escribe el nombre." : "Escribe la razón social.";
    setIssues(found);
    if (Object.keys(found).length === 0) void run(JSON.stringify([customerType, typeId, number, name, fantasyName, activity]));
  }
  return <FormSheet title="Nuevo cliente" saving={saving} error={error} onSave={save} onClose={onClose}>
    <Choice label="Tipo de cliente *" value={customerType} onChange={setCustomerType}
      options={[{ value: "company", label: "Empresa" }, { value: "person", label: "Persona" }, { value: "consignment", label: "Consignado" }]} />
    {!types && !typesError ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando tipos de identificación…</Text></View> : null}
    {typesError ? <View style={styles.field}><Text style={styles.error}>{typesError}</Text><Button title="Reintentar" variant="secondary" icon="refresh" onPress={fetchTypes} /></View> : null}
    {types && typeId !== null ? <Choice label="Tipo de identificación *" value={typeId} onChange={(value) => { setTypeId(value); setIssues({}); }}
      options={types.map((item) => ({ value: item.id, label: item.label }))} /> : null}
    <Field label="Número de identificación *" value={number} onChange={(value) => { setNumber(isRut ? value.replace(/\s/g, "") : value); setIssues(({ number: _, ...rest }) => rest); }} error={issues.number}
      placeholder={isRut ? "76.123.456-7" : "Número"} maxLength={30} autoCapitalize="characters" />
    {isRut && number && isValidRut(number) ? <Text style={styles.hint}>Se guardará como {formatRut(number)}</Text> : null}
    <Field label={customerType === "person" ? "Nombre completo *" : "Razón social *"} value={name} onChange={(value) => { setName(value); setIssues(({ name: _, ...rest }) => rest); }} error={issues.name} maxLength={255} autoCapitalize="words" />
    <Field label="Nombre de fantasía" value={fantasyName} onChange={setFantasyName} placeholder="Ingrese el nombre de fantasía" maxLength={255} />
    <Field label="Giro" value={activity} onChange={setActivity} maxLength={255} />
  </FormSheet>;
}

/** Nueva sucursal del cliente, con su dirección escrita (sin mapa). */
export function NewBranchSheet({ customerName, create, onCreated, onClose }: {
  customerName: string; create: (input: Omit<WorkshopNewBranch, "companyBranchId">) => Promise<WorkshopBranchOption>;
  onCreated: (branch: WorkshopBranchOption) => void; onClose: () => void;
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
  function save() {
    const found: Record<string, string> = values.name.trim() ? {} : { name: "Escribe el nombre de la sucursal." };
    setIssues(found);
    if (!found.name) void run(JSON.stringify(values));
  }
  return <FormSheet title="Nueva sucursal" saving={saving} error={error} onSave={save} onClose={onClose}>
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
export function NewContactSheet({ customerName, create, onCreated, onClose }: {
  customerName: string; create: (input: Omit<WorkshopNewContact, "companyBranchId">) => Promise<WorkshopContact>;
  onCreated: (contact: WorkshopContact) => void; onClose: () => void;
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
  function save() {
    const found: Record<string, string> = {};
    if (!values.firstName.trim()) found.firstName = "Escribe el nombre.";
    if (!values.lastName.trim()) found.lastName = "Escribe el apellido.";
    if (values.email.trim() && !isValidContactEmail(values.email)) found.email = "Revisa el correo.";
    if (phone && !isValidPhone(phone)) found.phone = "Escribe el teléfono con código de país, por ejemplo +56 9 1234 5678.";
    setIssues(found);
    if (Object.keys(found).length === 0) void run(JSON.stringify({ ...values, phone }));
  }
  return <FormSheet title="Nuevo contacto" saving={saving} error={error} onSave={save} onClose={onClose}>
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

/** Nuevo equipo del cliente: mismos campos obligatorios que «Registrar equipo de cliente» de la web. */
export function NewEquipmentSheet({ customerName, loadMasters, create, onCreated, onClose }: {
  customerName: string; loadMasters: () => Promise<WorkshopEquipmentMasters>;
  create: (input: Omit<WorkshopNewEquipment, "companyBranchId">) => Promise<WorkshopEquipmentOption>;
  onCreated: (equipment: WorkshopEquipmentOption) => void; onClose: () => void;
}) {
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
    if (Object.keys(found).length === 0) void run(JSON.stringify({ values, chosen }));
  }
  return <FormSheet title="Nuevo equipo del cliente" saving={saving} error={error} onSave={save} onClose={onClose}>
    <Text style={styles.hint}>Cliente: {customerName}</Text>
    <Choice label="Tipo de identificación *" value={values.identificationTypeId} onChange={(identificationTypeId) => set({ identificationTypeId })}
      options={EQUIPMENT_IDENTIFICATION_TYPES.map((item) => ({ value: item.id, label: item.label }))} />
    <Field label={values.identificationTypeId === 2 ? "Patente *" : "Número de serie *"} value={values.identification} onChange={(identification) => set({ identification })}
      error={issues.identification} maxLength={120} autoCapitalize="characters" placeholder={values.identificationTypeId === 2 ? "Ej.: VCRJ13" : "Número de serie"} />
    <Field label="Número interno" value={values.internalNumber} onChange={(internalNumber) => set({ internalNumber })} maxLength={120} autoCapitalize="characters" />
    {!masters && !mastersError ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando tipos, marcas y modelos…</Text></View> : null}
    {mastersError ? <View style={styles.field}><Text style={styles.error}>{mastersError}</Text><Button title="Reintentar" variant="secondary" icon="refresh" onPress={fetchMasters} /></View> : null}
    {masters ? (Object.keys(MASTER_LABELS) as MasterKey[]).map((key) => <SelectorTrigger key={key} label={MASTER_LABELS[key].label} value={chosen[key]?.name ?? ""} icon="chevron-down"
      disabled={saving} error={issues[key]} onPress={() => setPicker(key)} />) : null}
    <Field label="Año" value={values.year} onChange={(year) => set({ year: year.replace(/[^\d]/g, "") })} error={issues.year} maxLength={4} placeholder="Ej.: 2020" keyboardType="phone-pad" />
    <Field label="Descripción" value={values.description} onChange={(description) => set({ description })} maxLength={2000} multiline />
    <Field label="Nota" value={values.note} onChange={(note) => set({ note })} maxLength={2000} multiline />
    <Text style={styles.hint}>Se registra activo y con ficha pública, igual que en la web.</Text>
    {picker && masters ? <LocalPicker<{ id: number; name: string }> title={MASTER_LABELS[picker].title} placeholder={MASTER_LABELS[picker].placeholder}
      emptyText="No hay opciones registradas. Créalas desde la web." load={async () => masters[picker]} label={(item) => item.name}
      selectedId={chosen[picker]?.id ?? null} onClose={() => setPicker(null)}
      onPick={(item) => { setChosen((current) => ({ ...current, [picker]: item })); setIssues(({ [picker]: _, ...rest }) => rest); setPicker(null); }} /> : null}
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
  grow: { flex: 1 }
});
