# Configuración móvil: empresas administradas por el backend

Estado vigente **09-09-2026**. Para conectar Qualitzer Field a Qualitzer se configura **sólo `BACKEND_URL` como destino de API**. No se configura una URL del proyecto frontend ni una empresa en el teléfono. Puertos, host, CORS y protección de sesiones siguen siendo ajustes independientes.

## Recorrido de una solicitud

**App → pasarela móvil → `BACKEND_URL` → tenant resuelto por el backend → base de datos.**

1. Al arrancar, `createConfiguredApp()` obtiene `GET /auth/mobile/config` antes de abrir el listener.
2. El usuario introduce credenciales, sin elegir empresa. La pasarela llama a `POST /auth/mobile/discover`; el backend comprueba **todos los tenants activos del registro master, hasta 50**, sin crear sesiones durante esa comprobación.
3. Una coincidencia permite completar el acceso automáticamente. Varias producen un desafío breve y de un solo uso: el usuario elige sólo entre las empresas coincidentes. Ninguna devuelve 401; una comprobación incompleta bloquea todo el acceso, sin resultados parciales.
4. `POST /auth/mobile/complete` recibe el grant correlacionado, no otra contraseña ni una ruta elegida por el cliente. El backend revalida tenant/cuenta y crea la sesión con `deviceType: "mobile"` forzado. La pasarela coteja la identidad y entrega token opaco nativo o cookie HttpOnly web, nunca el JWT backend.
5. Las llamadas operativas siguen hacia **el mismo `BACKEND_URL`**. Para las APIs protegidas legacy, la pasarela añade internamente el Origin de la sesión y del catálogo autoritativo del backend.

Las tres llamadas centrales no envían Origin, cookies, Authorization ni cabeceras del cliente. El login web existente, JWT y middlewares operativos legacy no se reescriben: esas APIs siguen necesitando Origin internamente. El User-Agent fijo de la pasarela es `Qualitzer-Mobile/1.0 (Mobile; Gateway)`; la correlación del grant, no el User-Agent por sí solo, autoriza el acceso.

### Por qué desaparece `TENANT_ORIGIN`

Antes era una **cabecera de selección del tenant enviada al backend**, no una llamada HTTP al frontend. Ahora es innecesaria porque el backend entrega esa identidad. `portalOrigin` en los datos públicos es un origen canónico para presentación y routing legacy interno: **no es un destino HTTP al portal/frontend** ni una URL que el móvil pueda usar para cambiar de empresa.

El catálogo local actual identifica al master como `tenant-1`; el nombre interno conocido es `jaras` y el origen público local es `http://localhost:3000`. No se debe convertir ese origen en la IP del teléfono ni presentarlo como dominio productivo. El ID local histórico `grupo-eliseo-local` puede seguir visible como alias persistente de `tenant-1`; no son dos empresas distintas.

## Entorno normal

En [../.env](../.env) ya se retiraron `TENANT_ORIGIN` y `GATEWAY_TENANTS_FILE`. Sus ajustes de conexión actuales son:

| Ajuste | Uso |
| --- | --- |
| `BACKEND_URL` | API central: localmente `http://127.0.0.1:5001/api` |
| `GATEWAY_PORT` / `GATEWAY_HOST` | Listener de la pasarela: localmente `8787` / `0.0.0.0` |
| `GATEWAY_CORS_ORIGINS` | Orígenes exactos del navegador Expo, localhost/127.0.0.1 y LAN en puerto 8081; **no selecciona empresas** |

La app apunta a la **pasarela**; en teléfono se usa la IP LAN del computador, no su loopback. El navegador envía su Origin y cookie; el cliente nativo usa Bearer y no necesita enviar Origin. El arranque de desarrollo añade los orígenes LAN detectados para Expo web, no los orígenes de las empresas.

[../scripts/start.cjs](../scripts/start.cjs) carga el entorno y lo hereda a sus procesos hijos; el gateway también admite la carga habitual del archivo de entorno. **Quitar una variable del archivo no elimina una variable heredada del terminal, servicio o IDE.** Si persiste el modo legacy, retirar ambas variables en su fuente y del proceso que lanza la app, y reiniciar ese proceso. No dejarlas vacías: su presencia selecciona compatibilidad y un valor vacío puede ser inválido. No hacen falta nuevos argumentos de tenant ni cambios de dotenv.

La mera existencia de [../config/tenants.json](../config/tenants.json) **ya no activa ni alimenta el catálogo normal**. Sólo `TENANT_ORIGIN` o `GATEWAY_TENANTS_FILE` explícitas habilitan la compatibilidad deprecada y el aviso `GATEWAY_LEGACY_TENANT_CONFIGURATION_DEPRECATED`. No son fallback de una API nueva ausente. Los demás ajustes de seguridad/producción permanecen en [../server/README.md](../server/README.md).

## Altas, bajas e indisponibilidad

