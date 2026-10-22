import { useMemo } from "react";
import { SvgXml } from "react-native-svg";
import { create } from "qrcode";

/** Código QR dibujado con SVG (sin imágenes externas), con margen blanco para que se lea bien. */
export function QrCode({ value, size }: { value: string; size: number }) {
  const xml = useMemo(() => {
    const { size: count, data } = create(value, { errorCorrectionLevel: "M" }).modules;
    const margin = 2;
    const total = count + margin * 2;
    let path = "";
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (data[y * count + x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#0F172A"/></svg>`;
  }, [value]);
  return <SvgXml xml={xml} width={size} height={size} accessibilityLabel="Código QR del enlace" />;
}
