/**
 * Guía de fotos de la inspección: silueta y consejo por ángulo, los mismos de la web
 * (Qualitzer2.0-Frontend/src/modules/EquipmentMaster/domain/equipmentPhotoReference.ts). Siluetas en un lienzo de 100 × 175.
 */
const SILHOUETTES: Record<string, string> = {
  frontal: `<path d="M30 100 L30 65 Q30 55 40 55 L60 55 Q70 55 70 65 L70 100"/><path d="M25 100 L25 130 L75 130 L75 100"/>
    <circle cx="40" cy="125" r="6"/><circle cx="60" cy="125" r="6"/><path d="M35 55 L40 40 L60 40 L65 55"/>`,
  rear: `<path d="M30 60 L70 60 L70 100 L30 100 Z"/><path d="M25 100 L25 130 L75 130 L75 100"/><rect x="38" y="70" width="24" height="14" rx="1"/>
    <circle cx="40" cy="125" r="6"/><circle cx="60" cy="125" r="6"/>`,
  left: `<path d="M82 100 L82 130 L18 130 L18 100"/><path d="M78 100 L78 50 L70 60 L30 60 Q22 60 22 100"/><circle cx="30" cy="125" r="6"/><circle cx="70" cy="125" r="6"/>`,
  right: `<path d="M18 100 L18 130 L82 130 L82 100"/><path d="M22 100 Q22 60 35 60 L70 60 L78 50 L78 100"/><circle cx="30" cy="125" r="6"/><circle cx="70" cy="125" r="6"/>`,
  "frontal-left": `<path d="M82 100 L82 130 L18 130 L18 100"/><path d="M78 100 L78 55 L70 65 L40 65 Q32 65 32 100"/><circle cx="35" cy="125" r="6"/><circle cx="75" cy="125" r="6"/>`,
  "frontal-right": `<path d="M18 100 L18 130 L82 130 L82 100"/><path d="M22 100 L22 55 L30 65 L60 65 Q68 65 68 100"/><circle cx="25" cy="125" r="6"/><circle cx="65" cy="125" r="6"/>`,
  desk: `<rect x="15" y="55" width="70" height="80" rx="4"/><rect x="22" y="62" width="40" height="18" rx="1"/><rect x="65" y="62" width="14" height="18" rx="1"/>
    <circle cx="30" cy="105" r="4"/><circle cx="45" cy="105" r="4"/><circle cx="60" cy="105" r="4"/>`,
  horometer: `<rect x="20" y="60" width="60" height="55" rx="4"/><circle cx="35" cy="85" r="10"/><circle cx="65" cy="85" r="10"/><rect x="22" y="125" width="56" height="14" rx="2"/>`,
  odometer: `<circle cx="50" cy="85" r="25"/><line x1="50" y1="85" x2="65" y2="70" stroke-width="3"/>`,
  "fuel-indicator": `<rect x="30" y="55" width="40" height="65" rx="3"/><rect x="35" y="60" width="30" height="10" fill="currentColor"/><rect x="35" y="72" width="30" height="10"/>
    <rect x="35" y="84" width="30" height="10"/><rect x="35" y="96" width="30" height="10"/>`,
  serial: `<rect x="20" y="65" width="60" height="40" rx="2"/><line x1="25" y1="75" x2="75" y2="75"/><line x1="25" y1="85" x2="60" y2="85"/><line x1="25" y1="95" x2="70" y2="95"/>`,
  "inside-1": `<rect x="20" y="55" width="60" height="65" rx="3"/><rect x="25" y="60" width="50" height="20"/><rect x="25" y="85" width="50" height="30" rx="1"/>`,
  "motor-1": `<rect x="22" y="60" width="56" height="60" rx="2"/><rect x="28" y="65" width="44" height="15"/><rect x="28" y="85" width="20" height="30"/><rect x="52" y="85" width="20" height="30"/>`,
  balde: `<path d="M25 70 L75 70 L70 110 L30 110 Z"/><path d="M28 110 L28 130 L72 130 L72 110"/>`,
  orugas: `<path d="M15 80 Q15 60 25 60 L75 60 Q85 60 85 80 L85 95 Q85 115 75 115 L25 115 Q15 115 15 95 Z"/><circle cx="25" cy="87" r="6"/><circle cx="75" cy="87" r="6"/>`,
  "tolva-interior": `<path d="M20 70 L80 70 L75 130 L25 130 Z"/><path d="M25 70 L25 55 L75 55 L75 70"/>`,
  _default: `<rect x="20" y="55" width="60" height="75" rx="4"/><line x1="30" y1="75" x2="70" y2="75"/><line x1="30" y1="90" x2="70" y2="90"/><line x1="30" y1="105" x2="70" y2="105"/>`
};
SILHOUETTES["rear-left"] = SILHOUETTES.rear!;
SILHOUETTES["rear-right"] = SILHOUETTES.rear!;
SILHOUETTES["inside-2"] = SILHOUETTES["inside-1"]!;
// Claves equivalentes que se usan en algunas empresas y en la demostración.
const ALIASES: Record<string, string> = { front: "frontal", back: "rear", plate: "serial", patente: "serial" };
const keyOf = (slotKey: string) => ALIASES[slotKey] ?? slotKey;

const HINTS: Record<string, string> = {
  frontal: "Centra la máquina completa. Que se vean las orugas o llantas, la pluma hacia arriba y las luces frontales.",
  "frontal-left": "Captura el ángulo delantero desde la izquierda: que se vean las orugas o llantas y el frente oblicuo.",
  "frontal-right": "Captura el ángulo delantero desde la derecha: igual que el anterior pero al otro lado.",
  rear: "Muestra la parte trasera: contrapeso, escape, luces traseras y patente legible.",
  "rear-left": "Trasera desde la izquierda: contrapeso y lateral izquierdo en la misma foto.",
  "rear-right": "Trasera desde la derecha: contrapeso y lateral derecho en la misma foto.",
  left: "Lateral izquierdo completo. Pluma extendida o recogida, según corresponda.",
  right: "Lateral derecho completo. Que se vean los cilindros hidráulicos y la pluma.",
  desk: "Tablero encendido. Que se vean horómetro, testigos y luces de advertencia.",
  horometer: "Primer plano del horómetro. Lectura legible, sin reflejos que tapen los números.",
  odometer: "Primer plano del odómetro. Lectura clara, sin dedos ni reflejos.",
  "fuel-indicator": "Indicador de combustible encendido. Que se lea el nivel actual.",
  serial: "Placa de serie o VIN visible. Toma la foto de frente, sin sombras ni reflejos.",
  "inside-1": "Interior de cabina o canastillo. Asiento, joysticks, cinturón y mandos visibles.",
  "inside-2": "Segundo ángulo del interior (opcional): luneta trasera o panel lateral.",
  "motor-1": "Compartimento del motor abierto. Bomba hidráulica, filtros y niveles visibles.",
  balde: "Balde en primer plano. Cuchillas, dientes y conexiones.",
  orugas: "Tracción: orugas o llantas traseras. Ruedas dentadas y tensores visibles.",
  "tolva-interior": "Interior de la tolva: paredes, compuerta y piso.",
  _default: "Toma la foto solicitada. Mantén buena luz y el encuadre centrado."
};

/** Silueta en SVG (trazo de color `color`) para el ángulo pedido. */
export function inspectionSilhouette(slotKey: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 175" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round" color="${color}">${SILHOUETTES[keyOf(slotKey)] ?? SILHOUETTES._default}</svg>`;
}
export const inspectionHint = (slotKey: string) => HINTS[keyOf(slotKey)] ?? HINTS._default!;
