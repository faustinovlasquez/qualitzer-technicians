# Configurar el servidor para el APK de Qualitzer Field

Guía para el programador/administrador del servidor Linux. Fecha: 10-09-2026.
Estos pasos se ejecutan en el servidor de la API, no en el teléfono ni en el PC de desarrollo. No se ejecutaron desde esta guía.

## Resultado esperado

- API existente: **https://api-demos-qz-v2.qualitzer.com/api**.
- Servicio móvil integrado en esa API: **https://api-demos-qz-v2.qualitzer.com/mobile**.
- Comprobación: **https://api-demos-qz-v2.qualitzer.com/mobile/health**.
- El APK existente usa la segunda dirección. No necesita Expo Go, Metro, otro dominio ni otro puerto público.

La respuesta `MOBILE_GATEWAY_NOT_FOUND` en `/mobile/health` muestra que la petición alcanza la fachada móvil y, con el código entregado, normalmente indica que está desactivada. No es un rechazo de la contraseña. Activar variables y reiniciar no sustituye comprobar los demás requisitos.

## 1. Identificar el servicio y respaldar

Antes de modificar nada, identificar nombre del proceso PM2, usuario/grupo Linux que lo ejecuta, directorio del backend, puerto interno y configuración del proxy. No asumir que el nombre PM2 coincide con el archivo de ejemplo.

```bash
pm2 list
pm2 describe NOMBRE_REAL_DEL_PROCESO
node --version
```

Ejecutar PM2 con el usuario que administra ese proceso. Respaldar configuración y bases de datos antes de aplicar cambios o migraciones. Si ya hay sesiones móviles, respaldar su directorio privado completo, con el proceso detenido y acceso restringido.

## 2. Desplegar la versión que incluye el módulo móvil

La integración está en la rama `app-mobile`; el commit comprobado localmente es `e6b9cf642096a70c5d294f4891178913dc268195`. También puede integrarse en la rama habitual de despliegue, preservando los demás cambios. No cambiar ramas a ciegas ni ejecutar un reset destructivo.

La copia local del backend estaba en `refactor-inventario` al preparar esta guía y no contenía el módulo. Esto no identifica la rama del servidor: el programador debe verificar su entrega real.

La entrega del backend debe incluir:

```text
src/mobileGateway/
src/app.ts
package.json
package-lock.json
infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.0.tgz
```

Verificar que el arranque monta `/mobile` antes del CORS/parser/autenticación legacy y registra el cierre seguro cuando el módulo está habilitado. Conservar las rutas de autenticación móvil, panel técnico, creación, sincronización y notificaciones incluidas en la misma versión.

No subir la carpeta del proyecto Mobile, sus credenciales de firma Android, sesiones del PC ni dependencias locales al servidor. No cambiar el script de despliegue para otra rama sin revisar qué proceso actualiza.

## 3. Instalar dependencias del backend

Usar una versión Node mantenida y compatible con el backend; el paquete móvil requiere Node **20.12.2 o posterior**. No actualizar el motor de toda la API sin validar compatibilidad.

Desde el directorio de la versión del backend que se va a desplegar:

```bash
npm ci --include=dev --ignore-scripts
npm ls @qualitzer/mobile-gateway
```

Debe aparecer `@qualitzer/mobile-gateway@1.0.0`. El tarball viene preempaquetado; no necesita recompilarse en el servidor. Se incluyen dependencias de desarrollo porque el arranque existente utiliza `ts-node`/`tsconfig-paths`. Si el procedimiento del servidor usa código compilado, reconstruir la API conforme a ese procedimiento y apuntar PM2 a la salida nueva, no a una compilación anterior.

`--ignore-scripts` no ejecuta los scripts de instalación de otras dependencias. Si alguna dependencia nativa del backend requiere un paso de instalación aprobado, conservar ese paso del despliegue habitual. No ignorar errores de dependencias o del lockfile.

## 4. Crear la carpeta privada de sesiones

Ejemplo de ubicación Linux:

```text
/var/lib/qualitzer-mobile/sessions.enc
```

