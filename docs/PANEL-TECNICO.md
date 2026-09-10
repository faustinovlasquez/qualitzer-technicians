# Panel técnico móvil: cobertura y pendientes

Estado al **09-09-2026**. La app cubre operación, creación técnica acotada, asociación de checklists existentes y núcleo offline integrado, no toda la administración desktop. **No se declara paridad total ni end-to-end productivo terminado.** Backend/frontend están en `app-mobile`; frontend no cambió en esta mejora. Verificar el estado de las tres migraciones tenant originales; no se ejecutaron automáticamente ni se conoce si el usuario ya las aplicó. Push sigue pendiente. Resumen: [MEJORAS-TECNICO.md](MEJORAS-TECNICO.md).

## Matriz de cobertura

«Implementado» describe código integrado en móvil/pasarela; no significa validado con datos productivos. «Demo» significa navegador con datos ficticios. Los recursos nuevos necesitan también su backend correspondiente.

| Área / operación | Estado móvil | Verificación / límite |
| --- | --- | --- |
| Acceso, selección posterior de empresa, sesión y sucursal | Config/discover/complete neutrales; gateway usa sólo `BACKEND_URL` | Login real autorizado y lecturas comprobados; no acredita mutaciones ni todos los entornos |
| Cabecera de sesión | Empresa/sucursal visibles, sin URL de portal visual ni accesible | `portalOrigin` sigue en identidad/namespaces; sin cambios de autenticación |
| Jornada / agenda; selector Trabajos / OTs | Tarjetas planas por fecha en Trabajos; OTs separado | Proyección canónica compartida; espejo de mantenimiento sólo con relación verificada e hijo presente, sin fusionar títulos/equipos |
| Detalle OT: trabajos, productos/materiales y archivos | Implementado | Productos de consulta; no registra consumos ni edita materiales |
| Iniciar, pausar y reanudar hijo | Implementado | Pausa/reanudación comprobadas en demo |
| Entregar hijo con tiempo automático | Implementado | Demo; servidor confirma cronómetro, estado y evidencias |
| Horas manuales del hijo | Implementado con `allowEditExecutionTime` vigente | Falta probar cuenta real permitida y denegada |
| Entrega estándar multifecha | Implementado, hasta 30 fechas explícitas | Reautorización por día; visual/end-to-end real pendiente |
| Checklist operativo, asistente de un paso a la vez | Implementado | Demo: cuatro respuestas, avance al 100% de ese checklist; no del panel completo |
| Comentarios según fuente | Integrado en móvil/pasarela/backend y diálogo web presente | Sin sesión → 401; publicación/consulta en demo; persistencia y espejo real pendientes |
| Archivos OT/trabajo/paso, lectura/carga/borrado | Implementado; recursos backend e hidratación presentes en `app-mobile` | Demo de carga/borrado PNG; falta round-trip real y matriz de formatos |
| Inicio de OT de mantenimiento | Integrado | Ruta/contexto por tenant; falta operación real autorizada |
| Entrega OT y firmas técnica/cliente | Integrado en web y nativo | Demo de entrega con PNG; HTTP sin autorización/JSON inválido → 401; sin prueba física |
| Padre entregado y ejecución de hijos | Sin bloqueo heredado del padre | Demo: acciones del hijo pendiente conservadas tras entrega del padre; mandan estado/permisos frescos |
| Recursos genéricos tras entrega | Disponibles con autorización fresca | `readOnly` del hijo limita respuestas/estados, no comentarios/documentos del panel |
| Crear OT correctivo/detención y primer trabajo | **Implementado; verificar despliegue tenant** | Demo de correctivo; horario del mismo día y UUID idempotente; equipo interno |
| Crear preventivo/rutinario/checklist | **Asistente web requerido** | Tipos deshabilitados en creación móvil; faltan pautas/rutinas/listas administrativas |
| Crear trabajo independiente | **Implementado; verificar despliegue tenant** | Trabajo propio, horario y especialidad/equipo opcionales; demo |
| Crear tiempo no productivo | **Implementado; verificar despliegue tenant** | Motivo, detalle y comentario inicial; demo con planificación futura |
| Equipo por número interno en creación | **Integrado** | Coincidencia exacta sin perder ceros, selección manual del ID y borrador persistido; offline sólo consultas cacheadas |
| Avisos, preferencias y bandeja | **Integrado en app/pasarela/backend; activación pendiente** | Estado deshabilitado visible, consentimiento explícito; web sólo bandeja, sin browser push |
| Push con app cerrada / recordatorios | **Implementado; no probado físicamente** | Cron/outbox persistentes backend; Expo Go no soportado; no garantía de entrega |
| Editar trabajos, materiales y responsables | **Pendiente de portar a UI nativa** | `canManage` / `canEditDefinition` no habilitan administración |
| Asociar checklist de la empresa | **Integrado, sólo online** | Trabajo canónico no terminal; maestro activo, búsqueda nombre/código y páginas de 20; copia en blanco sin sobrescribir respuestas |
| Crear maestros, editar o quitar checklists | **No implementado en móvil** | La selección aditiva no administra definiciones ni sustituye el conjunto existente |
| Offline: perfil/cache, cola y recuperación | **Integrado en App/hook/dashboard/sucursal** | Restauración sólo ante `NetworkError`; SQLite WAL nativo / IndexedDB web; prueba nativa pendiente |
| Preparar período | **Integrado; acción explícita** | Metadatos/comentarios de hasta 30 trabajos y primeras páginas de catálogo; no bytes remotos |
| Creaciones, comentarios, respuestas y fotos offline | **Cola durable antes del envío** | E2E web aislado PASS; UUID/bytes estables, recibos y sincronización en primer plano |
| Conexión y dependencias offline | **Integrado** | Distingue red, acceso a Qualitzer, servidor y sesión; espera al padre, detalles técnicos contraídos y reanudación web/nativa |
| Cronómetro, estados, entrega, borrado y reporte legacy offline | **No se encolan** | No inventar tiempos ni confirmar evidencia local como remota |
| Conflictos y revisión | **Conservación local integrada** | Sin merge automático, solucionador ni exportación en UI; revisión manual |
| Batería móvil final | **591 casos: 590 aprobados, 1 omitido por plataforma, 0 fallidos** | Incluye conexión, dependencias, checklists y equipo por número interno |
| Tipos / exportación final de esta mejora | **App/pasarela 0 errores; Expo Android/iOS/web completado** | No equivale a APK/IPA firmado ni validación física |

