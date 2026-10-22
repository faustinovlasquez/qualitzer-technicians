import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { formatRut, isValidContactEmail, isValidPhone, isValidRut, type WorkshopIdentificationTypes, type WorkshopNewBranch,
  type WorkshopNewContact, type WorkshopNewCustomer } from "../../domain/workshopCustomers";
import type { WorkshopBranchOption, WorkshopContact, WorkshopCustomerOption } from "../../domain/workshopIntake";
import { PickerSheet } from "./IntakePickers";

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
  const [values, setValues] = useState({ name: "", contactName: "", address: "", apartment: "", noStreetNumber: false, region: "", county: "", city: "" });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const set = (patch: Partial<typeof values>) => { setValues((current) => ({ ...current, ...patch })); setIssues({}); };
  const blank = (value: string) => value.trim() || null;
  const { saving, error, run } = useSave((requestId) => create({ requestId, name: values.name.trim(), contactName: blank(values.contactName), address: blank(values.address),
    apartment: blank(values.apartment), noStreetNumber: values.noStreetNumber, region: blank(values.region), county: blank(values.county), city: blank(values.city) }), onCreated, "No se pudo crear la sucursal.");
  function save() {
    const found: Record<string, string> = values.name.trim() ? {} : { name: "Escribe el nombre de la sucursal." };
    setIssues(found);
    if (!found.name) void run(JSON.stringify(values));
  }
  return <FormSheet title="Nueva sucursal" saving={saving} error={error} onSave={save} onClose={onClose}>
    <Text style={styles.hint}>Cliente: {customerName}</Text>
    <Field label="Nombre *" value={values.name} onChange={(name) => set({ name })} error={issues.name} maxLength={255} placeholder="Ej.: Planta Lampa" />
    <Field label="Contacto" value={values.contactName} onChange={(contactName) => set({ contactName })} maxLength={255} placeholder="Persona de referencia" autoCapitalize="words" />
    <Text style={styles.section}>Dirección</Text>
    <Field label="Calle y número" value={values.address} onChange={(address) => set({ address })} maxLength={255} placeholder="Ej.: Av. Apoquindo 4501" />
    <View style={styles.switchRow}>
      <Text style={[styles.label, styles.grow]}>Sin numeración</Text>
      <Switch value={values.noStreetNumber} onValueChange={(noStreetNumber) => set({ noStreetNumber })} trackColor={{ true: palette.primary, false: palette.track }} accessibilityLabel="Sin numeración" />
    </View>
    <Field label="Departamento" value={values.apartment} onChange={(apartment) => set({ apartment })} maxLength={60} placeholder="Ej.: 302" />
    <Field label="Región" value={values.region} onChange={(region) => set({ region })} maxLength={120} placeholder="Ej.: Región Metropolitana" autoCapitalize="words" />
    <Field label="Comuna" value={values.county} onChange={(county) => set({ county })} maxLength={120} placeholder="Ej.: Las Condes" autoCapitalize="words" />
    <Field label="Ciudad" value={values.city} onChange={(city) => set({ city })} maxLength={120} placeholder="Ej.: Santiago" autoCapitalize="words" />
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