El directorio padre debe existir y pertenecer al usuario Linux que ejecuta la API, no al usuario que inicia sesión en Qualitzer. Sustituir los dos marcadores antes de ejecutar:

```bash
sudo install -d -m 700 -o USUARIO_LINUX_API -g GRUPO_LINUX_API /var/lib/qualitzer-mobile
sudo -u USUARIO_LINUX_API test -w /var/lib/qualitzer-mobile
stat -c '%U %G %a %n' /var/lib/qualitzer-mobile
```

La última salida debe mostrar el propietario correcto y `700`. La carpeta debe estar fuera del código/releases, en disco local persistente y sin enlaces simbólicos. No usar una carpeta temporal, pública o compartida entre varias instancias.

No crear el archivo de sesiones ni la clave a mano. La aplicación los genera; los archivos privados usan permisos `600`. Si ya existen, conservarlos. No usar `chmod 777` ni borrar archivos para resolver problemas de permisos.

## 5. Identificar la IP real del proxy

El proxy (por ejemplo, Nginx) recibe HTTPS y conecta con Node. Revisar su configuración y confirmar qué IP del peer TCP ve Node. No es la IP del teléfono ni necesariamente la IP pública del dominio.

Sólo si Nginx conecta desde el propio servidor mediante `127.0.0.1`, ese valor puede usarse en `MOBILE_GATEWAY_TRUSTED_PROXIES`. Si utiliza IPv6 u otro balanceador, configurar las IP exactas comprobadas, separadas por comas. No usar comodines, rangos CIDR ni `trust proxy=true`.

## 6. Cargar las variables en el lugar correcto

**No cambiar `USE_ENV` para habilitar el móvil:** podría cambiar cómo toda la API obtiene sus secretos.

- Si `USE_ENV=development`, agregar las variables al entorno efectivo del proceso o al archivo de entorno del backend que carga el servidor.
- Si tiene cualquier otro valor, agregarlas al JSON de AWS Secrets Manager identificado por `AWS_SECRET_NAME`. El código no usa el archivo local como alternativa. Conservar las claves existentes y cargar los nuevos valores como **strings**; CORS debe ser `""`, no `null` ni un array. El lector AWS actual lanza un error si falta una clave consultada.

Bloque que se debe agregar, sin reemplazar la configuración existente de la API:

```dotenv
MOBILE_GATEWAY_ENABLED=true
MOBILE_GATEWAY_BACKEND_URL=https://api-demos-qz-v2.qualitzer.com/api
MOBILE_GATEWAY_SESSION_FILE=/var/lib/qualitzer-mobile/sessions.enc
MOBILE_GATEWAY_TRUSTED_PROXIES=REEMPLAZAR_POR_IP_REAL_DEL_PROXY
MOBILE_GATEWAY_CORS_ORIGINS=
```

Cambiar el marcador de proxy por el valor del paso 5. Si se eligió otro directorio en el paso 4, ajustar la ruta del archivo. No introducir variables `EXPO_PUBLIC_*`, puertos 8081/8787 ni secretos de firma Android en el backend.

`MOBILE_GATEWAY_CORS_ORIGINS` vacío sirve para el APK nativo. Sólo necesita valores cuando una web vaya a consumir esta pasarela; en ese caso son origins HTTPS exactos aprobados, no la dirección del teléfono ni `*`.

## 7. Revisar proxy, HTTPS y cargas de archivos

El proxy del dominio debe:

1. Mantener su certificado HTTPS válido y la publicación actual de `/api`.
2. Reenviar `/mobile` y `/mobile/...` al mismo proceso/puerto de la API **sin quitar el prefijo**. No sustituirlo por `/api` ni redirigirlo.
3. Sobrescribir las cabeceras de protocolo/IP de acuerdo con la cadena real de proxies. No confiar en valores arbitrarios enviados por el cliente.
4. Evitar caché de las respuestas móviles y acceso público directo al puerto Node.
5. Permitir un archivo de hasta 25 MiB más el multipart; un límite de cuerpo de 30 MiB es suficiente para un archivo permitido. Configurar tiempos de lectura/escritura acordes con cargas de hasta 120 segundos y limitar clientes lentos/cabeceras.

