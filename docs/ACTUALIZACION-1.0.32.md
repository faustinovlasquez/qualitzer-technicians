# Agenda y archivos de actividades

APK 1.0.32, codigo Android 33. Gateway 1.0.12.

## Agenda

- Agenda abre el horario semanal aunque en Mi jornada se haya elegido Mantenimientos u OTs. La preferencia del listado no oculta el calendario.
- Selector Dia, Semana y Mes. Mes consulta el mes completo, permite cambiar de mes y muestra los trabajos y horarios de la fecha seleccionada. Incluye acceso para volver a hoy.
- Semana muestra las asignaciones de los siete dias. Los filtros por tipo siguen disponibles en la vista Lista.
- No se inventan horarios para trabajos sin planificacion. Los dias sin copia local no se presentan como dias libres. Las acciones conservan la fecha original del trabajo.

## Archivos de actividades

- Eliminar archivo aparece junto a las imagenes guardadas de una actividad editable. Siempre pide confirmacion; cancelar no envia una eliminacion.
- Solo se retira la imagen despues de confirmacion del servidor. Un error de borrado conserva la imagen; un error de recarga despues del borrado informa que no debe repetirse.
- Borrado online, sin cola ni reintento automatico. Se invalidan listas locales de archivos de actividades despues de confirmar y se descartan lecturas anteriores que lleguen tarde. No se borran borradores, recibos ni copias de otras operaciones.
- Los documentos del supervisor no reciben esta accion.

## Despliegue requerido

Publicar las fuentes actualizadas PanelWorkActions del Backend, los manifiestos y gateway 1.0.12. Detener y drenar la instancia antes de instalar:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.12.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Actualizar la salida compilada si el proceso la usa y arrancar una sola instancia fork, sin rolling reload solapado. No hay migracion nueva. Instalar la APK como actualizacion, sin desinstalar ni borrar datos. La correccion de Agenda solo depende de la APK; eliminar archivos requiere tambien backend y gateway nuevos.

## Verificacion local

92 pruebas enfocadas de actividades/repositorio movil y 56 de modelo horario/navegacion aprobadas. 16 recorridos visuales de Agenda y 12 de actividades con 368 aserciones, 90 capturas, y texto normal/ampliado en movil y escritorio. Fuentes reales con API, almacenamiento y SO simulados; no escrituras de negocio reales. Pruebas Backend agregadas como fuentes, no ejecutadas por las reglas del repositorio; sin SQL, build ni lint del Backend. El despliegue remoto y el telefono fisico requieren comprobacion posterior.