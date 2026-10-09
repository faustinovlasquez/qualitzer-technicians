# Avisos que se abren desde Mi perfil: APK 1.0.107

Mantiene todo lo de la [actualizacion 1.0.106](ACTUALIZACION-1.0.106.md) y corrige:

- **Tocar una notificación estando en Mi perfil abre su destino** (por ejemplo la OT asignada). Antes la app se quedaba en el perfil sin avisar.
- Solo se espera si hay una sección del perfil abierta (datos, firmas o ajustes de avisos), para no perder cambios sin guardar; en ese caso se muestra el mensaje en la pantalla del perfil.

## Verificacion local

1868 pruebas de la app y del gateway pasadas (1 omitida), typecheck sin errores.