Ejemplo **sólo** para Nginx que termina TLS en el mismo servidor y conecta a Node por loopback. Adaptar el puerto; añadir dentro del bloque HTTPS existente, no reemplazar toda la configuración:

```nginx
location /mobile/ {
    proxy_pass http://127.0.0.1:PUERTO_INTERNO_API;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_cache off;
    client_max_body_size 30m;
    client_body_timeout 120s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 150s;
    proxy_read_timeout 150s;
}
```

**No añadir barra final al `proxy_pass` del ejemplo**, porque eliminaría `/mobile/`. Revisar también el tratamiento de la ruta exacta `/mobile` según la configuración existente. Si hay CDN/balanceador delante de Nginx, adaptar protocolo/IP real y confianza a esa topología; no copiar el ejemplo como si Nginx recibiera TLS directamente.

Validar la configuración de Nginx antes de recargarlo. Confirmar que el propio servidor puede acceder por HTTPS a su catálogo, sin desactivar la validación TLS:

```bash
curl --fail --silent --show-error --max-time 30 https://api-demos-qz-v2.qualitzer.com/api/auth/mobile/config
```

Debe responder JSON versión 1 y tenants válidos, no HTML ni redirecciones. La clave `tenants` procede del master; no editar el APK para elegir una empresa.

## 8. Revisar las bases de datos y el almacenamiento de archivos

Mantener la configuración existente de base master/tenants, JWT, usuario/trabajador/sucursal y S3. El guardado de imágenes requiere bucket y credenciales S3 válidas en el servidor. Redis y sus workers deben conservar la configuración que use actualmente el backend; no habilitarlo o deshabilitarlo a ciegas para solucionar el gateway.

Revisar el historial de migraciones de cada tenant que usará la app. La versión móvil incorpora:

```text
20260908160000-Create-MobileCreationRequests.js
20260908160000-Create-MobileNotifications.js
20260909120000-Create-MobileSyncReceipts.js
```

Creación necesita `mobile_creation_requests`; sincronización necesita `mobile_sync_receipts`; las funciones de notificaciones requieren sus tablas correspondientes. El gateway no crea estas tablas automáticamente.

Después de respaldo y revisión de **todas** las migraciones pendientes, el comando existente para una base tenant concreta es:

```bash
npm run tenancy:migrate -- --database NOMBRE_REAL_BASE_TENANT
```

No ejecutarlo sin revisar: aplica todas las migraciones pendientes del tenant, no sólo las tres listadas. Sin `--database` puede recorrer todos los tenants. No recrear bases, ejecutar seeds de ejemplo ni deshacer migraciones para activar el APK.

## 9. Configurar una instancia y reiniciar correctamente

En la entrada PM2 del backend existente:

```javascript
exec_mode: "fork",
instances: 1,
kill_timeout: 40000
```

Conservar nombre, script, argumentos, directorio y demás opciones reales. No crear un segundo backend paralelo. Usar **stop → esperar salida completa → start**, con la configuración/entorno nuevos. Evitar reload solapado o varias réplicas: el almacenamiento de sesiones tiene un solo escritor y los desafíos de login son locales al proceso.

El módulo cachea su configuración inicial; modificar variables sin reiniciar no activa una instancia que ya se inició deshabilitada. El cierre correcto libera su lock. Tras una terminación forzada, revisar el lock sólo después de confirmar que el proceso propietario murió; nunca borrar sesiones o clave para arrancar.

## 10. Comprobar salud y autenticación

Desde el servidor y desde otra conexión a Internet:

```bash
curl --include --max-time 30 https://api-demos-qz-v2.qualitzer.com/mobile/health
```

Esperado: HTTP 200 y:

```json
{"ok":true,"backendReachable":true}
```

Comprobar que la ruta protegida reconoce que no hay sesión:

```bash
curl --include --max-time 30 https://api-demos-qz-v2.qualitzer.com/mobile/api/auth/me
```

Sin credenciales, es correcto recibir 401, no 404. No introducir contraseñas en comandos, logs ni esta guía. El login se prueba desde el APK usando la cuenta autorizada. Un health 200 no acredita por sí solo login, archivos o sincronización.

