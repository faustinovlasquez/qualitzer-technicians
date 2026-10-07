# Aviso de materiales abre la entrega: APK 1.0.92 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.91](ACTUALIZACION-1.0.91.md) y corrige:

- **Tocar el aviso "Materiales por confirmar" dejaba la app en la vista principal.** Dos causas:
  - Con la app protegida por bloqueo, el toque llegaba con la app bloqueada, quedaba guardado y nadie lo retomaba al desbloquear. Ahora se abre en cuanto se desbloquea.
  - Al abrir la app desde el aviso, el toque esperaba como máximo 8 s a que terminara la primera actualización y luego se descartaba. Los avisos de materiales solo cambian de pestaña, así que ya no esperan.
- El aviso abre **Materiales > Por confirmar** con la entrega notificada primero y sus materiales marcados.

## Servidor

Sin cambios respecto a la 1.0.89 (backend y gateway 1.0.37).

## Verificacion local

1855 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
