# Actualizacion 1.0.48: API de desarrollo

- Android versionCode 49, mismo paquete com.qualitzer.field y firma que 1.0.47.
- Gateway de la APK: https://api-dev-qz-v2.qualitzer.com/mobile.
- API del entorno local: https://api-dev-qz-v2.qualitzer.com/api.
- Sin fallback a demo, cambios del frontend o cambios del backend.
- El gateway 1.0.22 existente se conserva sin reempaquetar ni cambiar su hash.

## Antes de instalar

Sincronizar todos los pendientes y cerrar sesion en la app demo antes de actualizar.
Las sesiones y datos offline estan aislados por la URL completa del gateway.
Una sesion guardada para demo bloquea el acceso desde esta APK; no se borra ni se
migra automaticamente. No desinstalar ni borrar datos para resolver ese bloqueo.
Conservar la instalacion anterior hasta completar la sincronizacion y el cierre
de sesion. Los datos de demo no se envian al servidor de desarrollo.

## Servidor de desarrollo

El 22 de septiembre de 2026, GET https://api-dev-qz-v2.qualitzer.com/mobile/health
respondio HTTP 404. La API nueva debe publicar el gateway en /mobile y las rutas
propias del backend en /api. Cambiar la URL de la APK no despliega esos servicios.

Si el gateway todavia no esta instalado, desde la raiz del backend de desarrollo,
con el proceso detenido y drenado:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.22.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia y comprobar /mobile/health. Debe responder HTTP 200
con ok y backendReachable verdaderos. Configurar tambien las rutas del proxy
inverso para que /mobile llegue al backend. La instalacion del paquete por si
sola no prueba la configuracion del proxy ni la disponibilidad del servicio.

## Verificacion

Pruebas enfocadas en configuracion Expo, HTTPS, aislamiento de datos y bloqueo
de sesiones de otro servidor. La compilacion inspecciona la URL incorporada,
version, firma, integridad y permisos de la APK.

La descarga y firma verificadas no acreditan un login real, escrituras en la
nueva API, GPS nativo, notificaciones remotas ni autorizacion de Google Maps.
Los permisos y funciones de ubicacion por acciones se mantienen sin cambios.