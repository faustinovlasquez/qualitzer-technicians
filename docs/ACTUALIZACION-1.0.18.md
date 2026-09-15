# Qualitzer tecnicos 1.0.18

- Pestanas independientes: Trabajos, Mantenimientos y OTs. Trabajos nunca muestra tarjetas de los padres; sus codigos siguen indicando la relacion.
- Los mantenimientos y OTs vacios se conservan en su pestana y pueden abrirse desde un aviso.
- Regreso, codigo de trabajo, codigo de OT y estado en una fila. Con texto ampliado, los codigos pueden desplazarse horizontalmente.
- Iniciar, pausar, reanudar y entregar permanecen fijos al pie del detalle, tambien en checklist y archivos.
- Actividades separadas de los pasos de checklist, tanto en la ficha como en el refresco.
- Nueva actividad en un dialogo: nombre, minutos totales y archivos. Cancelar conserva el borrador. Los archivos se envian despues de obtener el ID confirmado; se conserva ese ID si queda un archivo pendiente.
- Eliminar actividad requiere confirmacion, conexion y permiso vigente sobre un trabajo abierto. El backend realiza borrado logico y no elimina respuestas de checklist ni archivos fisicos.

## Instalacion

Primero publicar Backend actualizado y gateway 1.0.7; despues instalar esta APK como actualizacion, sin desinstalar ni borrar datos. Se conservan firma, paquete Android, API remota, sesiones y pendientes. Sin migracion nueva ni cambios de Firebase.

APK: `artifacts/qualitzer-tecnicos-1.0.18-android.apk`, codigo 19, 69741339 bytes.
SHA-256: `e90519ae2b836a96da3de2c551769be4bdf23e929bc3a4219a8a5416ec0b893d`.
Gateway: `qualitzer-mobile-gateway-1.0.7.tgz`, SHA-256 `c0b8de858f06e65852cf0f1033b743d33a6c23582bcf7d4660d9238ae93525f7`.

## Verificacion

227 pruebas moviles enfocadas y cero errores de tipos en los archivos revisados. Ocho escenarios visuales de pestanas y seis flujos de actividades con 161 aserciones, incluidos minutos, adjuntos, eliminacion, pie fijo y texto 100/200 %. APK firmada release verificada con las fuentes incorporadas. Pruebas con componentes reales React Native Web y servicios simulados; no acreditan funcionamiento en telefono fisico ni despliegue remoto.

Las pruebas Backend se ampliaron pero no se ejecutaron, segun las reglas del repositorio. No se ejecutaron SQL ni migraciones. Las operaciones de actividades siguen requiriendo conexion; no se agregaron a la cola de recibos offline. Un resultado de red incierto debe verificarse antes de repetir una creacion o una subida.