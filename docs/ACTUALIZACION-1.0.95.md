# Confirmar materiales con el reloj del teléfono adelantado: APK 1.0.95 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.94](ACTUALIZACION-1.0.94.md) y corrige:

- **La primera confirmación seguía fallando con `CONSUMPTION_RECEIPT_LOCATION_EXPIRED`.** La hora de la ubicación la pone el teléfono y el servidor rechazaba lecturas más de 60 segundos "del futuro". Con el reloj del teléfono adelantado, cada lectura recién tomada se rechazaba; al tocar de nuevo, Android devolvía la lectura anterior, ya unos segundos más vieja, y pasaba.
  - **App:** si el servidor vuelve a rechazar la ubicación tras el reintento con ubicación nueva, se confirma en el mismo toque sin ubicación, igual que cuando el GPS no responde.
  - **Backend:** tolera hasta 10 minutos de reloj adelantado, igual que hacia atrás, así que la ubicación se conserva.

## Servidor

Requiere desplegar el backend para conservar la ubicación con relojes adelantados. Sin ese despliegue, la app igual confirma al primer toque, pero sin ubicación. El gateway sigue en 1.0.37.

## Verificacion local

1858 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
