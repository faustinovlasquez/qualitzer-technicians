# Recursos del panel móvil

## Integración actual

Exportación: `createPanelRouter(upstream, uploadLimiter, uploads)` desde [routes.ts](routes.ts).

- [../app.ts](../app.ts) ya crea un router por tenant bajo `/api/assignments`, **después de sesión**, en orden: OT, panel y asignaciones. El tenant procede exclusivamente de la sesión.
- Panel y asignaciones comparten `uploadLimiter` y `UploadConcurrency` entre todos los tenants: máximo global de dos cargas activas. CORS ya incluye `DELETE`.
- La autenticación previa se conserva. Las rutas fotográficas antiguas siguen como compatibilidad; la UI actual usa documentos genéricos y la lectura dedicada por paso. El alcance backend/frontend y su comprobación pendiente se detallan en [../../docs/PANEL-TECNICO.md](../../docs/PANEL-TECNICO.md).

## Contrato público

Query común obligatoria: `startDate`, `endDate`, `companyBranchId`, con las mismas reglas de rango que asignaciones. No se admiten otras claves, duplicados, arrays ni objetos. Sólo GET de comentarios acepta `page` opcional, de 0 a 1000; el gateway fija `limit=30` hacia backend.

| Método | Sufijo bajo `/api/assignments` | Entrada |
| --- | --- | --- |
| GET | `/:groupId/files` | Query común |
| POST | `/:groupId/files` | Un archivo en multipart `files` |
| DELETE | `/:groupId/files/:fileId` | Sin body |
| GET | `/:groupId/works/:workId/comments` | Query común + `page?` |
| POST | `/:groupId/works/:workId/comments` | JSON exclusivamente `{ text }`, 1–10000 caracteres tras trim |
| POST | `/:groupId/works/:workId/documents` | Un archivo en multipart `files` |
| DELETE | `/:groupId/works/:workId/files/:fileId` | Sin body |
| GET | `/:groupId/works/:workId/steps/:stepId/files` | Query común; adjuntos del paso desde snapshot canónico fresco |
| POST | `/:groupId/works/:workId/steps/:stepId/documents` | Un archivo en multipart `files` |
| DELETE | `/:groupId/works/:workId/steps/:stepId/files/:fileId` | Sin body |

Las escrituras responden `{ success: true }`; POST usa 201, DELETE 200 aunque backend responda vacío. Las lecturas conservan `{ data, totalRows, totalPages }`. Los archivos conservan ID, nombre, MIME, tamaño disponible y URLs; los comentarios incluyen autor y archivos históricos. No se reintentan escrituras automáticamente.

## Destinos y autorización

