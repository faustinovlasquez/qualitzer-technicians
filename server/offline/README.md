# Sincronización offline: contrato gateway integrado

Estado 09-09-2026: gateway, puertos HTTP/demo, motor/repositorio y UI están integrados con App/hook, incluidos dashboard y sucursal. No queda pendiente el cableado del padre. Guía: [../../docs/OFFLINE.md](../../docs/OFFLINE.md); contrato backend: [mobileSync](../../../Qualitzer2.0-Backend/src/mobileSync/README.md). Esta edición sólo cambia documentación móvil, no el README backend.

## Montaje y API

- Export: `createOfflineRouter(upstream, uploadLimiter, uploads)` desde [routes.ts](routes.ts).
- [../app.ts](../app.ts) lo monta por tenant en `/api/offline`, después de `SessionContext.middleware()`; comparte **el mismo** objeto `uploads` de límite global 2 con panel y asignaciones y el mismo rate limiter. CORS ya admite PUT/PATCH/DELETE y se conserva.
- `Upstream.requestReceipt(path, operationId, options)` admite únicamente POST `/mobile-sync/commands`, POST `/mobile-sync/documents`, GET `/mobile-sync/receipts/<UUID canónico>`. Devuelve `{ status, receipt }` validado, no el cuerpo crudo.
- `HttpTechnicianRepository` y `DemoTechnicianRepository` implementan `offlineCommand(command)`, `offlineReceipt(operationId, companyBranchId)`, `offlineDocument(metadata, file)`.
- POST `/api/offline/commands`: JSON de hasta 64 KiB, sin compresión, parseado después de sesión. El límite global de auth sigue en 32 KiB.
- GET `/api/offline/receipts/:operationId?companyBranchId=N`: UUID y sucursal canónicos, sin caché.
- POST `/api/offline/documents`: exactamente un `metadata` JSON de 16 KiB y un `files` no vacío de hasta 25 MiB. Límite del stream completo: 25 MiB + 16 KiB + 64 KiB de overhead. Se mide también transferencia chunked/preamble; al exceder ese límite o el timeout se cierra el stream. No se admite Content-Encoding comprimido.

Cada operación revalida `/auth/me`, trabajador positivo y sucursal habilitada. Los documentos comprueban identidad antes y después de leer el multipart. No se consulta la asignación actual en el gateway, ni para POST replay ni GET: la reclamación durable y la autorización canónica del destino nuevo pertenecen al backend. Así un replay aplicado no queda bloqueado al reasignar el trabajo.

Scope: `{ groupId, workId?, companyBranchId, startDate, endDate }`. IDs positivos seguros y decimales canónicos, nunca nombres locales; grupos `external-N`, `maintenance-N`, `direct-N`, `direct-np-N`; directos requieren trabajo. Fechas reales, ordenadas, máximo 93 días inclusivos. Identidad, tenant y destinos de almacenamiento no son campos de entrada.

## Respuestas de checklist

El transporte acepta **solamente** `SyncStepAnswer`:

`{ isCompleted: boolean|null, responseValue: string, selectValue: string, optionsSelectValue: { value: string, label: string }[], comment: string }`.

Exportaciones compartidas en [../../src/domain/offlineProtocol.ts](../../src/domain/offlineProtocol.ts):

- `syncAnswerFromStep(step)`: obtiene la base de la proyección **canónica del servidor**, sin normalizarla como un borrador móvil.
- `toSyncAnswer(step.type, normalizeChecklistAnswer(step, answer))`: convierte la respuesta móvil, que concentra el valor en `responseValue`. `false` sigue siendo `isCompleted:false`; vacío sigue siendo `null`; `not_applicable` ocupa `selectValue` con `isCompleted:null`. Números móviles ya son strings; no se aceptan coerciones ambiguas.
- Texto/número: `responseValue`; select/approval: `selectValue`; multiselect: `optionsSelectValue`; los flags de completado móvil no se trasladan a campos ajenos a validación. `executionStatus` no viaja ni se usa como base.
- `syncAnswersEqual`: compara todos los campos canónicos, pero opciones múltiples por valor ordenado, no por etiqueta.
- `syncResponseForStep`: valida la respuesta contra el tipo/opciones del paso para demo.
- `syncCommandSchema`, `syncDocumentSchema`, `syncReceiptSchema`, `receiptForOperation` y validadores de scope/IDs.

`OfflineAnswer` en [../../src/domain/offline.ts](../../src/domain/offline.ts) es una unión de forma antigua/canónica para transición tipada de la cola. **No significa que la forma antigua sea válida en la red**: HTTP la rechaza antes del POST, pues un string no permite distinguir texto, selección o aprobación sin inventar el tipo. Nunca releer la asignación actual para reconstruir silenciosamente una base antigua.

## Recibos, errores y conservación

Los recibos válidos ligados al UUID se preservan incluso con HTTP 400/409. La salida se limita a `operationId`, `state`, `error` de allowlist explícita y `fileId` entero positivo opcional. Nunca se devuelven mensaje upstream, credenciales, SQL, URLs ni campos desconocidos. Un 409 genérico, un UUID distinto o una forma inválida nunca confirman `applied`.

