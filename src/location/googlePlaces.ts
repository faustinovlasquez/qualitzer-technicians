import { requireOptionalNativeModule } from "expo";
import { z } from "zod";
import { equipmentAddressSchema, type EquipmentAddress } from "../domain/equipmentLocation";
import type { GoogleMapPoint } from "./googleMapProtocol";

const suggestionsSchema = z.array(z.object({ id: z.string().min(1).max(500), label: z.string().min(1).max(1000) }).strict()).max(5);
export type GooglePlaceSuggestion = z.infer<typeof suggestionsSchema>[number];
const configurationSchema = z.object({ packageName: z.string().min(1).max(255), keyConfigured: z.boolean(), certificateSha1: z.array(z.string().regex(/^(?:[A-F0-9]{2}:){19}[A-F0-9]{2}$/)).max(5), playServicesStatus: z.number().int() }).strict();
export type GoogleMapsConfiguration = z.infer<typeof configurationSchema>;
const diagnosticSchema = z.object({ status: z.number().int().min(0).max(599), accepted: z.boolean(), reasons: z.array(z.string().regex(/^[A-Z_]{1,80}$/)).max(10) }).strict();
export type GoogleMapsDiagnostic = z.infer<typeof diagnosticSchema>;
interface GooglePlacesNative {
  configured(): boolean;
  configuration?(): unknown;
  diagnose?(): Promise<unknown>;
  endSession(): void;
  search(query: string): Promise<unknown>;
  details(placeId: string): Promise<unknown>;
  reverse(latitude: number, longitude: number): Promise<unknown>;
}
const native = requireOptionalNativeModule<GooglePlacesNative>("QualitzerPlaces");
function required(): GooglePlacesNative {
  if (!native?.configured()) throw new Error("Google Maps no está configurado en esta instalación de la app.");
  return native;
}
async function bounded<Result>(operation: Promise<Result>): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Google no respondió. Revisa la conexión y vuelve a intentar.")), 15000); })]); }
  finally { clearTimeout(timer); }
}
export const googlePlaces = {
  diagnose: async (): Promise<GoogleMapsDiagnostic> => {
    const module = required();
    if (!module.diagnose) throw new Error("GOOGLE_DIAGNOSTIC_UNAVAILABLE");
    return diagnosticSchema.parse(await bounded(module.diagnose()));
  },
  configuration: (): GoogleMapsConfiguration | null => {
    try { const result = configurationSchema.safeParse(native?.configuration?.()); return result.success ? result.data : null; } catch { return null; }
  },
  available: () => native?.configured() === true,
  endSession: () => native?.endSession(),
  search: async (query: string): Promise<GooglePlaceSuggestion[]> => suggestionsSchema.parse(await bounded(required().search(z.string().trim().min(3).max(200).parse(query)))),
  details: async (id: string): Promise<EquipmentAddress> => equipmentAddressSchema.parse(await bounded(required().details(id))),
  reverse: async (point: GoogleMapPoint): Promise<EquipmentAddress> => equipmentAddressSchema.parse(await bounded(required().reverse(point.lat, point.lng))),
};