- Trabajo/paso: `AssignmentAuthorization.work(req, false)` sobre una proyección validada, sin modificar el request original ni el contrato común de asignaciones. Los recursos siguen disponibles en estados finalizados/entregados y con `canExecute=false`.
- Grupo: snapshot fresco, worker y sucursal verificados por la autorización existente, una coincidencia exacta de grupo. Grupos directos delegan al primer trabajo de ID válido y no duplicado del mismo snapshot; sin uno, `400 GROUP_HAS_NO_OT`.
- Grupo externo usa `/negotiation_files/<negotiationId>`; mantenimiento, `/maintenance_files/<maintenanceId>`. La lectura conserva el alcance raíz del gestor de escritorio, incluidos sus archivos de trabajos relacionados.
- Trabajo estándar usa `/work_files/<workId>`; mantenimiento usa su gestor con `folderId=maintenance_work_<workId>` derivado en servidor. Cargas de gestores usan `attachments` y `companyBranchId` en formulario; nunca carpetas o destinos del cliente.
- Comentarios y cargas de pasos de **ambas fuentes** usan `/technician-dashboard/panel/...`; `groupType` se deriva del grupo canónico. Los pasos envían un archivo en `files`, **sin campos de texto**, y sucursal/rango/fuente en query, como exige ese backend.
- Contrato backend coordinado: `PanelResources*` resuelve comentarios de mantenimiento por `maintenanceWork.workId` (trabajo espejo). La evidencia estándar usa `work_files` más namespace de ruta por trabajo/paso, hidratado en las asignaciones. No se igualan IDs de distintas fuentes ni se inventa el espejo. Su presencia en el checkout/despliegue debe confirmarse; ver la matriz.
- `GET /steps/:stepId/files` **no** usa sólo la lista conservada en pantalla: autoriza y toma `step.attachments` del nuevo snapshot. El getter móvil dedicado alimenta el gestor del paso; POST `/documents` y DELETE conservan el mismo alcance.
- Comentarios y documentos genéricos se pueden gestionar después de entregar el hijo. `readOnly` por cierre del hijo afecta a respuestas/estados, no a estos recursos. Un padre entregado no añade un bloqueo sobre el hijo; la pertenencia fresca sigue siendo obligatoria.
- Cada mutación revalida después del snapshot inicial; las cargas lo hacen después de recibir el archivo. Borrados exigen membresía en una lista fresca del dueño o en `step.attachments` frescos. El DELETE externo es únicamente `/files/<fileId>` ya autorizado.
- La lectura de archivos devuelve hasta 1000 elementos. Para pertenencia al borrar se recorren páginas de 1000, con tope de 100 páginas, sin aceptar filtros del cliente.
- Los bloqueos son locales al router, por trabajo/fuente o grupo. No son compartidos con las mutaciones de estado del router existente; la revalidación no constituye una transacción distribuida con backend.

## Documentos

Máximo un archivo no vacío de **25 MiB por petición**, sin campos multipart adicionales. La UI permite **4 pendientes y 40 MiB combinados**, pide confirmación y los envía **secuencialmente**, uno por petición. No es un multipart de cuatro documentos ni un límite acumulado de almacenamiento. No hay reintento automático tras una respuesta ambigua.

- JPEG, PNG, WebP, GIF, HEIC y PDF se identifican por firmas; no se confía en el MIME enviado.
- TXT/CSV requieren extensión correspondiente, UTF-8 válido, sin NUL/controles binarios ni marcado HTML/SVG.
- DOCX/XLSX requieren ZIP con directorio central válido y acotado a 2000 entradas, `[Content_Types].xml` y el documento principal correspondiente. Se rechazan traversal, duplicados, cifrado, ZIP64, enlaces simbólicos, macros VBA y entradas ejecutables/embebidas detectables. No se descomprime contenido; la suma declarada expandida se limita a 100 MiB.
- Esta inspección es limitada: no valida semántica XML, no garantiza ausencia de malware ni reemplaza antivirus. ZIP genérico, DOC/XLS binarios antiguos, HTML y SVG no están soportados.
- Se conservan nombres UTF-8 saneados, sin rutas/controles, corrigiendo extensiones incompatibles con la firma; no se generan nombres `photo-UUID`.
- HEIC se admite en gestores de archivos. Para pasos se responde `415 HEIC_STEP_DOCUMENT_UNSUPPORTED` porque el contrato backend actual no admite ese MIME; convertir a JPEG/PNG o ampliar explícitamente el backend antes de quitar la restricción.

## Verificación y límites

[../tests/panel-resources.test.ts](../tests/panel-resources.test.ts) cubre recursos con backend simulado; no prueba persistencia real entre móvil y desktop. Última batería móvil comunicada: **270 casos, 269 aprobados, 1 omitido por plataforma Windows, 0 fallidos**. Esta edición documental no ejecuta validaciones.

Demo en navegador: comentarios y carga/borrado de PNG, además de checklist, cronómetro y entregas. No prueba todos los formatos ni la seguridad/consistencia del backend real. TypeScript pasó antes del último cambio multifecha; repetirlo y ejecutar la exportación final quedan a cargo del integrador. Sin login/mutaciones reales, APK/IPA firmado ni dispositivo físico verificado. Sin lint/tests/build globales de backend/frontend. Pendientes funcionales y end-to-end: [../../docs/PANEL-TECNICO.md](../../docs/PANEL-TECNICO.md).