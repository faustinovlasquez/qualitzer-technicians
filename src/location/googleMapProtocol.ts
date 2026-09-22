import type { EquipmentAddress } from "../domain/equipmentLocation";

export interface GoogleMapPoint { lat: number; lng: number; accuracy?: number; }
export interface GoogleMapProps { point: GoogleMapPoint | null; editable?: boolean; disabled?: boolean; selection?: GoogleMapPoint | null; onAddress?(address: EquipmentAddress): void; onPoint?(point: GoogleMapPoint): void; }
export function validMapPoint(point: GoogleMapPoint | null): point is GoogleMapPoint {
  return point !== null && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
    && (point.accuracy === undefined || Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 10000);
}
