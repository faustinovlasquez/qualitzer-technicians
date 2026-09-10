import { useImperativeHandle, useMemo, useRef } from "react";
import { PanResponder, PixelRatio, Platform, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { appendSignaturePoint, hasSignature, requireSignaturePng, SIGNATURE_COLOR, SIGNATURE_HEIGHT, SIGNATURE_LINE_WIDTH, SIGNATURE_WIDTH, signaturePath, signaturePoint, type SignaturePadProps } from "./signatureGeometry";

export function SignaturePad(props: SignaturePadProps) {
  const svg = useRef<Svg>(null);
  const latest = useRef(props);
  latest.current = props;
  const strokes = useRef(props.strokes);
  strokes.current = props.strokes;
  const bounds = useRef({ width: 1, height: 1 });
  const drawing = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  const responder = useMemo(() => {
    function end(): void {
      drawing.current = false;
      latest.current.onDrawingChange(false);
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onPanResponderGrant: (event) => {
        if (latest.current.disabled) return;
        drawing.current = true;
        origin.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        strokes.current = appendSignaturePoint(strokes.current, signaturePoint(origin.current.x, origin.current.y, bounds.current.width, bounds.current.height), true);
        latest.current.onDrawingChange(true);
        latest.current.onChange(strokes.current);
      },
      onPanResponderMove: (_event, gesture) => {
        if (!drawing.current || latest.current.disabled || gesture.numberActiveTouches !== 1) return;
        strokes.current = appendSignaturePoint(strokes.current, signaturePoint(origin.current.x + gesture.dx, origin.current.y + gesture.dy, bounds.current.width, bounds.current.height));
        latest.current.onChange(strokes.current);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, []);

  useImperativeHandle(props.ref, () => ({
    capture: async () => {
      if (drawing.current || !hasSignature(strokes.current)) throw new Error("Dibuja la firma antes de continuar.");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return new Promise<string>((resolve, reject) => {
        const current = svg.current;
        if (!current) { reject(new Error("El área de firma no está disponible.")); return; }
        const timer = setTimeout(() => reject(new Error("No se pudo exportar la firma. El dibujo se conserva; vuelve a intentarlo.")), 8000);
        try {
          // iOS rasterizes at screen scale; Android's exporter already uses pixels.
          const scale = Platform.OS === "ios" ? PixelRatio.get() : 1;
          current.toDataURL((base64) => {
            clearTimeout(timer);
            try { resolve(requireSignaturePng(`data:image/png;base64,${base64.replace(/\s/g, "")}`)); }
            catch (error) { reject(error); }
          }, { width: Math.max(1, Math.floor(SIGNATURE_WIDTH / scale)), height: Math.max(1, Math.floor(SIGNATURE_HEIGHT / scale)) });
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    },
  }), []);

  return <View
    {...responder.panHandlers}
    accessibilityLabel={props.label}
    accessibilityHint="Dibuja con el dedo o un lápiz. Usa el botón Borrar para repetir la firma."
    style={styles.pad}
    onLayout={(event) => { bounds.current = event.nativeEvent.layout; }}
  >
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg ref={svg} width="100%" height="100%" viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`} preserveAspectRatio="none">
        <Rect x={0} y={0} width={SIGNATURE_WIDTH} height={SIGNATURE_HEIGHT} fill="#FFFFFF" />
        {props.strokes.map((stroke, index) => <Path key={index} d={signaturePath(stroke)} fill="none" stroke={SIGNATURE_COLOR} strokeWidth={SIGNATURE_LINE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />)}
      </Svg>
    </View>
  </View>;
}

const styles = StyleSheet.create({ pad: { height: 180, width: "100%", backgroundColor: "#FFFFFF" } });