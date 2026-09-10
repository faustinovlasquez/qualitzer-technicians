# Trabajo sin conexión

Estado **10-09-2026**: núcleo offline integrado en [../App.tsx](../App.tsx) y [../src/application/useTechnicianApp.ts](../src/application/useTechnicianApp.ts), incluida jornada/agenda, sucursal, detalles y centro **Sin conexión**. No es una promesa de paridad administrativa ni una validación en teléfonos físicos.

## Antes de salir a terreno

1. Inicia sesión con conexión, en la cuenta, empresa y sucursal correctas. Se verifica el perfil remoto antes de habilitar su copia local.
2. La preparación inicial automática intenta guardar **asignaciones de la semana actual y catálogo combinado inicial**. No descarga automáticamente todas las conversaciones, páginas de catálogo ni archivos.
3. Abre **Sin conexión → Preparar este período** para preparar explícitamente la semana seleccionada. Revisa la cobertura por fecha y cualquier error antes de desconectarte.

La preparación explícita guarda hasta siete snapshots diarios (con los checklists presentes), catálogo combinado y primeras páginas de equipos/especialidades, metadatos de archivos de trabajo/paso y primera página de comentarios de **hasta 30 trabajos**, además de metadatos de archivos de hasta 30 grupos. Otras páginas/búsquedas sólo quedan disponibles si se consultaron y cachearon. La cobertura puede ser parcial; no se inventan días ni catálogos completos.

**Preparar guarda datos y metadatos, no descarga fotos/documentos remotos.** El repositorio tiene un puerto opcional de descarga con presupuesto, pero la app actual no conecta ese downloader. La UI lo indica explícitamente. Una URL o una miniatura cargada anteriormente no garantizan bytes disponibles offline.

## Qué se puede guardar

| Operación | Sin conexión |
| --- | --- |
| Consultar jornada, agenda, detalle y checklists | Sólo datos cacheados y creaciones locales; mostrar antigüedad/cobertura |
| Crear trabajo propio o tiempo no productivo | Cola durable, con opciones cacheadas y los límites actuales del asistente |
| Crear OT correctivo/detención con primer trabajo | Cola durable; equipo interno y catálogos necesarios previamente disponibles |
| Responder un checklist existente | Cola durable con respuesta local y base remota conservadas |
| Añadir un comentario nuevo | Cola durable; útil para dejar un mensaje técnico sin usar el reporte legacy |
| Guardar fotos/documentos de OT, trabajo o paso | Bytes propios persistidos al confirmar **Guardar archivos**; un UUID por archivo |
| Buscar equipo por número interno | Sólo consultas cacheadas con coincidencia exacta y selección manual; no garantiza disponibilidad actual |
| Asociar checklist de la empresa | **Sólo online**, sobre trabajo canónico no terminal; no se encola ni se inventa para `local-*` |
| Iniciar, pausar, reanudar, cronometrar o entregar | **No se encola**; requiere conexión y recurso canónico verificado |
| Borrar archivos, reporte legacy, firmas/entrega OT y mutaciones de avisos | **Sólo online**; no se convierten silenciosamente en otra operación |

La creación sigue limitada a una fecha/franja del mismo día, sin recurrencia, otros responsables ni creación preventiva/rutinaria/checklist. Un trabajo local no recibe cronómetro, permisos ni checklists inventados. Al sincronizar se resuelven sus IDs canónicos y dependencias sin duplicar la ficha. Más límites en [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md).

**Guardado local no significa confirmado en Qualitzer.** La cola se confirma en almacenamiento antes de intentar la escritura remota, incluso estando online. La UI distingue pendiente de aplicado; respuestas/fotos pendientes no cuentan como evidencia confirmada para entregar. El reporte legacy conserva su contrato online: para un mensaje offline usa **Comentarios**, sin asumir una migración de reportes antiguos.

### Fotos y documentos

