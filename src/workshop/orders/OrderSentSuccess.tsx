import type { ComponentProps } from "react";
import { View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { CreationDone } from "../../screens/creation/CreationUi";

type Action = ComponentProps<typeof CreationDone>["primary"];

/** Ventana de éxito al enviar una OT a comercial (o al crearla y enviarla): qué pasó, qué sigue y adónde ir. */
export function OrderSentSuccess({ code, title, worksCount, created, primary, secondary, onDismiss }: {
  code: string | null; title: string | null; worksCount: number | null; created: boolean; primary: Action; secondary?: Action; onDismiss: () => void;
}) {
  return <Modal visible transparent animationType="none" onRequestClose={onDismiss}>
    <View style={{ flex: 1 }}>
      <CreationDone busy={false} icon="paper-plane" question={secondary ? "¿Qué quieres hacer ahora?" : null}
        title={created ? "¡OT creada y enviada a comercial!" : "¡OT enviada a comercial!"}
        code={code}
        subtitle="Comercial ya la recibió. Quedó pendiente de cotizar: ellos completan los precios."
        details={[
          ...(title ? [{ icon: "document-text-outline" as const, label: title }] : []),
          ...(worksCount !== null ? [{ icon: "construct-outline" as const, label: worksCount === 1 ? "1 trabajo incluido" : `${worksCount} trabajos incluidos` }] : []),
          { icon: "time-outline" as const, label: "Estado: pendiente de cotizar" }
        ]}
        primary={primary} secondary={secondary} />
    </View>
  </Modal>;
}