## Integración móvil y proyectos hermanos

### Montaje confirmado en móvil

`createConfiguredApp()` obtiene el catálogo neutral antes de abrir el listener. **App → pasarela → `BACKEND_URL` → tenant/base resueltos por el backend**; no se configura ni contacta el proyecto frontend para seleccionar empresa. Config/discover/complete no llevan Origin. Las APIs operativas protegidas legacy sí lo mantienen internamente, derivado del catálogo autoritativo y la sesión, sin reescribir cada módulo ni cambiar JWT/login web.

El master backend administra todos los tenants activos (máximo 50). La pasarela renueva antes de login/completado y con TTL de 60 segundos; fallos bloquean sin fallback parcial/legacy. Una baja confirmada revoca sólo sus sesiones. El GET público expone nombres saneados/orígenes, no credenciales ni `dbName`; restringir acceso de red en despliegue. CORS sigue siendo para navegador Expo, no selección de empresa.

La lista local ya no selecciona el catálogo normal. **Conservar [../config/tenants.json](../config/tenants.json) exacto hasta verificar V1 → V2**: la huella/ruta verificada conserva `grupo-eliseo-local` como alias del ID canónico `tenant-1` y evita cambiar los namespaces offline. Si falta/difiere, no resetear sesión ni borrar borradores; V2 ya no requiere la referencia para funcionar. Variables legacy ausentes también del entorno heredado, no vacías. Procedimiento: [CONFIGURACION-BACKEND.md](CONFIGURACION-BACKEND.md).

[../server/app.ts](../server/app.ts) monta `/api/assignments` después de sesión y selecciona el runtime exclusivamente por tenant de la sesión. Orden: `createOrderRouter` → `createPanelRouter` → `assignmentRouter`. CORS incluye `DELETE`; panel/asignaciones comparten límite y contador de uploads (dos activos por instancia, no por tenant).

`createChecklistRouter` también está montado después de sesión y antes del router genérico. App/hook conectan `loadChecklistOptions` y `attachChecklist` al detalle canónico; `OfflineTechnicianRepository` delega exclusivamente online. El panel empresarial aparece encima de los checklists incluso con lista vacía. Contrato: [../server/checklists/README.md](../server/checklists/README.md).

