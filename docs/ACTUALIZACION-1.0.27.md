# Qualitzer tecnicos 1.0.27

## Archivos de mantenimiento y OT

Los archivos recien seleccionados se guardan automaticamente mediante la misma cola durable existente. Con conexion se sincronizan por el proceso habitual; sin conexion permanecen guardados en el dispositivo. La seleccion se protege antes de transferir su propiedad a la cola. Un archivo en cola nunca se presenta como confirmado por el servidor.

Las imagenes seleccionadas y pendientes usan tarjetas con vista previa, igual que la lista de confirmadas, conservando su estado real. La barra de acciones queda fija y la lista tiene desplazamiento propio: ya no es necesario recorrer todos los archivos para encontrar Guardar. Si no hay borradores, desaparece el boton Guardar 0.

El guardado automatico se limita a los IDs del lote recien seleccionado. No reenvia borradores antiguos o de respuesta incierta al abrir la pantalla. Para un archivo que quedo sin guardar antes de actualizar, usar Guardar pendientes. Si existe una operacion ya en cola, no volver a seleccionar el archivo; revisar la sincronizacion existente. Los errores de guardado conservan el borrador y permiten reintento explicito.

El resto de destinos de archivos conserva el guardado manual existente. No se cambia el protocolo, los limites de almacenamiento ni los IDs/recibos de la cola.

## Inicio y menu

- El icono de casa vuelve a Mi jornada y cierra el detalle de la orden.
- El menu abre las secciones Trabajos, Repuestos cuando existen y Archivos, con salidas explicitas a Mi jornada o a las asignaciones.
- Volver mantiene la navegacion anterior. La navegacion se bloquea mientras se protege o transfiere un archivo.
- El encabezado separa nombre e iconos, y el menu admite desplazamiento con texto ampliado.

## Imagenes eliminadas

Corrige la reaparicion de una imagen borrada que era reconstruida desde un recibo de subida local aplicado. Cada lista guarda los IDs de las subidas que ya estaban confirmadas antes de iniciar su consulta. Si el servidor no devuelve ese archivo en una consulta posterior, el recibo no lo vuelve a agregar. La misma evidencia se conserva al reabrir sin conexion.

Las subidas pendientes y las confirmadas durante una consulta anterior conservan su copia; una respuesta antigua no sustituye una lista mas reciente. No se borran recibos, operaciones ni bytes locales para corregir la presentacion. No se convierte FILE_NOT_FOUND en un exito artificial. Tras un DELETE confirmado, la pantalla retira el archivo inmediatamente; si falla la recarga, avisa sin ofrecer otra eliminacion de esa imagen.

## Instalacion

APK 1.0.27, codigo Android 28, misma firma, paquete y API. Instalar como actualizacion sin desinstalar ni limpiar datos. Se conserva la APK 1.0.26 anterior.

No requiere cambios adicionales de backend ni gateway. Se mantiene gateway 1.0.10 y los requisitos de firmas publicados en 1.0.25. Sin migraciones, cambios de Firebase ni nuevas claves o nombres de base de datos.

## Verificacion

- 154 pruebas enfocadas de repositorio, motor, reconexion, reapertura SQLite y lotes de archivos aprobadas; tipos del alcance sin errores. Incluye regresion reproducida antes del arreglo, desaparicion tras consulta remota, reinicio offline, lecturas concurrentes, remapeo de trabajos locales y preservacion de pendientes/recibos/bytes.
- 365 pruebas de asignaciones y navegacion aprobadas, parcialmente solapadas con las anteriores; no se suman como pruebas distintas.
- Seis configuraciones RN Web con 13 archivos existentes, guardado confirmado/en cola/rechazado, vista previa, barra fija, menu e Inicio: 281 comprobaciones y 42 capturas. Informe artifacts/logs/time-sync-ui/2026-09-18T15-05-46-387Z/report.json.
- Seis configuraciones de borrado confirmado, recarga fallida y rechazo: 185 comprobaciones y 18 capturas. Informe artifacts/logs/time-sync-ui/2026-09-18T15-07-55-505Z/report.json.

Los recorridos usan componentes reales con respuestas de API, sistema y galeria simuladas. No se realizaron subidas, eliminaciones ni cambios en cuentas reales. No es una prueba de extremo a extremo en telefono fisico. No se ejecutaron herramientas, SQL ni instalaciones del backend.