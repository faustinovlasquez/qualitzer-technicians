# APK 1.0.142 (versionCode 143)

Sin cambios en el gateway: sigue el 1.0.50.

## Chat y archivos del taller: lo elegido ya no se pierde

Al abrir la cámara, la galería o el selector de documentos, la protección de pantalla marca la app como bloqueada. El taller dependía de eso para estar disponible, así que el chat y los archivos del ingreso (y de sus OT) se cerraban por detrás. Al volver se abrían de nuevo sin la foto o el documento elegido. Ahora el taller sigue disponible mientras el selector está abierto (`App.tsx`).

## Conexión: la app ya no queda «sin conexión» tras un corte breve

- Para revisar la red se pregunta de nuevo al teléfono (`NetInfo.refresh`) en vez de usar el último aviso guardado. Si el teléfono no avisó que volvió la red, la app quedaba pegada en «Sin red». Si el teléfono tarda más de 3 s en responder, se usa lo último conocido (`src/offline/connectivity.ts`).
- Una respuesta del servidor demuestra que hay red: la conexión pasa a «Conectado» aunque el aviso del teléfono siga diciendo lo contrario (`noteConnectionSuccess`).
- Sin conexión, la app vuelve a comprobar como máximo cada 10 s. Antes los intentos se espaciaban hasta 5 minutos.
