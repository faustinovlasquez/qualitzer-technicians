# Qualitzer tecnicos 1.0.25

## Firmas compartidas del perfil

- Mi perfil > Firmas permite consultar, agregar, editar y eliminar firmas del usuario en sesion.
- Comparte el mismo catalogo de la web: nombre, correo, telefono, imagen y sucursales predeterminadas. Se mantiene una firma predeterminada por sucursal y solo pueden elegirse sucursales asignadas.
- La imagen puede dibujarse o cargarse desde la galeria. Se prepara como PNG de hasta 768 x 320, conservando proporcion y con limite de 1 MiB. Es opcional en el perfil; para usarla como firma de entrega debe tener imagen.
- Al preparar una OT se carga la firma tecnica predeterminada de la sucursal. No reemplaza un dibujo ya iniciado ni una seleccion manual previa.
- Desde la entrega se puede elegir otra firma, agregarla o editarla en el mismo gestor; tambien se puede dibujar una firma solo para esa entrega.
- La firma de quien recibe es independiente y nunca se completa con la firma del tecnico. Guardar el perfil no entrega la OT: se mantienen revision y confirmacion explicitas.
- Editar o eliminar una firma del perfil no modifica los documentos ya firmados.

La consulta y los cambios de perfil requieren conexion. No se encolan offline ni se cachean las imagenes del catalogo en el almacenamiento durable. El borrador de entrega conserva temporalmente en memoria la copia PNG elegida, dentro del mismo aislamiento y caducidad de sesion existente. No es una firma digital criptografica ni una prueba biometrica de autoria.

## Despliegue

Primero desplegar las fuentes Backend de src/userSignatures y el paquete gateway 1.0.10, con las referencias de package.json/package-lock.json. Las rutas propias son GET/PUT /user_signatures/me y DELETE /user_signatures/me/:id. El propietario se obtiene de la sesion, no del cuerpo; se verifican sucursales, imagen PNG y pertenencia. La escritura modifica solo la firma indicada; no envia ni sustituye el perfil completo.

No hay migracion nueva: utiliza las tablas de firmas y sucursales existentes. Mantener directorios privados, claves, sesiones, colas y recibos. Detener/drenar el backend antes de instalar y volver a arrancar una sola instancia fork, sin rolling reload superpuesto. Si el servidor ejecuta JavaScript compilado, actualizar su salida mediante el procedimiento normal de despliegue; aqui no se ejecuto build de Backend.

Instalar APK 1.0.25/codigo 26 como actualizacion, con la misma firma, paquete y API. No desinstalar ni borrar datos. Se conserva la correccion de bloqueo 1.0.24 y el arreglo de archivos del gateway 1.0.9.

## Verificacion

79 pruebas enfocadas aprobadas: firmas por usuario/sucursal, rutas reales de la pasarela y limites JSON/PNG, hook de sesion y accesos revocados, navegacion del perfil y reglas de entrega. Tipos de la app y pasarela sin errores en el alcance validado. Reporte: artifacts/logs/user-signatures/2026-09-18T13-40-33-798Z/report.json.

Seis recorridos de interfaz real RN Web, anchos 360/390/1280 y texto 100/200%, con 196 comprobaciones y 24 capturas: crear dibujando (pixeles del canvas comprobados), cargar JPEG y convertir a PNG, editar conservando ID/imagen, firma predeterminada, cambio manual, editar desde entrega, confirmar solo al final y eliminar con confirmacion. Reporte: artifacts/logs/time-sync-ui/2026-09-18T13-40-05-575Z/report.json.

El sistema operativo, galeria y servidor de esas pruebas son simulados. No se modificaron firmas de usuarios reales ni se entregaron OTs reales. Pruebas Backend preparadas como fuentes, no ejecutadas por las reglas del repositorio; sin lint, build, SQL ni migraciones automaticas del Backend. Pendiente validar el recorrido con servidor actualizado y telefono real.