# Botones con contadores: APK 1.0.68 / gateway 1.0.31

Incluye todo lo de la [actualizacion 1.0.67](ACTUALIZACION-1.0.67.md) y ajusta la fila de acciones de la tarjeta de trabajo:

- Cinco botones en una fila: Iniciar/Pausar/Reanudar, Entregar, Archivos, Checklist y Comentarios. En trabajos finalizados quedan Archivos, Checklist y Comentarios.
- Las cantidades (archivos, checklist completados/total y comentarios) se muestran como contador sobre el icono, no dentro del texto.
- Etiquetas en una sola linea que se ajustan al ancho en telefonos angostos, sin cortarse ni desaparecer.

Gateway 1.0.31 regenerado antes de su primera publicacion: misma funcionalidad (colacion y logos con espacios), con el tipo corregido en la validacion del logo. Sin migraciones.

## Publicacion

Detener y drenar primero la unica instancia del backend. Desde su raiz:

```bash
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.31.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia fork. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

1814 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), typecheck sin errores. Fila de acciones verificada a 360 y 412 px de ancho en React Native Web.
