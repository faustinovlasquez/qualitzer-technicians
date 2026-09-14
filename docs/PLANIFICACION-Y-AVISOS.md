# Planificación, creación técnica y avisos

Estado al **09-09-2026**: código integrado en app/pasarela/backend, incluido núcleo offline, selección de equipo y asociación online de checklists existentes. **Verificar despliegue tenant; activación push pendiente.** Backend/frontend usan `app-mobile`, sin cambios frontend en esta mejora. No hay paridad administrativa ni validación productiva completa. Resumen: [MEJORAS-TECNICO.md](MEJORAS-TECNICO.md).

## Conexión y empresa de la sesión

La conexión móvil configura **sólo `BACKEND_URL` como destino de API**, no la URL del proyecto frontend. Config/discover/complete neutrales resuelven las empresas activas del master backend (máximo 50) sin Origin: credenciales → una coincidencia y acceso automático, o desafío con varias coincidencias. El backend correlaciona el grant y fuerza la sesión `mobile`; login web/JWT existentes permanecen sin cambios.

Creación y avisos siguen usando APIs protegidas legacy con Origin interno obtenido del catálogo autoritativo/sesión. `portalOrigin` no es un destino HTTP al frontend ni una selección del cliente: se oculta visualmente y por accesibilidad en la cabecera, pero se conserva para identidad/namespaces. CORS autoriza el navegador Expo (8081/LAN), no empresas; nativo no necesita enviar Origin. La pasarela renueva catálogo antes del login/completado y al vencer 60 segundos; un fallo bloquea sin fallback parcial/legacy y una baja confirmada retira sólo sus sesiones.

[../config/tenants.json](../config/tenants.json) ya no es el catálogo normal. **Conservarlo histórico y exacto para V1 → V2**, junto al snapshot cifrado y su clave: la migración preserva el alias `grupo-eliseo-local` y namespaces offline sólo si huella y ruta coinciden. No borrar antes del primer arranque ni resetear borradores si falta/difiere; V2 no lo necesita en adelante. Las variables legacy ya se retiraron del entorno local; también deben estar ausentes del proceso heredado, no vacías. Guía completa y exposición del catálogo público: [CONFIGURACION-BACKEND.md](CONFIGURACION-BACKEND.md).

## Crear y consultar la jornada

Desde **Mi jornada** o **Agenda**, Crear abre Datos → Horario → Revisar. Usa la sucursal y trabajador de la sesión; no permite asignar otro responsable ni sobrescribir tenant/zona horaria.

| Creación móvil | Alcance |
| --- | --- |
| Trabajo | Trabajo propio independiente; título, descripción y prioridad; equipo interno/especialidad opcionales |
| No productivo | Motivo, detalle y comentario inicial opcional; `other` exige detalle |
| Mantenimiento | OT **correctivo o detención** con equipo interno y primer trabajo; se asignan y planifican juntos |
| Preventivo, rutinario, checklist | **Sólo asistente web** para pautas/rutinas/listas; opciones deshabilitadas, no formulario genérico equivalente |

- Una fecha y franja `HH:mm`, inicio anterior al fin, **mismo día**; sin recurrencia ni cruce de medianoche. La zona procede de la sucursal. El backend rechaza horas inexistentes/ambiguas y franjas que atraviesan DST; no inventa zona ni corrige horas silenciosamente.
- Estado inicial pendiente/planificado; no inicia cronómetros ni registra horas ejecutadas o firmas. Con confirmación backend se reciben grupo/trabajo/horario; si sólo quedó en cola, la UI ofrece **Ver trabajo local**, no una creación remota confirmada.
- Borrador y petición se conservan por ámbito. Antes del envío la cola persiste un **UUID real** por intento lógico. Tras corte/timeout, el motor reintenta **exactamente el mismo cuerpo y UUID** en primer plano; no duplica deliberadamente la creación. Mismo UUID con otro cuerpo válido: 409 y revisión. No generar una solicitud nueva para reparar una respuesta incierta; «Editar como nueva», cuando corresponda fuera del estado encolado, es otra solicitud, no una edición del recurso anterior.
- La transacción backend reúne recursos, pivotes, planificación, comentario/auditoría y respuesta idempotente. En mantenimiento, `workId` de la respuesta es el **hijo de mantenimiento**, no su espejo estándar. La proyección compartida `CanonicalAssignmentWorks` omite el espejo sólo con relación `maintenanceWork.workId` verificada e hijo asignado presente, sin fusionar por título/equipo. Trabajos usa tarjetas planas por fecha y referencia OT dentro; OTs mantiene su pestaña separada.
- La previsualización de cruces compara sólo las asignaciones cargadas. Un solapamiento advierte, **no bloquea** el POST ni garantiza disponibilidad.

