# Reporte de errores: APK 1.0.86 / gateway 1.0.36

Mantiene todo lo de la [actualizacion 1.0.85](ACTUALIZACION-1.0.85.md) y agrega:

- **Reporte de errores de la app.** Los errores de JavaScript no controlados (incluidos los que cierran la app) y los de pantalla se guardan en el teléfono y se envían al log del backend al tener sesión, con versión, plataforma y pantalla. Se ocultan correos, tokens y números largos; no se envían datos de formularios. Si no hay conexión quedan en cola (máximo 20) y el mismo error repetido se guarda una vez por minuto.
- En el log del backend se buscan por el título `MOBILE_APP_ERROR`.

No cubre cierres nativos de Android (fuera de JavaScript); para eso haría falta un servicio como Sentry o Crashlytics.

## Servidor

Requiere el backend con `POST /mobile-diagnostics/errors`, la tarea de cierre de plazos de Utilizado/Devolver y el aviso "Devolución solicitada" del panel, y el gateway 1.0.36. Sin migraciones.

## Verificacion local

1852 pruebas de la app y del gateway pasadas, typecheck sin errores. Backend: 9 pruebas de diagnóstico y 13 de Utilizado/Devolver.
