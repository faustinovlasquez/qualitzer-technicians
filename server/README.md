# Gateway móvil multitenant Qualitzer

Gateway Express 5 / TypeScript para Node 22, con inyección manual. Consume HTTP, sin conexión SQL ni credenciales de base de datos. Conserva sesiones en disco cifrado y necesita una clave de cifrado protegida. Los contratos móviles y esquemas Zod limitan la información publicada.

## Integración

- **Rama de integración:** backend y frontend en `app-mobile`; no se afirma árbol limpio. El flujo nuevo añade autenticación móvil neutral sin modificar login web/JWT existentes. Frontend intacto en este cambio; no es destino de configuración móvil. Las comprobaciones históricas prepare/exchange con `{}` → **400** y comentarios sin sesión → **401** no equivalen a una prueba autenticada.
- **Integración presente:** config/discover/complete neutrales, grants y rate limiter; prepare/exchange permanecen para compatibilidad explícita. Recursos backend del panel y componentes frontend relacionados presentes. El montaje incluye hidratación de evidencia estándar; el diálogo web de comentarios está presente e importado. Comentarios según fuente, espejo `maintenanceWork.workId` y evidencia con `work_files`/namespace siguen pendientes de validación autenticada. Véase [../docs/PANEL-TECNICO.md](../docs/PANEL-TECNICO.md).
- **Requisito de despliegue normal:** el backend central debe exponer `GET /auth/mobile/config`, `POST /auth/mobile/discover` y `POST /auth/mobile/complete` sin Origin. Los endpoints prepare/exchange se conservan exclusivamente para configuración legacy explícita. No hay fallback entre modos.
- [app.ts](app.ts) conecta autenticación y sesiones y monta, por tenant y después de sesión, **OT → panel → asignaciones**. CORS incluye `DELETE`; panel/asignaciones comparten los dos slots de upload. [index.ts](index.ts) carga la configuración y abre HTTP. El arranque mediante [../INICIAR.cmd](../INICIAR.cmd) utiliza persistencia; una app de pruebas sin archivo de sesiones no demuestra conservación tras reinicios.
- [session-persistence.ts](session-persistence.ts) administra el almacén cifrado; [session-context.ts](session-context.ts) vincula cada sesión a su tenant y transporte. Los límites por IP y los dos slots de upload son de instancia.
- [assignments/authorization.ts](assignments/authorization.ts) revalida usuario, sucursal y pertenencia al agregado técnico canónico antes de operar.
- [creation/routes.ts](creation/routes.ts) y [notifications/routes.ts](notifications/routes.ts) están montados tras sesión y por tenant. Creación técnica y avisos están implementados; **ambas migraciones tenant y activación real siguen pendientes**, con flags push deshabilitados y clave no configurada. Guía de despliegue: [../docs/PLANIFICACION-Y-AVISOS.md](../docs/PLANIFICACION-Y-AVISOS.md).

El teléfono apunta a la IP LAN del gateway, normalmente puerto 8787; `127.0.0.1` identifica al teléfono, no al PC. Para uso diario y QR en pantalla, ver [../README.md](../README.md). Los scripts `gateway`, `test` y `typecheck` están en [../package.json](../package.json).

### Entorno

**Configuración normal: sólo `BACKEND_URL` como destino de API, no una URL del proyecto frontend.** En [../.env](../.env) ya se retiraron las dos variables legacy. Deben estar ausentes también del entorno heredado del terminal/IDE/servicio: dejarlas vacías no desactiva compatibilidad. El launcher carga el entorno y lo hereda a sus hijos; no requiere nuevos argumentos de tenant ni cambios de dotenv. Guía breve: [../docs/CONFIGURACION-BACKEND.md](../docs/CONFIGURACION-BACKEND.md).

| Variable | Predeterminado / regla |
| --- | --- |
| `GATEWAY_TENANTS_FILE` | **Deprecada:** su presencia explícita activa modo legacy. Sin esta variable no se lee una allowlist para routing normal |
| `BACKEND_URL` | `http://127.0.0.1:5001/api`; único destino HTTP fijado del modo backend, incluso para tenants descubiertos |
| `TENANT_ORIGIN` | **Deprecada:** su presencia explícita activa modo legacy. En modo backend está ausente, sin valor localhost predeterminado |
| `GATEWAY_PORT` | `8787` |
| `GATEWAY_HOST` | `0.0.0.0` en desarrollo/test; `127.0.0.1` en producción |
| `NODE_ENV` | `development`, `test` o `production` |
| `GATEWAY_CORS_ORIGINS` | Lista separada por comas de orígenes exactos. Por defecto `http://localhost:8081,http://127.0.0.1:8081` |
| `GATEWAY_TRUSTED_PROXIES` | IPs literales exactas separadas por comas; vacío en desarrollo. Nunca `true`, comodines ni número de saltos |
| `GATEWAY_SESSION_FILE` | Almacén cifrado local; el arranque normal usa .data/sessions.enc bajo la raíz del proyecto. Una ruta explícita relativa se resuelve contra el directorio actual; requiere un directorio privado dedicado |
| `GATEWAY_SESSION_SECRET` | Clave de 32 bytes: 64 caracteres hexadecimales o 43 base64url canónicos. Obligatoria en producción; sin ella, desarrollo genera y reutiliza session.key junto al almacén. No incluir claves reales en documentación, cliente ni logs |

La plantilla [../.env.example](../.env.example) también documenta `EXPO_PROJECT_ID` (UUID **público**, sin valor ficticio) y `GOOGLE_SERVICES_FILE` (ruta opcional a configuración Firebase del build Android). Los consume [../app.config.ts](../app.config.ts), no son credenciales del gateway. Push requiere build nativo, proyecto coincidente en backend y credenciales privadas EAS/FCM/APNs configuradas por separado; ninguna va al cliente ni al chat. Variables y flags del backend: [../docs/PLANIFICACION-Y-AVISOS.md](../docs/PLANIFICACION-Y-AVISOS.md).

Para Expo web por LAN, autorizar el origen correspondiente, por ejemplo `http://192.168.1.20:8081`, en `GATEWAY_CORS_ORIGINS`; el launcher de desarrollo añade los orígenes LAN detectados en puerto 8081. Detectar la IP para el QR no autoriza orígenes arbitrarios ni subdominios. Web usa cookies con credenciales y Origin exacto; clientes nativos sin Origin usan Bearer. **CORS no selecciona empresa ni sustituye autenticación.**

