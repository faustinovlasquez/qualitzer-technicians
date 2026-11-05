# Actualización 1.0.151 (gateway 1.0.52) — producción y Google Play

Versión anterior compilada: 1.0.150. Rediseño del checklist en ventana propia, galería de fotos, mosaico de evidencia y salida para los envíos atascados. Sin permisos nuevos previstos; se confirman al revisar la APK.

## Notas de la versión para Google Play

<es-419>
Nuevo diseño del checklist: se abre en una ventana completa, con respuestas grandes y fáciles de tocar.
Las fotos se suben solas, con su avance a la vista, y se ven en una galería donde puedes deslizar, descargar o eliminar.
Elige ver los archivos en grande, pequeños o en lista, y encuentra la carpeta Lista de chequeo en los trabajos de mantenimiento.
Ahora puedes descartar un envío que falló. Corregimos el conteo de fotos repetidas.
</es-419>

## Orden para publicar

1. Servidor de producción: respaldar la base de datos y actualizarlo a la rama `main` del servidor, que trae la pasarela 1.0.52. Detener el proceso antes de `npm ci`, porque ese comando borra `node_modules`. Correr `npm run migrate` y `npm run tenancy:migrate`.
2. Comprobar `https://api-qz-v2.qualitzer.com/mobile/health`: debe responder `ok: true`.
3. Probar `artifacts/qualitzer-tecnicos-1.0.151-android.apk` en un teléfono contra producción. La corrección de extensiones y la carpeta «Lista de chequeo» dependen de la pasarela 1.0.52.
4. Subir `artifacts/play/qualitzer-operaciones-1.0.151.aab` a Play Console con las notas de arriba. Conservar su archivo de desofuscación.
5. Comprobar que el usuario para revisores de Google sigue entrando en producción.

## Conservar

Los archivos de desofuscación de esta versión y las llaves de firma. Nunca regenerar las llaves.
