# Actualización 1.0.150 (gateway 1.0.51) — producción y Google Play

Primera versión ofuscada para Google Play. La versión anterior en la tienda es la 1.0.128. Permisos sin cambios respecto de la 1.0.128; apunta a Android 16 (API 36).

## Notas de la versión para Google Play

<es-419>
Nuevo módulo Taller: ingreso de equipos con inspección y firma, órdenes de trabajo, envío a comercial y entrega del equipo.
Archivos con carpetas y chat de comentarios en ingresos, órdenes, trabajos y mantenimientos.
Gestiona los técnicos de cada trabajo y sigue los trabajos atrasados hasta terminarlos.
Correo de confirmación del ingreso al cliente, vista compacta de trabajos, nuevo logo, mejoras al trabajar sin conexión y app más liviana.
</es-419>

## Orden para publicar

1. Servidor de producción: respaldar la base de datos y actualizarlo a la rama `main` del servidor, que ya trae la pasarela 1.0.51. Las migraciones son de todas las empresas (`npm run migrate` y `npm run tenancy:migrate`), solo se aplican las que falten. Revisar `pm2` en modo fork, una instancia y `kill_timeout` de 40000.
2. Web de producción: actualizarla a la rama `main`.
3. Comprobar `https://api-qz-v2.qualitzer.com/mobile/health`: debe responder `ok: true`.
4. Probar la APK `artifacts/qualitzer-tecnicos-1.0.150-android.apk` en un teléfono contra producción.
5. Play Console: subir `artifacts/play/qualitzer-operaciones-1.0.150.aab` con las notas de arriba. Conservar `qualitzer-operaciones-1.0.150-mapping.txt` para leer errores.
6. Comprobar que el usuario para revisores de Google sigue entrando en producción.
7. Publicar por etapas (por ejemplo, 20 %) y revisar Play Console y Crashlytics antes de llegar al 100 %.

## Conservar

Los archivos de desofuscación de esta versión y las llaves de firma. Nunca regenerar las llaves.