**Agenda** ofrece cuadrícula Día/Semana, bloques con estado, carga planificada diaria/semanal y cruces. Las barras comparan cargas entre días: **no suponen una jornada de 8 h**, no representan capacidad ni tiempo ejecutado. Vencidos/sin horario se muestran aparte sin inventar franjas. La visualización puede repartir trabajos nocturnos existentes entre fechas, aunque la nueva creación móvil sea sólo del mismo día. Abrir un bloque conserva su fecha y permite consultar la copia disponible; ejecutar acciones online exige autorización canónica fresca.

La edición administrativa de trabajos/materiales/responsables y la creación/quita de maestros checklist siguen fuera de alcance. **Asociar un checklist empresarial existente ya está implementado online**; consultar materiales no registra consumos.

### Equipo por número interno

En Datos se busca el número interno exacto: recorta espacios exteriores y compara en minúsculas, sin convertir a número ni quitar ceros (`001` ≠ `1`). No es búsqueda por prefijo. Incluso con un único resultado, el técnico debe **seleccionar expresamente** el equipo verificado del catálogo.

El borrador conserva selección y revisión; consultar otro número no reemplaza el equipo elegido. Se envía su ID como `work.rentalEquipmentId` para trabajo o `maintenance.equipmentId` para mantenimiento, no el texto como ID. Offline sólo se consultan resultados cacheados con metadatos coincidentes: no prueba catálogo completo ni disponibilidad actual en el servidor. No se cambia autenticación ni se añade equipo retroactivamente a un payload ya encolado sin él; ese cuerpo es inmutable y una nueva operación sería distinta.

### Agregar checklist de la empresa

En el detalle del trabajo, **Checklists de la empresa** aparece sobre el asistente incluso con lista vacía. Permite buscar maestros activos por nombre/código, páginas de **20**, selección manual y confirmación. Requiere conexión y trabajo canónico no cerrado/entregado; nunca funciona sobre una creación `local-*` ni se encola.

La asociación es aditiva: crea respuestas en blanco sin copiar evidencias ni reemplazar listas/respuestas/borradores anteriores. No crea maestros, no quita checklists y no exige migración nueva. Contrato y límites: [../server/checklists/README.md](../server/checklists/README.md).

### Preparación offline

Al ingresar se intentan guardar automáticamente **asignaciones semanales y catálogo combinado inicial**. Desde **Sin conexión → Preparar este período** se amplía explícitamente a primeras páginas de equipos/especialidades, metadatos de archivos y comentarios de hasta 30 trabajos y archivos de hasta 30 grupos. No descarga bytes remotos; el downloader opcional del repositorio no está conectado en App y la UI dice «metadatos». Los checklists presentes en snapshots quedan cacheados; no se inventan listas para creaciones locales.

Trabajo, no productivo y correctivo/detención mantienen sus límites y requieren opciones cacheadas para crear offline. Fotos propias se vuelven duraderas tras **Guardar archivos**; seleccionar sin guardar sigue siendo temporal en navegador. Comentarios/fotos de una creación local esperan sus IDs canónicos; el centro explica el estado del padre con detalles técnicos contraídos. Inicio/pausa/cronómetro, entrega, asociación de checklist, borrado y reporte legacy no se encolan.

