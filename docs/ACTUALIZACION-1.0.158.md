# Actualización 1.0.158 (gateway 1.0.53) — producción y Google Play

Misma app que la [1.0.157](ACTUALIZACION-1.0.157.md), más:

- "Nuevo mantenimiento" ya no pide especialidad, sistema ni subsistema (se eligen en cada trabajo) ni tipo de daño (se
  indica al entregar el mantenimiento: falla operacional o por desgaste). El formulario tampoco los envía aunque vengan
  de un borrador anterior.
- "Asociar equipo" muestra solo el catálogo (se quitó la pestaña "Código"). Todos los buscadores de catálogo del
  formulario (equipo, listas, sistema, subsistema, especialidad) filtran mientras se escribe, con una pausa breve; ya no
  tienen botón "Buscar".

Y una corrección para Google Play:

- Play Console rechazaba el envío porque el manifiesto obligaba a tener pantalla vertical (`android.hardware.screen.portrait`,
  deducida de la orientación fija) y Wi-Fi (`android.hardware.wifi`, deducido del permiso `ACCESS_WIFI_STATE`). El plugin
  `plugins/withOptionalHardwareFeatures.js` las declara opcionales (`android:required="false"`). La app sigue fija en
  vertical y sigue consultando el estado del Wi-Fi.
- La 1.0.157 (código 158) ya se subió a Play Console y no puede reutilizarse: esta versión usa el código 159.

Sin cambios en el servidor ni en la pasarela: se publican igual que en la 1.0.157.

## Notas de la versión para Google Play

<es-419>
Crea mantenimientos preventivos, rutinarios y de checklist desde la app.
En un preventivo, agrega los ítems de la pauta del equipo como trabajos.
Ahora puedes quitar a un técnico de un trabajo aunque sea responsable de toda la mantención.
</es-419>

## Orden para publicar

Igual que la [1.0.157](ACTUALIZACION-1.0.157.md), con el archivo `artifacts/play/qualitzer-operaciones-1.0.158.aab`. En Play
Console, descartar la versión 158 (1.0.157) del borrador de Producción y subir la 159.