También monta `/api/creation` y `/api/mobile-notifications` tras sesión, por tenant. [../src/domain/TechnicianRepository.ts](../src/domain/TechnicianRepository.ts) define creación/opciones y las seis operaciones de avisos; implementaciones HTTP y demo separadas. [../App.tsx](../App.tsx) conecta Crear y Avisos con [../src/application/useTechnicianApp.ts](../src/application/useTechnicianApp.ts). Contratos y activación se resumen en [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md), sin duplicar el contrato backend.

El montaje `/api/offline` también está integrado tras sesión. App/hook conectan el decorador, perfil verificado, restauración en frío, ciclo de primer plano, centro offline, detalles canónicos y props de dashboard/sucursal. Ya no queda pendiente ese cableado del padre. Al ingresar se intentan cachear semana y catálogo combinado; la preparación ampliada es explícita y sólo de metadatos. Logout con pendientes y cambio de sucursal con cola actual sin confirmar están bloqueados sin borrarla. Ante 401 se conserva y exige el mismo usuario verificado para reanudar. Contratos en [../src/offline/README.md](../src/offline/README.md).

El parser global conserva 32 KiB. **POST `/api/assignments/maintenance-<id numérico>/deliver`**, con slash final opcional, usa el parser específico de **3 MiB** después de sesión/validación de alcance. Las rutas `/api/offline` se parsean también después de sesión: comandos JSON de 64 KiB y documentos multipart acotados. No se amplía el parser de autenticación. Contratos en [../server/orders/README.md](../server/orders/README.md) y [../server/offline/README.md](../server/offline/README.md).

### Revisión correcta: `app-mobile`

El avance está en **`app-mobile` tanto en backend como frontend**. No se afirma que los árboles estén limpios: esta ampliación incorpora cambios de funcionalidad backend. No se cambiaron ramas ni se hicieron merges en esta tarea documental. La observación histórica sobre rutas ausentes correspondía a `development`, no a esta revisión.

Comprobado en el checkout actual:

- Registro de autenticación neutral config/discover/complete y sus dependencias; prepare/exchange conservados para compatibilidad legacy explícita del gateway.
- Backend `technicianDashboard`: rutas de `PanelResources*` para comentarios según fuente y archivos de pasos; espejo de mantenimiento mediante **`maintenanceWork.workId`**, sin confundir IDs.
- Evidencia estándar mediante **`work_files`**, namespace por trabajo/paso y llamada a la hidratación de `attachments` desde las asignaciones.
- Diálogo web **TechnicianWorkCommentsDialog.tsx** presente e importado por TechnicianDashboardPreview.tsx; se conserva TechnicianWorkChecklistDialog.tsx en la misma revisión.

Comprobación neutral previa: **GET config → 200 sin Origin** y alias conservado. Posteriormente se realizó login real autorizado y lectura de catálogo/asignaciones; no se atribuye causa al 401 histórico ni se afirma preservación de toda sesión. La cabecera actual de Heavytech no presenta URL del portal; el origen sigue siendo metadato interno.

Histórico HTTP: prepare/exchange con `{}` → **400**; GET de comentarios del panel sin sesión → **401**. El gateway devolvió **200**, `backendReachable: true`; conexión → **200**, Metro y LAN disponibles. Estas comprobaciones **no prueban login nuevo, permisos ni escrituras reales**.

## Reglas operativas

### Trabajos, equipo y checklists empresariales

- La lista Trabajos no repite la cabecera OT sobre cada tarjeta; conserva su referencia dentro y deja la agrupación de OTs en otra pestaña. `CanonicalAssignmentWorks` es proyección backend reutilizada por los consumidores web/móvil, no una heurística local por nombre o equipo. El espejo estándar de mantenimiento sólo se omite cuando `maintenanceWork.workId` es válido y su hijo asignado está presente.
- En creación, número interno exacto tras recortar extremos y pasar a minúsculas; `001` no es `1`. Siempre se selecciona manualmente el ID del catálogo, aunque exista una única coincidencia. Se persiste en `work.rentalEquipmentId` o `maintenance.equipmentId`; buscar otro número no reemplaza la selección. No modifica payloads ya encolados ni trabajos anteriores sin equipo.
- **Checklists de la empresa → Agregar checklist** busca maestros activos por nombre/código, de 20 en 20. Sólo se confirma online sobre un trabajo canónico vigente no cerrado/entregado, nunca `local-*`. El estado del padre no bloquea por sí solo al hijo.
- La asociación añade pasos/respuestas en blanco, sin copiar evidencias ni sustituir listas/respuestas/borradores anteriores. Repetir el mismo maestro informa que ya está asociado; si falla el refresco posterior, se actualiza el detalle sin repetir el POST. No crea ni elimina maestros, no se encola y no necesita migración nueva.
- Caché de equipos significa consultas previamente guardadas, no catálogo completo ni disponibilidad real del servidor. Para conexión, espera de creación padre y reintentos limitados de despliegue, consultar [OFFLINE.md](OFFLINE.md).

