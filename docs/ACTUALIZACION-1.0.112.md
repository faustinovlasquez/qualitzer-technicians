# Avisos que abren su destino: APK 1.0.112 / gateway 1.0.40

Mantiene todo lo de la [actualizacion 1.0.111](ACTUALIZACION-1.0.111.md) y corrige:

- **Tocar una notificación abre su destino** (OT, trabajo o Materiales). La causa: la bandeja de avisos contenía avisos de otra empresa que comparte la base de datos, y la app y el gateway rechazaban la página completa (MOBILE_PUSH_IDENTITY_MISMATCH); sin bandeja, la app no navegaba.
- La app y el gateway 1.0.40 omiten los avisos ajenos en vez de rechazar la bandeja; el backend filtra la bandeja por empresa.
- Si la bandeja no responde, la app abre igual un aviso dirigido explícitamente a este usuario y técnico.
- Se mantiene la tarjeta "Diagnóstico de avisos tocados" en Notificaciones.

## Despliegue

Backend y gateway 1.0.40 juntos. Sin migraciones. La APK funciona también con el gateway anterior (abre el aviso aunque la bandeja falle).

## Verificacion local

1872 pruebas de la app y del gateway pasadas, typecheck sin errores.
