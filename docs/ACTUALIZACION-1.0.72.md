# Mi jornada compacta y prioridad como punto: APK 1.0.72 / gateway 1.0.31

Incluye todo lo de la [actualizacion 1.0.71](ACTUALIZACION-1.0.71.md).

- Se quitan las tarjetas Pendientes, En curso y Completadas: los mismos conteos estan en los filtros de la lista.
- HH asignadas y HH reportadas en una sola fila, cada una con icono, cantidad y texto en una linea.
- Tarjeta de trabajo: la prioridad se muestra como un punto al inicio de la fila de codigos (verde baja, ambar media, rojo alta) en lugar de la etiqueta "Prioridad". "Atrasada" se mantiene como etiqueta.

El gateway y el backend no cambian respecto de la 1.0.71. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

1816 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), typecheck sin errores. Verificado a 360 px de ancho en React Native Web.
