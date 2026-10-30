import { useEffect, useRef, useState, type ComponentProps } from "react";
import { View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { CreationDone } from "../../screens/creation/CreationUi";
import { EMAIL_PROVIDER_LABEL, type EmailEligibility } from "../../domain/workshopCustomerEmail";
import type { useWorkshopBoard } from "../useWorkshopBoard";
import { EmailSendScreen } from "./EmailSendScreen";

type EmailsApi = ReturnType<typeof useWorkshopBoard>["emails"];
type IconName = ComponentProps<typeof CreationDone>["details"][number]["icon"];

type EmailState =
  | { kind: "checking" }
  | { kind: "sending" }
  | { kind: "sent"; label: string }
  | { kind: "failed" }
  | { kind: "slow" }
  | { kind: "ask"; eligibility: EmailEligibility }
  | { kind: "none"; message: string | null };

const POLL_MS = 2_000;
const POLL_LIMIT_MS = 30_000;

/** Puede enviarse aunque el ingreso no tenga contactos con correo: en el envío se agregan. */
const shouldAsk = (eligibility: EmailEligibility) => eligibility.shouldPrompt
  || (eligibility.mode !== "off" && eligibility.canSend && !eligibility.alreadySent && eligibility.recipients.length === 0
    && (!eligibility.isInternalEntry || eligibility.includeInternalEntries));

/**
 * «¡Ingreso realizado!» al terminar la recepción (como en la web), con el correo al cliente: en automático muestra
 * a quién y cómo se envió; en manual ofrece enviarlo ahora o después desde la ficha.
 */
export function ReceptionDoneModal({ api, contacts, entryId, entryCode, equipmentLabel, onClose }: {
  api: EmailsApi; contacts?: ReturnType<typeof useWorkshopBoard>["intake"]; entryId: number; entryCode: string; equipmentLabel: string | null; onClose: () => void;
}) {
  const [email, setEmail] = useState<EmailState>({ kind: "checking" });
  const [sendOpen, setSendOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const sentLabel = (recipients: string[], provider: string | null, sender: string | null) =>
    `Confirmación enviada a ${recipients.join(", ")}${provider ? ` por ${provider}` : ""}${sender ? ` (${sender})` : ""}.`;

  useEffect(() => {
    if (!api.available) { setEmail({ kind: "none", message: null }); return; }
    const waitForAutomatic = async () => {
      const startedAt = Date.now();
      while (alive.current && Date.now() - startedAt < POLL_LIMIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!alive.current) return;
        const history = await api.history(entryId).catch(() => null);
        const sent = history?.items.find((item) => item.status === "sent");
        if (sent) {
          setEmail({ kind: "sent", label: sentLabel(sent.recipients, sent.provider ? EMAIL_PROVIDER_LABEL[sent.provider] : null, sent.senderEmail) });
          return;
        }
        if ((history?.summary.failed ?? 0) > 0) { setEmail({ kind: "failed" }); return; }
      }
      if (alive.current) setEmail({ kind: "slow" });
    };
    api.eligibility(entryId).then((eligibility) => {
      if (!alive.current) return;
      if (eligibility.mode === "automatic" && eligibility.canAutoSend) { setEmail({ kind: "sending" }); void waitForAutomatic(); }
      else if (shouldAsk(eligibility)) setEmail({ kind: "ask", eligibility });
      else setEmail({ kind: "none", message: eligibility.alreadySent ? "La confirmación al cliente ya se había enviado." : null });
    }, () => { if (alive.current) setEmail({ kind: "none", message: null }); });
  }, [entryId]);

  const emailDetail: { icon: IconName; label: string } | null =
    email.kind === "checking" ? { icon: "mail-outline", label: "Revisando el correo de confirmación…" }
      : email.kind === "sending" ? { icon: "paper-plane-outline", label: "Enviando la confirmación al cliente…" }
        : email.kind === "sent" ? { icon: "mail-open-outline", label: email.label }
          : email.kind === "failed" ? { icon: "alert-circle-outline", label: "No se pudo enviar la confirmación. Puedes enviarla ahora o desde la ficha." }
            : email.kind === "slow" ? { icon: "time-outline", label: "La confirmación se sigue enviando; te llegará una notificación." }
              : email.kind === "ask" ? { icon: "mail-unread-outline", label: email.eligibility.recipients.length > 0
                ? `Puedes avisar al cliente (${email.eligibility.recipients.map((recipient) => recipient.name ?? recipient.email).join(", ")}) con el certificado de ingreso adjunto.`
                : "El ingreso no tiene contactos con correo: al enviar puedes agregar uno." }
                : email.message !== null ? { icon: "mail-outline", label: email.message } : null;

  const canSend = email.kind === "ask" || email.kind === "failed";
  return <>
    <Modal visible={!sendOpen} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <CreationDone busy={false} icon="checkmark-done"
          title="¡Ingreso realizado!"
          code={entryCode}
          subtitle="El equipo quedó recibido y firmado."
          question={canSend ? "¿Enviar la confirmación al cliente?" : null}
          details={[
            ...(equipmentLabel ? [{ icon: "construct-outline" as const, label: equipmentLabel }] : []),
            ...(emailDetail ? [emailDetail] : [])
          ]}
          primary={canSend
            ? { label: "Enviar confirmación", icon: "send", onPress: () => setSendOpen(true) }
            : { label: "Ver ficha del ingreso", icon: "arrow-forward", onPress: onClose }}
          secondary={canSend ? { label: "Enviar después", icon: "time-outline", onPress: onClose } : undefined} />
      </View>
    </Modal>
    {sendOpen ? <EmailSendScreen api={api} contacts={contacts} entryId={entryId} entryCode={entryCode}
      onClose={() => setSendOpen(false)}
      onSent={(result) => {
        setSendOpen(false);
        const sent = result.results.filter((item) => item.status === "sent");
        const first = sent[0];
        setEmail(first ? { kind: "sent", label: sentLabel(sent.map((item) => item.email), first.provider ? EMAIL_PROVIDER_LABEL[first.provider] : null, first.senderEmail) } : { kind: "failed" });
      }} /> : null}
  </>;
}
