# Qualitzer tecnicos 1.0.24

## Correccion posterior del gateway

El gateway 1.0.9 corrige el rechazo de archivos con tamanos redondeados en KB/MB al consultar listas o comprobar pertenencia para eliminarlos. La APK 1.0.24 permanece identica: este arreglo requiere instalar el paquete nuevo en el backend y reiniciar su unica instancia, sin migraciones. Consultar la guia de despliegue de archivos en Backend/docs/ACTUALIZACION-ASIGNACIONES-MOVILES.md. No repetir cargas que ya estan en cola ni borrar los datos de la app. Las secciones siguientes documentan la entrega original de la APK.

## Bloqueo al iniciar

Cambiar a otra aplicacion y volver a Qualitzer ya no solicita nuevamente la huella ni el PIN. El desbloqueo se mantiene en memoria mientras la instancia de la app siga abierta.

Al arrancar de nuevo tras un cierre real, la app vuelve a pedir autenticacion si esta habilitada la seguridad del telefono. Si Android termina la app en segundo plano, tambien se considera un arranque nuevo. No se guarda un permiso de desbloqueo en el almacenamiento ni se deshabilita la preferencia de seguridad.

El contenido permanece oculto e inactivo en segundo plano. Al volver se espera a que finalice la restauracion de privacidad antes de mostrarlo, sin presentar un boton de desbloqueo innecesario. Los fallos de privacidad, cambios de sesion, verificaciones explicitas de configuracion y selectores nativos conservan sus restricciones de seguridad.

Se mantienen la correccion de adjuntos de 1.0.23, los borradores y la apertura offline. No se modifican colas, recibos, claves de sesion ni bases de datos.

## Instalacion

APK 1.0.24, codigo Android 25. Misma firma, paquete y API. Instalar como actualizacion; no desinstalar ni borrar datos. Se conserva la APK anterior.

No requiere cambios nuevos de backend, gateway 1.0.8, Firebase ni migraciones.

## Verificacion

- 62 pruebas del controlador de bloqueo y 130 de integracion, selectores, permisos y actividades aprobadas.
- Cambios repetidos de aplicacion sin autenticacion adicional; arranque nuevo bloqueado, incluido un arranque inicial en segundo plano. Autenticacion cancelada y privacidad fallida siguen impidiendo el acceso.
- Seis escenarios del panel real en RN Web, con desmontaje Android de modales ocultos: archivos preparados, tres cambios ordinarios de app sin nueva huella, conservacion del borrador, envio manual simulado y reinicio de la pagina que exige autenticacion otra vez. 293 comprobaciones, 12 capturas, cero errores de tipos y navegador.
- Informe visual: artifacts/logs/time-sync-ui/2026-09-18T12-41-10-717Z/report.json.
- Otros 14 escenarios de regreso desde otra app aprobados: seis del selector de hora sin guardar cambios (149 comprobaciones) y ocho de fotos del checklist con borrador conservado (734 comprobaciones). Informes: artifacts/logs/time-sync-ui/2026-09-18T12-48-55-281Z/report.json y artifacts/logs/picker-messages-ui/2026-09-18T12-49-09-972Z/report.json. Cero errores de tipos y navegador. El simulador web antiguo de fotos emite una advertencia por un metodo nativo de permisos no exportado; esa rama no se ejecuta en web y no acredita permisos nativos.

Las transiciones de sistema, biometria y selectores se simulan. No se ha validado esta version en un telefono real ni se han realizado operaciones contra la API de negocio. La recarga del escenario comprueba un proveedor nuevo, no un cierre nativo de Android.