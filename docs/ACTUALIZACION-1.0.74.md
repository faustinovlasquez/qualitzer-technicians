# Agenda con dias y modos: APK 1.0.74 / gateway 1.0.32

Reemplaza el diseno de Agenda de la [actualizacion 1.0.73](ACTUALIZACION-1.0.73.md):

- Semana con flechas, icono de calendario (vista semanal/mensual anterior) e icono de filtros (lista con filtros y OTs).
- Fila de dias de la semana: tocar un dia muestra solo ese dia.
- Hoy y selector Dia / Semana / Mes. Mes carga el mes completo.
- Cinco indicadores en una fila: HH pendientes, en curso, completadas, planificadas y reportadas, segun el periodo visible.
- "Trabajos de la semana" (o del dia/mes) con la cantidad de OT y cuantas no tienen hora.
- Lista unica de trabajos: borde y punto de color, hora de inicio y termino, titulo, horas planificadas, estado (Programada, Pendiente, En curso, Pausada, Completada; "Sin hora asignada" cuando falta hora), codigo y equipo. Con varios dias se separa por fecha.
- El buscador de la cabecera dice "Buscar OT" y filtra la agenda y sus totales.

El gateway y el backend no cambian. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

1819 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), typecheck sin errores. Verificada a 360 px de ancho en React Native Web.
