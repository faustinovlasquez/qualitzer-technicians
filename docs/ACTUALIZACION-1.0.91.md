# Confirmar materiales a la primera: APK 1.0.91 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.90](ACTUALIZACION-1.0.90.md) y corrige:

- **Los materiales aparecen todos marcados** al abrir una entrega por confirmar: "Confirmar todo" queda listo y se puede desmarcar lo que falte.
- **La primera confirmación fallaba y la segunda funcionaba.** Un intento anterior guardado sin respuesta (por ejemplo, tras un corte) se reenviaba con su ubicación original, ya vencida, o era de otra entrega ya resuelta; el servidor lo rechazaba. Ahora la app descarta ese intento y repite automáticamente, una sola vez, con ubicación nueva y la entrega actual.

## Servidor

Sin cambios respecto a la 1.0.89 (backend y gateway 1.0.37).

## Verificacion local

1854 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
