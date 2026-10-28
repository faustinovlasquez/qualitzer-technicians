# Actualización 1.0.139 (gateway 1.0.49, sin cambios) — servidor de desarrollo

## Qué trae
- **Gestor de archivos sin hueco gris**: al terminar una subida, la foto del teléfono queda de fondo en su recuadro y la del servidor se pone encima cuando termina de descargarse; antes el recuadro quedaba vacío unos segundos y parecía que la foto había desaparecido. Vale para todos los gestores (Taller, OT, trabajo y mantenimiento).
- **APK ofuscada (R8)**: junto al APK queda `qualitzer-tecnicos-1.0.139-android-mapping.txt`, necesario para leer reportes de errores; no se borra.

## Para publicar en desarrollo
1. Backend y web: sin cambios nuevos para esta versión.
2. Base de desarrollo: sin migración nueva.
3. App: rama `desarrollo`, APK 1.0.139 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Instalar encima de la 1.0.138 sin desinstalar ni borrar datos.