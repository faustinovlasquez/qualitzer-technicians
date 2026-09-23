# Actualizacion 1.0.58: tarjetas de trabajo compactas

Android versionCode 59, misma firma y paquete.

- Menos relleno y separacion entre datos, con titulo limitado a dos lineas.
- Si el titulo recibido esta vacio, muestra Trabajo sin titulo en vez de reservar una linea vacia.
- Fecha abreviada con anio y horario en una fila adaptable, sin caja interior.
- Ejecucion en dos filas: reloj total y tiempo asignado con porcentaje cuando existe planificacion.
- Se retira la repeticion de minutos ejecutados y la barra vacia cuando no hay tiempo planificado.
- Archivos, Checklist y Comentarios en una sola fila con iconos, contadores y nombres accesibles.
- Inicio, pausa, reanudacion, entrega, avisos de cola, exceso de tiempo y restricciones existentes se conservan.
- Area tactil minima de 44 px; botones y textos se adaptan a letra ampliada sin recortes.

Solo cambia AssignmentWorkCard, compartida por jornada, agenda y trabajos de
una OT. No cambia el calculo del cronometro, permisos, fechas consultadas,
envios, colas, backend, frontend ni gateway 1.0.27. Tampoco modifica la clave
Google ni la configuracion de API. Instalar como actualizacion sin borrar datos.

## Verificacion

Seis recorridos de tarjeta real RN Web a 360/390/1280 px con letra 100/200%
pasan: 173 comprobaciones, 12 capturas y tipos sin errores. Cubren tarjeta sin
horario, titulo largo/vacio, reloj, porcentaje, exceso, accesos, inicio/pausa,
revision de entrega y estados ocupado, offline y cerrado. La tarjeta de prueba
sin horario mide 381 px con letra normal; fecha 18 px y bloque de tiempo 42 px.
Otros seis recorridos de mantenimiento pasan con 167 comprobaciones.

Las pruebas unitarias antiguas de reconciliacion y sus fixtures tienen fallos
no resueltos en esta entrega. Tres aserciones de estado se reprodujeron tambien
con la tarjeta anterior de HEAD, cargada en memoria sin reemplazar archivos.
No se afirma un resultado global de tests. No se modificaron esas reglas para
hacer pasar una mejora visual. Sin prueba fisica ni escrituras de negocio
remotas; sin tests/build/lint/SQL del backend.