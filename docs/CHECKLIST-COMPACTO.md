# Checklist compacto para móvil

## Implementación

- Checklist fuera del `ScrollView` general del detalle. La pregunta o el resumen son el único scroll vertical activo.
- Encabezado abreviado con código TR, estado y acceso a Trabajo. Se mantiene el estado real de conexión y acceso al centro offline; no se repite la empresa ni la ficha técnica.
- Una cabecera de checklist: nombre, posición, volver al catálogo, resumen y progreso confirmado. Sin clave interna ni etiqueta «Complementario». La obligatoriedad sí se conserva cuando aplica o no está informada.
- Pregunta, requisitos y estado de respuesta primero. Sin bloque vacío de respuesta anterior ni campos opcionales abiertos por defecto.
- Comentario opcional accesible mediante botón; si contiene texto se muestra. Historial confirmado desplegable. Archivos siempre accesibles, y evidencia requerida, existente o pendiente siempre señalizada.
- Pie fuera del scroll con flechas de 48 px y Guardar y seguir de al menos 44 px. Navegar conserva borradores, pero no guarda. Guardar sin avanzar y descartar siguen disponibles dentro de la pregunta. El último paso ofrece Guardar respuesta.
- Cada paso remonta el editor y reinicia el desplazamiento. Un fallo local de validación vuelve al inicio; no avanza ni descarta.
- `SafeAreaView` exterior protege todos los bordes. `KeyboardAvoidingView` envuelve cabeceras, pregunta y pie; usa padding en iOS con offset superior seguro. Android conserva su `adjustResize` existente, sin duplicar compensaciones.
- Retorno de archivos conserva checklist/paso mediante el almacén de navegación existente. No se modificaron selección de archivos, validación, upload/delete, comentarios, entrega ni firmas.
- Colores explícitos no vacíos del `RefreshControl` conservados para RN 0.86.
- El progreso usa exclusivamente `checklistFillProgress`. No se modificaron contadores del trabajo ni dominio/aplicación/offline.

Documentación consultada antes de codificar: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) y [safe-area-context SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/).

## Archivos de implementación

- [WorkDetailScreen](../src/screens/WorkDetailScreen.tsx)
- [ChecklistTab](../src/screens/workDetail/ChecklistTab.tsx)
- [StepEditor](../src/screens/workDetail/checklist/StepEditor.tsx)
- [ChecklistCatalog / progreso compacto](../src/screens/workDetail/checklist/ChecklistCatalog.tsx)
- [Estilos del checklist](../src/screens/workDetail/checklist/styles.ts)
- [Estilos del detalle](../src/screens/workDetail/detailStyles.ts)
- [DetailUi / semántica checked y disabled de opciones](../src/screens/workDetail/DetailUi.tsx)

## Validación ejecutada

**17/17 casos UI aislados** y **6/6 contratos focalizados**, sin errores TypeScript en los nueve archivos objetivo. No se ejecutó suite global, lint, build, export ni APK.

Los 17 casos usan WorkDetailScreen, ChecklistTab, StepEditor, FileWorkspace y CommentsTab reales sobre React Native Web: tres anchos 320/360/390 a 640 de alto; borrador y cambio de paso; fallo/reintento; bloqueo durante envío; número/multiselección/aprobación/selección; evidencia requerida; upload/delete/retorno al paso; resumen/último paso; comentarios; cola sin falsa confirmación; solo lectura/vacío; pregunta larga; y tres anchos con viewport reducido a 380 de alto.

La fixture tiene 47 pasos, uno informativo: el total obligatorio proviene del helper canónico, no se fuerza a 47. Todos los callbacks de red son ficticios en memoria. La selección documental produce un TXT sintético. Los límites sustituidos explícitamente son glifos de iconos, gradiente y APIs nativas de archivos/selectores; no hay API, credenciales, SQL ni servicios reales. El informe exige cero peticiones externas y cero errores de página.

Los seis contratos incluyen cinco invariantes estructurales del layout y la regresión existente de colores de RefreshControl. No son seis pruebas nativas.

### Resultados y capturas

