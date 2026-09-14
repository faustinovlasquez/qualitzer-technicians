# Progreso confirmado de checklist — 2026-09-11

## Causa comprobada en código

- [AssignmentWorkCard](../src/screens/orders/AssignmentWorkCard.tsx) muestra directamente `work.checklistDone/checklistTotal`. [ChecklistCatalog](../src/screens/workDetail/checklist/ChecklistCatalog.tsx) calcula las respuestas obligatorias con `checklistFillProgress`. No eran la misma métrica.
- [Contratos del gateway](../server/contracts.ts) conservan ambos contadores recibidos y las respuestas por tipo; no recalculan el progreso. El payload sintético reproduce `0/47` con siete respuestas válidas, un paso informativo y un paso respondido sin evidencia obligatoria.
- Inspección de solo lectura del backend: la proyección de mantenimiento cuenta `step.isCompleted === true`, mientras `mapAssignmentStep` coloca respuestas no booleanas en `selectValue`, `optionsSelectValue` o `responseValue`. La proyección de actividades estándar usa otro contador de respuestas y también suma todos los pasos al denominador. No se modificó el backend ni se afirma haber consultado el payload real del teléfono.
- [mergeDailyAssignments](../src/domain/assignmentSchedule.ts) priorizaba el snapshot de la fecha exacta incluso ante una copia posterior del mismo trabajo/fecha con checklist más reciente. Se conserva esa prioridad para tiempos y estado, pero no para las respuestas del checklist.
- El hook delegaba el refresco tras responder a la pantalla; ahora el guardado confirmado refresca dentro de la acción, invalidando lecturas anteriores. El repositorio offline además impedirá que un GET con `generatedAt` anterior sustituya la caché más reciente de la misma fecha, sucursal y trabajador.

## Implementación

1. [assignmentChecklistProgress](../src/domain/assignmentChecklistProgress.ts): exporta `workChecklistProgress(work)` con `{completed, total, remaining, percentage}`. Reutiliza `checklistFillProgress`, incluye todos los formularios asociados al trabajo, incluso complementarios, y excluye archivos locales/no confirmados de la evidencia computable. También exporta `normalizeWorkChecklistProgress` y `normalizeAssignmentsChecklistProgress`.
2. [assignmentSchedule](../src/domain/assignmentSchedule.ts): normaliza trabajos y sus snapshots diarios; una copia posterior del mismo trabajo y fecha puede actualizar exclusivamente su checklist. No une trabajos por título, equipo ni ID sin su grupo.
3. [useTechnicianApp](../src/application/useTechnicianApp.ts): normaliza asignaciones antes de publicarlas y refresca después de `saveAnswer` confirmado, antes de liberar la acción. `OfflineQueuedError` se propaga sin transformación ni incremento optimista. Si falla el refresco tras confirmar, conserva la última ficha y muestra una advertencia sin pedir repetir el envío.
4. [OfflineTechnicianRepository](../src/offline/OfflineTechnicianRepository.ts): la escritura atómica de caché de asignaciones conserva una respuesta más reciente frente a otra tardía. No cambia respuestas, UUID, wire/base, recibos, estados de cola ni su protocolo.

## Semántica

- 47 pasos del wizard no equivalen a 47 respuestas obligatorias. La regresión `EQUIPMENT_DISPATCH_CHECKLIST_1`, complementaria, tiene **47 pasos / 46 computables / 7 confirmados / 15%**.
- `false`, `0`, `NC`, rechazo y «No aplica» son respuestas según el criterio canónico; el conteo no significa aprobación técnica.
- Los textos informativos y campos explícitamente opcionales no aumentan el denominador. Una observación sin respuesta no completa un paso obligatorio.
- Una respuesta parcial sin archivo obligatorio confirmado no incrementa el progreso. Al confirmar la evidencia se aplica el criterio existente del wizard, sin añadir una regla nueva basada únicamente en `executionStatus` ni inventar campos de comentario obligatorio que no existen en el contrato móvil.
- Pendientes: **7/46**. Recibo aplicado sin snapshot actualizado: **7/46**. Snapshot con la octava respuesta: **8/46, 17%**, conservado al restaurar offline. Nunca sumar operaciones de cola al numerador.
- Dos formularios del mismo trabajo se agregan, sin crear tarjetas espejo: el caso de prueba devuelve **8/48** y exactamente **un trabajo**.

## Integración para el agente de UI

- No se editaron Dashboard, AssignmentWorkCard, WorkDetailScreen, componentes de checklist, App ni Profile.
- La tarjeta existente ya recibe `checklistDone/checklistTotal` normalizados; **no necesita un hunk de UI para corregir sus cifras**.
- Para nuevos resúmenes de detalle, importar `workChecklistProgress` desde el dominio y pasar el trabajo confirmado, no respuestas de borrador ni overlays de pendientes. Mantener `checklistFillProgress(checklist.steps)` para cada formulario, usando evidencia confirmada como ya hace el detalle.
- Separar visualmente «paso 9/47» de «7/46 respuestas confirmadas». «Complementario» afecta la obligatoriedad del formulario para entregar, no excluye sus respuestas del progreso de llenado.
- `saveAnswer` del hook ya realiza el refresco confirmado. El refresco adicional actual de la pantalla sigue siendo compatible; no es necesario modificarlo para integrar esta corrección. Mantener el aviso de pendientes y el bloqueo de entregas existente.

## Validación ejecutada

- **142 pruebas aprobadas, 0 fallos, 0 omitidas**, secuenciales; **17 regresiones nuevas**.
- **0 diagnósticos TypeScript** en los cuatro archivos runtime afectados y los nuevos archivos de prueba/fixture, con tipos Node y React explícitos.
- [Pruebas de dominio](../tests/assignment-checklist-progress.test.ts): 8; [hook real con dependencias simuladas](../tests/assignment-checklist-hook.test.ts): 4; [repositorio y cola en memoria](../src/offline/tests/checklist-progress.test.ts): 5.
- [Payload representativo](../tests/helpers/assignment-checklist.ts) y [validador acotado](../scripts/testing/checklist-progress-validation.cjs). El validador guarda `report.json`, `tests.log` y `types.log` bajo la carpeta temporal `qualitzer-checklist-progress-47952073` del sistema.
- Ejecución final: 2026-09-11 12:45:27–12:45:32 UTC, Node 22.23.2. Se verificó el informe persistido, no la salida de otro agente en el terminal compartido.
- Sin pruebas en teléfono físico, login real, escrituras operativas, validaciones globales del backend, build de APK, export, cambio de versión ni empaquetado.

## Despliegue

**No requiere nueva pasarela ni paquete del gateway por esta corrección.** Los cambios runtime son exclusivamente del cliente móvil y ya se integraron en la APK **1.0.3 / código 4**. La revisión nativa con datos demo confirmó dos respuestas guardadas y **2/4** tanto en wizard como en tarjeta; no se consultó la cuenta real. Entrega y límites: [ACTUALIZACION-1.0.3.md](ACTUALIZACION-1.0.3.md).