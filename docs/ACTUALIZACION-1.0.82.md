# Confirmar materiales sin bloqueos: APK 1.0.82 / gateway 1.0.33

Mantiene todo lo de la [actualizacion 1.0.81](ACTUALIZACION-1.0.81.md) y corrige el error MATERIAL_RECEIPT_LOCKED al confirmar:

- La confirmacion ya no se cancela porque la app este ocupada en otra tarea (por ejemplo, actualizando la agenda). Solo exige la misma sesion, el telefono desbloqueado y la app en primer plano, y espera hasta 8 segundos a que se recuperen.
- El permiso de ubicacion solo se pide si nunca se respondio; si ya estaba concedido no se abre ningun dialogo.
- Si aun asi no puede confirmar, el codigo indica el motivo exacto: MATERIAL_RECEIPT_DEVICE_LOCKED, MATERIAL_RECEIPT_APP_BACKGROUND o MATERIAL_RECEIPT_SESSION_CHANGED.

## Verificacion local

1834 pruebas de la app y del gateway pasadas, typecheck sin errores.
