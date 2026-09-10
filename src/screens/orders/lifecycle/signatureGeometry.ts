import type { Ref } from "react";

export const SIGNATURE_WIDTH = 768;
export const SIGNATURE_HEIGHT = 320;
export const SIGNATURE_MAX_BYTES = 1024 * 1024;
export const SIGNATURE_MAX_POINTS = 6000;
export const SIGNATURE_COLOR = "#1D4ED8";
export const SIGNATURE_LINE_WIDTH = 3;

export interface SignaturePoint { readonly x: number; readonly y: number; }
export type SignatureStroke = readonly SignaturePoint[];
export type SignatureStrokes = readonly SignatureStroke[];
export interface SignaturePadHandle { capture: () => Promise<string>; }
export interface SignaturePadProps {
  ref?: Ref<SignaturePadHandle>;
  label: string;
  strokes: SignatureStrokes;
  disabled: boolean;
  onChange: (strokes: SignatureStrokes) => void;
  onDrawingChange: (drawing: boolean) => void;
}

export function signaturePoint(x: number, y: number, width: number, height: number): SignaturePoint {
  return {
    x: Math.round(Math.max(0, Math.min(SIGNATURE_WIDTH, x / Math.max(1, width) * SIGNATURE_WIDTH)) * 10) / 10,
    y: Math.round(Math.max(0, Math.min(SIGNATURE_HEIGHT, y / Math.max(1, height) * SIGNATURE_HEIGHT)) * 10) / 10,
  };
}

export function signaturePointCount(strokes: SignatureStrokes): number {
  return strokes.reduce((sum, stroke) => sum + stroke.length, 0);
}

export function appendSignaturePoint(strokes: SignatureStrokes, point: SignaturePoint, start = false): SignatureStrokes {
  if (signaturePointCount(strokes) >= SIGNATURE_MAX_POINTS) return strokes;
  if (start) return [...strokes, [point]];
  const stroke = strokes[strokes.length - 1];
  const previous = stroke?.[stroke.length - 1];
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) < 1) return strokes;
  return [...strokes.slice(0, -1), [...stroke, point]];
}

export function hasSignature(strokes: SignatureStrokes): boolean {
  let distance = 0;
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      distance += Math.hypot(stroke[index].x - stroke[index - 1].x, stroke[index].y - stroke[index - 1].y);
      if (distance >= 8) return true;
    }
  }
  return false;
}

export function signaturePath(stroke: SignatureStroke): string {
  return stroke.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

export function requireSignaturePng(dataUrl: string): string {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error("No se pudo generar una firma PNG. Vuelve a intentarlo.");
  const base64 = dataUrl.slice(prefix.length);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if (base64.length > Math.ceil(SIGNATURE_MAX_BYTES / 3) * 4 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new Error("La firma no es un PNG válido de hasta 1 MiB. Bórrala y vuelve a dibujarla.");
  }
  if (base64.length * 3 / 4 - padding > SIGNATURE_MAX_BYTES) throw new Error("La firma supera 1 MiB. Bórrala y vuelve a dibujarla.");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const header: number[] = [];
  for (let offset = 0; offset < Math.min(44, base64.length); offset += 4) {
    const block = alphabet.indexOf(base64[offset]) * 262144 + alphabet.indexOf(base64[offset + 1]) * 4096 + alphabet.indexOf(base64[offset + 2]) * 64 + alphabet.indexOf(base64[offset + 3]);
    header.push((block >>> 16) & 255, (block >>> 8) & 255, block & 255);
  }
  const width = header[16] * 16777216 + header[17] * 65536 + header[18] * 256 + header[19];
  const height = header[20] * 16777216 + header[21] * 65536 + header[22] * 256 + header[23];
  if (base64.length < 64 || header.slice(8, 16).join(",") !== "0,0,0,13,73,72,68,82" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024) {
    throw new Error("La firma PNG debe tener dimensiones válidas de hasta 1024 × 1024 píxeles.");
  }
  return dataUrl;
}