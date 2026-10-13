import { useEffect, useRef, type ReactNode } from "react";
import * as ReactNative from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * Movimiento común de la app: mismas duraciones y curvas en todas las pantallas para que se sienta consistente.
 * Respeta "Reducir movimiento" del teléfono y no hace nada donde las animaciones no existen (pruebas, web antigua).
 */
export const MOTION = { fast: 160, base: 240, slow: 320 } as const;

const { AccessibilityInfo, Animated, Easing, LayoutAnimation, View } = ReactNative;
let reduceMotion = false;
void AccessibilityInfo?.isReduceMotionEnabled?.().then((value) => { reduceMotion = value; }).catch(() => undefined);
AccessibilityInfo?.addEventListener?.("reduceMotionChanged", (value: boolean) => { reduceMotion = value; });

export type LayoutMotion = "collapse" | "content";

/** Anima el siguiente cambio de tamaño o posición (por ejemplo, un bloque que se despliega). */
export function animateNextLayout(kind: LayoutMotion = "collapse"): void {
  if (reduceMotion || LayoutAnimation?.configureNext === undefined) return;
  const duration = kind === "collapse" ? MOTION.base : MOTION.fast;
  LayoutAnimation.configureNext({
    duration,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity, duration: MOTION.fast },
    update: { type: LayoutAnimation.Types.easeInEaseOut, duration },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity, duration: MOTION.fast }
  });
}

interface FadeInProps { children: ReactNode; style?: StyleProp<ViewStyle>; offset?: number; delay?: number }

function AnimatedFadeIn({ children, style, offset = 8, delay = 0 }: FadeInProps) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { progress.setValue(1); return; }
    const animation = Animated.timing(progress, { toValue: 1, duration: MOTION.base, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] });
  return <Animated.View style={[{ opacity: progress, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

function StaticFadeIn({ children, style }: FadeInProps) {
  return <View style={style}>{children}</View>;
}

/** Aparición suave (opacidad y un leve desplazamiento) al montar una pantalla, pestaña o bloque. */
export const FadeIn = Animated?.Value !== undefined && Animated.timing !== undefined && Easing?.out !== undefined ? AnimatedFadeIn : StaticFadeIn;
