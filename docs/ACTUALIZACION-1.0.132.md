# Actualización 1.0.132 — inspección completa, listas de revisión y mantenimientos desde el ingreso (gateway 1.0.46)

## Qué cambia
- **Inspección única para ingreso y entrega**: guía de fotos por ángulo, fotos adicionales con nombre, comparar con la foto del ingreso al entregar, **Descargar comprimido** (zip de fotos, se comparte desde el teléfono) y **Compartir** (enlace público con QR y extender su vigencia).
- **Listas de revisión en la inspección**: resumen, asociar una lista si no tiene y completarla con el mismo diseño y autoguardado de los checklists de los trabajos.
- **Mantenimientos desde el ingreso**: en un equipo propio, la pestaña Mantenimientos permite **Agregar mantenimiento** con el formulario normal de la app; el equipo sale del ingreso.
- **Buscador del Taller fijo en el encabezado**, igual que en Mi jornada.
- Módulo nativo nuevo `expo-sharing` (por eso se requiere APK nueva).

## Despliegue
1. Backend con el cambio de creación móvil (`maintenance.operationAreaEntryId`) y el paquete `@qualitzer/mobile-gateway` 1.0.46, juntos.
2. Instalar la APK 1.0.132 con **Actualizar** (no desinstalar).

Timer, checklist de trabajos y notificaciones no cambian. Sin migraciones.

## Destino de esta APK
Compilada desde la rama `desarrollo`: apunta a `https://api-dev-qz-v2.qualitzer.com/api`.
