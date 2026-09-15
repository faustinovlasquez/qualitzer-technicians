import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { PrivateModal } from "../../security/DeviceSecurityContext";
import { Button } from "../../ui/components";
import { palette } from "../../ui/theme";
import { styles } from "./detailStyles";

export interface DeliverySuccessProps {
  title: string;
  name: string;
  demo: boolean;
  onClose(): void;
  onBack(): void;
}

export function DeliverySuccess({ title, name, demo, onClose, onBack }: DeliverySuccessProps) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    const animation = Animated.timing(progress, { toValue: 1, duration: 420, useNativeDriver: true });
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!active) return;
      if (reduced) progress.setValue(1); else animation.start();
    }).catch(() => progress.setValue(1));
    return () => { active = false; animation.stop(); };
  }, [progress]);
  return <PrivateModal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.modalOverlay}>
      <View style={[styles.modalCard, success.content]} accessibilityViewIsModal testID="delivery-success">
        <Animated.View style={{ opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }}>
          <Ionicons name="checkmark-circle" size={80} color={palette.primary} accessible={false} />
        </Animated.View>
        <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
        <Text style={[styles.label, success.center]}>{name}</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.caption, success.center]}>{demo ? "Entrega registrada en demostración." : "La entrega se registró correctamente."}</Text>
        <Button title="Volver a mis trabajos" icon="arrow-back-outline" onPress={onBack} />
        <Button title="Consultar detalle" variant="ghost" onPress={onClose} />
      </View>
    </View>
  </PrivateModal>;
}

const success = StyleSheet.create({ content: { padding: 24, gap: 16, alignItems: "center" }, center: { textAlign: "center" } });