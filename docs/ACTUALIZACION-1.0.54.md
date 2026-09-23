# Actualizacion 1.0.54: clave Google para Android

Android versionCode 55. Incorpora la nueva clave Android suministrada por el
usuario mediante GOOGLE_MAPS_API_KEY en el .env privado, excluido de Git.
La clave no se copia a fuentes, documentacion ni registros de diagnostico.
El plugin de react-native-maps y el cliente Places utilizan la configuracion
nativa generada. Cambiar la clave requiere instalar esta nueva APK.

La configuracion efectiva de Expo coincide con el .env. El preflight del
23-09-2026 a las 13:29 UTC respondio HTTP 200 de Places API (New) usando el
paquete y certificado de la APK. Esto no verifica las teselas de Maps SDK
for Android ni sustituye la prueba en un telefono fisico.

Conservar habilitados Maps SDK for Android y Places API (New), facturacion
activa y la restriccion Android para com.qualitzer.field con SHA-1:

```text
B1:A3:1E:CE:4E:B7:53:D1:8E:D2:1A:4D:BB:46:BD:74:81:1F:3B:E4
```

Instalar como actualizacion, sin desinstalar ni borrar datos, sesiones o colas.
No cambia backend, frontend ni gateway 1.0.25. Se conservan los requisitos y
funciones de la version 1.0.53. No cambia la URL de la API ni agrega permisos.

La clave es recuperable de una APK Android: las restricciones de Google Cloud
son necesarias. No compartirla en capturas ni registros.