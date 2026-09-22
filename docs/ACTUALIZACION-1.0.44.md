# Qualitzer tecnicos 1.0.44

APK Android codigo 45, misma identidad y firma. Instalar como actualizacion sin desinstalar ni borrar sesiones, colas, recibos o borradores.

## Google Maps y equipo

- Mi historial de ubicacion abre el punto seleccionado en Google Maps dentro de la app, con hora y precision. No envia el historial completo a Google al abrir la lista.
- Trabajo > Equipo muestra la ubicacion actual, mapa y Editar ubicacion actual cuando el usuario tiene permiso de actualizar el modulo de equipos.
- Busqueda Google, seleccion en mapa, direccion estructurada y Usar mi ubicacion. Esta ultima pide permiso de primer plano explicitamente; no activa el seguimiento laboral ni pide acceso de fondo.
- Lectura/guardado de equipo requiere conexion. Confirmacion solo tras respuesta valida; doble pulsacion bloqueada, direccion original comparada bajo transaccion, conflicto sin sobrescribir. Reintento identico con direccion ya aplicada no vuelve a modificarla.
- La direccion registrada se guarda en el mismo registro que edita la web. Si Qualitzer prioriza un despacho o resguardo activo, se muestra como ubicacion operativa separada; editar la direccion registrada no modifica ese movimiento.
- Visor WebView aislado al origen del portal, sin tokens ni cookies compartidas, sin coordenadas en URL, mensajes con nonce y validacion de esquema. Abrir un mapa transmite ese punto a Google. Historial del tecnico y direccion del equipo son datos distintos.

## Despliegue requerido

1. Frontend: publicar `src/app/api/mobile-map/route.ts` y `public/mobile-map.js` con el proceso habitual. Reutiliza `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` existente. Mantener Maps JavaScript API, Places y restricciones HTTP referrer del dominio del portal; no quitar restricciones ni exponer claves de servidor. La pagina `/api/mobile-map` no consulta datos de negocio ni guarda equipos. No requiere iniciar sesion web.
2. Backend: publicar PanelEquipmentLocation (domain/application/infrastructure/dependencies/routes), referencias equipmentId/equipmentContext en TechnicianDashboard y pruebas fuente. Actualizar salida compilada si corresponde. Sin migracion nueva.
3. Publicar gateway 1.0.21, sidecars, manifiesto, lockfile, .gitignore y comprobador. Con el proceso detenido y drenado, desde la raiz real del backend:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.21.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Arrancar una sola instancia fork sin reload solapado. Instalar APK 1.0.44. Se mantienen tabla de ubicacion y requisitos de sincronizacion de versiones previas. Si falta publicar el visor, la app mostrara error de carga, no un mapa ficticio.

## Verificacion y limites

160 pruebas Mobile/gateway y tipos cliente/servidor sin errores; seis recorridos RN Web 360/390/1280 px con texto normal/ampliado. Componentes y JavaScript del portal reales; Google Maps/GPS/API simulados. Se verifica puente, marcador visible, mapa de historial, busqueda/seleccion/GPS, lectura/edicion/confirmacion, permiso denegado, conflicto, doble pulsacion, respuesta tardia y borrador ante desconexion.

Backend: regresion fuente preparada y diagnosticos revisados. No se ejecutaron sus tests, lint, build, SQL, migraciones ni instalaciones/reinicios. No se ha probado cuenta productiva, persistencia MySQL, claves/restricciones Google desplegadas ni WebView/GPS en telefono real. La compilacion y pruebas locales no acreditan esos puntos.