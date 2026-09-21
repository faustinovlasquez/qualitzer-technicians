# Agenda por fecha y carga progresiva

APK 1.0.34, codigo Android 35. Se mantiene gateway 1.0.12. No requiere cambios adicionales de servidor ni migraciones.

## Visibilidad

- Las tareas con fecha pero sin horas validas aparecen directamente en el dia, no solo en el apartado plegado de trabajos sin horario. No se inventan horas.
- Mantenimientos y OTs asignados sin trabajos hijos aparecen en su fecha. Al abrirlos, la consulta usa esa fecha si pertenece al periodo visible, no el primer dia del mes.
- El contador mensual incluye tareas sin hora y ordenes sin trabajos hijos.
- Cambiar de Mes a Dia/Semana conserva el periodo ya cargado si cubre las fechas necesarias. La semana se alinea de lunes a domingo y la seleccion conserva el dia pulsado.

## Respuesta de la interfaz

- La agenda muestra los resultados por dia conforme llegan, sin esperar al periodo completo.
- La fecha seleccionada tiene prioridad. Si se selecciona otra mientras carga, es la siguiente consulta disponible, sin reiniciar el lote ni duplicar solicitudes.
- Se mantiene el limite de dos consultas simultaneas, cancelacion al cambiar de rango/sesion y verificacion de trabajador. Las versiones de cada fecha y las pruebas causales de los cronometros no se mezclan.
- Los dias aun no consultados se distinguen de los dias sin tareas. La navegacion entre fechas sigue disponible durante la carga.
- Esto mejora la espera de la interfaz; no modifica el coste ni la latencia de las consultas del servidor. Un mes sigue requiriendo sus lecturas diarias para preservar sus datos exactos.

## Verificacion

110 pruebas enfocadas de lectura de agenda y repositorio offline aprobadas, incluyendo prioridad dinamica, publicacion antes de terminar el lote y rechazo de respuestas tardias. Tipos del cliente/pasarela sin errores y 92 pruebas de regresion aprobadas (solapadas con la bateria anterior, no sumarlas).

24 recorridos RN Web a 320/360/390/1024 px y texto normal/ampliado. Caso especifico del dia 16 con tarea con hora, tarea sin hora, mantenimiento con tarea y mantenimiento sin hijos; cambio Mes/Dia/Semana sin consultas redundantes y navegacion durante carga simulada. Capturas en artifacts/logs/compact-overview-ui/2026-09-18T20-59-26-348Z.

Las pruebas usan datos simulados: no se accedio a la cuenta ni a las asignaciones reales del dia 16 del usuario, ni se midio el tiempo de respuesta del servidor productivo. No se hicieron escrituras de negocio, cambios en backend ni pruebas en telefono fisico.

Instalar como actualizacion. No desinstalar ni borrar datos, colas, recibos o borradores.