- Android/iOS: base SQLite en WAL y archivos propios persistentes. Web: IndexedDB para estado y blobs reales; las URL `blob:` se reconstruyen al abrir.
- En navegador, **seleccionar una foto antes de pulsar Guardar archivos sigue siendo temporal**. Recargar antes de ese guardado puede perder la selección. Después del commit, la cola es dueña de los bytes.
- Límites actuales: **25 MiB por archivo**, **4 seleccionados / 40 MiB** en UI y **500 MiB** de archivos offline entre identidades. Si no hay espacio, se rechaza el nuevo guardado sin expulsar pendientes. Caché JSON: 180 entradas / 16 MiB.
- Transporte offline: JPEG/PNG/WebP/GIF, PDF, DOCX/XLSX y TXT/CSV, sujetos a validación de contenido. HEIC debe convertirse antes a JPEG/PNG, conservando los mismos bytes para reintentos; no se admiten SVG/HTML, ejecutables ni ZIP genérico. Validar formato no equivale a antivirus.
- Los archivos confirmados se vinculan por el `fileId` del recibo, nunca por nombre ni por «último archivo». Se conservan también sus copias locales. Imágenes locales tienen visor; PDF/otros documentos locales nativos aún requieren un visor/compartidor no integrado.

## Reconexión y recuperación

El motor sincroniza automáticamente **con la app en primer plano**, al arrancar, reconectar y volver a ella. En nativo usa AppState/NetInfo; en web está conectado el adaptador de `focus`, `pageshow` y `visibilitychange`. Volver despierta el motor y reinicia la espera de transporte sin saltar esperas de despliegue, perder un despertar durante un envío ni omitir el lease/validación del actor. También existe **Sincronizar**. Mantén la app abierta hasta revisar los pendientes; no hay garantía con ella cerrada.

### Conexión no es caché

`OfflineSnapshot.connection` es opcional por compatibilidad; el motor actual publica estado, `networkConnected` (`true`, `false` o `null`), `foreground`, fecha de comprobación y código de error. `online` indica `ready`, no simplemente Wi-Fi disponible.

| Estado de conexión | Mensaje / significado |
| --- | --- |
| `checking` | Verificando conexión con Qualitzer; aún no confirmada |
| `ready` | Conectado a Qualitzer, tras comprobación remota |
| `offline` | Sin red: señal de red explícitamente `false` |
| `unreachable` | Sin acceso a Qualitzer: falla el transporte hacia la pasarela, aunque haya enlace de red |
| `service_error` | Servidor no disponible, requiere actualización o configuración incompatible, según el error |
| `auth_required` | Verificar sesión; no enviar hasta reautenticar el mismo ámbito |

NetInfo no garantiza internet ni disponibilidad del backend. La antigüedad de agenda/caché es información secundaria; no sustituye el estado de conexión. `foreground` se muestra por separado: tener conexión no implica estar sincronizando en segundo plano.

La franja superior muestra dos líneas: conexión y resumen de pendientes/revisiones. Ya no repite el nombre de la sucursal. Pulsarla abre el centro con cobertura, fechas y detalles; la identidad de sucursal no se modifica. La agenda de teléfonos usa tarjetas cronológicas y siete días ajustados al ancho; [AGENDA-MOVIL.md](AGENDA-MOVIL.md) describe el alcance.

### Dependencias y esperas

Los comentarios e imágenes de una creación local esperan primero su confirmación y remapeo a IDs canónicos. El centro muestra el trabajo, motivo humano de espera y estado/error de la creación padre; los IDs y JSON quedan en **detalles contraídos**. No confundir varios pendientes dependientes con varios trabajos nuevos.

Sólo `MOBILE_CREATION_SCHEMA_NOT_READY`, `MOBILE_SYNC_SCHEMA_NOT_READY` y `OFFLINE_SYNC_ROUTE_NOT_FOUND` permiten espera automática de despliegue de **al menos 60 segundos**, conservando UUID, payload y bytes. También se recuperan bloqueos/conflictos antiguos de creación sin resultado/recibo cuyo código exacto sea `MOBILE_CREATION_SCHEMA_NOT_READY`, incluidos los antiguos 409 de ese caso. **No se reinician** conflictos 409 genéricos, rechazos, revisiones con recibo ni colisiones de operación. La única recuperación adicional de una revisión local es el caso específico de documento descrito abajo. El reintento no crea tablas ni despliega rutas: el servidor debe estar preparado.

