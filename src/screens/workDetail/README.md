# Detalle de ejecución técnica

## Exports públicos

Desde `WorkDetailScreen.tsx`:

- `WorkDetailScreen`: componente nombrado con el contrato solicitado, sin props adicionales.
- `WorkDetailScreenProps`: contrato tipado de integración.
- `workDetailDraftKey(storageKey, mode, group, workId)`: clave de almacenamiento de un trabajo.
- `clearWorkDetailDrafts(storageKey): Promise<void>`: borra respuestas, reportes y fotos de ese espacio de usuario/sucursal, tanto live como demo.

## Integración del padre

- Montar bajo `SafeAreaProvider`. No se añaden rutas ni se modifica `App`.
- `storageKey` debe identificar tenant, usuario y sucursal, sin tokens ni otros secretos. No compartirlo entre usuarios/sucursales.
- Todos los callbacks de escritura deben resolver **solo cuando el envío haya sido confirmado**, y rechazar cuando falle la mutación. Un fallo de actualización posterior no debe convertir un envío confirmado en rechazo: podría inducir duplicados.
- La pantalla llama `onRefresh` después de una escritura confirmada. El padre debe actualizar `work`, `group` y `generatedAt`; no cambiar `generatedAt` por la hora del dispositivo. Las validaciones locales de cierre usan esa instantánea y los adjuntos recibidos, no respuestas optimistas.
- El servidor/gateway debe volver a autorizar la asignación y validar transiciones, `canExecute`, respuestas y adjuntos obligatorios. El cliente no reemplaza esas validaciones.
- `onReport` debe guardar el reporte de mantenimiento como un archivo de texto generado en el gateway. No existe lectura de historial de reportes en este contrato. Un callback que aún no soporte esa operación debe rechazar, nunca simular éxito.
- En demo, los callbacks deben persistir localmente y actualizar las props, sin llamar a la API. Si un adjunto demo usa una foto local, el padre debe copiar su contenido a su propio almacenamiento **antes de resolver `onUpload`**: esta pantalla elimina la copia de borrador tras confirmar el envío. Se pueden mostrar imágenes demo como data URI; `Linking` solo abre HTTP/HTTPS.

## Borradores y limpieza

- AsyncStorage usa `@qualitzer/work-detail/v1/<storageKey codificada>/<modo>/<grupo y trabajo codificados>`.
- Los reportes y respuestas se conservan al escribir; los envíos al backend son explícitos. La hidratación fusiona sin reemplazar ediciones nuevas y las escrituras son serializadas con control de revisión.
- En nativo, las fotos se copian con `await File.copy` a `Paths.document/qualitzer-work-detail/session-<storageKey codificada>/`. No se usan APIs legacy ni compresión adicional.
- En web, las fotos son **solo de sesión**: permanecen al volver dentro de la aplicación, pero no sobreviven a una recarga. No se serializan URIs blob como si fueran duraderas. Se advierte al usuario y se protege la salida del navegador cuando corresponde.
- Las fotos confirmadas conservan una marca local de envío mientras se limpia el dispositivo; una limpieza fallida no vuelve a enviarlas. No hay reintentos automáticos de mutaciones ni uploads.
- Al cerrar sesión o borrar los datos locales: desmontar la pantalla, terminar los callbacks de escritura pendientes y **esperar `clearWorkDetailDrafts(storageKey)` antes de volver a montar ese mismo espacio**. La función drena escrituras y copias de fotos en curso. El padre debe borrar por separado su almacenamiento demo y sesión.
- Revisar la configuración nativa de permisos de cámara/fotos y sus mensajes en español antes de distribuir. No se modificó configuración fuera del alcance autorizado. Las denegaciones se muestran en la pantalla; en web no se solicitan permisos nativos antes de abrir el selector.

## Verificación

Se consultaron modelos, utilidades, UI común y documentación de Expo SDK 57. Se revisaron los diagnósticos del editor, sin ejecutar terminal, instalación, tests, lint ni build. No se realizó una prueba de ejecución en dispositivo o navegador.