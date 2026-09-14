# Archivos compactos y selección múltiple

Implementación móvil en fuentes, 11 de septiembre de 2026. No se generó otro APK ni se cambió la versión 1.0.3.

## Uso

- Abrir **Adjuntar al paso** muestra una sola cabecera con el nombre del paso.
- **Cámara** captura una foto por apertura; repetir añade otra, sin reemplazar las anteriores.
- **Galería** selecciona varias imágenes. **Archivos** permite mezclar imágenes, PDF y documentos admitidos en una selección.
- Cada lote se añade al borrador del mismo destino. No existe la restricción de un adjunto por pregunta.
- **Checklist**, en la cabecera, vuelve a la misma pregunta y conserva su respuesta y los archivos sin guardar. El icono de carpeta abre los archivos del trabajo, en un borrador separado.
- Cámara/Galería/Archivos tienen altura mínima de 48 px; las otras acciones principales, al menos 44 px.
- Sólo se desplaza la lista. El botón **Guardar archivos · N** permanece debajo de ella. Archivos del trabajo también usa el contenedor compacto, sin hero ni ScrollView general envolvente.
- Los detalles de formatos, almacenamiento y conexión están en **Ayuda de archivos y límites**. Se conservan avisos de error, sesión, carga de cola y evidencia obligatoria.
- Seleccionar no equivale a guardar. La confirmación sigue siendo explícita.

## Límites exactos

| Concepto | Límite |
|---|---|
| Archivo individual | 25 MiB = 26.214.400 bytes |
| Borrador de un destino | 40 MiB = 41.943.040 bytes |
| Cantidad simultánea en un borrador | 100 archivos, antes 4 |
| Reservas de archivos de la cola durable | 500 MiB = 524.288.000 bytes globales, sin modificación |
| Cámara | Una captura por apertura, acumulable |

Los límites de cantidad y bytes se aplican conjuntamente: por ejemplo, dos archivos de 25 MiB no caben en un borrador de 40 MiB. Se pueden guardar los archivos y preparar otro lote; no hay un máximo nuevo de adjuntos confirmados por paso. No se eliminan pendientes de la cola para liberar espacio.

Los 40 MiB son por borrador/destino. La cuota durable de 500 MiB se comprueba al transferir cada archivo a la cola y cuenta sus reservas existentes. No es una nueva cuota combinada de todos los borradores, cachés del selector y copias de la cola. Durante la transferencia puede existir una copia original y otra propiedad de la cola; el almacenamiento disponible del dispositivo también puede limitar el guardado.

El selector conserva la lista de formatos existente: JPEG, PNG, WebP, HEIC/HEIF, GIF, BMP, AVIF, PDF, DOCX, XLSX, TXT y CSV. Esto **no amplía la compatibilidad del servidor**: sus validaciones de contenido siguen vigentes; HEIC no es aceptado por la ruta durable actual. Para evidencia de pasos se recomienda JPEG/PNG o PDF compatible. No se convierte ni comprime la imagen ni se solicitan datos base64. SVG, ejecutables y macros no se habilitan.

## Protección del lote

1. Se valida el nombre, MIME y tamaño real de **todos** los seleccionados y el total acumulado antes de incorporar el lote.
2. En nativo se copian secuencialmente a la carpeta propia del borrador y se persisten sus metadatos antes de habilitar Guardar. Un fallo al preparar el lote no sustituye los archivos anteriores.
3. En web, el borrador previo al guardado sólo permanece en memoria durante esa sesión. El aviso de pérdida al recargar sigue visible; no se afirma persistencia previa al guardado.
4. El envío usa una llamada por archivo, secuencial, manteniendo su `LocalPhoto.id`. No se añaden envíos paralelos ni un nuevo mecanismo de reintentos.
5. El repositorio durable existente usa ese `sourceDraftId`, namespace y destino para recuperar la misma operación. Sus UUID, huellas, payloads y recibos exactos permanecen sin cambios.
6. Sólo después de resolución confirmada o `OfflineQueuedError` de documento con `ownsFiles: true` se marca y limpia el borrador original. La copia propiedad de la cola no se elimina desde esta pantalla.
7. Si falla el segundo archivo de tres, el primero ya transferido no se reenvía; el segundo y el tercero conservan identidad y datos. Guardar de nuevo procesa sólo los restantes. Si falla la limpieza, el marcador local impide incluir los ya transferidos en el siguiente envío.
8. Salir de la pantalla o cambiar el recurso durante un envío detiene el resto del lote. La operación en curso puede terminar; sus restantes no se redirigen al nuevo destino.
9. Cancelar el selector no vacía el borrador. La cancelación manual web invalida resultados tardíos del selector.

**Sin guardar**, **en cola** y **confirmados** se muestran por separado. En cola no satisface evidencia obligatoria ni progreso confirmado. Los bloqueos de autenticación y los estados de revisión no se reinician desde esta UX.

## Alcance e integración

