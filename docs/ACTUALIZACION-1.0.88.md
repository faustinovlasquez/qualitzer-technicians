# Confirmar materiales con ubicación reciente: APK 1.0.88 / gateway 1.0.36

Mantiene todo lo de la [actualizacion 1.0.87](ACTUALIZACION-1.0.87.md) y corrige:

- **Confirmar la entrega fallaba con "La entrega o la ubicación cambió".** Android entregaba una lectura de ubicación guardada de hace minutos y el servidor rechaza ubicaciones de más de 10 minutos (CONSUMPTION_RECEIPT_LOCATION_EXPIRED). Ahora, si la lectura no es de los últimos 2 minutos, se pide otra al GPS; si tampoco es reciente, se confirma sin ubicación (motivo TIMEOUT) en vez de fallar.
- El mensaje de rechazo distingue ubicación desactualizada de entrega cambiada y muestra el código.
- Los errores de notificaciones muestran el código real del servidor (por ejemplo, límite de pruebas por hora) en vez de MOBILE_PUSH_CLIENT_OPERATION_FAILED.

## Actualizaciones automáticas

La publicación firmada en Expo requiere el plan pago EAS Production o Enterprise; la cuenta fv24715s-team no lo tiene, por eso esta corrección se entrega como APK.

## Servidor

Sin cambios respecto a la 1.0.87.

## Verificacion local

1855 pruebas de la app y del gateway pasadas, typecheck sin errores.