La conexión distingue **Sin red**, **Sin acceso a Qualitzer**, error del servidor y sesión requerida; la caché no prueba conexión. Volver a primer plano despierta la sincronización también en web. Errores específicos de esquema/ruta pendientes de despliegue esperan **al menos 60 segundos** con el mismo UUID/cuerpo/bytes; no se reinician conflictos genéricos ni se borran datos. Detalles en [OFFLINE.md](OFFLINE.md).

## Avisos en la app

**Avisos** abre el centro: estado habilitado/deshabilitado, requisitos faltantes, dispositivo, reconciliación, fallos, bandeja paginada, leído/no leído y preferencias. El estado deshabilitado permanece visible; demo dice que no envía push y no simula entregas.

- Activar requiere **pulsación explícita** y permiso del SO. Iniciar sesión/restaurar no solicita permiso automáticamente; un consentimiento previo válido permite renovar el registro propio.
- Preferencias iniciales: asignaciones y cronómetros activados, primer recordatorio a los **30 min**, repetición cada **120 min**, silencio **22:00–07:00** en zona de sucursal. Se ofrecen 30/60/120 min y repetición 120/240 min; el backend impone al menos 120 min entre recordatorios agregados por cuenta. No pausa trabajos.
- Canal Android `technical-work`; cambios de token/permisos/sucursal se revalidan. Primero se comprueba la cola: logout con pendientes y cambio de sucursal con operaciones actuales sin confirmar se bloquean. Sólo si procede la transición se intenta desregistrar con la sesión capturada; un fallo de revocación bloquea el cambio de sucursal. En un logout permitido, el fallo de notificaciones no omite la invalidación de sesión; un envío ya aceptado no puede retirarse.
- **Web sólo consulta la bandeja autenticada cuando el servidor está habilitado; no hay browser push. Expo Go no admite push remoto de esta app en Android/iOS**: requiere development build o distribución nativa. Tener SDK/plugin instalado no activa el servidor.
- La prueba usa sólo el dispositivo propio, máximo cinco eventos/hora; devuelve pendiente en outbox, no «recibido». También respeta silencio/TTL y puede vencer sin enviarse.

### Navegación y privacidad

Pantalla bloqueada: título/cuerpo genéricos, sin nombres, clientes, equipos, importes ni texto privado de trabajos. El payload contiene identificadores de evento/ámbito/recurso, no instrucciones para ejecutar trabajos.

Al pulsar un aviso o una entrada de bandeja se validan esquema y sesión/tenant/sucursal, se comprueba el evento en la **bandeja propia fresca** y se recarga el destino autorizado. Se deduplica por `eventId`; no se abre `tenantOrigin` como URL arbitraria ni se cambia estado automáticamente. Trabajo → grupo directo o no productivo según la respuesta canónica; mantenimiento → hijo real, no espejo. Un aviso de cabecera OT con `workId: null` abre **la OT**, sin inventar ni autorizar un hijo. La notificación nunca concede permisos adicionales.

## Qué persiste y qué no garantiza el backend

- Snapshots y outbox SQL persistentes: reconciliación/detección cada **2 minutos**; despacho y recibos cada **1 minuto**. Latencia habitual de detección más despacho hasta ~3 minutos, más colas/proveedor/SO: **no es SLA** ni depende de mantener la app abierta.
- Primera alta/sesión nueva: asignaciones existentes forman una **línea base silenciosa**, sin avisarlas de golpe. Los cronómetros automáticos ya abiertos sí se comprueban desde la primera reconciliación y pueden generar recordatorio vencido.
- Es reconciliación de estado, **no CDC ni outbox transaccional dentro de cada fuente de negocio**. Una asignación y desasignación completas entre ticks pueden no detectarse. Tras reiniciar se recuperan cambios todavía vigentes comparando el último snapshot, no todos los estados transitorios.
- Snapshot y eventos se confirman juntos. Tokens Expo cifrados; leases SQL, reintentos persistentes con backoff, TTL y consulta de recibos. Se revalida sesión, pertenencia y cronómetro antes del transporte; pausa/finalización/desasignación puede cancelar pendientes.
- `accepted` significa ticket Expo; `receipt_ok`, aceptación hacia FCM/APNs; **ninguno confirma visualización ni lectura**. Crash tras enviar y antes de guardar ticket puede duplicar; vencimiento, fallos, revocación, cierre forzado o restricciones del SO pueden impedir entrega.
- Push con la app cerrada/segundo plano está contemplado, **no garantizado**. No hay tareas móviles ni alarmas locales duplicando el cronómetro backend. El aviso de cronómetros dentro de la app sólo conoce el rango cargado.

