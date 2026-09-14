# Reanudar navegación del checklist

Implementación móvil del 11 de septiembre de 2026. Cambios de fuente, **sin generar APK ni cambiar versiones**. Leídos AGENTS.md y la documentación de Expo SDK 57 antes de modificar código.

## Causa

- `ChecklistTab.open` proponía el primer paso ordenado, sin consultar respuestas ni evidencia.
- `ChecklistNavigationStore.open` priorizaba `stepIds[checklistId]` sobre ese primer paso. La posición guardada era solamente la última visita, no un punto de continuación.
- La hidratación restauraba directamente `checklistId` y `stepIds`. Una selección antigua en el paso 1 podía abrirse automáticamente allí, aunque hubiera 20 respuestas confirmadas.
- Por tanto, no era simplemente «siempre abrir el primero»: había tanto un fallback al primero como una restauración de una posición antigua, sin resolución del pendiente.

## Prioridad y comportamiento

| Entrada o evento | Resultado |
| --- | --- |
| Abrir explícitamente una lista desde el catálogo | Primer paso pendiente relevante, ordenado por `order`; prevalece sobre la última visita |
| 20 primeros pasos confirmados de 47 | Abre el paso 21 |
| Existe un hueco anterior | Abre el primer hueco, aunque haya respuestas posteriores |
| Respuesta confirmada pero evidencia obligatoria ausente | Abre ese paso y muestra aviso de evidencia faltante, sin pedir repetir la respuesta |
| No quedan pendientes relevantes | Resumen; no fuerza el paso 1 ni afirma entrega/aprobación |
| Resumen | Permite escoger y responder cualquier paso, incluidos opcionales e informativos, sujeto a los permisos existentes |
| Respuesta en cola en el paso elegido | Sigue pendiente de confirmación; conserva «En cola» y el bloqueo contra reenvío de esa versión; permite avanzar sin guardar |
| Editar, guardar o recibir un refresh mientras se responde | No recalcula la posición activa ni salta automáticamente |
| Ir a Archivos y volver durante la sesión | Conserva exactamente el paso actual, incluso si su evidencia se confirmó al volver |
| Cerrar/reabrir el detalle dentro del mismo proceso | Conserva la navegación activa en memoria; abrir desde el catálogo vuelve a resolver el primer pendiente |
| Reiniciar el proceso con selección persistida válida | Autoabre esa misma lista, resolviendo una sola vez su primer pendiente con la ficha recibida; un antiguo paso 1 no manda |
| Reiniciar con catálogo guardado (`checklistId: null`) | Permanece en catálogo; no elige otra lista automáticamente |
| Checklist guardado ausente | Conserva la selección y muestra aviso; no cambia a otro checklist. Puede resolverlo si vuelve a aparecer antes de otra navegación explícita |
| Paso guardado inexistente al restaurar en frío | Se resuelve el primer pendiente de la misma lista |
| Paso activo eliminado por un refresh | Muestra resumen y aviso, conservando el borrador, sin saltar a otro paso |
| Almacenamiento inválido o ilegible | Aviso; permite navegación en memoria sin sobrescribir el contenido que no pudo recuperar |

La resolución se realiza con la ficha disponible, que puede ser caché offline. No realiza peticiones nuevas ni supone que la caché es información recién confirmada por el servidor.

## Criterio canónico, sin modificar el progreso

El helper nuevo `checklistResumeTarget` utiliza `isChecklistStepProgressRelevant`, `hasChecklistStepAnswer` y `workChecklistProgress` para cada paso candidato. Reutiliza así el filtrado de evidencia confirmada existente, sin duplicarlo ni editar los helpers de progreso.

