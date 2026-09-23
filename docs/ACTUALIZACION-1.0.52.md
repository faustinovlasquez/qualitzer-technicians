# Actualizacion 1.0.52: selector compacto de equipo

Android versionCode 53. Mismo paquete, firma, API configurada y gateway 1.0.24.
No modifica backend, frontend ni contratos HTTP. No hay migraciones.

## Cambios

- Sin equipo, el formulario muestra un boton Asociar equipo.
- Un solo dialogo permite buscar por Codigo / numero interno o por Catalogo.
  No se apilan dos dialogos para pasar al catalogo.
- Seleccionar cierra el dialogo y muestra un resumen con check verde, nombre,
  numero interno e identificacion cuando el catalogo los proporciona.
- Los iconos Cambiar equipo y Quitar equipo actuan sobre la seleccion.
- Cancelar un cambio conserva la seleccion anterior; una respuesta tardia no
  puede recuperar una seleccion de un dialogo cerrado ni de otra identidad.
- Se reutiliza el mismo selector en creacion de trabajo, mantenimiento y
  edicion de trabajo cuando la asociacion sea editable.
- Un mantenimiento nuevo sigue requiriendo equipo. Quitar la seleccion obliga
  a elegir otro antes de continuar. No elimina el equipo maestro del catalogo.
- La marca verde confirma seleccion en el formulario, no guardado remoto.
  La asociacion se persiste al crear o guardar el registro.
- Se preserva la herencia: un trabajo hijo de mantenimiento no puede cambiar
  el equipo del mantenimiento desde su formulario de trabajo.

Los metadatos del resumen se conservan en el borrador; los borradores anteriores
con solo id/label siguen siendo validos. La API recibe los mismos IDs que antes,
sin campos adicionales ni modificaciones de las colas offline.

## Verificacion y entrega

185 pruebas Mobile/gateway y tipos sin errores; 12 recorridos de los formularios
reales trabajo/mantenimiento y 6 de edicion, con 360/390/1280 px y texto normal
y ampliado. React Native Web, catalogo y OS simulados; no escrituras reales ni
validacion en telefono fisico.

Instalar como actualizacion, sin desinstalar ni borrar datos. No se genera otra
version de gateway ni se requiere reinstalar el backend por esta mejora.
Se mantienen los requisitos de despliegue anteriores para ubicacion por acciones
y edicion de trabajos si aun no fueron publicados.