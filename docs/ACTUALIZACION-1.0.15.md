# Qualitzer tecnicos 1.0.15

APK Android firmada, codigo 16. Actualizar sobre la app instalada, sin desinstalar ni borrar datos, sesiones, borradores o pendientes.

## Entrega

- Una respuesta sincronizada que coincide con la confirmada por el servidor ya no bloquea la entrega por conservar una marca local de borrador. Los cambios locales diferentes siguen protegidos.
- La revision muestra el tiempo trabajado precargado desde el cronometro de la fecha seleccionada.
- Si la sucursal permite editar la ejecucion, se puede corregir el total en horas y minutos o ajustar inicio, termino y dia de termino con selectores.
- La correccion manual no se reemplaza por actualizaciones pasivas del cronometro.
- Se puede entregar una fecha disponible o varias fechas planificadas autorizadas. El tiempo indicado es un solo total para la seleccion, no horas independientes por dia. No se agregan fechas ni se multiplica el tiempo automaticamente.
- La confirmacion permanece visible y muestra el motivo de bloqueo. Siguen siendo obligatorios la conexion, los permisos, las evidencias requeridas y la confirmacion de los cambios pendientes.

## Archivos

- Los archivos confirmados usan la misma tarjeta con imagen, nombre, autor cuando esta informado, apertura y eliminacion autorizada.
- Tener una copia local ya no cambia el formato de la tarjeta ni duplica el archivo.
- Se conserva el enlace del servidor y la copia local validada para previsualizar imagenes sin conexion. Los documentos conservan su acceso local existente.
- Un archivo pendiente no se presenta como evidencia confirmada. No se cambia su formato, contenido ni identificador.

## Instalacion

1. Descargar `qualitzer-tecnicos-1.0.15-android.apk`.
2. Elegir Actualizar sobre Qualitzer tecnicos.
3. Abrir la tarea y revisar Entregar trabajo. Corregir el total o el intervalo si corresponde y confirmar.

No requiere cambios nuevos de backend ni otro gateway. Se conserva el gateway 1.0.4 existente. Esta actualizacion no altera las horas historicas del cronometro: una correccion de entrega se registra como manual.

## Verificacion

- SHA-256 APK: `407bae1d2cb0929c24424aa63f2ddc5e8274655d4641558eeeed24da8d6a2583`
- Tamano: 69.705.727 bytes.
- Paquete: `com.qualitzer.field`.
- Firma SHA-256: `06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510`.
- Reporte: `artifacts/release-verification-1.0.15.json`.
- Pruebas moviles: 1.667 aprobadas, 1 omitida, sin fallos; tipos de cliente y gateway movil sin errores.
- UI aislada: 24 casos, 554 aserciones, 36 capturas; anchos 360, 390 y 1280 con texto al 100% y 200%.
- Las pruebas usan datos ficticios, sin entregar tareas ni subir o eliminar archivos reales. No equivalen a una prueba con la cuenta del tecnico o su telefono fisico.