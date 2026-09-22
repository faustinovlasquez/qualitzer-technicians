# Actualizacion 1.0.49: configuracion unica de API

Android versionCode 50. Mismo paquete y firma que 1.0.48.

## Entornos sin cambios de codigo

La unica direccion configurable es BACKEND_URL en el .env del proyecto movil,
ignorado por Git. Termina en /api; Expo y los scripts derivan /mobile en el mismo
servidor, conservando cualquier prefijo de ruta.

El proceso o CI/EAS puede suministrar esa misma variable en cada entorno y tiene
prioridad sobre el archivo. No definir EXPO_PUBLIC_GATEWAY_URL por separado.
No hay dominios de desarrollo, demo o produccion en las fuentes activas, perfiles
de EAS ni pruebas de configuracion. Las pruebas usan servidores ficticios, sin
solicitudes a APIs reales y sin depender del .env privado.

La app consume la configuracion embebida de Expo. La compilacion, firma Gradle,
inspeccion de APK, auditoria y entrega contrastan la misma URL derivada.
Se mantienen HTTPS publico obligatorio y bloqueo de sesiones de otro servidor.

npm start y npm run mobile inician Expo contra el gateway configurado. No
inician otra pasarela local automaticamente; npm run gateway permanece como
comando independiente de soporte.

## Instalacion y limites

El destino local no cambia respecto de 1.0.48. Instalar como actualizacion;
no desinstalar ni borrar datos. Si cambia BACKEND_URL entre compilaciones,
sincronizar pendientes y cerrar sesion en el servidor anterior antes de instalar.
No se migran credenciales ni colas entre servidores.

Cambiar .env exige reiniciar Expo o generar una nueva APK. No modifica una APK
ya instalada. En EAS remoto suministrar BACKEND_URL como variable de build,
porque el .env ignorado no se incluye automaticamente.

No hay cambios del backend, frontend ni gateway 1.0.22, ni nuevas migraciones.
El servidor configurado debe exponer /mobile y /api. La disponibilidad observada
durante el build queda registrada en release-verification; no acredita login ni
escrituras reales, GPS nativo, notificaciones o autorizacion de Google Maps.