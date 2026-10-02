import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const optionalText = z.string().nullable();
// URL publica del bucket, o data URI JPEG en el modo de demostracion (sin servidor).
const avatarSource = z.union([z.url({ protocol: /^https?$/ }).max(2048), z.string().max(4_300_000).regex(/^data:image\/jpeg;base64,/)]);

export const GENDER_OPTIONS = [{ value: "M", label: "Masculino" }, { value: "F", label: "Femenino" }, { value: "O", label: "Otro" }] as const;
export const NATIONALITY_OPTIONS = [
  { value: "CL", label: "Chilena" }, { value: "AR", label: "Argentina" }, { value: "PE", label: "Peruana" },
  { value: "CO", label: "Colombiana" }, { value: "VE", label: "Venezolana" }, { value: "OTHER", label: "Otra" },
] as const;
export const MARITAL_STATUS_OPTIONS = [
  { value: "SINGLE", label: "Soltero(a)" }, { value: "MARRIED", label: "Casado(a)" }, { value: "DIVORCED", label: "Divorciado(a)" },
  { value: "WIDOWED", label: "Viudo(a)" }, { value: "CIVIL_UNION", label: "Acuerdo de unión civil" },
] as const;
export const BLOOD_TYPE_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(value => ({ value, label: value }));

const values = <T extends ReadonlyArray<{ value: string }>>(options: T) => options.map(option => option.value) as [T[number]["value"], ...Array<T[number]["value"]>];
const genderSchema = z.enum(values(GENDER_OPTIONS));
const nationalitySchema = z.enum(values(NATIONALITY_OPTIONS));
const maritalStatusSchema = z.enum(values(MARITAL_STATUS_OPTIONS));
const bloodTypeSchema = z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);

export const BIRTHDATE_MIN_YEAR = 1900;
const birthdateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCFullYear() >= BIRTHDATE_MIN_YEAR && date.getTime() <= Date.now();
});

const name = z.string().trim().max(50);

/** Respuesta del perfil propio: valores desconocidos del servidor se muestran como "sin especificar". */
export const ownProfileSchema = z.object({
  userId: id,
  workerId: id.nullable(),
  email: optionalText,
  firstNames: z.string(),
  lastNames: z.string(),
  secondLastName: optionalText,
  preferredName: optionalText,
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  gender: genderSchema.nullable().catch(null),
  nationality: nationalitySchema.nullable().catch(null),
  maritalStatus: maritalStatusSchema.nullable().catch(null),
  bloodType: bloodTypeSchema.nullable().catch(null),
  identification: z.object({ type: optionalText, number: optionalText }),
  avatarUrl: avatarSource.nullable(),
  avatarThumbnailUrl: avatarSource.nullable(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().catch(null),
  updatedAt: z.string().nullable(),
});

export const ownProfileInputSchema = z.object({
  firstNames: name.min(1),
  lastNames: name.min(1),
  secondLastName: name.nullable(),
  preferredName: name.nullable(),
  birthdate: birthdateSchema.nullable(),
  gender: genderSchema.nullable(),
  nationality: nationalitySchema.nullable(),
  maritalStatus: maritalStatusSchema.nullable(),
  bloodType: bloodTypeSchema.nullable(),
}).strict();

export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
export const ownAvatarInputSchema = z.object({
  image: z.string().max(Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 32).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
}).strict();

export type OwnProfile = z.infer<typeof ownProfileSchema>;
export type OwnProfileInput = z.infer<typeof ownProfileInputSchema>;
export type OwnAvatarInput = z.infer<typeof ownAvatarInputSchema>;

export interface OwnProfilePort {
  ownProfile(): Promise<OwnProfile>;
  saveOwnProfile(input: OwnProfileInput): Promise<OwnProfile>;
  saveOwnAvatar(input: OwnAvatarInput): Promise<OwnProfile>;
  removeOwnAvatar(): Promise<OwnProfile>;
}

export interface OwnProfileAccess {
  scopeKey: string;
  userId: number;
  available: boolean;
  actions: OwnProfilePort;
  /** Avisa a la sesion que la foto o el nombre cambiaron, para refrescar la cabecera. */
  onChanged(profile: OwnProfile): void;
}

export function ownProfilePort(repository: Partial<OwnProfilePort>): OwnProfilePort {
  if (!repository.ownProfile || !repository.saveOwnProfile || !repository.saveOwnAvatar || !repository.removeOwnAvatar) throw new Error("OWN_PROFILE_UNAVAILABLE");
  return { ownProfile: repository.ownProfile.bind(repository), saveOwnProfile: repository.saveOwnProfile.bind(repository), saveOwnAvatar: repository.saveOwnAvatar.bind(repository), removeOwnAvatar: repository.removeOwnAvatar.bind(repository) };
}

/** Acepta el perfil solo si pertenece al usuario de la sesion. */
export function ownProfileFor(value: unknown, userId: number): OwnProfile {
  const profile = ownProfileSchema.parse(value);
  if (profile.userId !== userId) throw new Error("OWN_PROFILE_IDENTITY_MISMATCH");
  return profile;
}

export function profileInputFrom(profile: OwnProfile): OwnProfileInput {
  return {
    firstNames: profile.firstNames, lastNames: profile.lastNames, secondLastName: profile.secondLastName, preferredName: profile.preferredName,
    birthdate: profile.birthdate, gender: profile.gender, nationality: profile.nationality, maritalStatus: profile.maritalStatus, bloodType: profile.bloodType,
  };
}

export function optionLabel(options: ReadonlyArray<{ value: string; label: string }>, value: string | null): string | null {
  return value === null ? null : options.find(option => option.value === value)?.label ?? null;
}

export function profileDisplayName(profile: Pick<OwnProfile, "firstNames" | "lastNames" | "secondLastName" | "preferredName">): string {
  const legal = [profile.firstNames, profile.lastNames, profile.secondLastName].filter(Boolean).join(" ").trim();
  return profile.preferredName?.trim() || legal;
}

export function profileInitials(firstNames: string, lastNames: string): string {
  return `${firstNames.trim()[0] ?? ""}${lastNames.trim()[0] ?? ""}`.toUpperCase() || "?";
}

export function profileAge(birthdate: string | null, now = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || now.getMonth() + 1 === month && now.getDate() < day) age--;
  return age >= 0 && age < 150 ? age : null;
}