En producción el arranque exige `BACKEND_URL` HTTPS, allowlist CORS explícita solo HTTPS e IPs de proxy confiables. Un tenant marcado `production` también exige portalOrigin HTTPS aunque el proceso sea de desarrollo; metadata `development` con Origin HTTP no convierte ese Origin en destino de red. Legacy conserva su validación HTTPS de todos los tenants configurados, incluso deshabilitados. Además se rechazan solicitudes cuyo protocolo efectivo no sea HTTPS. El proxy debe terminar TLS, **reescribir** X-Forwarded-Proto/X-Forwarded-For y ser el único que pueda conectarse al listener mediante firewall/red privada. No exponer el listener HTTP de producción directamente. El gateway no administra certificados. En desarrollo HTTP, usar únicamente redes de confianza; Bearer y contraseñas no están cifrados en ese tramo.

### Catálogo central, arranque y renovación

- `loadConfig()` usa `tenantResolution: "backend"` salvo variables legacy explícitas. La existencia de un archivo local de tenants **no cambia el modo ni el catálogo**. `resolveConfig()` directo conserva el valor legacy para fábricas/pruebas antiguas; integraciones productivas deben usar `loadConfig()` o `tenantResolution: "backend"` explícito.
- `createConfiguredApp(input?, {now?, legacyMigrationTenants?})` es la fábrica asíncrona de [app.ts](app.ts), utilizada por [index.ts](index.ts). Obtiene y valida el catálogo antes de abrir el listener. `createApp()` síncrona rechaza backend con `BACKEND_BOOTSTRAP_REQUIRED`. Backend temporalmente caído: arranque cerrado con `BACKEND_DIRECTORY_UNAVAILABLE`, sin memoria alternativa ni selección manual; iniciar/reintentar cuando el backend esté disponible.
- Contrato: `{version:1,tenants:[{id:"tenant-<masterId>",name,portalOrigin,environment}]}`. Cero tenants es válido; máximo 50, sin truncamiento, IDs y Origins únicos. Se rechazan campos extra, rutas, credenciales, valores no canónicos y respuestas parciales/malformadas. Solo el backend determina cuáles están activos.
- El backend obtiene todos los activos del master y comprueba sus credenciales; no necesita una lista del frontend/gateway. El GET neutral es público y saneado, sin credenciales ni `dbName`, pero revela nombres/orígenes: restringir acceso de red al backend/gateway confiable en despliegue si no se acepta esa exposición.
- Todas las solicitudes centrales y operativas usan **exclusivamente BACKEND_URL**. No se admite `backendUrl` descubierto. `portalOrigin` solo es metadata y cabecera Origin interna de las APIs legacy operativas; nunca se contacta el frontend. Config/discover/complete no llevan Origin, Authorization, cookies ni headers del cliente.
- Cada petición central tiene timeout de 25 segundos, límite leído de 128 KiB, JSON obligatorio y redirects prohibidos. No hay reintentos automáticos de POST. 401 discovery/complete significa no autorizado, 429 conserva rate limit, las demás indisponibilidades fallan con 503. Health neutral valida config y no llama `/auth/me` de cada tenant; catálogo vacío válido cuenta como backend alcanzable.
- Se fuerza renovación antes de login/discovery y antes de completar el grant. Las peticiones protegidas renuevan al vencer **60 segundos**, con una solicitud compartida en vuelo. No se sirve catálogo vencido si falla la renovación. Tenants nuevos obtienen routers sin reinicio; misma ruta conserva instancias y locks aunque cambie el nombre.
- Una sustitución validada del catálogo es atómica. Retirar un tenant revoca y persiste únicamente sus sesiones; reactivarlo no revive tokens revocados. Una modificación de Origin o environment de un serverId conocido devuelve `BACKEND_TENANT_BINDING_CHANGED` y bloquea renovación/acceso hasta corregirla: **no hay rebinding silencioso**. Para una identidad realmente distinta, el backend debe emitir un masterId nuevo. Los bindings históricos no se reciclan; máximo 10 000 antes de requerir gestión administrativa.

### Migración única V1 → V2: conservar alias y pendientes offline

1. Detener el único escritor. Conservar copia privada del snapshot cifrado y su clave; **no borrar sesiones ni almacenamiento offline**. El coordinador debe quitar las variables legacy del entorno real para activar backend. Esta implementación no modifica ese entorno.
2. Si el snapshot descifrado dentro del módulo es V1, y solo entonces, se lee [../config/tenants.json](../config/tenants.json) como referencia de migración. No se utiliza para seleccionar destinos. Para despliegues con otro archivo histórico se puede inyectar `legacyMigrationTenants: () => rutasAntiguas` en `createConfiguredApp`; no se añade una variable de tenant obligatoria.
3. Se exige igualdad **exacta** de la huella V1 de rutas habilitadas. Cada ruta antigua debe coincidir con el catálogo central por backend URL normalizada fijada + portalOrigin + environment. Se conserva el ID cliente anterior (por ejemplo `grupo-eliseo-local`) como alias del serverId `tenant-N` verificado. También se conservan SHA de token opaco, upstream token cifrado, expiración y nextStep. Namespace cliente/portal/environment y `X-Qualitzer-Tenant` no cambian.
4. Se escribe atómicamente payload cifrado **V2** (el sobre AES-GCM mantiene `QZMS1`) con BACKEND_URL, bindings alias/serverId/portal/environment y `routeKey` SHA-256 por sesión. La huella incluye backend, serverId, Origin y environment; jamás se decide por el nombre de presentación. V2 ya no lee el archivo histórico y conserva alias incluso tras logout de todas las sesiones. Conservar la referencia como histórico controlado: **no borrarla antes del primer arranque migrado**. Deja de ser requisito de funcionamiento V2, pero el CLI legacy de branding aún la usa.
5. Archivo histórico ausente: `SESSION_MIGRATION_LEGACY_ROUTES_REQUIRED`; fingerprint distinto: `SESSION_MIGRATION_ROUTING_FINGERPRINT_MISMATCH`; ruta no confirmada/tenant retirado: `SESSION_MIGRATION_ROUTE_NOT_VERIFIED`. Se detiene sin descartar ni sobrescribir el V1. Recuperar la referencia exacta/corregir el catálogo; no forzar una migración por nombre, ID parecido ni ruta distinta.
6. V2 fija el backend global y rechaza cambiarlo al reiniciar. Altas de tenants no invalidan sesiones existentes. Sesiones retiradas o sin binding vigente se revocan antes de aceptar tráfico y se persiste la revocación. No se migran JWT crudos del cliente ni namespaces sin identidad de tenant. Los pendientes offline permanecen en el cliente y no se leen ni reescriben desde el gateway.

