# Reintentar confirmación de materiales sin error de ubicación: APK 1.0.94 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.93](ACTUALIZACION-1.0.93.md) y corrige:

- **"Reintentar confirmación" fallaba con `CONSUMPTION_RECEIPT_LOCATION_EXPIRED` y al tocar de nuevo funcionaba.** El botón reenvía el intento guardado (por ejemplo, tras un corte), que lleva la ubicación de ese momento; si pasaron más de 10 minutos, el servidor la rechaza. El reintento automático de la 1.0.91 solo actuaba al confirmar desde la tarjeta, no desde este botón. Ahora el botón también descarta el intento vencido y confirma en el mismo toque con una ubicación nueva y las entregas que siguen pendientes.

## Servidor

Sin cambios respecto a la 1.0.89 (backend y gateway 1.0.37).

## Verificacion local

1857 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
