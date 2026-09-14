# Qualitzer técnicos 1.0.5 — configuración Android para notificaciones

## Alcance

Esta actualización incorpora la configuración del cliente Firebase entregada por el propietario y su proyecto Expo/EAS. No cambia trabajos, checklists, adjuntos, autenticación, permisos de negocio ni la cola offline.

- Expo Project ID: `be200e44-9d60-4881-9050-1c67afaeb650`.
- Proyecto Firebase: `qualitzer-7612f`.
- Aplicación Android: `com.qualitzer.field`.
- Versión 1.0.5, código Android 6. Mismo certificado de firma que las versiones anteriores.
- Slug de Expo alineado con el proyecto creado: `qualitzer-tecnicos`. El esquema de enlaces `qualitzer-field`, el paquete Android y los identificadores offline no cambian.

La configuración pública está incorporada en los archivos del proyecto, por lo que llega a prebuild/Gradle incluso con el entorno restringido del compilador. No se copiaron variables de servidor ni claves privadas. El archivo de configuración Firebase del cliente no es una cuenta de servicio.

## Instalar

Instalar mediante **Actualizar** sobre la app existente. **No desinstalar ni borrar datos, sesiones o pendientes.** La URL de la API desplegada permanece igual; no se utiliza Expo Go ni Metro.

## Lo que todavía debe configurar el propietario

Incorporar Firebase en el APK **no confirma la recepción de notificaciones**. Faltan por comprobar las credenciales de envío, el servidor y el permiso del teléfono:

1. En Firebase, proyecto **qualitzer-7612f → Configuración del proyecto → Cuentas de servicio**, preparar una clave de cuenta de servicio autorizada para FCM v1. Conservarla privadamente; no enviarla al chat ni incluirla en el APK.
2. En Expo, proyecto **qualitzer-tecnicos → Project settings → Credentials → Android → com.qualitzer.field → FCM V1 service account key**, subir esa clave privada. El archivo de cuenta de servicio es distinto del archivo Android ya entregado. No generar ni reemplazar la clave de firma Android.
3. En el proceso backend, configurar el mismo `EXPO_PROJECT_ID` y los requisitos `MOBILE_PUSH_*`, verificando primero el esquema tenant. Los valores se leen de `process.env`; un secreto en AWS necesita inyección en ese entorno. No se ha cambiado el servidor durante esta entrega.
4. En el teléfono actualizado, abrir **Avisos → Actualizar estado**. No debe aparecer el aviso de proyecto ausente en la compilación. Si quedan motivos `MOBILE_PUSH_*`, son requisitos del servidor; si aparece proyecto no coincidente, revisar el UUID del backend.
5. Con el servidor habilitado, pulsar **Activar notificaciones** y aceptar el permiso Android. Si está bloqueado, habilitar Notificaciones en los ajustes de Qualitzer técnicos.
6. Confirmar registro activo y probar recepción. Tickets/recibos de Expo no garantizan visualización. Se mantienen horarios silenciosos y restricciones del sistema.

Si la clave pública de configuración Firebase tiene restricciones de API/aplicación, deben permitir Firebase Installations y FCM Registration para el paquete y certificado con que se firma esta distribución. No cambiar restricciones a ciegas ni desactivar validación TLS.

## Verificación de la entrega

APK final: **68.889.774 bytes**, SHA-256 `7c9f509c68182dc36fc9ea5ddcc6a1921d7056fd8c8d3f14fa9d35c958c79c52`. Compilación completada, firma y actualización desde 1.0.4 verificadas, sin permisos añadidos. Se publicó el mismo binario instalado en el emulador, no una recompilación distinta.

El compilador valida el paquete, los proyectos y la ausencia de credenciales privadas en el JSON. Comprueba dentro del APK el Project ID Expo, los recursos Firebase, el proveedor nativo de inicialización, la firma, la versión y las fuentes. El informe usa `push.clientConfigured` y `push.remotePending`: no significa que el backend esté habilitado o que se haya enviado un aviso real.

Pruebas de fuentes: **955 aprobadas, cero fallos, una omitida por plataforma**, incluidas 44 nuevas de configuración y verificación push. Tipos app/servidor/app con pruebas sin errores. Detalles: [validación](../artifacts/logs/release-1.0.5-validation/SUMMARY.md).

Emulador propio Android API 36: actualización sin borrar datos, login visible, mismo proceso sin error fatal y mensaje nativo de inicialización Firebase satisfactoria. No se solicitó permiso, registró dispositivo con una cuenta real ni envió una notificación. [Informe nativo](../artifacts/logs/native-release-1.0.5/push-client-startup.json) y [captura de arranque](../artifacts/logs/native-release-1.0.5/push-client-startup.png).

Guía del servidor y Firebase: [ACTIVAR-NOTIFICACIONES.md](ACTIVAR-NOTIFICACIONES.md). Referencia: [credenciales FCM v1](https://docs.expo.dev/push-notifications/fcm-credentials/).