import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { checklistFillProgress } from "../../../domain/checklistProgress";
import { plainText } from "../../../domain/format";
import type { Checklist } from "../../../domain/models";
import { Badge, BodyText, Card } from "../../../ui/components";
import { palette } from "../../../ui/theme";
import { styles } from "../detailStyles";
import type { WorkDraft } from "../useWorkDraft";
import { checklistStyles } from "./styles";

export function ChecklistProgress({ checklist }: { checklist: Checklist }) {
  const progress = checklistFillProgress(checklist.steps);
  if (checklist.steps.length === 0) return <BodyText>No se recibieron pasos. No se puede verificar este checklist.</BodyText>;
  if (progress.total === 0) return <BodyText>Sin respuestas obligatorias computables · {checklist.steps.length} pasos informativos u opcionales.</BodyText>;
  return (
    <View style={styles.tight}>
      <Text style={styles.caption}>{progress.completed} de {progress.total} respuestas obligatorias con requisitos confirmados · {progress.percentage}%</Text>
      <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityLabel={`Progreso confirmado de ${plainText(checklist.name)}`} accessibilityValue={{ min: 0, max: progress.total, now: progress.completed }}>
        <View style={[styles.progressFill, { width: `${progress.percentage}%` }]} />
      </View>
    </View>
  );
}

export function ChecklistCatalog({ checklists, draft, onOpen }: { checklists: Checklist[]; draft: WorkDraft; onOpen: (checklist: Checklist) => void }) {
  return (
    <View style={checklistStyles.catalog}>
      {checklists.map((checklist) => {
        const drafts = checklist.steps.filter((step) => draft.answers[String(step.stepId)]?.saved === false).length;
        const name = plainText(checklist.name) || "Checklist sin nombre";
        return (
          <Pressable key={checklist.checklistId} onPress={() => onOpen(checklist)} accessibilityRole="button" accessibilityLabel={`Abrir ${plainText(checklist.code)}: ${name}`} style={({ pressed }) => pressed && checklistStyles.pressed}>
            <Card style={checklistStyles.catalogCard}>
              <View style={checklistStyles.cardHeading}>
                <View style={checklistStyles.cardIcon}><Ionicons name="list-outline" size={24} color={palette.primary} accessible={false} /></View>
                <View style={[styles.grow, styles.tight]}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={checklistStyles.code}>{plainText(checklist.code) || "Sin código"}</Text>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={checklistStyles.name}>{name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={palette.textMuted} accessible={false} />
              </View>
              <View style={styles.row}>
                <Badge label={checklist.required === true ? "Checklist obligatorio" : checklist.required === false ? "Complementario" : "Obligatoriedad no informada"} tone={checklist.required === true ? "warning" : "neutral"} />
                <Badge label={`${checklist.steps.length} pasos`} />
                {drafts > 0 ? <Badge label={`${drafts} en borrador`} tone="warning" /> : null}
              </View>
              <ChecklistProgress checklist={checklist} />
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}