## Activación pendiente: no habilitar sólo por tener código

### 1. Despliegue tenant bajo revisión

El backend central debe tener config/discover/complete y el catálogo master completo disponibles antes del arranque del gateway; si no, éste falla de forma segura. Esta configuración y la migración cifrada V1 → V2 **no aplican ni sustituyen las migraciones SQL operativas** siguientes.

Tres migraciones tenant originales requeridas, **no ejecutadas automáticamente en esta tarea**. No se confirmó si el usuario ya las aplicó; no se diagnostica una tabla faltante sólo por ver una cola pendiente:

- [Creaciones móviles](../../Qualitzer2.0-Backend/src/database/infrastructure/sequelize/migrations/tenant/20260908160000-Create-MobileCreationRequests.js): persistencia idempotente; sin tabla, POST responde `MOBILE_CREATION_SCHEMA_NOT_READY`.
- [Notificaciones móviles](../../Qualitzer2.0-Backend/src/database/infrastructure/sequelize/migrations/tenant/20260908160000-Create-MobileNotifications.js): dispositivos, snapshots y entregas/outbox.
- [Recibos de sincronización](../../Qualitzer2.0-Backend/src/database/infrastructure/sequelize/migrations/tenant/20260909120000-Create-MobileSyncReceipts.js): UUID/payload y estados durables; sin esquema, `MOBILE_SYNC_SCHEMA_NOT_READY`. No borrar recibos para forzar reenvíos ni volver a rutas legacy.

Revisar estado real, dependencias, columnas/índices, procedimiento tenant, rollback y compatibilidad MySQL en staging antes de aplicar lo que falte. No hay migración automática ni `sync` nuevo; la asociación de checklists no añade otra migración. La atomicidad de una creación **no significa** atomicidad DDL MySQL. Falta comprobar SQL concurrente y autorización por tenant/cuenta/sucursal. Los reintentos de la app no despliegan el servidor ni reparan datos por sí solos.

### 2. Configuración privada del backend

Estado comunicado: flags deshabilitados y clave push no configurada. Mantenerlos así hasta completar revisión y pruebas autorizadas.

Guía operativa actualizada: [ACTIVAR-NOTIFICACIONES.md](ACTIVAR-NOTIFICACIONES.md). El módulo de push lee directamente `process.env`, a diferencia de la configuración de la pasarela: si los valores se almacenan en AWS Secrets Manager, el despliegue debe inyectarlos en el entorno del proceso. La actualización 1.0.5 incorpora Expo/Firebase mediante configuración estática validada en el APK, manteniendo el entorno de build restringido. Las credenciales FCM v1 y la habilitación remota siguen siendo independientes.

| Variable | Requisito |
| --- | --- |
| `MOBILE_PUSH_ENABLED` | `true` sólo para activar tras completar requisitos |
| `MOBILE_PUSH_SCHEMA_READY` | `true` sólo después de revisar/aplicar esquema en cada tenant habilitado |
| `MOBILE_PUSH_ENCRYPTION_KEY` | Secreto aleatorio de 32 bytes, 64 caracteres hexadecimales; sin valor predeterminado |
| `EXPO_PROJECT_ID` | UUID **público real** del proyecto permitido, idéntico al build móvil |
| `MOBILE_PUSH_GATEWAY_USER_AGENT` | Exactamente **`Qualitzer-Mobile/1.0 (Mobile; Gateway)`**, usado actualmente en login y todas las llamadas del gateway |
| `EXPO_ACCESS_TOKEN` | Secreto opcional si se habilita la seguridad mejorada de Expo |

