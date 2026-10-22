# Actualización 1.0.129 — Taller en la app y logo oficial (gateway 1.0.44)

## Qué cambia
- Pestaña **Taller**: tablero de naves e ingresos, ficha del ingreso, ingreso en tres pasos (datos y foto, inspección, firma de recepción), trabajos del ingreso con la ficha normal de la app (iniciar, cronómetro, archivos, checklist), órdenes de trabajo sin precios que se envían a comercial, entrega del equipo con firma, mover de nave, fecha estimada con motivo y cambio de estado/subestado.
- **Logo oficial** nuevo en el ícono, la app, las notificaciones y la página de descarga.

## Despliegue (en este orden)
1. Backend de la misma entrega (incluye `work.operationAreaEntryId` en la creación móvil y el paquete `@qualitzer/mobile-gateway` 1.0.44).
2. Instalar la APK 1.0.129 (reemplaza a la anterior sin desinstalar).

## Requisitos
- Migraciones del ingreso a taller aplicadas (works, maintenances, envíos a comercial, inspecciones obligatorias, firmas del ingreso, foto en bitácora de naves). En producción, respaldo antes.
- Permisos del técnico: guardar inspecciones pide "editar" en Equipos de arriendo; unir trabajos a un ingreso u OT pide "editar" en Trabajos. Sin ellos la app explica el permiso que falta.

## Destino de esta APK
Compilada desde la rama `desarrollo`: apunta a `https://api-dev-qz-v2.qualitzer.com/api`.
