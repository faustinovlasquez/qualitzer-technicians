# APK 1.0.60: actividades sin conexion

Version intermedia conservada. Instalar [1.0.61](ACTUALIZACION-1.0.61.md), que tambien protege la entrega cuando las actividades conservan el ID local original.

## Comportamiento

- Crear actividades con nombre y minutos en un trabajo creado offline, o en un trabajo autorizado previamente descargado.
- Guardar formulario y UUID antes de registrar la actividad en la cola. Un fallo de almacenamiento no se anuncia como guardado.
- Esperar la confirmacion del trabajo antes de enviar sus actividades. Reintentar con el mismo UUID y contenido, tambien tras perder una respuesta o reiniciar.
- Mostrar actividades locales y estados pendientes/revision separados de las confirmadas; conservar prueba de lectura con la cache para no ocultarlas con datos antiguos.
- Mantener los pendientes existentes, la firma Android y el servidor configurado. No desinstalar ni borrar datos.

La edicion, completado, borrado y subida de adjuntos de actividades siguen requiriendo conexion. Las fotos ya seleccionadas se conservan en el formulario, pero no se encolan ni se envian automaticamente. No se habilitan actividades sobre una OT local sin trabajo canonico ni se inventan permisos, checklist o ejecucion.

## Despliegue

1. Publicar los cambios de `src/mobileSync` y `src/technicianDashboard` del backend, incluido `MobileSyncActivitySequelize.repository.ts`, soporte de transaccion en PanelWorkActions y `supportsOfflineActivities` en asignaciones. Compilar el backend si el proceso ejecuta archivos de build.
2. Publicar gateway 1.0.28, sus sidecars y las referencias del consumidor. No se necesita una nueva migracion; sigue siendo necesaria la tabla de recibos offline existente.
3. Detener y drenar el proceso del backend. Desde su raiz ejecutar:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.28.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

4. Iniciar una sola instancia fork, sin reload solapado, conservando directorio y clave de sesiones.
5. Instalar APK 1.0.60 como actualizacion, mantener la misma cuenta y abrir la app para sincronizar.

Si falta soporte backend, la actividad permanece pendiente de despliegue. No se reinician recibos de conflicto/revision ni se repiten operaciones con otro UUID.

## Verificacion local

243 pruebas Mobile/gateway y tipos sin errores. Seis escenarios RN Web, 137 aserciones y 24 capturas en 360/390/1280 px y texto 100/200%, con cola real y almacenamiento/servidor simulados. Pruebas backend preparadas pero no ejecutadas. Sin escrituras SQL, despliegue remoto ni validacion en telefono fisico.