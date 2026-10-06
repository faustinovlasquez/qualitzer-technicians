# Materiales con linea de tiempo: APK 1.0.76 / gateway 1.0.33

Mantiene todo lo de la [actualizacion 1.0.75](ACTUALIZACION-1.0.75.md) y agrega la pestaña **Materiales** en la barra inferior:

- Badge con la cantidad de materiales (lineas de producto) pendientes de confirmar.
- Resumen superior: materiales por confirmar y en cuantas entregas; "Todo al dia" cuando no queda nada.
- Linea de tiempo agrupada por dia (Hoy, Ayer, fecha) con hora, estado (Por confirmar, Con incidencia, Recibido), codigo de entrega, OT/negociacion o mantenimiento de origen, quien solicita la confirmacion, bodega, destino, motivo, notas y cada producto con su cantidad.
- Confirmar una entrega con un toque o "Confirmar todo" con un paso de confirmacion. Se registra usuario, hora y ubicacion (o el motivo si no esta disponible).
- Alertas para incidencias, errores de conexion y confirmaciones sin respuesta (se reintentan sin duplicar).
- Transiciones suaves al cargar y al pasar de pendiente a recibido.
- El aviso de nueva entrega o recordatorio abre directamente la pestaña Materiales.
- En modo demostracion hay entregas de ejemplo que se confirman solo en memoria.

## Despliegue

El backend agrega a `/inventory_consumptions_v2/my-receipts` los campos opcionales `requestedByName`, `requestedAt`, `sourceType`, `warehouseName`, `reasonLabel` y `notes`. **Backend y gateway 1.0.33 se despliegan juntos**: el gateway 1.0.32 rechazaria los campos nuevos. La app 1.0.75 sigue funcionando con el gateway 1.0.33. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

Pruebas de la app y del gateway pasadas, typecheck de app, gateway y backend sin errores. Revisada a 360 px en React Native Web en modo demostracion: badge, linea de tiempo, confirmar una entrega y confirmar todo.