### Recuperación del error de archivo mostrado

**Corrección posterior del 10-09-2026:** el destino raíz de una asignación directa se guardaba sin `workId`. Tras resolver una creación local quedaba `direct-N` sin trabajo, y el schema HTTP rechazaba el documento antes de construir el POST. El primer arreglo de multipart no cubría este caso; su segundo intento terminaba en `OFFLINE_DOCUMENT_UNEXPECTED_ERROR`.

`resolveDocumentScope` añade el trabajo canónico únicamente al scope de envío de `direct-N` / `direct-np-N`, validando los identificadores y el resultado del padre. No modifica el scope persistido ni la identidad de archivos de la orden en la UI. Las raíces de mantenimiento/externa siguen sin trabajo. La revisión con el segundo código se recupera sólo si cumple ese patrón directo, no tiene recibo ni paso y su padre local está aplicado y es consistente. Un nuevo fallo desconocido usa `OFFLINE_DOCUMENT_SUBMISSION_FAILED`, no elegible para repetir esta reparación.

**Comprobación real de sólo lectura:** el UUID documental de la captura ya tiene recibo `applied`, `fileId=30994`, sucursal 1. La creación padre corresponde al trabajo `11444` (`direct-11444`). El recibo se actualizó a las 13:54:23 del 10-09-2026 según la base local. Esto confirma el resultado registrado en backend; no acredita la actualización del contador en el teléfono ni una descarga física desde S3.

Los documentos antiguos en `needs_review`, sin recibo local y con el código exacto `OFFLINE_SYNC_UNEXPECTED_RESPONSE`, vuelven automáticamente al protocolo de comprobación. No cambia su UUID, destino, dependencia, nombre, MIME ni contenido. No se aplica a comentarios, respuestas, otros errores o recibos terminales.

- Primero consulta el recibo: `needs_review`, `conflict` o `rejected` detienen el envío; `in_progress` espera.
- Para continuar comprueba propiedad, tamaño y SHA-256 de la copia persistida. Después usa el POST idéntico para validar el contenido, incluso si el GET ya decía `applied`.
- Sólo confirma el documento cuando el recibo del POST incluye un `fileId` válido. No busca archivos por nombre ni crea un identificador nuevo.
- El multipart nativo conserva el nombre y MIME originales, aunque la copia local tenga nombre UUID sin extensión. Las fuentes instaladas de Expo 57 reproducen la pérdida de esos metadatos con el mecanismo anterior; no acredita por sí solo la causa exacta del archivo del teléfono.
- Un error desconocido nuevo se clasifica como `OFFLINE_DOCUMENT_SUBMISSION_FAILED` y se detiene, sin bucle de reenvíos. Fallos de transporte tipados siguen esperando reconexión. Una discrepancia de contenido o un recibo incierto real todavía requiere revisión para evitar duplicados.

Cada intento conserva UUID, cuerpo y bytes. Creaciones reutilizan `clientRequestId`; comentarios, respuestas y documentos usan recibos backend. Tras una respuesta perdida, un GET `applied` por sí solo no prueba que era el mismo payload: se confirma con **POST idéntico**, sin generar otro UUID. `in_progress` espera; una colisión `MOBILE_SYNC_OPERATION_REUSED` queda en revisión, nunca se reactiva a ciegas.

Esto no promete «exactamente una vez» para todos los efectos backend. Una caída **después del efecto y antes de persistir el recibo terminal** es distinta de perder la respuesta HTTP de un recibo ya confirmado: la primera queda conservadoramente en `needs_review`, sin volver a ejecutar el efecto; la segunda puede recuperar el recibo mediante replay idéntico.

