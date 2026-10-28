# Actualización 1.0.138 (gateway 1.0.49, sin cambios) — servidor de desarrollo

## Qué trae
- **Chat con teclado en Android**: con la pantalla completa obligatoria de Android la ventana ya no se achica sola; ahora el campo donde se escribe sube sobre el teclado y la conversación mantiene a la vista el último mensaje (ingreso, OT, trabajo y mantenimiento).
- **Gestor de archivos**: el estado de las subidas se guarda fuera de la pantalla. Si la pantalla se vuelve a armar (al volver de la cámara o la galería, o al salir y entrar), las fotos siguen a la vista con su avance, «Subido», «En cola» o «No se subió».
- **APK ofuscada (R8)**: junto al APK queda `qualitzer-tecnicos-1.0.138-android-mapping.txt`, necesario para leer reportes de errores; no se borra.

## Para publicar en desarrollo
1. Backend y web: sin cambios nuevos para esta versión.
2. Base de desarrollo: sin migración nueva.
3. App: rama `desarrollo`, APK 1.0.138 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Instalar encima de la 1.0.137 sin desinstalar ni borrar datos.
