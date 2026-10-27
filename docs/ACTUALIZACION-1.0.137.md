# Actualización 1.0.137 (gateway 1.0.49, sin cambios) — servidor de desarrollo

## Qué trae
- **Gestor de archivos**: cada archivo que se sube muestra su estado en la cuadrícula hasta que el servidor lo lista: «En espera», «Subiendo %», «Subido» (verde, se queda hasta que aparece en la lista aunque el servidor tarde), «En cola» (naranja, guardado sin señal) y «No se subió» (rojo, se toca para reintentar sin volver a elegirlo).
- **APK ofuscada (R8)**: junto al APK queda `qualitzer-tecnicos-1.0.137-android-mapping.txt`, necesario para leer reportes de errores; no se borra.

## Para publicar en desarrollo
1. Backend y web: sin cambios nuevos para esta versión.
2. Base de desarrollo: sin migración nueva.
3. App: rama `desarrollo`, APK 1.0.137 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Instalar encima de la 1.0.136 sin desinstalar ni borrar datos.