### Hijos, permisos y fechas

- Inicio/pausa/reanudación y entrega requieren pertenencia a una asignación canónica fresca, usuario/trabajador y sucursal autorizados, transición válida y `canExecute`. No se vuelve a excluir un trabajo heredado sólo porque `responsibles` esté vacío.
- Tiempo automático desde el cronómetro confirmado; edición manual únicamente con permiso de sucursal vigente. Mantenimiento automático conserva su cronómetro sin enviar horas manuales. El reloj visible del cliente no autoriza horas libres.
- Multifecha sólo al finalizar/entregar **un trabajo estándar**: array explícito de 1–30 fechas únicas. Mantenimiento hijo, inicio y pausa siguen siendo de una fecha. El rango de consulta admite hasta 31 días inclusivos; no debe confundirse con el máximo de 30 fechas de entrega.
- Para cada día seleccionado se releen usuario y asignación antes y después de comprobar evidencia: misma identidad, sucursal, fuente y trabajo, con `scheduledDate` exacto y fecha incluida en `plannedDates`. Un trabajo atrasado visible ese día no demuestra planificación/propiedad de esa fecha.
- Una sola llamada de estado con el array autorizado. En automático se usa la primera fecha ordenada; si otro día tiene tiempo acumulado, se exige entregar por separado. No se suman ni multiplican cronómetros. Un intervalo nocturno multifecha requiere seleccionar explícitamente los días que cubre.
- **Nunca `finalizeAll` ni `finalizeAllDays`.** El botón «Seleccionar todas» sólo selecciona el array acotado. El cierre masivo upstream puede ampliar días sin las mismas garantías de alcance y no se considera seguro para esta API.
- El padre entregado **no añade un bloqueo**. Si la finalización de OT actualiza el estado del hijo, se respeta ese nuevo estado: hijo `completed/delivered` implica solo lectura para respuestas/estados, no para recursos genéricos autorizados.

### Comentarios y documentos actuales frente a legacy

Base de trabajo: `/api/assignments/:groupId/works/:workId`, con query estricta de fechas y sucursal.

| Operación actual | Ruta / alcance |
| --- | --- |
| Leer / publicar comentarios | GET/POST `/comments`; fuente derivada del grupo, no del cliente |
| Leer archivos del trabajo | GET `/files`; gestor/folder derivado |
| Leer archivos de paso | **GET `/steps/:stepId/files`**; getter dedicado desde snapshot canónico fresco, no sólo adjuntos en memoria |
| Subir documento al trabajo / paso | POST `/documents` o `/steps/:stepId/documents`; un archivo en `files` |
| Borrar archivo del trabajo / paso | DELETE `/files/:fileId` o `/steps/:stepId/files/:fileId`; pertenencia comprobada |
| Archivos de OT | GET/POST `/api/assignments/:groupId/files`; DELETE con `/:fileId` |

Documentos: imágenes, PDF, DOCX, XLSX, TXT y CSV; **25 MiB por archivo**, **4 pendientes / 40 MiB combinados en UI**, confirmación y envío secuencial de uno por petición. Inspección de firma/estructura, no antivirus. HEIC se admite en gestores pero se rechaza en pasos; convertir a JPEG/PNG. Sin SVG, ejecutables, macros ni ZIP genérico. Detalles en [../server/panel/README.md](../server/panel/README.md).

Los POST fotográficos antiguos de trabajo/paso `/files` y `/report` son **legacy**. Allí persiste el rechazo de paso estándar y el reporte de mantenimiento como TXT; **no describen el soporte actual** de `/documents` y `/comments`. El decorador guarda comentarios nuevos, respuestas y documentos mediante cola/recibos `/api/offline`, con reintentos acotados e idénticos. Para un mensaje técnico offline usa Comentarios: `/report` sigue online y no se migró silenciosamente. Estados, entrega y borrado tampoco se encolan; ante respuesta ambigua de esas acciones, consultar antes de repetir. Los recursos genéricos siguen exigiendo autorización actual al enviar.

