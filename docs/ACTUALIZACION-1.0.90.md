# Avisos al abrir la app y actividades sin conexión: APK 1.0.90 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.89](ACTUALIZACION-1.0.89.md) y corrige:

- **Tocar un aviso con la app cerrada no abría su destino.** Al abrir la app desde el aviso se pide desbloquear el dispositivo; el toque llegaba bloqueado y se descartaba. Ahora se conserva y se abre al desbloquear: Materiales con la entrega por confirmar, la tarea del cronómetro o la asignación.
- **Actividades sin conexión con el servidor** mostraban "No se pudo completar la operación (HTTP_502)". Ahora se mantienen las actividades de la última carga con un aviso de que se actualizarán al volver la conexión.

## Servidor

Sin cambios respecto a la 1.0.89 (backend y gateway 1.0.37). Para que el aviso de materiales filtre la entrega exacta, el backend de la 1.0.89 debe estar desplegado; con un backend anterior abre Materiales > Por confirmar sin filtro.

## Verificacion local

1854 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