- Cambios en [WorkDetailScreen](../src/screens/WorkDetailScreen.tsx), [FileWorkspace](../src/screens/workDetail/FileWorkspace.tsx) y sus helpers/componentes de archivos.
- [saveFileBatch](../src/screens/workDetail/files/saveFileBatch.ts) concentra el recorrido secuencial, no el transporte ni los recibos.
- `compact`, `headerAction`, `requirement`, `notices` y `listFooter` son props opcionales. El consumidor de OT mantiene su API previa; no se editó OrderDetailScreen.
- Los borradores legacy de fotos siguen disponibles en su panel anterior. Sus límites históricos de cuatro fotos/40 MiB y su almacenamiento no se migraron ni borraron. Las nuevas selecciones normales usan el workspace de archivos.
- No se editaron ChecklistTab, StepEditor, helpers de navegación, Login, App, comentarios, firmas, backend, migraciones, variables de entorno, cola ni protocolo.
- `RefreshControl` conserva `colors={[palette.primary]}`, `tintColor` y `progressBackgroundColor`, evitando la regresión nativa RN 0.86 de colores vacíos.
- Para integrar los E2E compartidos, el antiguo botón **Documento** ahora se llama **Archivos**; el retorno visible dice **Checklist** y mantiene el nombre accesible **Volver al checklist**. No se modificaron los E2E del agente de navegación; los nuevos escenarios viven en archivos independientes.

## Validación focalizada

Ejecutor: [compact-files-validation.cjs](../scripts/testing/compact-files-validation.cjs). Informes y capturas en artifacts/logs/compact-files, separados por fecha. Sólo ejecuta:

- 13 pruebas nuevas de lotes, límites exactos, append de 3+3, IDs distintos, cancelación, copia/restauración nativa simulada, fallo parcial, reintento, limpieza fallida y cambio de destino.
- 133 regresiones existentes de repositorio durable, engine, huellas de archivos y protección de RefreshControl.
- TypeScript del grafo de nueve fuentes/fixture propios; sin diagnósticos en la ejecución verificada.
- 12 comprobaciones RN Web/Edge aisladas con WorkDetailScreen/FileWorkspace reales y callbacks/selectores ficticios.

Las pruebas visuales incluyen 320/360/390 × 480 y × 380, lista de 32 archivos, controles dentro del viewport y sin ancestro con scroll, lote mixto PNG/PDF/fotos, segundo lote, cámara repetida, cancelación, retorno con respuesta intacta, separación de destinos, exceso de tamaño, fallo parcial con reintento, cola sin confirmar y sesión rechazada. Los intentos de cargar imágenes del dominio ficticio se bloquean; no se usan cuentas ni endpoints de negocio reales.

Resultado final verificado: **146/146 pruebas focalizadas, 12/12 comprobaciones UI, 0 diagnósticos TypeScript**, ejecución 2026-09-11T14-30-13-452Z. Sin suite completa, lint, export ni APK.

Integración adicional: **5/5 pruebas existentes de compact-checklist-layout** ejecutadas correctamente después de colocar la rama de archivos antes de la rama original del checklist. Se resolvió la incompatibilidad de su aserción estructural sin editar el test ni el código de navegación. Total de pruebas focalizadas: **151/151**, además de las 12 comprobaciones UI.

- [Informe final](../artifacts/logs/compact-files/2026-09-11T14-30-13-452Z/validation.json)
- [Lote mixto a 390 px](../artifacts/logs/compact-files/2026-09-11T14-30-13-452Z/390-mixed-batch.png)
- [Controles visibles a 320 × 380](../artifacts/logs/compact-files/2026-09-11T14-30-13-452Z/320-low-viewport.png)
- [En cola, sin evidencia confirmada](../artifacts/logs/compact-files/2026-09-11T14-30-13-452Z/390-queued-unconfirmed.png)

Las capturas usan RN Web, iconos decorativos simplificados y archivos sintéticos; no son capturas del APK. La tarea temporal de validación se retiró sin modificar las tareas existentes.

Previsualización reproducible: el smoke [compact-files-smoke.cjs](../tests/e2e/compact-files-smoke.cjs) admite `--serve` y abre únicamente un servidor local efímero con el fixture, sin Metro ni API.

## Pendiente en dispositivo nativo

- Selector múltiple real de Android/Samsung e iOS, permisos denegados/limitados y cancelación del proveedor de documentos.
- Capturas repetidas con cámara real, JPEG/HEIC de cada dispositivo y PDF procedente de almacenamiento externo.
- Destrucción de MainActivity al volver del picker, cierre forzado/reinicio del teléfono, poco espacio y recuperación de borradores con bytes reales.
- Persistencia física SQLite/FileSystem, interrupción de transporte y recibo del servidor real, sin duplicados tras reabrir.
- Safe areas, tamaños de letra del sistema, lector de pantalla y teclado nativo. Los viewports web reducidos no prueban teclado ni layout OEM.
- Estas fuentes todavía deben incorporarse a un futuro APK autorizado. El APK publicado 1.0.3 no se recompiló en esta tarea.