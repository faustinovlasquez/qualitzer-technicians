# Nueva Agenda: APK 1.0.73 / gateway 1.0.32

Incluye todo lo de la [actualizacion 1.0.72](ACTUALIZACION-1.0.72.md).

La pestana Agenda abre en una vista nueva por semana:

- Semana con flechas, acceso a "Hoy", icono de calendario (abre la vista semanal/mensual anterior) e icono de filtros (abre la lista con filtros y OTs). Desde ambas se vuelve con "Volver a la agenda".
- Horas de la semana: HH pendientes, HH en curso y HH completadas (horas planificadas por estado), HH planificadas (total OT) y HH reportadas (horas trabajadas).
- Pestanas Trabajos (con horario), Sin hora y Completados, con su cantidad.
- Linea de tiempo por dia con hora de inicio y termino, punto de color por estado y tarjeta con titulo, estado, horas planificadas, codigo y equipo. La colacion de los trabajos del dia aparece como Almuerzo, una vez por dia.
- La busqueda de la cabecera filtra la agenda y sus totales.

No incluye el bloque de horas disponibles del mes ni la tarjeta de KPI (pendientes de definir). La colacion requiere el gateway 1.0.31 o posterior en el servidor.

## Verificacion local

1819 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), incluidas 3 nuevas de agrupacion, totales por estado, colacion y busqueda de la agenda. Verificada a 360 px de ancho en React Native Web.
