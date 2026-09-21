# Dias trabajados no consecutivos

APK 1.0.36, codigo Android 37. Gateway 1.0.14 y fuentes actualizadas de TechnicianDashboard requeridos. Sin migracion nueva.

## Uso

1. Abrir Entregar trabajo y activar Trabaje en varios dias.
2. Pulsar Seleccionar dias trabajados, marcar las fechas y confirmar con Usar fechas seleccionadas. Se puede cambiar de mes, desmarcar fechas o cancelar sin modificar la seleccion anterior.
3. Revisar los dias y el tiempo total antes de Confirmar y entregar.

Se admiten hasta 30 fechas no consecutivas, incluso de distintos meses. El tiempo es un unico total: cuatro dias seleccionados y seis horas siguen siendo seis horas, no veinticuatro. La edicion manual mantiene los permisos de la sucursal y en este modo utiliza duracion total. La entrega y la autorizacion siguen siendo del trabajo abierto.

## Persistencia y compatibilidad

`workedDates` registra dias realmente trabajados; `executionDates` mantiene una sola fecha de consulta/autorizacion. No se agregan dias intermedios, no se crean horas por dia ni se utiliza la lista para cerrar otras planificaciones. Las entregas anteriores sin este campo no cambian.

Backend valida la lista y permite este campo solo al completar/entregar sin flags masivos. Guarda HAS_REPORTED_WORK_DATES en users_logbooks dentro de la transaccion del cambio de estado. En mantenimiento bloquea la fila y publica realtime despues del commit. La consulta recupera la ultima lista del usuario/trabajador para los trabajos autorizados de la respuesta. App y cache conservan el campo y el detalle muestra Dias trabajados registrados.

El backend anuncia technician.supportsWorkedDates. El gateway revalida esa capacidad y la asignacion antes de guardar; rechaza un backend antiguo en lugar de descartar fechas silenciosamente. Se conservan checklist obligatorio, evidencias y permisos de horas manuales. No se encola ni reintenta una entrega nueva de forma automatica.

## Despliegue

Desplegar fuentes TechnicianDashboard, el nuevo WorkedDates de dominio, TechnicianWorkedDates.repository y la clave de app.logbooks. Publicar e instalar gateway 1.0.14 con manifiesto y lockfile preparados. Detener y drenar el proceso anterior, actualizar la salida compilada segun el procedimiento del servidor y arrancar una sola instancia fork, sin rolling reload solapado. Luego instalar APK 1.0.36 como actualizacion, sin desinstalar ni limpiar datos.

## Verificacion

114 pruebas enfocadas de paridad de entrega y repositorio offline aprobadas, incluyendo fechas separadas, una escritura, duracion sin multiplicacion, servidor incompatible y conservacion en cache. Tipos cliente/pasarela sin errores y 92 regresiones adicionales aprobadas (no sumarlas como bateria unica).

12 recorridos RN Web, 299 comprobaciones y 24 capturas a 360/390/1280 px con texto normal/ampliado: artifacts/logs/time-sync-ui/2026-09-21T13-08-18-224Z. Fechas 15/17/21 de septiembre y 29 de agosto, cancelacion, cambio de mes, modo manual/cronometro y compatibilidad del calendario de fecha unica. Pruebas con API/OS simulados, sin escrituras de negocio.

Backend: pruebas fuente de validacion, auditoria transaccional y lectura por actor preparadas; diagnosticos del editor sin errores. No se ejecutaron tests, lint, build, SQL, instalaciones o reinicios del backend. No se verifico la cuenta real, un telefono fisico ni el despliegue remoto.