**Estado actual:** las variables legacy ya se retiraron del archivo de entorno por el coordinador. Comprobar también el proceso heredado y dejar la referencia histórica exacta para V1 → V2. Ante ausencia/diferencia no resetear sesiones ni borrar clave, snapshot o borradores para “arreglar” el arranque. El modo legacy emite `GATEWAY_LEGACY_TENANT_CONFIGURATION_DEPRECATED`. Esta edición sólo cambia documentación; guía raíz y procedimiento están enlazados en [../docs/CONFIGURACION-BACKEND.md](../docs/CONFIGURACION-BACKEND.md).

### Allowlist legacy explícita: compatibilidad

Esta sección **no describe el modo backend predeterminado**. [../scripts/prepare-company-brand.cjs](../scripts/prepare-company-brand.cjs) también sigue leyendo [../config/tenants.json](../config/tenants.json) en formato legacy para preparar recursos de marca; no está migrado al directorio central ni administra el acceso móvil.

Solo en compatibilidad explícita se usa el archivo señalado por `GATEWAY_TENANTS_FILE`. Ejemplo de formato histórico:

```json
[
	{
		"id": "grupo-eliseo-local",
		"name": "Grupo Eliseo",
		"tenantOrigin": "http://localhost:3000",
		"backendUrl": "http://127.0.0.1:5001/api",
		"environment": "development",
		"enabled": true
	}
]
```

- La consulta inicial de sólo lectura encontró un único registro master `{id:1,name:"jaras",hostname:"http://localhost:3000"}` y branding `Grupoeliseo`. No es un dominio productivo. La allowlist fija ID y routing; el nombre/logo de presentación pueden enriquecerse con el branding válido del backend. Esa consulta SQL de diagnóstico no forma parte del funcionamiento del gateway.
- Cada entrada exige exactamente `id,name,tenantOrigin,backendUrl,environment,enabled`. IDs de 1–100 caracteres con patrón `[a-z0-9][a-z0-9_-]*`; nombre no vacío, máximo 120 caracteres. `environment` solo `development`/`production`; `enabled` es booleano obligatorio.
- IDs **y** tuplas `(backendUrl normalizada, tenantOrigin)` deben ser únicos, también entre entradas deshabilitadas. Las bases se normalizan con URL y sin slash final. Se rechazan credenciales, protocolos distintos de HTTP(S), query, fragmentos, comodines, espacios y backslashes. `tenantOrigin` debe ser un Origin exacto, sin path ni slash final.
- Se valida todo antes de filtrar `enabled:false`. Una lista vacía o solo deshabilitada sigue vacía: nunca activa el tenant de compatibilidad.
- Un archivo legacy explícito inexistente, ilegible, inválido o con configuración insegura detiene el arranque con una clave de error sin contenido ni credenciales.
- **Compatibilidad sólo de configuración:** `TENANT_ORIGIN` explícito sin archivo genera `local` / `Entorno local` usando `BACKEND_URL`. Las fábricas legacy directas conservan sus defaults anteriores. Ninguno es fallback de un fallo del catálogo central.
- El registro se carga al arrancar. Cambios de allowlist requieren reinicio; no hay recarga ni edición por API. Los valores `backendUrl` y `enabled` nunca forman parte de respuestas móviles.
- Añadir, retirar o cambiar rutas de tenants altera la huella del almacén de sesiones. Planificar la invalidación administrativa de **todas** las sesiones; no reiniciar suponiendo que los tokens existentes se reasignarán al catálogo nuevo.

### QR y conexión de desarrollo

`GET /api/development/connection` está disponible **sólo con `NODE_ENV=development`**; en test/producción devuelve 404. Publica el enlace `exp://` de Expo en el puerto estable 8081, URL LAN del gateway, QR y estado de conectividad, nunca credenciales. Usa interfaces IPv4 privadas del equipo y descarta loopback, VPN y adaptadores virtuales; si no hay LAN adecuada, avisa en lugar de prometer acceso desde el teléfono.

El panel permanece visible en web de escritorio; en móvil se abre desde una pastilla a un modal con instrucciones para Expo Go. La misma dirección produce el mismo QR; **Actualizar** recoge la IP vigente tras un cambio de red. No necesita lectura de la terminal, no arranca Metro por sí mismo ni crea un túnel público. Esta facilidad es de desarrollo, no un mecanismo de distribución productiva.

## API móvil

Los contratos siguientes describen móvil/pasarela. En la revisión local `app-mobile` están las tres rutas neutrales y se verificó GET config → 200 sin Origin. Los recursos del panel y las comprobaciones históricas prepare/exchange no acreditan login real por el flujo nuevo ni despliegue en otros tenants.

Las respuestas de error tienen `{error:string,message?:string}` con mensajes locales, nunca SQL, stacks ni cuerpos de error del upstream. Las mutaciones operativas existentes retornan `{success:true}` **únicamente después** del éxito upstream. Creación y avisos devuelven sus contratos específicos: creación 201/replay 200, prueba push 201 pendiente, desregistro 200 vacío. Logout puede confirmar revocación local aunque falle el cierre upstream, pero **no confirma éxito si falla la persistencia local**. Las cargas usan HTTP 201.

