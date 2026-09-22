# Qualitzer tecnicos 1.0.46

APK codigo 47, misma firma. Instalar como actualizacion sin borrar datos, sesiones, borradores o colas. Gateway 1.0.21 sin cambios. No hace falta publicar codigo frontend para esta version.

## Google directo en la app

- Mapa nativo react-native-maps 1.27.2, Maps SDK for Android, marcador arrastrable y circulo de precision.
- Busqueda mediante Places SDK for Android 3.5.0, con resultados y seleccion explicita; el SDK se comunica con Google, no con Qualitzer Frontend.
- Direccion de un punto mediante Geocoder de Android. GPS solo al pulsar Usar mi ubicacion; captura laboral y consentimiento conservados. Si no se obtiene direccion, las coordenadas permanecen y la direccion se puede escribir.
- Equipo e historial abren el mismo componente nativo. No se carga WebView, iframe, /api/mobile-map ni mobile-map.js. La variante web de desarrollo no sustituye el SDK Android.
- Guardado del equipo sigue pasando por la API autenticada y conserva permisos, direccion previa y conflictos. El mapa no guarda automaticamente.

## Clave local y Google Cloud

La clave se configura en el `.env` del proyecto Qualitzer-Mobile, variable `GOOGLE_MAPS_API_KEY`, documentada sin valor real en `.env.example`. Archivo ignorado por Git. La configuracion Expo lo lee al compilar e inyecta la clave en Android. No se imprime ni se agrega a fuentes o informes; el build redacta claves Google en salida y config de diagnostico. Las claves cliente incluidas en APK son extraibles y deben restringirse en Google Cloud.

El build y `scripts/android/configure-google-maps.cjs` leen unicamente la configuracion de la app; no leen ni modifican archivos de Qualitzer Frontend. La tarea verifica la variable sin mostrar su valor. Cambiar la clave requiere recompilar la APK; cambiar solo el archivo de configuracion no actualiza una APK ya instalada.

**Bloqueo comprobado:** el 22-09-2026 una consulta minima con la clave existente e identidad Android recibio HTTP403 SERVICE_DISABLED para Places API (New). El servicio Places anterior respondio REQUEST_DENIED. No se modificaron servicios, facturacion ni restricciones en Cloud. Debe habilitarse Places API (New), comprobar Maps SDK for Android y facturacion, y autorizar la app:

- Paquete: `com.qualitzer.field`
- Certificado SHA-1: `B1:A3:1E:CE:4E:B7:53:D1:8E:D2:1A:4D:BB:46:BD:74:81:1F:3B:E4`

No quitar restricciones ni cambiar una clave web activa a Android rompiendo la web. Si la clave existente esta limitada a Websites, crear una clave cliente Android del mismo proyecto y colocarla en la configuracion local para recompilar. Una sola clave no puede tener a la vez restricciones Websites y Android. La prueba HTTP no demuestra autorizacion de las teselas del SDK en un telefono.

## Verificacion

164 pruebas de app/gateway y tipos cliente/servidor sin errores. Seis recorridos visuales con componente real y fronteras nativas Google/GPS simuladas, 360/390/1280 px y texto normal/ampliado. Sin solicitudes al frontend ni iframe; cubren seleccion, busqueda, GPS, confirmacion, conflictos y errores. No hay telefono/emulador conectado; falta verificar renderizado nativo y autorizacion Google en dispositivo. No se realizaron escrituras de negocio, SQL, despliegue remoto ni cambios backend/frontend.