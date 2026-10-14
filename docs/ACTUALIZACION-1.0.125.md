# Marcar todas como leídas: APK 1.0.125 / gateway 1.0.42

Mantiene todo lo de la [actualizacion 1.0.124](ACTUALIZACION-1.0.124.md) y cambia:

- **"Marcar todas como leídas"** en la bandeja de avisos (visible cuando hay avisos sin leer). Deja el contador en cero, actualiza el número del ícono y quita de la barra del teléfono los avisos de la sesión.

## Despliegue

Backend y gateway 1.0.42 juntos (`PATCH /mobile-notifications/inbox/read-all`). Sin migraciones.

## Verificacion local

1882 pruebas de la app y del gateway pasadas, typecheck sin errores. Backend: 163 pruebas de avisos móviles pasadas.