## 11. Probar el APK con datos móviles

Con el PC/Metro apagado y el teléfono usando datos móviles:

1. Abrir el APK existente e iniciar sesión con credenciales del servidor.
2. Elegir empresa si aparece más de una coincidencia; verificar sucursal y trabajador vinculados.
3. Consultar jornada, agenda, equipo y checklist.
4. Con datos de prueba autorizados, guardar comentario, respuesta y una foto; verificar su existencia en la API/web.
5. Preparar la copia offline, desconectar, guardar un pendiente y reconectar con la app abierta. Confirmar sincronización sin duplicar.
6. Cerrar/abrir la app y realizar un reinicio controlado del backend para verificar que la sesión se conserva.
7. Confirmar que el frontend y las rutas `/api` preexistentes siguen funcionando.

No reinstalar ni borrar datos del teléfono para limpiar una cola pendiente. La instalación del mismo APK no necesita cambiar por activar estas variables.

## 12. Notificaciones push: etapa adicional

Las operaciones principales no necesitan push. No habilitarlo sólo por haber instalado el APK: el APK entregado no tiene completada/verificada la configuración de proyecto Expo y Firebase para recepción remota.

Si se necesitan avisos con la app cerrada, preparar proyecto Expo real, FCM v1 y configuración Firebase de Android; igualar `EXPO_PROJECT_ID` entre backend y build, preparar clave privada `MOBILE_PUSH_ENCRYPTION_KEY`, revisar esquema y activar `MOBILE_PUSH_ENABLED` / `MOBILE_PUSH_SCHEMA_READY` sólo después. Conservar el User-Agent `Qualitzer-Mobile/1.0 (Mobile; Gateway)` y configurar `EXPO_ACCESS_TOKEN` sólo si aplica. Los secretos se gestionan en el servidor/EAS, nunca en el chat ni en el bundle.

Esa activación puede requerir **otro build del APK con configuración Firebase/proyecto**. No contradice que el APK actual sea standalone: Expo Go no se necesita. Procedimiento detallado en [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md).

## 13. Diagnóstico y mantenimiento

| Respuesta | Qué revisar |
| --- | --- |
| `MOBILE_GATEWAY_NOT_FOUND` en `/mobile/health` | Con la integración entregada, revisar activación `true`, proveedor de configuración y reinicio; normalmente está deshabilitado. |
| HTML `Cannot GET /mobile/health` | Versión ejecutada, montaje `/mobile` y reenvío del proxy. No es el mismo caso anterior. |
| `MOBILE_GATEWAY_UNAVAILABLE` | Variables, lectura de secretos, paquete instalado, carpeta/permisos/lock, catálogo y TLS. Revisar sin borrar archivos privados; cooldown de 30 s tras fallo. |
| `HTTPS_REQUIRED` | IP de proxy confiable y protocolo reenviado. No desactivar HTTPS. |
| `ORIGIN_FORBIDDEN` | Una petición de navegador tiene un Origin no permitido. El APK nativo no requiere CORS. |
| `NOT_FOUND` del gateway | Prefijo/ruta incorrectos; no quitar `/mobile`. |
| `MOBILE_CREATION_SCHEMA_NOT_READY` / `MOBILE_SYNC_SCHEMA_NOT_READY` | Migraciones del tenant, no configuración del teléfono. |
| 413 al subir | Límite de archivo del cliente/gateway/proxy. |
| 401 en login | Credenciales/tenant/cuenta; no compartir contraseñas ni confundirlo con 404 de ruta. |

Mantener backups privados de clave y sesiones juntos, permisos y directorio entre actualizaciones. No publicar su contenido en logs ni copiarlos a otro entorno. Conservar también la clave de firma Android en su almacenamiento privado de desarrollo para futuras actualizaciones del APK.

**Criterio de cierre:** health 200, login real, lectura y guardado autorizados, foto confirmada, recuperación offline sin duplicados y funcionamiento con datos móviles sin el PC. No marcar el despliegue completo sólo porque desapareció el 404.