- `false` de validación, `"0"` numérico, NC, rechazo y No aplica son respuestas, no ausencia de respuesta ni necesariamente aprobación.
- Archivos locales o marcados como no confirmados no satisfacen evidencia requerida.
- Los borradores y las operaciones en cola no se convierten en progreso confirmado.
- Los pasos informativos y explícitamente opcionales no desplazan el primer pendiente relevante. Permanecen accesibles en resumen y con las flechas; sus requisitos de guardado/entrega no se modifican.
- Un checklist complementario puede contener pasos relevantes: no se excluye toda la lista porque `checklist.required` sea falso.
- Una lista vacía conserva el estado «Sin pasos disponibles», sin inventar 100 %.

## Persistencia y alcance

Se conserva exactamente la clave `@qualitzer/checklist-navigation/v1/<scope codificado>` y su formato `{ checklistId, stepIds }`. El scope sigue usando la identidad de borrador proporcionada por el padre, modo, tipo de mantenimiento y trabajo. No se cambian namespaces de empresa, usuario, sucursal, grupo ni trabajo.

`ready` y `needsResume` son flags transitorios del store de navegación: no se persisten. La restauración espera la lectura de posición y no muestra fugazmente el paso antiguo antes de resolverla. La revisión del store protege las acciones explícitas frente a una hidratación tardía.

Solo se escriben posiciones de navegación. No se modifican respuestas, borradores, reportes, fotos, UUID, payloads, recibos, outbox, archivos privados ni claves de sesión. Cuando no hay pendiente se quita únicamente el stepId de la lista abierta, conservando las posiciones de otras listas.

## Archivos propios

- [ChecklistTab](../src/screens/workDetail/ChecklistTab.tsx): apertura, espera de restauración, resumen y aviso de evidencia.
- [useChecklistNavigation](../src/screens/workDetail/checklist/useChecklistNavigation.ts): resolución de apertura y restauración en frío una sola vez.
- [checklistResume](../src/domain/checklistResume.ts): helper puro específico de reanudación.
- [Pruebas de dominio](../tests/checklist-resume.test.ts), [navegación](../tests/checklist-resume-navigation.test.ts) y [componentes](../tests/checklist-resume-ui.test.ts).
- [Validador acotado](../tests/checklist-resume-validation.cjs): genera logs y reporte en una carpeta temporal nueva, sin modificar fixtures compartidas.

No se editaron WorkDetailScreen, FileWorkspace, estilos, helpers existentes de progreso, suites/e2e compartidas, backend, frontend ni servidor móvil en esta tarea.

## Validación y límites

- **27 pruebas nuevas pasan**: 9 de dominio, 12 del hook real de navegación y 6 de componentes reales cargados en VM.
- Las pruebas de componentes ejercitan ChecklistTab, StepEditor, ChecklistOverview y displayedAnswer. Simulan primitivas nativas y AsyncStorage; no son una prueba visual ni de dispositivo Android.
- **TypeScript: 0 diagnósticos en los seis archivos TypeScript de este alcance**, incluidos los tests. No es un chequeo global de toda la aplicación.
- El validador por defecto selecciona 8 archivos: las 27 pruebas nuevas más regresiones de progreso, publicación del hook, caché offline y deduplicación/presentación de cola. No ejecuta toda la suite.
- Ejecución final del 11/09 a las 14:24 UTC: **78/78 correctos, 0 fallos, 0 omitidos; tipos 0 diagnósticos**. Reporte temporal `qualitzer-checklist-resume-hpSd45/report.json` y logs de esa ejecución.
- La opción `--include-layout` añade la prueba estructural compartida de layout. En la ejecución conjunta de 83 casos del 11/09 a las 14:22 UTC hubo **82 correctos y 1 fallo externo**: `checklist route is separate from parent scroll and inside keyboard/safe-area host` busca literalmente `} /> : <ScrollView`. El otro agente añadió el caso intermedio `tab === "evidence" ? evidenceContent` en WorkDetailScreen. Se deja a integración actualizar esa aserción sin debilitar la separación de scroll. No se cambió el test compartido.
- Sin suite global, APK, export, cambios de versión, despliegue, reinicio de servidores ni escrituras de negocio reales.

La prueba de APK instalado y teléfono físico queda pendiente del empaquetado e integración principal.