- [Informe UI](../artifacts/logs/compact-checklist/ui-results.json)
- [Informe de tipos y contratos](../artifacts/logs/compact-checklist/validation.json)
- [320 × 640](../artifacts/logs/compact-checklist/320-question.png)
- [360 × 640](../artifacts/logs/compact-checklist/360-question.png)
- [390 × 640](../artifacts/logs/compact-checklist/390-question.png)
- [Evidencia requerida](../artifacts/logs/compact-checklist/390-required-evidence.png)
- [Respuesta en cola](../artifacts/logs/compact-checklist/390-queued.png)
- [Viewport reducido 320 × 380](../artifacts/logs/compact-checklist/320-reduced-viewport.png)

### Repetir desde la raíz de Qualitzer-Mobile (PowerShell)

```powershell
& '.\node_modules\node\bin\node.exe' 'tests/e2e/compact-checklist-smoke.cjs'
& '.\node_modules\node\bin\node.exe' 'tests/e2e/compact-checklist-validation.cjs'
```

El smoke escribe informe/capturas en una carpeta temporal única e imprime la ruta. Para copiar la evidencia de esa corrida al directorio de artefactos, pasar dicha ruta como único argumento al validador. Los resultados de tipos son diagnósticos de archivos objetivo, no un typecheck global del proyecto.

### Inspección manual en el navegador principal

```powershell
& '.\node_modules\node\bin\node.exe' 'tests/e2e/compact-checklist-smoke.cjs' --serve
```

Abrir la URL loopback que imprime. No usa Metro ni gateway, no lee sesiones reales. Se detiene con Ctrl+C. Abrir el checklist; probar Resumen → paso 7 para evidencia, paso 47 para límite, flechas para navegar sin guardar y Trabajo para archivos/comentarios generales. Desde consola de **esa fixture únicamente**:

```javascript
window.compactChecklist.render('long'); // También: standard, readonly, empty
window.compactChecklist.mode = 'queue'; // También: save, fail, hold
```

La fixture `--serve` es web y no debe presentarse como ejecución nativa.

## Integración Android y comprobaciones pendientes

Los cambios se integraron en la APK **1.0.3 / código 4**, instalada como actualización en el emulador API 36 sin borrar datos. Se verificaron el formulario compacto, navegación, dos respuestas demo guardadas y el contador 2/4 coincidente con la tarjeta. Se escribió un comentario en el campo real con Gboard flotante y se guardó desde el pie. Esto no acredita el ajuste con teclado acoplado ni el comportamiento Samsung; tampoco se probaron cámara o firmas físicas. [Evidencia nativa y límites](../artifacts/logs/native-release-1.0.3/compact-native/SUMMARY.md).

Para ampliar la verificación en teléfonos autorizados:

1. Abrir checklist de 47 pasos a 320/360/390 dp y altura 640 dp; comprobar pregunta visible y pie sobre navegación gestual/tres botones.
2. En texto/número/comentario, abrir teclado, escribir varias líneas, desplazar para ver la respuesta completa y pulsar Guardar sin cerrar el teclado. Verificar que pie y campo enfocado siguen alcanzables. Repetir con fuente ampliada y pregunta larga.
3. Ir al resumen, saltar al paso 47, volver y entrar/salir de archivos: no perder borrador ni posición, y reiniciar el scroll al cambiar de pregunta.
4. Probar cámara/galería/documento, cancelar selector, guardar y eliminar archivo confirmado; cortar red solo en datos de prueba para comprobar marcas de cola y bloqueo de eliminación.
5. Verificar lector de pantalla para títulos, requeridos, Sí/No, estados, flechas, resumen y errores; comprobar controles de al menos 44 dp.
6. Regresar a Trabajo y realizar el flujo autorizado de entrega/firma. Las firmas no se tocaron ni se probaron en esta tarea.

La altura reducida web demuestra que el pie conserva su posición y puede guardar con foco en texto; **no demuestra ajuste del teclado, IME, cámara, firma ni accesibilidad física nativa**. No se afirma resolución en el teléfono del usuario hasta completar esa comprobación.