- Las empresas se administran en el **registro master del backend**, no en la app ni en una lista de APIs del gateway. Se incluyen todos los activos; más de 50, duplicados o registros inválidos hacen fallar el catálogo completo, sin truncarlo.
- La pasarela renueva antes de iniciar/completar login; en peticiones protegidas, al vencer el **TTL de 60 segundos**. Altas válidas no requieren reiniciarla ni invalidan otras sesiones.
- Una baja confirmada revoca persistentemente **sólo las sesiones del tenant retirado/inactivo**. Reactivarlo no revive tokens. Una caída del endpoint no se interpreta como baja ni produce una lista parcial.
- Si falla la renovación, no se usa un catálogo vencido ni la lista legacy. Cambiar Origin/entorno de una identidad conocida bloquea el binding: no se reasignan sesiones silenciosamente.
- Con el backend caído al arrancar, la pasarela no abre el listener y muestra `BACKEND_DIRECTORY_UNAVAILABLE`. Recuperar el backend y reintentar; **no borrar sesiones ni datos locales**. No existe fallback a memoria o selección manual para eludir el fallo.

## Migración única de sesiones cifradas V1 → V2

**No borrar ni modificar el archivo histórico antes del primer arranque migrado.** Con el único escritor detenido, conservar una copia privada del snapshot cifrado, su clave y [../config/tenants.json](../config/tenants.json). Activar el modo backend retirando las variables legacy, no eliminando esa referencia.

La migración exige la **huella exacta de las rutas habilitadas V1** y la coincidencia exacta de cada ruta antigua con el servidor: `BACKEND_URL` normalizada + `portalOrigin` + entorno. No basta un nombre parecido ni cambiar manualmente `grupo-eliseo-local` por `tenant-1`.

Tras verificarla se guarda atómicamente V2, conservando el alias cliente histórico, su binding al ID canónico `tenant-N`, la referencia de token, expiración y paso de acceso. Mantener alias/origen/entorno evita cambiar los namespaces del cliente con caché, borradores y pendientes offline. El gateway **no lee, mueve ni borra esa cola**; conservar el binding no prueba que una sesión real siga autorizada en el backend.

| Fallo | Acción segura |
| --- | --- |
| `SESSION_MIGRATION_LEGACY_ROUTES_REQUIRED` | Recuperar el archivo histórico exacto; no crear una lista aproximada |
| `SESSION_MIGRATION_ROUTING_FINGERPRINT_MISMATCH` | Recuperar las rutas originales que corresponden al snapshot V1 |
| `SESSION_MIGRATION_ROUTE_NOT_VERIFIED` | Revisar el catálogo autoritativo y la coincidencia de ruta/estado |

Ante estos errores se detiene sin descartar ni sobrescribir V1. **No resetear sesión, clave, snapshot, borradores ni almacenamiento offline para forzar el arranque.** Una vez verificado V2, el funcionamiento normal ya no necesita leer la referencia histórica y el alias persiste incluso tras logout. Conservarla como referencia histórica controlada; retirarla no es un paso previo al arranque. Recuperación detallada en [../server/README.md](../server/README.md) y aislamiento en [OFFLINE.md](OFFLINE.md).

## Exposición y excepción de branding

`GET /auth/mobile/config` es **público sin credenciales**: publica únicamente IDs, nombres saneados, orígenes y entorno; no contraseñas, tokens ni `dbName`. Aun así revela clientes/topología: restringir su acceso de red al gateway/proxy confiable si no se acepta esa exposición. CORS no sustituye ese control. Fuera del desarrollo privado, usar HTTPS y los controles de proxy/red del gateway; las APIs legacy no adquieren aislamiento global por este cambio.

[../scripts/prepare-company-brand.cjs](../scripts/prepare-company-brand.cjs) **todavía lee el formato legacy de [../config/tenants.json](../config/tenants.json)** para seleccionar `--tenant` y consultar branding en la API configurada allí. Es un CLI separado para preparar recursos de build, no el catálogo de acceso normal ni una herramienta ya migrada al descubrimiento central. No alterar la referencia V1 para preparar otra marca antes de completar la migración. No genera por sí solo APK/IPA; ver [BRANDING.md](BRANDING.md).

## Evidencia actual y límites

Validación móvil completa comunicada y verificada por el coordinador el **09-09-2026**: **534 pruebas, 533 aprobadas, 1 omitida por plataforma, 0 fallidas**; TypeScript de app y gateway: **0 errores**. Este ajuste documental no vuelve a ejecutarlas. Las cifras anteriores de offline/exportación en otros documentos son históricas, no un export nuevo de esta etapa.

Las tres rutas neutrales están presentes; el **GET de configuración respondió 200 sin Origin** en el backend local. Esto no atribuye un 200 autenticado a los POST de discovery/complete. Se verificó la conservación del alias, **no un usuario real activo preservado por la migración**. Hubo login real antes de esta tarea; la sesión inicial devolvió 401 antes del reinicio. No se hizo login real mediante el flujo nuevo ni se atribuye aquí la causa del 401.

No se ejecutaron tests, lint ni build backend en esta etapa documental. Siguen pendientes login nuevo autorizado, operaciones/SQL reales, las tres migraciones operativas, dispositivos físicos y push; esta migración de archivo de sesiones no aplica esas migraciones tenant.