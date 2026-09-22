# 1.0.42: guardar entrega sin conexion

Correccion del boton Guardar entrega para trabajos y tareas de mantenimiento con cronometro iniciado offline y sin hora descargada: la duracion manual usa el primer inicio real de la cadena local, en la zona horaria de la sesion. No se inventa una hora de inicio. Si no hay inicio local ni remoto, la edicion por duracion muestra un selector de hora real para completarlo.

Cuando la ficha descargada acredita archivos obligatorios pero no existe copia local de su listado, la falta de red ya no bloquea el guardado de entrega. Una lista conocida vacia, ausencia de evidencias, permisos revocados, conflictos o borradores sin guardar siguen bloqueando. Los archivos de checklist en cola solo cuentan si su operacion durable los respalda; una referencia local suelta no cuenta como archivo guardado.

Tras guardar, detalle y tarjeta indican Entregado local / pendiente y el reloj queda detenido. Se conserva el snapshot del servidor, sin presentarlo como confirmado. Si existe un conflicto aparece Entrega por revisar. Al volver internet, con la app abierta y desbloqueada, la cola envia sus dependencias primero y despues la misma entrega con su UUID original. El servidor revalida requisitos y permisos antes de confirmar. No se descartan pendientes ni se reinician recibos de conflicto.

La interfaz no ofrece Actualizar ficha durante la desconexion. Se mantiene Mi jornada con Pendientes y En curso como entrada predeterminada.

## Instalacion

Solo APK 1.0.42/codigo 43, como actualizacion sin desinstalar ni borrar datos. Sin nuevos cambios de gateway, backend, permisos o migraciones. Se mantiene gateway 1.0.19 y las fuentes backend de entrega offline de versiones anteriores.

## Verificacion

Validacion final Mobile/gateway: 269 pruebas aprobadas, tipos del cliente y gateway sin errores. El backend y el gateway no se modificaron para esta entrega.

Regresiones sobre el dialogo/detalle reales: duracion manual sin hora descargada, evidencia conocida offline, bloqueo de lista vacia/permisos/borradores, fallo de disco, doble pulsacion y estado pendiente separado de confirmado. Recorrido RN Web: 36 casos, 683 comprobaciones y 72 capturas, inicio-pausa-reanudacion-entrega automatica/manual, reinicio y reconexion idempotente. OS, red y almacenamiento de ese recorrido son simulados. No se ha ejecutado una entrega contra la API productiva ni probado la APK en un telefono fisico.