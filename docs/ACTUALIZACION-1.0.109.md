# Ventana de notificaciones siempre al iniciar sesión: APK 1.0.109

Mantiene todo lo de la [actualizacion 1.0.108](ACTUALIZACION-1.0.108.md) y corrige:

- **La ventana del teléfono para permitir notificaciones aparece al iniciar sesión aunque el servidor todavía no tenga listo el servicio de avisos.** Antes la app no preguntaba si el servidor no respondía que el servicio estaba activo.
- Al aceptar, "Recibir avisos" queda activado; el teléfono se registra en el servidor en cuanto el servicio esté disponible.

## Verificacion local

1870 pruebas de la app y del gateway pasadas, typecheck sin errores.
