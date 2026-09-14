# Qualitzer técnicos 1.0.4 — continuar y adjuntar

## Instalación

Versión Android **1.0.4 / código 5**. Instalar mediante **Actualizar**, sobre la app existente. Se conserva `com.qualitzer.field`, la firma y los datos. **No desinstalar, borrar caché/datos ni eliminar pendientes.** No requiere cambios adicionales del servidor ni un gateway nuevo.

APK final verificado y publicado: **68.887.058 bytes**, SHA-256 `5c0fee034a794679095c5167aaf6d08163d69d4b12caa0db69eaa4f6be38db61`. Misma firma que 1.0.3 y sin permisos añadidos. Se entrega el mismo binario instalado en el emulador, no la primera compilación de diagnóstico.

## Continuar el checklist

Al abrir una lista desde el catálogo o restaurarla tras reiniciar la app, se elige el primer paso obligatorio pendiente según respuestas y evidencia confirmadas. Con los primeros 20 completos, abre el 21; si hay un hueco anterior, abre ese. Una respuesta sin la evidencia requerida se mantiene pendiente sin pedir responderla de nuevo.

Las flechas y el resumen permiten revisar cualquier pregunta. No se cambia de paso por un refresco mientras se responde, ni al volver de Archivos. Cerrar y reabrir el detalle dentro de la misma sesión conserva la posición activa; volver a abrir la lista desde el catálogo busca el primer pendiente. Si todo está completo, se muestra el resumen, sin afirmar que el trabajo esté entregado. Borradores y respuestas en cola se conservan y no se cuentan como confirmados.

## Archivos más simples

- **Cámara**, **Galería** y **Archivos** siempre visibles; el botón de guardar queda fijo abajo. Sólo desplaza la lista.
- Galería permite varias imágenes. Archivos permite varios documentos e imágenes compatibles en una selección, incluidos PDF. La cámara añade una captura cada vez; repetir acumula fotos.
- Cada selección se añade al lote anterior del mismo paso. No hay un límite de un adjunto por pregunta.
- **Checklist** vuelve al paso sin perder su respuesta ni el lote pendiente. Los archivos generales del trabajo tienen un destino separado.
- Se retiraron encabezados repetidos y explicaciones extensas de la vista principal; límites y ayuda están en el botón de información. Errores y estados de envío siguen visibles.
- Guardado secuencial por archivo. Si falla parte del lote, los restantes se conservan y no se vuelven a enviar los ya transferidos. En cola no equivale a confirmado.

### Límites conservados y ampliación de cantidad

Hasta **100 archivos por borrador**, **25 MiB por archivo**, **40 MiB por lote/destino** y cuota durable global de **500 MiB**. Tras guardar un lote se puede añadir otro; no se limita a 100 el historial de adjuntos confirmados del paso. No se eliminan pendientes para liberar espacio. Los formatos siguen sujetos a la validación existente del servidor; HEIC/HEIF no se amplía como formato compatible de la cola de evidencias.

## Login de usuario

La APK no muestra «Pasarela en uso», la URL, «Comprobar conexión», configuración avanzada ni QR técnico. Conserva usuario, contraseña, errores comprensibles, sesión recordada y demostración. Las comprobaciones internas de conexión y autenticación permanecen activas. Las herramientas técnicas sólo se montan en una compilación de desarrollo con conexión desbloqueada.

## Validación y límites

- Pruebas de reanudación: 20/47 → 21, primer hueco, evidencia faltante, restauración fría, resumen y retorno desde archivos; 78 aprobadas, incluidas 27 nuevas.
- Archivos: lotes mixtos, añadir otro lote, cancelación, fallo parcial, conservación de identidad y pendientes; 151 pruebas focalizadas y 12 casos UI. Login: 27 pruebas focalizadas y 18 UI. Son grupos solapados, no se suman como casos únicos.
- Validación final tras reiniciar VS Code: **894 aprobadas y una omitida por plataforma**, más 13 pruebas CJS de archivos y cuatro de assets. Cero fallos; tipos app/servidor/app con tests sin errores. Las 35 fuentes críticas y 138 fuentes propias del mapa coinciden con el APK. [Cierre final](../artifacts/logs/release-1.0.4-validation/SUMMARY-AFTER-RESTART.md).
- Android API 36: login sin controles técnicos; selección múltiple real mediante DocumentsUI, regreso con dos archivos seleccionados; acciones fijas durante scroll y retorno al mismo paso. No se usaron credenciales ni datos reales del técnico.
- La prueba inicial en demo transfirió archivos a revisión por un recibo demo sin ID de archivo: **no acredita una carga confirmada en el servidor real**. No se reenvió ni alteró esa cola. Se corrigió la etiqueta del listado demo para no presentarlo como confirmación de esos envíos y se reforzó la clasificación de metadata de evidencia inválida.
- El PNG sintético de esa primera prueba era inválido; su fallo de miniatura no demuestra un defecto de la app. No se sustituyeron los bytes del pendiente. La reanudación de 20 respuestas fue verificada en pruebas automatizadas, no con la cuenta del Samsung.
- La comprobación final se repitió con un PNG válido: PDF+PNG seleccionados juntos en DocumentsUI, una imagen añadida posteriormente desde Galería, tres borradores conservados al volver al mismo paso y controles fijos durante scroll. No se enviaron esos tres borradores ni se tocaron los pendientes anteriores. [Evidencia del APK final](../artifacts/logs/native-release-1.0.4/smoke-final/SUMMARY.md).

La validación no sustituye las pruebas de permisos, cámara, selector y teclado Samsung, almacenamiento lleno o cargas reales. Los registros demo no se presentan como comprobación de la API desplegada.

Detalles: [reanudación](CHECKLIST-RESUME.md), [archivos compactos](ARCHIVOS-COMPACTOS.md), [login](LOGIN-USUARIO.md).