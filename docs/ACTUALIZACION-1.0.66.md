# Perfil propio y avisos activados: APK 1.0.66 / gateway 1.0.30

## Mi perfil

- Tarjeta con foto circular, nombre (o nombre social), cargo, correo, empresa y sucursal.
- Foto de perfil: tomar con la camara frontal, elegir de la galeria o quitar. Se recorta en cuadrado, se reduce a 768 px y se re-codifica JPEG sin EXIF ni GPS. El backend la vuelve a procesar y la guarda en la carpeta del colaborador del bucket; la anterior pasa a la papelera.
- Datos personales editables por el tecnico: nombres, apellido paterno y materno, nombre social, fecha de nacimiento, genero, nacionalidad, estado civil y grupo sanguineo, con los mismos catalogos del formulario web.
- Identificacion, correo, cargo, permisos, estado y color de avatar solo los cambia un administrador. El servidor rechaza cualquier otro campo.
- Requiere conexion; sin conexion se muestra el aviso y no se guarda nada localmente.

## Notificaciones

- Activadas por defecto. Solo quedan apagadas si el tecnico las desactiva explicitamente en Configurar notificaciones.
- Si falta el permiso del sistema, la app explica el motivo y con Permitir abre el dialogo de Android. Si quedo bloqueado, ofrece Abrir ajustes. Una vez por sesion; espera a que se responda el consentimiento de ubicacion.
- No se muestra el aviso si el servidor tiene las notificaciones deshabilitadas.

## Mi jornada y cabecera

- Cabecera: logo y nombre de la empresa (solo el nombre si no tiene logo). Se quitan el boton de perfil, que duplicaba la pestana Mi perfil, el cierre de sesion, que queda en Mi perfil, y el recargar.
- Barra de conexion en una linea: Conectado u Offline. Su boton sincroniza la cola y actualiza las asignaciones. Al tocarla se abre el detalle de pendientes, conflictos y espacio offline. El resultado de una sincronizacion manual se muestra temporalmente en la misma linea.
- Se elimina el recuadro de resumen (tareas por completar, fecha y minutos planificados): la informacion esta en los contadores y el calendario. El buscador sube a ese lugar.
- Calendario semanal mas compacto, con la misma area tactil.

## Publicacion

Backend: publicar `src/profiles` (rutas `GET/PUT /api/profiles/me` y `PUT/DELETE /api/profiles/me/avatar`). No agrega migraciones. Para las notificaciones, el servidor debe tener `MOBILE_PUSH_ENABLED=true`, `MOBILE_PUSH_SCHEMA_READY=true`, `MOBILE_PUSH_ENCRYPTION_KEY`, `EXPO_PROJECT_ID` y `MOBILE_PUSH_GATEWAY_USER_AGENT` configurados, y Expo la clave FCM V1.

Detener y drenar primero la unica instancia del backend. Desde su raiz:

```bash
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.30.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia fork. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

Backend: 7 pruebas del perfil propio, lint y TypeScript sin errores. App: 1810 pruebas pasadas (1 omitida por ser solo POSIX), typecheck de app y gateway sin errores. Flujo de perfil y foto verificado en React Native Web en modo demostracion.

Pendiente: prueba en telefono fisico de camara frontal, recorte nativo, guardado contra el backend real y S3, y entrega push real tras desplegar.
