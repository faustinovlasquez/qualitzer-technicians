# Sistema y subsistema, avisos y cronómetro: APK 1.0.89 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.88](ACTUALIZACION-1.0.88.md) y agrega:

- **Sistema y subsistema en trabajos de mantenimiento.** Se eligen al crear un mantenimiento o un trabajo dentro de uno, y al editar un trabajo de mantenimiento. El subsistema se filtra por el sistema elegido. El detalle del trabajo los muestra en el encabezado y en "Detalle del trabajo"; en la ficha de equipo "Componente" pasa a llamarse "Subsistema".
- **Cronómetro activo solo en la barra naranja superior.** Se quitó la tarjeta grande "Cronómetros activos" de Mi jornada. La barra también muestra los cronómetros de la jornada cargada que el servidor aún no informa.
- **Ir al inicio / ir al final** en la lista de trabajos: botones discretos que aparecen solo en listas largas mientras se desplaza.
- **El aviso de confirmación de materiales abre la entrega del aviso** en Materiales > Por confirmar, con un botón "Ver todas".
- **El aviso de cronómetro en curso abre la tarea** aunque haya otra tarea u orden abierta, busca la tarea en los últimos 30 días y espera a que termine una actualización en curso. Los mensajes del aviso se ven también dentro del detalle.

## Servidor

**Desplegar backend y gateway 1.0.37 juntos.** El backend acepta sistema y subsistema en la creación móvil (`mobile-creations`) y en la edición (`PanelWorkEdit`), expone los catálogos `systems`/`components` y agrega `materialReceiptIds` a los avisos de materiales. Sin migraciones.

Las APK anteriores siguen funcionando: los campos nuevos son opcionales y `/edit` conserva su respuesta anterior. Una APK 1.0.89 con un servidor anterior falla solo al crear o editar con sistema/subsistema.

## Verificacion local

1854 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
