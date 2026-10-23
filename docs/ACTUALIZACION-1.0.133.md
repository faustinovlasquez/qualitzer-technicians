# Actualización 1.0.133 (gateway 1.0.47) — servidor de desarrollo

## Qué trae
- **OT completa en la app**: datos generales editables, trabajos, productos, transporte, otros y archivos, sin precios. Se abre desde el ingreso del Taller y desde Mi jornada («Detalle»). Bloqueada como en la web cuando ya fue enviada al cliente, aprobada, rechazada, revisada o cancelada.
- **Enviar a comercial** desde la OT (botón naranja abajo, con confirmación).
- **Permisos de la app móvil por sucursal** (web: configuración de la sucursal → «Permisos de la app móvil»). Todo permitido por defecto.
- Taller: tarjeta oscura del ingreso con estado y subestado, avance minimizable, entregar equipo fijo abajo con aviso de lo que falta, buscador dentro del ingreso y de la OT, menú inferior oculto dentro del Taller, abrir el trabajo desde el ingreso y la OT, flujo de edición del ingreso hacia la inspección y la firma.
- Clientes con scroll infinito y RUT, equipo nuevo del cliente, dirección de sucursal con mapa, OT sin trabajos, selector de hora simple.
- Nuevo logo de la app.
- La entrega del equipo exige que todas las OTs del ingreso estén enviadas a comercial.

## Para publicar en desarrollo
1. Backend (rama `development`): commit y push del gateway `infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.47.tgz`, `package.json`, `package-lock.json`, `.gitignore` y `scripts/check-mobile-sync-deployment.cjs`; actualizar el servidor.
2. Base de desarrollo: `npm run tenancy:migrate` (incluye `20261023140000-Add-MobileAppConfig-To-CompaniesBranches`; sin ella fallan las consultas de sucursales).
3. Web (rama `development`): ya publicada con el diálogo de permisos.
4. App: rama `desarrollo`, APK 1.0.133 apuntando a https://api-dev-qz-v2.qualitzer.com/api.
