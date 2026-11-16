# Actualización 1.0.156 (gateway 1.0.52) — producción y Google Play

Reúne la fluidez del checklist (1.0.153–1.0.155) y los arreglos encontrados al probar en local:

- Las fotos de cada paso ya no consultan al servidor al abrir el paso: al avanzar rápido se superaba el límite de
  peticiones de la pasarela y se cortaban conexiones. Se consulta solo al subir, eliminar, confirmar o actualizar.
- Un checklist quitado en la web se puede volver a agregar desde la app (antes quedaba deshabilitado 14 días).
- El paso deja de decir "Respuesta registrada en el teléfono" cuando el servidor ya la confirmó.
- La reducción de fotos sigue los mismos pasos que la foto del equipo del ingreso (lee la foto orientada antes de
  reducirla), por una foto que se vio negra en un teléfono.

Sin cambios en el servidor ni en la pasarela.

## Notas de la versión para Google Play

<es-419>
El checklist es más rápido: guardar respuestas y fotos ya no detiene la pantalla.
Toma y administra las fotos de cada paso sin salir del paso.
Ahora puedes volver a agregar un checklist que se había quitado del trabajo.
</es-419>

## Orden para publicar

Ver [actualización 1.0.151](ACTUALIZACION-1.0.151.md): mismo servidor, misma pasarela 1.0.52 y mismos pasos en Play Console, con el archivo `artifacts/play/qualitzer-operaciones-1.0.156.aab`.
