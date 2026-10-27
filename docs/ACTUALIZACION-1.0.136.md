# Actualización 1.0.136 (gateway 1.0.49, sin cambios) — servidor de desarrollo

## Qué trae
- **Ventanas centradas**: las que salían desde abajo (agregar y eliminar en el gestor de archivos, opciones del chat, recepciones de materiales, tablero del taller, foto de perfil y listas del nuevo ingreso) ahora se abren al centro, para que sus botones no queden bajo la barra de navegación del teléfono.
- **Gestor de archivos**: si una acción falla porque el archivo ya no está (otro lo movió o borró), la ventana se cierra y la lista se actualiza sola.
- **APK ofuscada (R8)**: junto al APK queda `qualitzer-tecnicos-1.0.136-android-mapping.txt`, necesario para leer reportes de errores; no se borra.

## Para publicar en desarrollo
1. Backend y web: sin cambios nuevos para esta versión.
2. Base de desarrollo: sin migración nueva.
3. App: rama `desarrollo`, APK 1.0.136 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Instalar encima de la 1.0.135 sin desinstalar ni borrar datos.
