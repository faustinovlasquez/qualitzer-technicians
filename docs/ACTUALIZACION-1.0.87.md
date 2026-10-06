# Actualizaciones OTA firmadas y Crashlytics: APK 1.0.87 / gateway 1.0.36

Mantiene todo lo de la [actualizacion 1.0.86](ACTUALIZACION-1.0.86.md) y agrega:

- **Actualizaciones OTA firmadas (expo-updates).** Desde esta versión las correcciones de JavaScript se publican con `npm run publish:ota -- "mensaje"` sin generar un APK. La app revisa al abrir, descarga en segundo plano y aplica al siguiente inicio. Solo instala actualizaciones firmadas con la clave privada de Qualitzer (`%LOCALAPPDATA%\QualitzerAndroid\updates-signing\private-key.pem`, fuera del repositorio); el certificado público va en `certs/certificate.pem`. El runtime es la versión de la app: un OTA de 1.0.87 solo llega a teléfonos con el APK 1.0.87. Los cambios nativos (permisos, librerías nativas) siguen requiriendo APK.
- **Firebase Crashlytics** para cierres nativos de Android (fuera de JavaScript), en el mismo proyecto Firebase de los avisos push (qualitzer-7612f). Se asocia solo el id numérico del usuario, la empresa y la sucursal. Hay que activar Crashlytics en la consola de Firebase para ver los reportes.
- Se mantiene el reporte propio de errores de JavaScript (`MOBILE_APP_ERROR` en el log del backend).

## Servidor

Sin cambios respecto a la 1.0.86: backend y gateway 1.0.36.

## Verificacion local

1852 pruebas de la app y del gateway pasadas, typecheck sin errores.