- `in_progress` conserva HTTP 409 y `Retry-After: 5` en gateway. En HTTP/demo móvil se representa como `ApiError(409, "MOBILE_SYNC_IN_PROGRESS")`, **no** como estado terminal. El motor lo conserva pendiente con espera durable mínima de cinco segundos.
- `MOBILE_SYNC_OPERATION_REUSED` en recibo se transforma en `needs_review`, manteniendo ese código. El recibo original backend no se cambia.
- Sólo GET 404 con **exactamente** `MOBILE_SYNC_RECEIPT_NOT_FOUND` se traduce a `OFFLINE_RECEIPT_NOT_FOUND`; sólo éste retorna `null` en HTTP. Ruta faltante: `OFFLINE_SYNC_ROUTE_NOT_FOUND`, jamás fallback a escritura legacy.
- Recibo exitoso malformado: error 502, conservar contenido. 401 sigue invalidando sesión.
- Un archivo no confirmado, un rechazo, conflicto o revisión no autorizan borrar la copia local.

## Archivos y demo

El gateway reutiliza `detectDocument`, `MAX_DOCUMENT_BYTES` y `releaseDocuments` del módulo de documentos, pero **no** su parser que prohíbe todos los campos. Se emplea parser acotado con almacenamiento limitado, un campo metadata y un archivo. El SHA-256 recibido se compara con el hash de **los bytes recibidos**, antes de cualquier POST upstream; luego se elimina `sha256` del metadata porque el backend lo rechaza como campo desconocido.

Intersección admitida con el uploader móvil existente: JPEG/PNG/WebP/GIF, PDF, DOCX/XLSX, TXT/CSV. No HEIC directo, JSON, DOC/XLS antiguo, HTML/SVG ni ZIP genérico. Extensión y MIME deben coincidir con formato; octet-stream se sustituye por el MIME detectado. PDF comprueba cabecera/EOF e indicadores activos; texto UTF-8 sin HTML/SVG ni controles y CSV sin fórmulas. Nombres canónicos ASCII de hasta 180 caracteres. Las comprobaciones pesadas de decodificación Sharp y descompresión/relaciones OOXML permanecen en el backend, que no confía en el gateway. No equivale a antivirus.

`DemoOfflineStore` mantiene un mapa por instancia/UUID con sucursal y digest del payload normalizado, nombre/MIME/tamaño y hash real. Reclama antes del efecto; concurrentes iguales dan `in_progress`, colisiones se retienen y efectos ambiguos quedan `needs_review`. Captura bytes antes del hash/escritura para no releer una URI mutable. Sus recibos sólo incorporan `fileId` cuando el writer lo devuelve explícitamente; el adaptador demo que devuelve void no lo adivina. Esto **no es una limitación del backend actual** ni de la fixture E2E.

### `fileId` backend y efectos inciertos

Los callbacks backend actuales capturan el ID exacto devuelto por el repositorio de archivos y lo publican después de completar subida/commit. Los documentos nuevos aplicados incluyen `fileId`, preservado en GET y replay; no se busca por nombre ni último registro. El cliente enlaza su copia en `state.attachments`. Un documento histórico sin ID o una subida sin ID confirmado exige revisión y conservación de bytes, no otra subida ciega.

El backend reclama durablemente `applying` antes del efecto. Archivo/S3, transacción de negocio y recibo terminal no son una única transacción: una caída entre efecto y recibo, o un `applying` vencido, queda en `needs_review` y **no reejecuta el efecto**. No promete exactamente una vez global ni elimina todos los huérfanos S3. Perder sólo la respuesta HTTP de un recibo ya confirmado sí permite recuperar con replay idéntico.

## Recuperación integrada del cliente

- El repositorio persiste antes del envío, conserva respuesta/base UI y sobre canónico `wire`; la migración legacy usa sólo tipo/base cacheados inequívocos. Si faltan, retiene `needs_review` sin reconstruir la base desde una lectura posterior.
- El motor mantiene `MOBILE_SYNC_IN_PROGRESS` pendiente y espera; `MOBILE_SYNC_OPERATION_REUSED` queda retenido en `needs_review`, sin retry ni confirmación posterior por GET.
- GET `applied` no prueba igualdad de payload. Tras ambigüedad se confirma con POST de **idénticos UUID/cuerpo/bytes**; GET conflict/rejected/needs_review no permite volver a ejecutar. No genera UUID nuevo automáticamente ni hace fallback legacy.
- AppState/NetInfo disparan sincronización de primer plano con revalidación de `me`; 401 detiene y conserva pendientes. Reautenticar la misma cuenta/ámbito permite continuar. Logout con pendientes y cambio de sucursal con cola actual sin confirmar se bloquean sin limpieza destructiva.
- El centro muestra conflicto/base/recibo/fotos para revisión manual, sin merge, solucionador ni exportación. No sobrescribe automáticamente servidor ni descarta contenido local.

## Despliegue y validación

Requiere la migración tenant de recibos sync además de creación y notificaciones: **tres en total**, sin ejecución automática. Revisar esquema/concurrencia en staging antes de habilitar flujos reales; [../../docs/PLANIFICACION-Y-AVISOS.md](../../docs/PLANIFICACION-Y-AVISOS.md).

Pruebas con mocks en [../tests/offline-sync.test.ts](../tests/offline-sync.test.ts): auth/scope, respuestas canónicas, recibos/UUID, formatos/digest, límites y concurrencia. Batería previa comunicada: **512 casos, 511 aprobados, 1 omitido, 0 fallidos**; error TypeScript de App en corrección y cambios concurrentes requieren validación final del coordinador.

El coordinador ejecutó E2E web aislado **PASS**: cuatro operaciones aplicadas, un efecto por tipo, blob/hash conservado, respuesta de archivo perdida tras commit recuperada con dos POST idénticos y recibo sin doble escritura, recargas adicionales sin duplicados y logout bloqueado. [../../tests/e2e/README.md](../../tests/e2e/README.md). Prueba app real/fixture, **no gateway/backend real, SQL, shell web sin servidor ni dispositivos físicos**. Esta edición no ejecutó tests, lint, build, migraciones ni escrituras reales.