| Estado | Qué hacer |
| --- | --- |
| Pendiente / sincronizando | Mantener conexión y app abierta; no crear otra solicitud |
| Esperando creación padre | Revisar la operación de creación; comentarios/fotos continuarán al obtener sus IDs reales |
| Servidor requiere actualización | Verificar despliegue del tenant; espera automática mínima de 60 s, sin borrar contenido |
| `auth_required` / sesión vencida (401) | Volver a ingresar **con la misma cuenta y ámbito**; la cola se conserva y se revalida antes de continuar |
| `conflict`, `needs_review` o rechazo bloqueado | Revisar manualmente respuesta, base, error/recibo y datos reales con el responsable; conservar fotos y texto |

No hay en la UI un solucionador de conflictos, mezcla automática, exportación ni descarte seguro general. La respuesta local/base/fotos se retienen; no se sobrescribe automáticamente el valor remoto para resolver un conflicto. No borrar almacenamiento ni cambiar UUID como reparación.

La búsqueda de equipo se aplica a nuevos borradores y conserva la selección existente al consultar otro número. No puede añadir retroactivamente un equipo a un payload ya encolado sin equipo: ese cuerpo es inmutable. Una nueva operación es distinta, no una reparación automática ni autorización para duplicar una creación incierta.

## Sesión y aislamiento

**Configuración vigente:** sólo `BACKEND_URL` identifica la API; empresas y Origins provienen del master backend, no de una URL frontend ni de la lista local. El Origin canónico se usa internamente en APIs legacy, nunca para contactar el portal. El catálogo se refresca al login y con TTL de 60 segundos; una indisponibilidad no habilita fallback parcial/legacy ni permite sincronizar sin autorización. Guía: [CONFIGURACION-BACKEND.md](CONFIGURACION-BACKEND.md).

El arranque con sesión guardada recupera el usuario cacheado **sólo ante `NetworkError`** y con perfil previamente verificado ligado a la sesión live actual. No usa caché para disfrazar 401/403/404/503 o datos inválidos de éxito. El perfil se vincula mediante hash de token opaco, pasarela y tenant; el namespace separa modo, pasarela, tenant/origen/entorno, usuario, trabajador y sucursal. `portalOrigin` permanece en esa identidad aunque ya no se muestre ni anuncie en la cabecera; ocultarlo no migra ni borra datos. En web `cookie-session` recuerda el último principal verificado, no acredita autenticación remota.

- Un 401/rechazo conocido deshabilita el perfil y detiene sincronización, **sin borrar pendientes**. Tras autenticarse de nuevo se comprueba la misma identidad y pertenencia antes de reanudar.
- **Cerrar sesión se bloquea si hay pendientes**, incluso en otro namespace. Cambiar de sucursal exige conexión/verificación y se bloquea mientras la sucursal actual conserva operaciones sin confirmar. No hay limpieza destructiva de pendientes.
- No se permite apropiarse automáticamente de la cola/perfil de otra cuenta. Un ámbito pendiente incompatible se bloquea y requiere recuperar/revisar su cuenta original.
- Si el cierre está permitido, se retiran sesión y borradores aún no encolados; no se vacían la cola ni la caché offline. No equivale a borrado seguro del dispositivo.

### Migración de configuración sin cambiar los ámbitos pendientes

El snapshot cifrado de sesiones del gateway **V1 → V2** exige [../config/tenants.json](../config/tenants.json) como referencia histórica exacta: misma huella V1 de rutas habilitadas y coincidencia de backend/origen/entorno con el catálogo central. **No borrarlo ni cambiarlo antes del primer arranque migrado.** Retirar `TENANT_ORIGIN`/`GATEWAY_TENANTS_FILE` del entorno, incluido el proceso heredado, no significa eliminar ese archivo.

El binding conserva el alias cliente `grupo-eliseo-local` frente al ID canónico `tenant-1`, así como origen/entorno y referencia de sesión; no sustituye el ID de los namespaces por el nuevo ID master. V2 persiste ese alias y no necesita leer la lista histórica en funcionamiento normal. El gateway no mueve ni borra caché, borradores o pendientes del cliente.

