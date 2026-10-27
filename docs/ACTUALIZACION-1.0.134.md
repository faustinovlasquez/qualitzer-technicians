# Actualización 1.0.134 (gateway 1.0.48) — servidor de desarrollo

## Qué trae
- **Archivos con carpetas** y **chat de comentarios** en el ingreso, la OT, el trabajo y el mantenimiento, con avisos en vivo y menciones.
- **Equipo de técnicos asignados**: desde la tarjeta o el detalle se agregan o quitan personas (desde hoy en adelante, nunca deja el trabajo sin nadie). Nuevo permiso «Asignar técnicos», activo por defecto.
- **Trabajos atrasados**: un trabajo, OT o mantenimiento sin terminar sigue apareciendo día a día hasta hoy, hasta que se termina o entrega.
- **Vista compacta o extendida** de los trabajos en el Taller.
- Eliminación desde la app, mejores avisos de sincronización sin conexión y textos de inicio de sesión («Correo»).
- **APK ofuscada (R8)**: más liviana y difícil de copiar. Junto al APK queda `qualitzer-tecnicos-1.0.134-android-mapping.txt`, necesario para leer reportes de errores; no se borra.

## Corrección: gateway 1.0.49
Tras actualizar el servidor de desarrollo la pasarela quedó apagada (`/mobile/health` → 503 `MOBILE_GATEWAY_UNAVAILABLE`) y la app solo decía «No se pudo iniciar sesión». Causa probable: candado de sesiones `.writer.lock` dejado por el proceso anterior. La 1.0.49 lo recupera sola y el backend registra el motivo en el log.

## Para publicar en desarrollo
1. Backend (rama `development`): commit y push del gateway `infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.49.tgz`, `package.json`, `package-lock.json`, `.gitignore` y `scripts/check-mobile-sync-deployment.cjs`; actualizar el servidor.
2. Base de desarrollo: sin migración nueva.
3. App: rama `desarrollo`, APK 1.0.134 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Probar en el teléfono lo indicado en la etapa 2 de Plan-google-play.md.
