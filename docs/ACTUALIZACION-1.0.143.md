# APK 1.0.143 (versionCode 144)

Sin cambios en el gateway: sigue el 1.0.50.

## Ficha del ingreso: sin «No se pudo cargar la ficha» por fallas pasajeras

La ficha mostraba el error ante cualquier falla, sin reintentar. Además se recarga al volver a la app. En ese instante la protección de pantalla todavía marca la app como bloqueada, el taller no está disponible y la carga fallaba (`WORKSHOP_ENTRY_UNAVAILABLE`).

`src/workshop/useWorkshopEntry.ts`:
- Ante fallas pasajeras (corte breve, servidor ocupado, taller aún no disponible) reintenta solo a los 0,8 s, 2 s y 4 s antes de mostrar el aviso.
- No reintenta ante «sin acceso» (403), «ya no existe» (404) ni sesión vencida (401).
- Si la ficha ya estaba a la vista, una actualización fallida no la tapa con el error: se sigue viendo y se puede deslizar para reintentar.

Incluye también lo de la 1.0.142: el chat y los archivos del taller ya no pierden la foto o el documento elegido, y la conexión se recupera sola después de un corte breve.
