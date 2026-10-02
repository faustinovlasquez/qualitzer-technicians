# Permisos limpios para instalacion y Google Play: APK 1.0.75 / gateway 1.0.32

Mantiene todo lo de la [actualizacion 1.0.74](ACTUALIZACION-1.0.74.md) y quita permisos que la app no usa y que Play Protect y la revision de Google Play consideran sensibles:

- Superposicion sobre otras apps (`SYSTEM_ALERT_WINDOW`).
- Servicio en primer plano (`FOREGROUND_SERVICE`); la ubicacion se toma solo al registrar acciones, nunca en segundo plano.
- Permisos de contador de iconos de launchers antiguos (Samsung, Huawei, Oppo, HTC, Sony y otros). Android 8+ muestra el contador con las notificaciones.

La revision de la APK ahora falla si vuelven a aparecer superposicion, ubicacion en segundo plano, microfono u otros permisos restringidos por Google Play.

El gateway y el backend no cambian. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

1819 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), typecheck sin errores. Permisos de la APK revisados con aapt2.