Inyectar secretos mediante el mecanismo seguro de despliegue, **nunca en el chat, cliente, repositorio ni logs**. El User-Agent fijo no es una credencial; la autorización exige sesión upstream vigente y sus relaciones reales. No cambiar claves de cifrado sin un plan supervisado de recifrado/re-registro.

### 3. Build nativo y proveedores

- [../app.config.ts](../app.config.ts) admite `EXPO_PROJECT_ID` y lo publica en `extra.eas.projectId`. Es configuración pública; usar el ID real del proyecto EAS, sin UUID de ejemplo. Si no se configura, omitir la variable: un valor vacío es inválido. El cliente exige coherencia con el ID incorporado al build y con `/status` backend.
- La misma configuración admite `GOOGLE_SERVICES_FILE`: ruta **opcional** a un archivo local Firebase para el build Android. No es un interruptor que habilite push ni sustituye credenciales de envío. [../.env.example](../.env.example) deja ambas variables comentadas, sin valores ficticios ni secretos.
- Preparar por separado credenciales nativas **FCM v1/cuenta de servicio en EAS para Android y APNs para iOS**, junto con identificadores y firma correctos. Las claves/cuentas de servicio son privadas, no se incluyen en el bundle ni en documentación/chat. El archivo de configuración Firebase del cliente no es la cuenta de servicio FCM.
- Compilar e instalar un development build/distribución con dependencias/plugin y configuración correspondientes. Cambiar sólo el entorno del gateway o usar Expo Go no reemplaza el build. Verificar registro, permisos/canal y proyecto antes de pedir una prueba real autorizada.

## Evidencia y pendientes de validación

- Validación final: **591 casos, 590 aprobados, 1 omitido por plataforma, 0 fallidos**. TypeScript app/pasarela sin errores; exportación Android/iOS/web completada. No se ejecutaron validaciones globales del backend/frontend.
- **Offline E2E PASS** con recargas, respuesta de archivo perdida y reconexiones automáticas sin duplicados. **Checklist/equipo E2E PASS** en demo y fixture HTTP a 390×844, sin URL del portal en cabecera ni desbordamiento. Fixture 8788 detenida; [../tests/e2e/README.md](../tests/e2e/README.md).
- Login real autorizado en Heavytech y lecturas comprobadas: una tarea de mantenimiento sin espejo duplicado, equipo ID 1 por número interno `1644051` y catálogo de checklists. Se usó demo/fixture para verificar asociaciones sin alterar registros reales.
- Sólo se encontraron seis operaciones ya aplicadas en el IndexedDB compartido, no los padres `local-94…` de las capturas. **No se declara resuelta la cola concreta del usuario.** Tampoco se conoce el estado actual de las tres migraciones en su servidor.
- Pendientes: SQL real autorizado, idempotencia/concurrencia/rollback, cámara/SQLite/firmas en teléfonos, APK/IPA y push. Para avisos: baseline/timers, rotación/revocación, silencio y navegación tras perder asignación. No se cambian permisos del editor ni se omiten controles. Resumen: [MEJORAS-TECNICO.md](MEJORAS-TECNICO.md).

## Fuentes de contrato

- [Creación backend](../../Qualitzer2.0-Backend/src/technicianDashboard/MobileCreation.md) y [avisos backend](../../Qualitzer2.0-Backend/src/mobileNotifications/README.md): cuerpos, errores y garantías exactas. Sus notas sobre integración del consumidor describen el alcance del módulo backend; el montaje móvil actual está en las fuentes siguientes.
- [Repositorio móvil](../src/domain/TechnicianRepository.ts), [creación](../src/domain/creation.ts), [avisos](../src/domain/notifications.ts), [agenda](../src/domain/weeklySchedule.ts), [integración de sesión/navegación](../src/application/useTechnicianApp.ts) y [app](../App.tsx).
- [Gateway](../server/README.md), [rutas de creación](../server/creation/routes.ts), [rutas de avisos](../server/notifications/routes.ts) y [User-Agent upstream](../server/upstream.ts). Cobertura restante: [PANEL-TECNICO.md](PANEL-TECNICO.md).