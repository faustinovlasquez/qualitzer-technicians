# Actualización 1.0.155 (gateway 1.0.52) — producción y Google Play

Igual que la 1.0.154, más:

- Las respuestas que quedaron en la cola del teléfono y luego el servidor confirmó ya no se quedan marcadas como
  "Borrador": la app las marca guardadas cuando el servidor tiene esa misma respuesta o aplicó exactamente ese envío.
  Esa marca bloqueaba "Guardar entrega" con el aviso "Guarda o descarta las respuestas que aún están en borrador".
  Los trabajos afectados se corrigen solos al abrirlos.

Sin cambios en el servidor ni en la pasarela.

## Notas de la versión para Google Play

<es-419>
El checklist ya no se detiene al elegir una respuesta y las fotos se administran dentro de cada paso.
Las respuestas confirmadas ya no quedan como borrador y puedes entregar el trabajo sin problemas.
</es-419>

## Orden para publicar

Ver [actualización 1.0.151](ACTUALIZACION-1.0.151.md): mismo servidor, misma pasarela 1.0.52 y mismos pasos en Play Console, con el archivo `artifacts/play/qualitzer-operaciones-1.0.155.aab`.
