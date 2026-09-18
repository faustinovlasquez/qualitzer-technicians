# Qualitzer tecnicos 1.0.23

## Adjuntos en actividades

Corrige la perdida del resultado de camara, galeria y archivos al seleccionarlos dentro del panel de una actividad. En Android, ocultar el modal nativo desmontaba el panel y cancelaba su seleccion antes de preparar el borrador.

El modal conserva su contenido montado durante la interaccion nativa autorizada y hasta completar la restauracion de privacidad. El contenido permanece oculto, sin interaccion ni acceso por lectores de pantalla mientras esta protegido. Un bloqueo normal, la expiracion o el cambio de sesion mantienen sus controles de acceso y cancelacion.

1. Abrir los archivos de una actividad y seleccionar Camara, Galeria o Archivos.
2. Al regresar, comprobar el archivo en la lista de adjuntos sin guardar.
3. Pulsar Subir para enviarlo y esperar la confirmacion del servidor.

Cancelar el selector conserva los adjuntos anteriores. No se inicia una subida automatica ni se cambia el destino de archivos, la cola offline o los recibos. Si una subida previa quedo con respuesta incierta, revisar los archivos confirmados antes de repetirla.

## Instalacion

APK 1.0.23, codigo Android 24, misma firma, paquete y API. Instalar como actualizacion; no desinstalar ni limpiar datos. Se conservan las versiones anteriores y el arranque local de 1.0.22.

Sin cambios nuevos de backend, gateway 1.0.8, Firebase ni migraciones. Esta correccion de seleccion es local a la app; el servidor debe conservar los requisitos de actividades ya publicados en 1.0.20.

## Verificacion

- 130 pruebas enfocadas de seguridad, selectores, permisos y actividades aprobadas.
- Regresion que reproduce el desmontaje de modales ocultos de Android, ambos ordenes de retorno y restauracion diferida de privacidad, con bloqueo habilitado y deshabilitado.
- Seis escenarios del panel real en RN Web: camara, galeria, documento, cancelacion, reapertura del borrador y subida manual simulada al mismo ID de actividad. 179 comprobaciones, 12 capturas, cero errores de tipos y de navegador; anchos 360, 390 y 1280, texto normal y ampliado.
- Los puertos de sistema, resultados de selectores y servidor de estas pruebas son simulados. No habia telefono ni emulador conectado. No se acredita una seleccion nativa ni una subida real a la API; queda por comprobar en el telefono.

Informe visual: artifacts/logs/time-sync-ui/2026-09-18T12-32-28-511Z/report.json.