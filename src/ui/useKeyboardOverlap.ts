import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, type View } from "react-native";

/**
 * Cuánto tapa el teclado a la vista (en Android). Con la pantalla completa obligatoria de Android (edge-to-edge) la
 * ventana ya no se achica sola al abrir el teclado: hay que dejar ese espacio abajo para que el campo de texto se vea.
 * En iPhone se sigue usando KeyboardAvoidingView.
 */
export function useKeyboardOverlap() {
  const ref = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android" || typeof Keyboard?.addListener !== "function") return;
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      const view = ref.current;
      if (!view?.measureInWindow) { setOverlap(event.endCoordinates.height); return; }
      view.measureInWindow((_x, y, _width, height) => setOverlap(Math.max(0, Math.round(y + height - keyboardTop))));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setOverlap(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return { ref, overlap };
}
