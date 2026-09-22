import { requireOptionalNativeModule } from "expo";
import { z } from "zod";
import { equipmentAddressSchema, type EquipmentAddress } from "../domain/equipmentLocation";
import type { GoogleMapPoint } from "./googleMapProtocol";

const suggestionsSchema = z.array(z.object({ id: z.string().min(1).max(500), label: z.string().min(1).max(1000) }).strict()).max(5);
export type GooglePlaceSuggestion = z.infer<typeof suggestionsSchema>[number];
interface GooglePlacesNative {
  configured(): boolean;
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
  available: () => native?.configured() === true,
  endSession: () => native?.endSession(),
  search: async (query: string): Promise<GooglePlaceSuggestion[]> => suggestionsSchema.parse(await bounded(required().search(z.string().trim().min(3).max(200).parse(query)))),
  details: async (id: string): Promise<EquipmentAddress> => equipmentAddressSchema.parse(await bounded(required().details(id))),
  reverse: async (point: GoogleMapPoint): Promise<EquipmentAddress> => equipmentAddressSchema.parse(await bounded(required().reverse(point.lat, point.lng))),
};