La cola distingue respuesta/base y fotos locales de confirmadas, sin sobrescribir el servidor ante conflicto. Un efecto backend incierto anterior al recibo queda en `needs_review`, sin ejecutar dos veces. Para preparación, formatos offline (sin HEIC), límites y revisión manual, consultar [OFFLINE.md](OFFLINE.md).

### Entrega de la OT padre

La OT de mantenimiento tiene contexto, inicio y entrega propios, distintos de entregar un hijo. No exige completar primero todos los hijos; sí verifica checklists obligatorios y el detalle fresco, y el backend conserva la validación final. El cierre backend puede finalizar estados de hijos.

Firma técnica **PNG obligatoria**, máximo 1 MiB decodificado por firma y validación de estructura/dimensiones. Correctivo/detención requieren además tipo de falla, nombre receptor y firma cliente. Preventivo/rutinario/checklist omiten esos campos de recepción o los envían null. La fecha y autor técnico los determina el backend por sesión; no son overrides del cliente. La captura web/nativa implementada no acredita identidad biométrica ni sustituye pruebas físicas.

## Evidencia disponible y validación pendiente

- Validación final: **591 casos, 590 aprobados, 1 omitido por plataforma, 0 fallidos**. Tipos app/pasarela sin errores y exportación Android/iOS/web completada; sin validaciones globales del backend/frontend.
- **Offline E2E PASS** con respuesta de documento perdida, recargas y reconexiones sin duplicar efectos. **Checklist/equipo E2E PASS** en demo y pasarela ficticia a 390×844: selección exacta/manual, borrador y payload con ID real de fixture, asociación en blanco, repetición bloqueada y cabecera sin URL ni desbordamiento. Fixture 8788 detenida; [../tests/e2e/README.md](../tests/e2e/README.md).
- Login real y lecturas autorizados en Heavytech: asignaciones devuelve un solo trabajo bajo mantenimiento, número interno `1644051` devuelve el equipo ID 1 y el catálogo muestra «Revision carro». No se modificaron registros reales; la asociación se verificó en demo/fixture sin cambiar estados ni permisos reales.
- El IndexedDB compartido sólo mostró seis operaciones ya aplicadas; no contenía los padres `local-94…` de las capturas. **No se verificó ni reparó esa cola concreta.** Esquema actual del servidor no confirmado; no se ejecutaron migraciones automáticamente.
- Faltan integración SQL autorizada, concurrencia, cámara/SQLite/firma en dispositivos físicos y push. Sin APK/IPA firmado ni cambios de políticas de permisos de VS Code. Resumen de alcance: [MEJORAS-TECNICO.md](MEJORAS-TECNICO.md).

### End-to-end real requerido antes de distribuir

1. Desplegar el backend `app-mobile` con config/discover/complete y recursos operativos de los tenants activos. La app sólo configura `BACKEND_URL`, no la URL del proyecto frontend; sus cambios web relacionados son independientes de esta conexión. Verificar V1 → V2 sin borrar la referencia histórica previamente y probar login nuevo: las comprobaciones locales sin credenciales no validan otros entornos.
2. Con cuenta técnica y datos de prueba autorizados: login/sucursal, asignaciones heredadas y permisos, comentarios mantenimiento/espejo y estándar, visibilidad de archivos/pasos tanto en móvil como desktop después de guardar/borrar/refrescar.
3. Probar ejecución automática/manual permitida y denegada, selección multifecha, cambio de permisos/asignación entre lecturas, intervalos nocturnos y cronómetros de varios días. No activar flags masivos para facilitar la prueba.
4. Probar entrega de hijo y padre, checklists/evidencia obligatoria, recepción correctivo/detención con ambas firmas y recursos después de entrega. Verificar persistencia real, no sólo el mensaje de éxito.
5. Verificar las tres migraciones tenant originales (creación, notificaciones y recibos sync) y aplicar sólo las que falten; comprobar creación idempotente, proyección sin espejo duplicado, SQL concurrente y recuperación conservadora entre efecto y recibo. Mantener flags push deshabilitados hasta completar [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md).
6. En dispositivos físicos: cámara/documentos, firmas, sesiones y push con app cerrada; proyecto Expo/build coincidente, FCM/APNs, permisos, rotación, revocación, horario silencioso y navegación canónica. Compilar/firmar y validar los binarios; el export JavaScript/Hermes final no prueba entrega física.

Las relecturas y locks son locales, no una transacción distribuida ni un endurecimiento global del backend. Los endpoints operativos upstream accesibles directamente conservan sus propios riesgos de autorización/atomicidad. No presentar esta pasarela como aislamiento global garantizado.