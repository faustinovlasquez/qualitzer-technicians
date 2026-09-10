import { useImperativeHandle, useLayoutEffect, useRef, type PointerEvent } from "react";
import { appendSignaturePoint, hasSignature, requireSignaturePng, SIGNATURE_COLOR, SIGNATURE_HEIGHT, SIGNATURE_LINE_WIDTH, SIGNATURE_MAX_BYTES, SIGNATURE_WIDTH, signaturePoint, type SignaturePadProps } from "./signatureGeometry";

export function SignaturePad(props: SignaturePadProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const strokes = useRef(props.strokes);
  strokes.current = props.strokes;
  const pointer = useRef<number | null>(null);

  useLayoutEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
    context.strokeStyle = SIGNATURE_COLOR;
    context.lineWidth = SIGNATURE_LINE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of props.strokes) {
      context.beginPath();
      stroke.forEach((point, index) => { if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); });
      context.stroke();
    }
  }, [props.strokes]);

  useImperativeHandle(props.ref, () => ({
    capture: () => new Promise<string>((resolve, reject) => {
      const current = canvas.current;
      if (!current || pointer.current !== null || !hasSignature(strokes.current)) { reject(new Error("Dibuja la firma antes de continuar.")); return; }
      try {
        current.toBlob((blob) => {
          if (!blob || blob.type !== "image/png" || blob.size > SIGNATURE_MAX_BYTES) { reject(new Error("No se pudo generar una firma PNG de hasta 1 MiB.")); return; }
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("No se pudo leer la firma. El dibujo se conserva."));
          reader.onabort = () => reject(new Error("Se interrumpió la lectura de la firma."));
          reader.onload = () => {
            try {
              if (typeof reader.result !== "string") throw new Error("No se pudo exportar la firma PNG.");
              resolve(requireSignaturePng(reader.result));
            } catch (error) { reject(error); }
          };
          reader.readAsDataURL(blob);
        }, "image/png");
      } catch (error) { reject(error); }
    }),
  }), []);

  function draw(event: PointerEvent<HTMLCanvasElement>, start = false): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = signaturePoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
    strokes.current = appendSignaturePoint(strokes.current, point, start);
    latest.current.onChange(strokes.current);
  }

  function end(event: PointerEvent<HTMLCanvasElement>): void {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    latest.current.onDrawingChange(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <canvas
    ref={canvas}
    width={SIGNATURE_WIDTH}
    height={SIGNATURE_HEIGHT}
    role="img"
    aria-label={`${props.label}. Dibuja con el ratón, el dedo o un lápiz.`}
    aria-disabled={props.disabled}
    style={{ display: "block", width: "100%", height: 180, touchAction: "none", backgroundColor: "#FFFFFF", cursor: props.disabled ? "default" : "crosshair" }}
    onPointerDown={(event) => {
      if (latest.current.disabled || !event.isPrimary || event.button !== 0 || pointer.current !== null) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = event.pointerId;
      latest.current.onDrawingChange(true);
      draw(event, true);
    }}
    onPointerMove={(event) => { if (pointer.current === event.pointerId && !latest.current.disabled) { event.preventDefault(); draw(event); } }}
    onPointerUp={end}
    onPointerCancel={end}
    onLostPointerCapture={end}
  />;
}