| Método y ruta | Upstream / respuesta |
| --- | --- |
| `GET /api/tenants` | Catálogo `{data:Tenant[]}` con aliases preservados; refresca metadata central al vencer TTL. No representa coincidencias de credenciales ni es selector previo al acceso |
| `GET /health` | `{ok:true,backendReachable:boolean}`; modo backend valida catálogo neutral sin Origin. Legacy agrega probes de todos los tenants |
| `GET /health?tenantId=<id>` | Catálogo neutral fresco + tenant/Origin, nunca tráfico al portal. Legacy conserva probe `/auth/me`. Desconocido/deshabilitado: 404 |
| `POST /api/auth/login/start` | `{username,password,remember}` a `/auth/mobile/discover` central. Una coincidencia: complete automático. Varias: `{nextStep:"SELECT_TENANT",challenge,expiresAt,tenants}`. Ninguna: 401, incompleto: 503, rate limit: 429 |
| `POST /api/auth/login/complete` | `{challenge,tenantId}` alias cliente; consume desafío y envía solo `{grant}` a `/auth/mobile/complete`. Valida identidad devuelta contra catálogo/binding elegido; no reenvía contraseña |
| `POST /api/auth/login` | Solo legacy explícito hacia `/auth/login`. Backend devuelve 400 `USE_LOGIN_DISCOVERY`, sin fallback |
| `GET /api/auth/me` | `GET /auth/me` en el tenant de la sesión; `companyBranchId` opcional, validado primero contra membresía sin sucursal seleccionada. Respuesta `User` sanitizada más `tenant:Tenant` |
| `POST /api/auth/logout` | Sin cuerpo o `{}`. Elimina cookie si corresponde y persiste la revocación **antes** de intentar `POST /auth/logout` en el tenant vinculado; responde éxito aunque falle ese intento remoto, no si falla el almacén |
| `PATCH /api/auth/forced_password` | `{newPassword,confirmPassword,remember}` al tenant de la sesión restringida. Rota el token opaco; web recibe una cookie nueva y el indicador `cookie-session`. El token anterior queda revocado |
| `GET /api/assignments` | `GET /technician-dashboard/assignments`, conserva exactamente `startDate,endDate,companyBranchId`; salida `Assignments` sanitizada |

### Creación y avisos

| Ruta móvil | Contrato / upstream |
| --- | --- |
| `GET /api/creation/options` | `/technician-dashboard/mobile-creations/options`; sucursal obligatoria, recurso `equipment`/`specialties`, búsqueda y página base cero |
| `POST /api/creation` | `/technician-dashboard/mobile-creations`; `CreationInput` estricto, UUID persistente; `CreationResult` con grupo/trabajo/horario, HTTP 201 o replay 200 |
| `GET /api/mobile-notifications/status` | Estado habilitado/deshabilitado y requisitos, no promesa de entrega |
| `PUT /api/mobile-notifications/device` | Registro propio; sucursal en body, proyecto cotejado con status; sin query |
| `DELETE /api/mobile-notifications/device/:installationId` | Desregistro propio idempotente |
| `GET /api/mobile-notifications/inbox` | Bandeja de cuenta/sucursal; `page` base uno, 25 eventos |
| `PATCH /api/mobile-notifications/inbox/:id/read` | Sin body; lectura independiente del estado de transporte |
| `POST /api/mobile-notifications/test` | Sin body o `{}`; sólo dispositivo propio, máximo cinco por hora; respuesta pendiente, no envío confirmado |

Avisos conserva el mismo sufijo upstream bajo `/mobile-notifications`; excepto PUT, exige `companyBranchId` en query. [creation/authorization.ts](creation/authorization.ts) valida actor/sucursal; tenant, Bearer upstream y Origin se derivan de la sesión/configuración. El User-Agent **real y fijo** es `Qualitzer-Mobile/1.0 (Mobile; Gateway)`, tanto en login como en llamadas; `MOBILE_PUSH_GATEWAY_USER_AGENT` backend debe coincidir exactamente. No se reenvía el User-Agent del teléfono.

Creación admite trabajo propio, no productivo y mantenimiento **correctivo/detención** con primer hijo, sólo una franja del mismo día. Preventivo/rutinario/checklist siguen en el asistente web. La atomicidad y la idempotencia SQL pertenecen al backend; el gateway conserva UUID, respuesta y status y no añade reintentos. Esquemas compartidos: [../src/domain/creation.ts](../src/domain/creation.ts), [../src/domain/notifications.ts](../src/domain/notifications.ts) y [../src/domain/TechnicianRepository.ts](../src/domain/TechnicianRepository.ts).

El gateway **no ejecuta cron ni guarda una outbox SQL**. El backend reconcilia snapshots cada 2 minutos y despacha/consulta recibos cada minuto, con tokens cifrados, leases y reintentos SQL. No es CDC transaccional por cada fuente: cambios transitorios entre ticks pueden perderse. Detalles de baseline, preferencias, navegación canónica y activación en [../docs/PLANIFICACION-Y-AVISOS.md](../docs/PLANIFICACION-Y-AVISOS.md).

Todas las rutas siguientes tienen prefijo **`/api/assignments/:groupId/works/:workId`** y requieren la misma query **`startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&companyBranchId=N`**:

| Método y sufijo | Comportamiento |
| --- | --- |
| `POST /status` | `StatusInput`; `POST /technician-dashboard/update-work-status` con identificadores y sourceType derivados |
| `PATCH /steps/:stepId` | `StepAnswer`; paso localizado dentro de los checklists del trabajo propio; valida tipo y opciones |
| `GET /files` | Estándar: `/work_files/:workId`. Mantenimiento: `/maintenance_files/:maintenanceId`, filtro fijo `folderId=maintenance_work_<workId>`. Devuelve `{data:Attachment[],totalRows,totalPages}` |
| `GET /steps/:stepId/files` | Actual: getter dedicado de adjuntos del paso desde snapshot canónico fresco, ambas fuentes |
| `GET /comments`, `POST /comments` | Actual: comentarios según fuente vía `/technician-dashboard/panel/...`; GET admite `page`, POST sólo `{text}` |
| `POST /documents` | Actual: un documento en `files`; gestor del trabajo con destino/carpeta derivados |
| `POST /steps/:stepId/documents` | Actual: un documento en `files`; ruta backend de panel para pasos estándar y mantenimiento |
| `DELETE /files/:fileId`, `DELETE /steps/:stepId/files/:fileId` | Actual: borrado tras verificar pertenencia al dueño/paso |
| `POST /files` | **Legacy fotográfico:** multipart `files`; estándar reconstruye `attachments` a `/work_files/:workId`, mantenimiento `files` a `/maintenances/works/:workId/files` |
| `POST /steps/:stepId/files` | **Legacy fotográfico:** sólo mantenimiento; paso estándar se rechaza en esta ruta, no en `/documents` |
| `POST /report` | **Legacy:** sólo `{note}`; comentario técnico estándar o TXT generado en archivos de mantenimiento. No es el flujo actual de comentarios del panel |

Bajo `/api/assignments/:groupId`, los archivos de OT usan GET/POST `/files` y DELETE `/files/:fileId`. El ciclo de OT de mantenimiento usa GET `/maintenance-delivery`, POST `/start` y POST `/deliver`. Contratos completos en [panel/README.md](panel/README.md) y [orders/README.md](orders/README.md).

