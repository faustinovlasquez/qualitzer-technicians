# Actualización 1.0.135 (gateway 1.0.49, sin cambios) — servidor de desarrollo

## Qué trae
- **Gestor de archivos**: lo que se sube aparece al instante en la cuadrícula con la foto, su avance y el visto bueno al terminar; barra con porcentaje (estimado según el tamaño, se confirma al 100 % cuando responde el servidor). La lista se actualiza sola cada 15 s, al volver a la app y al deslizar hacia abajo; espera a que el servidor muestre lo recién subido. Si se corta la señal antes de enviar, reintenta solo dos veces y luego ofrece «Reintentar los que fallaron». Si la miniatura aún no existe, muestra la foto original.
- **Foto del equipo en el ingreso**: la vista previa usa el archivo elegido (la de texto base64 a veces no se dibujaba en Android).
- **APK ofuscada (R8)**: junto al APK queda `qualitzer-tecnicos-1.0.135-android-mapping.txt`, necesario para leer reportes de errores; no se borra.

## Para publicar en desarrollo
1. Backend (rama `development`): la pasarela no cambia (sigue la 1.0.49). Subir y actualizar el servidor con el arreglo de la inspección del ingreso (`fix(equipment-dispatches): reuse the workshop entry inspection…`).
2. Web (rama `development`): subir y actualizar (inspección correcta en la ficha del ingreso y enlace de las menciones al chat del ingreso).
3. Base de desarrollo: sin migración nueva.
4. App: rama `desarrollo`, APK 1.0.135 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Instalar encima de la 1.0.134 sin desinstalar ni borrar datos.
