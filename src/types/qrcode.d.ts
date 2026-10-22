/** Lo que la app usa de `qrcode`: la matriz del código para dibujarlo con SVG. */
declare module "qrcode" {
  export function create(text: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): { modules: { size: number; data: ArrayLike<number | boolean> } };
}