La entrega de OT exige firma técnica PNG; correctivo/detención exigen también falla, receptor y firma del cliente. Sólo `POST /api/assignments/maintenance-<id numérico>/deliver` evita el parser global de 32 KiB: el parser específico de **3 MiB actúa después de sesión**, sin ampliar otros métodos/grupos/rutas. Comprobación HTTP en el gateway activo: un POST sin autorización con JSON inválido devolvió **401**, no un error de parsing.

### Credenciales primero; selección sólo si hay varias coincidencias

1. `/login/start` recibe usuario y contraseña, sin empresa previa. En backend envía una única solicitud `/auth/mobile/discover`; el backend verifica todos los tenants y devuelve grants breves **sin crear sesiones/JWT**. Legacy conserva fanout prepare con concurrencia máxima de tres.
2. Se valida el conjunto completo contra el directorio central, sin aceptar coincidencias parciales, duplicadas, caducadas, metadatos desconocidos ni destinos añadidos. El backend es responsable de rechazar verificación incompleta; el gateway no puede demostrar si un backend que viola el contrato omitió una coincidencia válida.
3. Una coincidencia se intercambia automáticamente mediante `/auth/mobile/complete` (legacy `/exchange`). Con varias se devuelve un desafío opaco `qzc_`, de un solo uso y duración máxima de **120 segundos**, limitada además por la expiración más próxima de sus grants. El selector sólo muestra esas empresas, no todo el catálogo. En backend la marca del catálogo se muestra antes de selección; branding legacy se consulta después del login exitoso.
4. `/login/complete` consume el desafío antes del intercambio, incluso si la elección no pertenece al conjunto. Desafíos vencidos, reutilizados o selecciones ajenas se rechazan; hay que volver a ingresar credenciales. Los desafíos son transitorios en memoria y no se recuperan tras reiniciar. No se conservan contraseñas en el almacén de sesiones ni en el desafío.

Las respuestas de login incluyen `username,email,nextStep,tenant` y un token opaco nativo o el indicador web. Los grants quedan entre servidores. El complete neutral correlaciona el grant y fuerza `deviceType: "mobile"` al crear sesión; login web/JWT y middleware legacy existentes no cambian. Ningún cliente proporciona routing, Origin del tenant ni conexión de base de datos. La ruta antigua de login sigue siendo compatibilidad explícita, no una recuperación automática del flujo nuevo.

`/login/start` y `/login/complete` comparten el límite de credenciales de 10 solicitudes por 15 minutos e IP con login y cambio forzado; no lo evitan por usar subrutas. El backend aplica además su limitador de autenticación.

### Transporte nativo y web

- **Android/iOS:** recibe `qzm_<base64url de 32 bytes>`, lo conserva con SecureStore y usa `Authorization: Bearer <token>`. Nunca recibe el JWT crudo del backend.
- **Web:** envía `X-Qualitzer-Session: cookie` y `credentials: "include"` en login y peticiones protegidas, sin Bearer. El gateway entrega la cookie `qz_mobile_session`, **HttpOnly**, host-only, `Path=/api`; `Secure` con HTTPS/producción, `SameSite=None` en producción y `Lax` en desarrollo. El Origin debe estar presente y coincidir exactamente con la allowlist, también en lecturas y logout.
- El campo `token` del JSON web contiene sólo `cookie-session`. El almacenamiento JavaScript conserva ese indicador y metadatos públicos de tenant/conexión/sucursal; **no guarda `qzm_` ni JWT en localStorage**. El indicador no autentica sin la cookie. La cookie dura como máximo el menor valor entre la vigencia restante de la sesión y 400 días; el navegador puede aplicar restricciones adicionales.
- No se aceptan combinaciones ambiguas de cookie y Bearer. Sin optar por el transporte web, una cookie no autentica al cliente nativo. Un 401 protegido revoca la referencia usada y limpia la cookie cuando corresponde.
- `X-Qualitzer-Tenant` es una aserción opcional, no un selector: debe coincidir exactamente con el tenant vinculado. Una discrepancia devuelve 409 `TENANT_SESSION_MISMATCH` sin tráfico upstream. Query, JSON y multipart tampoco permiten cambiar de empresa en una sesión existente.
- **Cerrar sesión** está visible en la UI con ambos transportes, pero se bloquea si hay pendientes offline. Cuando procede, revoca persistentemente antes del cierre upstream y retira sesión/borradores no encolados del ámbito; no borra cola ni caché offline. Si el cliente no alcanza el gateway, sólo puede confirmar la limpieza local permitida y advierte del cierre remoto pendiente.

### Persistencia, expiración y recuperación

- El registro almacena `sha256(token móvil)` y el contexto `{tenantId,upstreamToken,expiresAt,nextStep,routeKey?}`; V2 backend exige binding por sesión. El token móvil original no se guarda en disco. El snapshot completo se cifra y autentica con **AES-256-GCM**, con escrituras mediante temporal y sustitución atómica.
- El arranque normal usa el directorio privado .data para el archivo de sesiones y, en desarrollo sin secreto configurado, su clave. POSIX exige **0700 para el directorio y 0600 para archivos**; Windows restringe ACL al usuario del proceso y SYSTEM. Si no puede proteger o leer el almacén, falla cerrado; no vuelve silenciosamente a memoria. Test y la creación explícita sin `sessionFile` usan memoria y no representan el despliegue persistente.
- **Reiniciar conserva sesiones** cuando archivo, clave y binding permanecen intactos. También se conservan revocaciones, rotaciones y estado de contraseña temporal; reiniciar no revive un token revocado. Lecturas dentro del TTL no reescriben; renovación backend, cambios y purga persisten aliases/revocaciones.
- **No existe el tope artificial de siete días.** La expiración se limita al `exp` upstream cuando está presente; sin él no se inventa un TTL local de siete días. Un JWT/`exp` malformado se rechaza. Leer `exp` no verifica su firma ni sustituye los controles del backend. La plantilla actual del backend configura **315 360 000 segundos (diez años)** para expiración normal y remember; no demuestra la configuración activa ni promete duración infinita.
- La sesión puede terminar por expiración, cambio de contraseña, revocación administrativa o nuevo acceso móvil según la política upstream. Sigue existiendo una categoría móvil por usuario/tipo de dispositivo: almacenar el token duraderamente no permite garantizar sesiones simultáneas en varios teléfonos.
- Las sesiones antiguas incompatibles, incluido el JWT crudo o almacenamiento sin contexto de tenant, no se migran ni restauran automáticamente: se requiere volver a ingresar una vez. Una sesión nueva válida sí puede restaurarse desde SecureStore o cookie después de cerrar/reabrir la app.
- **Solo V1 legacy:** la huella global liga IDs, URLs backend y Origins de todos los tenants habilitados; un cambio rechaza el snapshot con `SESSION_PERSISTENCE_ROUTING_MISMATCH`. Para pasar al modo backend usar la migración verificada anterior, no invalidar indiscriminadamente. V2 usa bindings por sesión y permite altas/retiradas sin revocar otros tenants.
- Una clave incorrecta/ausente, datos corruptos o un fallo de escritura bloquean el servicio. El marcador con sufijo .unavailable impide recuperar un snapshot que podría anteceder a un logout fallido. Con la instancia detenida, el administrador debe resolver el fallo y recuperar un estado íntegro compatible o invalidar íntegramente el almacén; **nunca borrar sólo el marcador ni editar el snapshot para forzar el arranque**. Una invalidación exige nuevo login a todos; no hay una migración automática segura de esos datos.
- **Un solo escritor/instancia por archivo.** No soporta varias réplicas compartiéndolo, failover concurrente ni almacenamiento distribuido. La afinidad del balanceador no resuelve la concurrencia de escrituras; los límites y locks también son locales.
- Capacidad **10 000 sesiones por instancia**; al llenarse, 503 `SESSION_CAPACITY_REACHED` sin expulsar sesiones activas. Se comprueba vigencia y se purgan expiradas al acceder/emitir sesiones. Una rotación reutiliza el slot y no extiende la expiración anterior.
- `nextStep !== "DONE"` restringe las rutas protegidas a cambio forzado y logout. El cambio correcto rota el token, conserva el tenant y no permite que una respuesta tardía restaure una sesión ya revocada. Un 401 upstream revoca sólo la referencia móvil utilizada; futuras peticiones fallan localmente.

