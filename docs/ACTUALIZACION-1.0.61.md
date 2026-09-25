# APK 1.0.61: actividades offline y dependencias de entrega

Entrega final del soporte descrito en [1.0.60](ACTUALIZACION-1.0.60.md), cuya APK intermedia se conserva sin sobrescribir. Usar esta version 1.0.61 (codigo Android 62), con la misma firma y sin borrar la app ni sus datos.

Permite crear actividades con nombre y minutos en trabajos locales o descargados autorizados. Se conservan en cola antes de enviar; esperan la creacion del trabajo, sobreviven reinicios y reintentan con el mismo UUID. La entrega del trabajo espera tambien las actividades que aun guardan el identificador local original, aunque el trabajo ya tenga su ID del servidor.

Edicion, completado, borrado y adjuntos de actividades siguen online. Los archivos seleccionados se conservan para envio explicito al confirmar la actividad. No se cambian pendientes anteriores, permisos, firmas ni configuracion de servidor.

## Servidor requerido

Publicar MobileSync y PanelWorkActions/TechnicianDashboard actualizados, incluido MobileSyncActivitySequelize.repository.ts y supportsOfflineActivities. No hay nueva migracion. Compilar el backend si su proceso usa build.

Detener y drenar el proceso. Desde la raiz del backend:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.28.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Reiniciar una sola instancia fork, sin reload solapado y conservando directorio y clave de sesiones. Instalar la APK como actualizacion y abrirla con la misma cuenta para sincronizar.

## Verificacion

244 pruebas Mobile/gateway pasan y tipos cliente/servidor sin errores. Seis flujos RN Web con 137 aserciones y 24 capturas verificaron formulario, pendientes, reinicio y reconexion en 360/390/1280 px y texto normal/ampliado. Almacenamiento y servidor de las pruebas son simulados; backend tests preparados, no ejecutados. Despliegue remoto y telefono fisico no comprobados.