Si falta la referencia, difiere su huella o no coincide exactamente la ruta, el arranque se bloquea sin descartar V1. Recuperar la referencia/catálogo correctos; **no resetear sesiones ni borrar almacenamiento para desbloquear la cola**. Una baja validada del tenant revoca sólo sus sesiones y no borra sus pendientes; se requiere revisión autorizada, no reasignarlos a otra empresa. La conservación del alias está verificada; no acredita una sesión real activa restaurada ni una sincronización real tras esta migración.

## Arranque, privacidad y límites reales

- **Web:** el E2E recarga el cliente con la **pasarela inaccesible**, pero Expo sigue sirviendo el código web. No hay PWA/service worker que garantice abrir toda la aplicación sin servidor web.
- **Android/iOS standalone con bundle instalado:** puede arrancar sin Metro; necesita una sesión/perfil/caché previamente preparados para trabajar offline. **Expo Go no garantiza arranque en frío sin servidor de desarrollo.** Falta probar esta recuperación en dispositivos físicos.
- No se garantiza sincronización con app cerrada, en background o bajo restricciones del SO. Los avisos push son otro flujo, descrito en [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md).
- SQLite, caché y archivos operativos **no están cifrados por la app**. El token nativo usa SecureStore y el token web cookie HttpOnly, pero eso no cifra datos de trabajo. Se conserva un perfil mínimo permitido y datos potencialmente sensibles: usar bloqueo de pantalla y dispositivo de confianza.
- WAL, transacciones y blobs persistentes no protegen absolutamente contra desinstalación, borrado de datos, modo privado, expulsión del navegador/SO, corrupción o daño físico. No se promete ausencia absoluta de pérdida.

## Despliegue y evidencia

Verificar las **tres migraciones tenant originales**: creación, notificaciones y recibos sync. No se ejecutaron automáticamente; se desconoce si el usuario ya las aplicó en su servidor. No se afirma que falte una tabla concreta. Requisitos en [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md). Una indisponibilidad exige revisar red/servidor/sesión, no borrar datos ni volver a endpoints legacy no idempotentes.

**E2E web aislado PASS**: cuatro operaciones aplicadas, un efecto por tipo, caché/blob conservados tras recarga, respuesta de documento perdida tras commit recuperada con POST idéntico/recibo y dos reconexiones sin duplicados. La fixture 8788 se detuvo; no usó SQL ni cuentas reales y el cliente web siguió disponible. Reproducción: [../tests/e2e/README.md](../tests/e2e/README.md).

**El recibo real del archivo sí está verificado:** después de la corrección del destino directo se consultaron únicamente los UUID de documento y creación en la base local, sin escrituras ni contenido del archivo. Resultado documental `applied`, archivo 30994; la cola/indicador del teléfono no se pudo inspeccionar. No borrar datos ni reinstalar.

Validación del 10-09-2026: **653 casos, 652 aprobados, 1 omitido por plataforma, 0 fallidos**. TypeScript app/pasarela sin errores y exportación Expo Android/iOS/web completada. Cabecera: cinco escenarios; agenda: 320/360/390/1280 px; recuperación legacy con respuesta perdida y dos reconexiones: PASS aislado, un efecto por tipo y bytes conservados. No se ejecutaron validaciones globales backend/frontend ni escrituras reales. No equivale a validar SQL, SQLite físico o push.

Validación posterior del destino directo: **703 casos, 702 aprobados, 1 omitido Windows, 0 fallos** y TypeScript app/gateway sin errores. Incluye 50 pruebas nuevas con cliente HTTP y schemas reales contra loopback: raíz directa, reparación de dos intentos, respuesta perdida/un efecto y recibos terminales. El nuevo E2E de UI de raíz directa llegó al archivo persistido y revisión restaurada, pero falló por un selector de expansión de detalles; **no se declara completo**. Cabecera con actualizar en header: 5/5; agenda: 4/4. No se repitió exportación en esta corrección posterior.

Contratos técnicos: [../src/offline/README.md](../src/offline/README.md), [../src/screens/offline/README.md](../src/screens/offline/README.md) y [../server/offline/README.md](../server/offline/README.md).