`PATCH /api/auth/forced_password` exige que la sesión tenga exactamente `nextStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"`; una sesión `DONE` recibe 403 `PASSWORD_CHANGE_NOT_REQUIRED` sin tráfico upstream. Un bloqueo local por clave de sesión rechaza cambios simultáneos con 409 `PASSWORD_CHANGE_IN_PROGRESS`, sin encolarlos ni bloquear otras sesiones aunque compartan token upstream. La vigencia y el paso requerido se comprueban dentro del bloqueo antes de llamar al backend; el bloqueo se libera tanto en éxito como en error. Tras la rotación, el token anterior recibe 401 sin repetir el cambio upstream. Esta exclusión solo cubre la instancia del gateway, no llamadas directas al backend.

### Autorización y mutaciones

- Sesión opaca obligatoria, por Bearer nativo o cookie web validada, ligada al tenant resuelto por el servidor. No se exige rol técnico: un administrador de prueba con trabajador asociado y asignación propia es válido.
- Sucursal positiva, segura y perteneciente a `me.accessBranchs`, no eliminada ni deshabilitada. Para recursos, `workerId` debe ser no nulo y coincidir con `assignments.technician.id`.
- Fechas ISO reales, sin normalizar días imposibles, rango ordenado de **hasta 31 días inclusivos**. Query duplicada/desconocida y campos de control adicionales son errores, no valores ignorados.
- Se consulta `/auth/me` y se vuelve a obtener `/technician-dashboard/assignments` antes de cada lectura/escritura de recurso. No se usan caché, sockets ni `workerId` del cliente. Upload revalida una segunda vez después de recibir el multipart; completar vuelve a validar después de comprobar archivos. Reportar mantenimiento revalida propiedad, sucursal y estado una segunda vez inmediatamente antes de generar/enviar el TXT; si perdió la asignación o quedó de solo lectura, no se escribe nada.
- La pertenencia exige coincidencia **única y exacta** de `group.id` y `work.id` en el GET canónico fresco del técnico autenticado. Se retiró el segundo filtro por `work.responsibles`: no es una prueba completa para mantenimiento heredado, actividades/planning o no productivos. Ese filtro explicaba la reducción observada de 13 trabajos a 2. Se conservan los trabajos del agregado autorizado, incluidos `direct-np-*` con responsables vacíos; no se admiten IDs ajenos ni un override amplio. No se confía en `group.isResponsible`, `isCurrentUser`, `canManage` ni flags del cliente. Se recalculan totales y materiales visibles.
- `internal_maintenance` es la única fuente de mantenimiento. Su ID se deriva exclusivamente de `maintenance-<id>`. No se aceptan sourceType, workId, maintenanceWorkId, activityId, tenant, target, folderId, `finalizeAll` ni `finalizeAllDays` como overrides.
- Ejecución del hijo: iniciar, pausar, reanudar y finalizar/entregar (`completed` o `delivered`) según transición válida y `canExecute` fresco. El hijo `completed/delivered` bloquea cambios de estado/respuestas; **el padre cerrado no añade un bloqueo**. No hay reset a pending ni flags de cierre masivo. Comentarios y documentos genéricos del panel usan autorización sin bloqueo de ejecución y permanecen disponibles tras entrega, incluso con `canExecute=false`.
- Completar exige responder los checklists obligatorios y adjuntar los archivos exigidos por cada paso/trabajo. Para los archivos de trabajo se consulta la lista real, no se confía únicamente en el contador del dashboard.
- Entrega automática: el gateway calcula horas desde el cronómetro confirmado, no desde horas libres ni el reloj cliente. Estándar exige duración positiva; mantenimiento automático no reenvía horas manuales. La edición manual requiere `allowEditExecutionTime` vigente, horas `HH:mm` válidas y duración positiva; también aplica a la entrega manual del hijo de mantenimiento.
- **Multifecha sólo al finalizar/entregar un trabajo estándar:** `executionDates` explícitas, únicas, máximo **30**. Se reconsulta `/auth/me` y la asignación **de cada día** antes y después de comprobar evidencia; deben coincidir identidad, sucursal, fuente, trabajo, `scheduledDate` y `plannedDates`, además de permisos/estado actuales. Una aparición como atrasado no autoriza esa fecha. Mantenimiento hijo, inicio y pausa siguen siendo de una fecha.
- Se realiza una llamada de estado para el trabajo con las fechas autorizadas, sin ampliar días implícitamente. En automático se toma el cronómetro de la primera fecha ordenada; si otro día acumula tiempo se exige entregar por separado. No se suman ni multiplican cronómetros. Intervalos nocturnos multifecha requieren seleccionar también los días del intervalo; el caso nocturno de fecha única conserva su comportamiento previo.
- «Seleccionar todas» en UI envía únicamente el array explícito de hasta 30 fechas. **No habilita `finalizeAll`/`finalizeAllDays`**: el comportamiento masivo upstream puede ampliar días restantes sin el mismo alcance/autorización y no se considera seguro para este contrato.
- Validación permite booleano o `not_applicable`; select/approval solo valores presentes en opciones; multiselect se normaliza usando las etiquetas del servidor; número exige string numérico finito. `isCompleted`/estado completed no puede acompañar respuesta vacía. Reglas finales de contraseña siguen siendo las del backend.
- El endpoint estándar de checklist ignora `activityId` y resuelve `step.activityId → activity.workId` en su repositorio. Se envía `activityId=workId` como el diálogo desktop existente, **no se inventa un ID de actividad**. La autorización real se basa en el paso encontrado en las asignaciones. Mantenimiento envía `workId` para el evento upstream.
- **Reporte legacy `/report`:** sólo `note`, no vacía, hasta **10 000 caracteres tras trim** y JSON de 32 KiB. Estándar envía HTML escapado a comentarios técnicos; mantenimiento genera un TXT con autor/fecha/OT/trabajo derivados. No admite metadatos arbitrarios ni reemplaza la nota global. El flujo actual de comentarios es `/comments`, según fuente, descrito en [panel/README.md](panel/README.md).

