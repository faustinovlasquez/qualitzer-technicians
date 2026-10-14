# Producción: APK 1.0.126 / gateway 1.0.43

Mismo contenido que la [actualizacion 1.0.125](ACTUALIZACION-1.0.125.md), compilada para producción:
la app usa **https://api-qz-v2.qualitzer.com/mobile** (BACKEND_URL=https://api-qz-v2.qualitzer.com/api).

## Requisitos del servidor de producción

Backend con gateway 1.0.43 instalado (npm ci), `/mobile` habilitado y publicado por el proxy, variables
MOBILE_GATEWAY_* y MOBILE_PUSH_*, migraciones tenant de la app aplicadas y PM2 en una sola instancia.
Ver [manual de producción](MANUAL-INSTALACION-PRODUCCION.md) y `npm run diagnose:mobile -- --url https://api-qz-v2.qualitzer.com`.

Mismo paquete que la app de desarrollo: instalarla en un teléfono reemplaza la de desarrollo.
