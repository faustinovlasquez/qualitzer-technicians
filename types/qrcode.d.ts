declare module "qrcode" {
  export interface QRCodeOptions {
    type?: "image/png";
    width?: number;
    margin?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark: string; light: string };
  }

  export function toDataURL(text: string, options?: QRCodeOptions): Promise<string>;

  const qrCode: { toDataURL: typeof toDataURL };
  export default qrCode;
}