### Jornada, agenda y presentación

Mi jornada comienza en **hoy** y pide `startDate=endDate`. Agenda realiza **siete consultas diarias**, con concurrencia máxima de **dos**, porque el agregado upstream se centra en `startDate`. Fusiona trabajos por identidad sin duplicar tarjetas ni totales y conserva los horarios y días de consulta asociados. El detalle y sus operaciones usan el día correspondiente para la revalidación; no convierten la semana en un permiso sobre cualquier trabajo.

La cuadrícula Día/Semana calcula carga planificada diaria/semanal y minutos de cruce, muestra estados y separa vencidos/sin horario. Las barras comparan días, **no una capacidad supuesta de 8 h**; no son tiempo ejecutado ni disponibilidad. Las advertencias de creación comparan sólo lo cargado y no bloquean por solapamiento.

Las tarjetas muestran códigos **TR**, referencias de OT y metadatos de negociación cuando el backend los aporta, además del progreso. No se inventan relaciones de equipo ni metadatos ausentes. El nombre y logo internos proceden del branding válido de `/companies/branding` del tenant autorizado, con caché y fallback a la identidad configurada/imagen genérica. Esto no cambia routing, permisos ni el icono nativo; las distribuciones se explican en [../docs/BRANDING.md](../docs/BRANDING.md).

### Archivos y límites

- **Documentos actuales:** POST de grupo `/files`, trabajo `/documents` y paso `/documents`: un archivo por petición, **25 MiB inclusivos**, sin campos de texto del cliente. La UI acumula hasta **4 pendientes / 40 MiB**, confirma y envía secuencialmente; no se reintentan escrituras ambiguas. Imágenes, PDF, DOCX, XLSX, TXT y CSV, con inspección de firma/estructura y nombres saneados. HEIC permitido en gestores, no en pasos. Detalles y límites de inspección ZIP/texto en [panel/README.md](panel/README.md).
- **Legacy fotográfico de asignaciones** (POST de trabajo/paso `/files`): campo `files`, de 1 a 4 imágenes; **25 MiB por archivo / 40 MiB combinados**. Las reglas de los tres puntos siguientes son exclusivas de estas rutas, no de documentos.
- Límite combinado medido mientras se reciben bytes, también para transferencias sin Content-Length. Dos cargas simultáneas como máximo por instancia. Memoria acotada, sin archivos temporales persistidos.
- Busboy emite algunos eventos de límite al alcanzar el umbral: el umbral interno usa 25 MiB + 1 byte y 5 partes, mientras los controles explícitos mantienen 25 MiB inclusivos y 4 archivos. No reducir esos umbrales sin conservar la prueba de exactamente 4 archivos.
- Firmas JPEG, PNG, WebP y HEIC; se ignoran MIME/extensión del cliente y se generan nombres seguros. Se rechazan TXT/texto arbitrario, SVG, PDF, GIF, AVIF, HEIF genérico sin marca HEIC y ejecutables. La detección de firma **no es decodificación completa, antivirus ni eliminación de EXIF**; un archivo malformado/polyglot todavía requiere controles del almacenamiento/decoder upstream. HEIC depende además del soporte del generador de thumbnails del backend.
- En las rutas fotográficas legacy, el TXT sólo puede generarlo internamente `/report`; un TXT subido al POST de trabajo/paso `/files` se rechaza. **Las rutas actuales de documentos sí admiten TXT/CSV validados.** Los GET conservan nombre, URL y tipo del adjunto.
- FormData/Blob/fetch nativos de Node 22, sin reenviar boundary, Origin, User-Agent, headers de proxy ni headers personalizados del cliente. Nunca se siguen redirects upstream.
- Timeouts por llamada: JSON **25 s**, upload upstream **120 s**; recepción multipart **120 s**; cabeceras entrantes **15 s**. Respuestas JSON upstream limitadas a 8 MiB. Body JSON móvil hasta 32 KiB, excepto entrega de OT de mantenimiento (3 MiB después de sesión), sin compresión entrante.
- Rate limit por IP sin excepción localhost: general 120/min, auth 60/min y login/cambio forzado 10/15 min, uploads 20/15 min, compartidos entre tenants. Memoria por instancia: múltiples procesos necesitan un límite compartido en el proxy. Cada tenant tiene un `AssignmentService` y un conjunto de locks independiente; las claves canónicas internas son `maintenance:<workId>` o `work:<workId>`. Se autoriza antes de consultar/adquirir el lock. Dentro del mismo tenant, el trabajo estándar comparte lock aunque aparezca en distintos grupos/sucursales; mantenimiento y estándar con igual ID no colisionan. IDs iguales en tenants distintos no se bloquean entre sí. Las mutaciones autorizadas concurrentes sobre la misma clave/tenant se rechazan con 409, no se encolan; un usuario ajeno no puede adquirir ese lock. El límite de dos uploads simultáneos sigue siendo global por instancia, no dos por tenant.
- **Cero reintentos automáticos de operaciones HTTP del gateway**, incluidos POST y uploads. Ante timeout, releer antes de repetir. Creación ofrece reenvío manual del mismo cuerpo/UUID persistido; no aplica a otras escrituras. Esto no describe el despachador push backend, que sí reintenta entregas mediante su outbox SQL.

