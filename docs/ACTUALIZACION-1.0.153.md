# Actualización 1.0.153 (gateway 1.0.52) — producción y Google Play

Fluidez del checklist (plan `Plan-fluidez-app.md`, etapas 1 y 2). Sin cambios en la pasarela.

- Guardar una respuesta ya no bloquea la pantalla; las respuestas se anotan en fila propia y la agenda se vuelve a
  descargar una sola vez tras una ráfaga de respuestas confirmadas.
- Fotos reducidas al tomarlas (lado mayor 1920 px, JPEG 0,75): se guardan, muestran y suben mucho más rápido.
- La galería y los avisos de la cola ya no redibujan ni copian todo el estado guardado.
- La cola sin conexión guarda cada copia de agenda en su propia fila (`offline_cache_entries`) y solo escribe lo que
  cambió; se migra sola al abrir la versión nueva. Una versión anterior conserva su cola (con la caché vacía).

El servidor principal trae una mejora aparte (validar cada respuesta o foto con una sola lectura de la agenda): se nota
al actualizar el servidor, pero esta versión de la app no la requiere.

## Notas de la versión para Google Play

<es-419>
El checklist es mucho más rápido: guardar respuestas y fotos ya no detiene la pantalla.
Las fotos ocupan menos espacio y se suben más rápido.
</es-419>

## Orden para publicar

Ver [actualización 1.0.151](ACTUALIZACION-1.0.151.md): mismo servidor, misma pasarela 1.0.52 y mismos pasos en Play Console, con el archivo `artifacts/play/qualitzer-operaciones-1.0.153.aab`.
