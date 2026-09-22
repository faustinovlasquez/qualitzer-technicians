# 1.0.40: recuperacion y espacio offline

Paquete de esta entrega: **gateway 1.0.19**. El archivo 1.0.18 existente queda preservado y no debe usarse como sustituto de este paquete verificado.

## Correccion de sincronizacion

Se comprobo un defecto de compatibilidad: la entrega valida que recibia HTTP 400 INVALID_INPUT de una pasarela antigua quedaba bloqueada en vez de esperar actualizacion. El adaptador ahora conserva esa solicitud pendiente, igual que los cambios de cronometro. Mantiene prioridad absoluta de un recibo backend definitivo: nunca lo sustituye por un reintento automatico.

Para bloqueos anteriores sin recibo ni resultado, la app consulta el contrato autenticado de gateway 1.0.18 y verifica usuario/trabajador/sucursal. Solo recupera una vez solicitudes que pasan la validacion actual. No cambia su UUID, payload, fechas, duracion ni dependencias. Iniciar, pausar, reanudar y entregar se envian en orden; la entrega espera tambien archivos y respuestas. Un cambio externo o rechazo con recibo permanece para revision.

**No se ha confirmado que esta sea la causa exacta del fallo reportado en el telefono.** Las pruebas usan servidor y almacenamiento simulados; falta el codigo del primer paso fallido y comprobar la version realmente instalada. Si sigue retenida, abrir Centro offline > operacion anterior > Ver detalles y compartir codigo/UUID/recibo con soporte. No borrar datos ni crear otra entrega para sustituirla.

## Almacenamiento

Solo sin red o sin acceso al servicio se muestra una linea discreta con archivos usados/reservados y espacio adicional aproximado. Desaparece al reconectar. El centro offline muestra el desglose y la reserva del sistema.

En Android/iOS se elimina el tope fijo de 500 MiB si el sistema informa espacio libre. Se permite ocupar ese espacio menos el mayor entre 512 MiB y 5 % del disco total. Se revalida antes de copiar. No es una reserva de espacio garantizada: otras apps pueden consumirlo. Si la consulta falla, se mantiene la cuota precautoria de 500 MiB, identificada como tal. Maximo 25 MiB por archivo, compatible con la API; no se aumentan los limites de cada envio.

El contador incluye archivos de todos los perfiles, incluidas copias confirmadas conservadas y reservas. No representa RAM ni el tamano total de SQLite/borradores/agenda. El disponible del sistema ya descuenta ese uso. Los pendientes y coordenadas no se borran automaticamente para liberar espacio. Ubicacion conserva su limite independiente de 5000 puntos pendientes por perfil.

## Despliegue y prueba

Instalar gateway 1.0.19 y verificar que el proceso use ese paquete. Debe conservarse el backend compatible con cronometro capturado/entrega offline de 1.0.38. Sin migracion nueva para esta correccion; la migracion de ubicacion de 1.0.39 sigue siendo necesaria para esa funcionalidad. Actualizar APK sobre 1.0.39, sin desinstalar, borrar datos, colas, recibos o claves.

Validado: 338 pruebas Mobile/gateway y tipos sin errores; 24 recorridos RN Web con 443 comprobaciones y 48 capturas, incluyendo usado/disponible solo offline. La secuencia inicio-pausa-reanudacion-entrega manual sobrevive reinicio. Se probaron perdida de respuesta, mismo UUID, conflictos no recuperables, cambio de identidad, reserva y disco lleno. No hubo escrituras reales de trabajo, pruebas SQL/backend ni prueba en telefono fisico. Despliegue remoto pendiente del operador.