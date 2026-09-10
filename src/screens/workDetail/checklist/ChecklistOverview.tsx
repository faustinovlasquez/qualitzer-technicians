import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { plainText } from "../../../domain/format";
import type { ChecklistStep } from "../../../domain/models";
import { Badge, BodyText, Button, Field, SectionTitle } from "../../../ui/components";
import { styles } from "../detailStyles";
import type { WorkDraft } from "../useWorkDraft";
import { checklistStepStatus } from "./checklistPresentation";
import { checklistStyles } from "./styles";

const PAGE_SIZE = 20;

export function ChecklistOverview({ steps, stepId, draft, onJump }: { steps: ChecklistStep[]; stepId: string | undefined; draft: WorkDraft; onJump: (stepId: string) => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(() => Math.floor(Math.max(0, steps.findIndex((step) => String(step.stepId) === stepId)) / PAGE_SIZE));
  const query = search.trim().toLocaleLowerCase("es");
  const matches = steps.map((step, index) => ({ step, number: index + 1 })).filter(({ step, number }) => `${number} ${plainText(step.title)} ${plainText(step.tag)}`.toLocaleLowerCase("es").includes(query));
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  return (
    <View style={styles.stack}>
      <SectionTitle title="Resumen de pasos" subtitle="Elige cualquier paso. Navegar no guarda ni descarta respuestas." />
      <Field label="Buscar paso" placeholder="Número, título o etiqueta" value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} />
      {matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(({ step, number }) => {
        const status = checklistStepStatus(step);
        const dirty = draft.answers[String(step.stepId)]?.saved === false;
        const selected = String(step.stepId) === stepId;
        return (
          <Pressable key={String(step.stepId)} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Paso ${number}: ${plainText(step.title)}. ${status.label}${dirty ? ". Borrador pendiente" : ""}`} onPress={() => onJump(String(step.stepId))} style={({ pressed }) => [checklistStyles.stepRow, selected && checklistStyles.selectedRow, pressed && checklistStyles.pressed]}>
            <View style={styles.stepNumber}><Text style={styles.label}>{number}</Text></View>
            <View style={[styles.grow, styles.tight]}>
              <Text numberOfLines={2} style={styles.label}>{plainText(step.title) || "Paso sin título"}</Text>
              <View style={styles.row}><Badge {...status} />{dirty ? <Badge label="Borrador" tone="warning" /> : null}</View>
            </View>
          </Pressable>
        );
      })}
      {matches.length === 0 ? <BodyText>No se encontraron pasos con esa búsqueda.</BodyText> : <Text style={styles.caption}>{matches.length} pasos · página {currentPage + 1} de {pages}</Text>}
      {pages > 1 ? <View style={checklistStyles.navigation}>
        <Button title="Página anterior" variant="secondary" style={checklistStyles.navigationButton} disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} />
        <Button title="Página siguiente" variant="secondary" style={checklistStyles.navigationButton} disabled={currentPage + 1 >= pages} onPress={() => setPage(currentPage + 1)} />
      </View> : null}
    </View>
  );
}