## Excepciones exactas y limitaciones de seguridad

1. **Comentarios actuales de mantenimiento:** el contrato backend de panel resuelve `maintenanceWork.workId` para usar el trabajo espejo, sin confundir IDs. Es distinto del reporte TXT legacy y depende de integrar/desplegar `PanelResources*`. No se sobrescribe la nota global de OT ni se adivina el espejo.
2. **Pasos estándar soportados por documentos del panel:** relación `work_files`, namespace de ruta por trabajo/paso e hidratación de adjuntos. `STANDARD_STEP_UPLOAD_UNSUPPORTED` subsiste únicamente en el POST fotográfico legacy de pasos; no usarlo para describir todo el panel. La ruta nueva requiere el backend coordinado, no basta desplegar auth.
3. **Un trabajo ausente o ambiguo en el agregado canónico fresco da 404.** Un array `responsibles` vacío no lo excluye por sí solo: los no productivos `direct-np-*` devueltos para el técnico autenticado se conservan. La garantía depende del contrato de selección del agregado upstream, no de una autorización global nueva en el backend.
4. Listados de archivos de gestores: página 0, límite 1000, conservando `totalRows/totalPages`, sin paginación pública adicional. El borrado genérico recorre hasta 100 páginas para comprobar pertenencia. El GET dedicado de paso devuelve `checklists[].steps[].attachments` frescos de ambas fuentes, no una consulta arbitraria por ruta/carpeta.
5. `canManage` y `canEditDefinition` salen en false: esta API no permite editar definiciones, responsables, materiales ni toda la OT. Campos fuera del contrato móvil, incluidos costes/precios, no se publican. URLs inválidas/no HTTP(S) se vacían; no hay proxy de descargas arbitrario.
6. El contrato de asignaciones upstream **no incluye la sucursal de cada trabajo y algunas fuentes no filtran estrictamente por companyBranchId**; usan esa sucursal para preferencias/zona horaria. El gateway verifica membresía, identidad del técnico y pertenencia al agregado, pero no puede demostrar aislamiento adicional por sucursal del recurso con esos datos. Las consultas diarias de la agenda respetan los resultados upstream, incluidos vencidos; no inventan asignaciones faltantes ni alteran esa limitación.
7. **Los endpoints upstream existentes permanecen accesibles con sus autorizaciones actuales. Este gateway NO corrige la seguridad global del backend.** Varias rutas de pasos/archivos solo verifican sesión allí; usuarios que puedan alcanzar directamente el backend pueden evitar los controles de este gateway. Restringir la red y reforzar autorización en el backend antes de afirmar aislamiento global.
8. Revalidar no equivale a una transacción distribuida: otra UI/instancia puede cambiar asignaciones, checklists, archivos o estado entre la comprobación y la escritura. El bloqueo local no protege frente a cambios directos en backend. Se necesitan comprobaciones atómicas/versionado upstream para eliminar esa carrera.
9. Complete neutral fuerza `deviceType: "mobile"`; el gateway mantiene el User-Agent fijo `Qualitzer-Mobile/1.0 (Mobile; Gateway)` también en las llamadas operativas/legacy. El login web existente no cambia. La política upstream de una sesión por deviceType puede hacer que dos instalaciones del mismo usuario/tenant compartan o revoquen esa categoría. El registro opaco aísla las sesiones del gateway, pero no modifica la política de sesiones upstream ni garantiza que un JWT siga vigente después de otra operación allí.
10. Archivos y documentos devuelven URLs upstream, no se descargan ni inspeccionan sus contenidos. Sanear claves de costes no elimina información financiera que un documento, foto, nombre o texto libre ya contenga. Se requiere control editorial/permisos upstream para esos contenidos.

## Estado de verificación

**Actualización vigente del 09-09-2026:** batería móvil completa verificada por el coordinador, **534 casos, 533 aprobados, 1 omitido por plataforma, 0 fallidos**; TypeScript app/gateway: **0 errores**. No se repiten pruebas en esta edición documental ni se ejecutan tests/lint/build backend.

Las tres rutas neutrales están presentes y GET config respondió **200 sin Origin**, con master local `tenant-1`, nombre interno conocido `jaras` y portal local `http://localhost:3000`. Se verificó el alias persistente `grupo-eliseo-local`, **no un usuario real activo preservado**. No hubo login real por el flujo nuevo; existió login antes de la tarea y la sesión inicial devolvió 401 antes del reinicio, sin atribuir aquí su causa.

La ampliación añade [tests/backend-directory.test.ts](tests/backend-directory.test.ts): fixtures HTTP locales y copias cifradas ficticias, sin credenciales reales. Los resultados históricos siguientes son anteriores a esta ampliación; no representan una nueva exportación de esta etapa. Guía: [../docs/CONFIGURACION-BACKEND.md](../docs/CONFIGURACION-BACKEND.md).

Validación final tras los ajustes de presentación/UX: **353 casos, 352 aprobados, 1 omitido por plataforma, 0 fallidos**; TypeScript móvil/gateway **0 errores** y Expo export Android/iOS/web completado. Finalizó el 09-09-2026 a las 01:18 UTC. No prueba SQL real, despliegue ni entrega física.

Demo ficticia: tres creaciones el 10-09-2026 (trabajo 09:00–10:30, no productivo 10:45–11:15, correctivo con hijo 11:30–12:30), **3 h** planificadas y detalles abiertos; Avisos deshabilitado explícitamente. Las operaciones demo previas de checklist, comentarios, archivos y firmas no son escrituras productivas.

HTTP previo sin credenciales: prepare/exchange con `{}` → 400; comentarios y entrega sin sesión → 401; gateway alcanzable. El Origin web del gateway y el Origin tenant backend son distintos y no intercambiables. No se inició sesión real en esas comprobaciones.

Las rutas nuevas de creación, opciones y estado de avisos devolvieron **401** sin sesión en el servidor local. **No se ejecutaron migraciones, escrituras SQL, push ni pruebas/lint/build globales backend/frontend.** Las dos migraciones tenant requieren revisión/despliegue; flags push deshabilitados y clave no configurada. Pendientes: integración SQL concurrente, cuenta técnica autorizada, compilación/firma y Android/iPhone físicos. Guía: [../docs/PLANIFICACION-Y-AVISOS.md](../docs/PLANIFICACION-Y-AVISOS.md); cobertura: [../docs/PANEL-TECNICO.md](../docs/PANEL-TECNICO.md).