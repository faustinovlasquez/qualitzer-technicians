import type { Ref } from "react";
import { Text, View } from "react-native";
import { Badge, Button } from "../../../ui/components";
import { SignaturePad } from "./SignaturePad";
import { hasSignature, SIGNATURE_MAX_POINTS, signaturePointCount, type SignaturePadHandle, type SignatureStrokes } from "./signatureGeometry";
import { styles } from "./lifecycleStyles";

export interface SignatureFieldProps {
  label: string;
  name?: string;
  strokes: SignatureStrokes;
  signatureRef: Ref<SignaturePadHandle>;
  disabled: boolean;
  error?: string;
  onChange: (strokes: SignatureStrokes) => void;
  onDrawingChange: (drawing: boolean) => void;
}

export function SignatureField({ label, name, strokes, signatureRef, disabled, error, onChange, onDrawingChange }: SignatureFieldProps) {
  const signed = hasSignature(strokes);
  const limit = signaturePointCount(strokes) >= SIGNATURE_MAX_POINTS;
  return <View style={styles.tight}>
    <View style={styles.row}>
      <View style={styles.grow}><Text style={styles.label}>{label} *</Text>{name ? <Text style={styles.caption}>{name}</Text> : null}</View>
      <Badge label={signed ? "Dibujada" : "Pendiente"} tone={signed ? "success" : "warning"} />
    </View>
    <View style={[styles.signature, error && styles.signatureError]}>
      <SignaturePad ref={signatureRef} label={label} strokes={strokes} disabled={disabled} onChange={onChange} onDrawingChange={onDrawingChange} />
      <Text style={styles.signatureHint}>{limit ? "Límite de trazos alcanzado. Puedes usar esta firma o borrarla para repetir." : "Firma dentro del recuadro · dedo, lápiz o ratón"}</Text>
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button title={`Borrar ${label.toLowerCase()}`} icon="trash-outline" variant="ghost" disabled={disabled || strokes.length === 0} onPress={() => onChange([])} />
  </View>;
}