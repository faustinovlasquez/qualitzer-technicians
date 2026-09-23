# Asignacion de mantenimiento y boton flotante: gateway 1.0.26 / APK 1.0.55

La entrega actual corrige el falso aviso de trabajo no asignado al crear un hijo con otro horario y separa Crear trabajo como un + flotante. Ver [actualizacion 1.0.55](ACTUALIZACION-1.0.55.md). Instalar gateway 1.0.26 para corregir la autorizacion de la OT; no hay cambios nuevos de tablas. Conservar claves, sesiones y colas.

## Historial: gateway 1.0.25 / APK 1.0.53

La entrega actual agrega el footer fijo de mantenimiento y creacion de hijos con equipo heredado. Ver [actualizacion 1.0.53](ACTUALIZACION-1.0.53.md). Desplegar las fuentes backend y gateway 1.0.25 antes de usar Crear trabajo. Conservar sesiones y colas; no hay migracion nueva. El contenido posterior conserva las entregas anteriores.

Se registra tambien creacion y edicion, con guardado local antes de finalizar la accion e intento inmediato de sincronizacion. Conserva timer, checklist, completion y recibos. Publicar workerLocations actualizado. Mapa nativo con diagnostico de Google, sin clave visible. Detalles en ACTUALIZACION-1.0.51.md.

## Edicion de trabajos: gateway 1.0.23 / APK 1.0.50

Formulario de creacion reutilizado en modo editar y asociacion de equipo faltante. Publicar PanelWorkEdit del backend antes de gateway 1.0.23. Se mantienen timer, checklist, completion, recibos y ubicacion por acciones. No se modifica ni borra la cola offline. Detalles en ACTUALIZACION-1.0.50.md.

Contrato nuevo de ubicacion consentimiento2 por acciones confirmadas o guardadas en cola. No modifica timer, checklist, completion ni sus recibos. Publicar workerLocations actualizado antes de gateway1.0.22; sin migracion nueva. La captura periodica y servicios de fondo se detienen, sin borrar puntos anteriores pendientes. Google nativo no depende del frontend; su autorizacion en Cloud sigue siendo necesaria.

# Actualizacion de mapas y equipo: gateway 1.0.21

APK 1.0.44 incorpora Google Maps mediante el visor del portal y edicion online de la direccion registrada del equipo. Publicar PanelEquipmentLocation y las referencias canonicas en Backend; publicar src/app/api/mobile-map/route.ts y public/mobile-map.js en Frontend con la configuracion Google existente. No modifica timer, checklist, completion, recibos, colas ni datos de versiones anteriores. Sin migracion nueva.

Con el backend detenido y drenado: `npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.21.tgz --ignore-scripts --no-audit --no-fund`, despues `node scripts/check-mobile-sync-deployment.cjs`, y arrancar una sola instancia fork. Detalles y limites en ACTUALIZACION-1.0.44.md. No borrar app/datos ni pendientes.

# Fluidez móvil — app 1.0.11 y gateway 1.0.4

Paquete final de esta corrección: **gateway 1.0.19 con APK 1.0.40**. Sustituye la referencia de entrega 1.0.18 del párrafo siguiente; mantiene el mismo contrato timer/checklist/completion y conserva el artefacto 1.0.18 previo sin sobrescribirlo.

Actualización vigente: APK 1.0.40 y gateway 1.0.18 incorporan recuperación acotada de rechazos INVALID_INPUT sin recibo, con los mismos UUID y dependencia timer/checklist/completion, y capacidad dinámica de archivos en el teléfono con indicador solo offline. Instalar el gateway actualizado y conservar las fuentes backend de entrega offline. Sin migración nueva para esta corrección; los requisitos de ubicación de 1.0.39 siguen vigentes. Ver ACTUALIZACION-1.0.40.md. No se ha reproducido el fallo concreto del teléfono contra su servidor.

Actualización vigente: APK 1.0.39 y gateway 1.0.17 añaden ubicación laboral con consentimiento, horario configurable y cola independiente. Conservan timer, checklist, completion y recibos. Requiere desplegar workerLocations y la migración tenant 20260921200000-Create-WorkerLocationHistory.js, no ejecutada aquí. Ver ACTUALIZACION-1.0.39.md. Las versiones siguientes son historial, no instrucciones de la entrega actual.

Actualización vigente: APK 1.0.38 y gateway 1.0.16 incorporan cierre de tareas offline durable, dependiente de respuestas, archivos y timer pendientes, con recibo transaccional en backend. Reportes técnicos se guardan en cola como comentario o documento según su destino. Preservan UUID, información anterior y fechas trabajadas; no muestran cierre confirmado hasta recibo. Sin migración nueva. Requiere fuentes MobileSync/TechnicianDashboard/app.logbooks actualizadas antes de instalar la APK. Ver ACTUALIZACION-1.0.38.md y OFFLINE.md para la matriz real: actividades, borrados, firmas y cierre de OT completa siguen online. El contenido siguiente es histórico.

Actualización vigente: APK 1.0.37 y gateway 1.0.15 incorporan cronómetro offline con instantes de inicio/pausa/reanudación persistidos, avance local visible y secuencia idempotente. Desplegar MobileSync, TechnicianDashboard y app.logbooks actualizados antes de instalar la APK. Mantiene acumulados anteriores; cambios externos quedan en conflicto sin sobrescritura. No cambia checklist, archivos, comentarios, recibos ni colas existentes. Sin migración nueva. Ver ACTUALIZACION-1.0.37.md. El contenido siguiente es histórico.

Actualización vigente: APK 1.0.36 y gateway 1.0.14 permiten seleccionar días trabajados no consecutivos al entregar, conservando un único tiempo total. Exigen backend TechnicianDashboard actualizado, con soporte anunciado y auditoría transaccional de workedDates. No crean tiempos por día, no cierran otras planificaciones, no alteran timer, checklist, recibos o colas. Sin migración nueva. Ver ACTUALIZACION-1.0.36.md. El contenido siguiente es histórico.

Actualización del 21 de septiembre: APK 1.0.35 y gateway 1.0.13 permiten trabajos sin descripción ni horas; la app espera brevemente la confirmación de la misma solicitud conectada y conserva la cola si no llega. El backend distingue las nuevas creaciones propias para omitir su aviso de asignación. Desplegar fuentes MobileCreation/MobileNotifications y gateway 1.0.13 antes de actualizar la APK. Sin migración nueva; timer, checklist, recibos y borradores permanecen. Ver ACTUALIZACION-1.0.35.md. Las versiones posteriores en este documento son historial.

Actualización actual: APK 1.0.32 y gateway 1.0.12. Agenda recupera el horario semanal independientemente del listado y añade Día/Semana/Mes. Los archivos de actividades incorporan eliminación confirmada y online mediante PanelWorkActions actualizado. Conservar timer, checklist, recibos, colas y borradores; no hay migración nueva. Primero desplegar backend, instalar gateway 1.0.12 con el proceso detenido y arrancar una sola instancia fork; después actualizar la APK. Ver ACTUALIZACION-1.0.32.md. El contenido posterior es histórico, no una instrucción para instalar paquetes anteriores.

Se conserva la entrega técnica de gateway 1.0.11: nota, duración y firma, confirmación previa y estado entregado para padre/hijos sin completar respuestas pendientes. El nuevo borrado de archivos no modifica ese contrato ni la finalización del supervisor.

Firmas del perfil: gateway 1.0.10 y APK 1.0.25 permiten consultar, crear, editar y eliminar firmas propias y elegirlas al entregar una OT. Desplegar las nuevas rutas userSignatures del backend antes de instalar la pasarela. Mismos registros de perfil web, sin migración nueva; timer, checklist y recibos permanecen sin cambios. Ver ACTUALIZACION-1.0.25.md.

Actualización del 18 de septiembre: gateway 1.0.9 corrige listas y validaciones de pertenencia de archivos con tamaños redondeados en KB/MB. Mantiene timer, checklist y recibos. Usar la APK 1.0.24 existente; no requiere APK nueva ni migraciones. Instalar el paquete en el backend y reiniciar un único proceso. No repetir cargas ya en cola. El contenido posterior conserva el historial de entregas anteriores.

Actualización vigente: gateway 1.0.8 y APK 1.0.20 conservan timer/checklist y permiten editar actividades y devolverlas a pendiente. Los adjuntos exigen ID confirmado; el lote no se interrumpe por su propio bloqueo temporal. Desplegar el backend PanelWorkActions actualizado antes del gateway y la APK. Sin migración nueva.

Actualización actual: gateway 1.0.7 y APK 1.0.18 separan Trabajos, Mantenimientos y OTs; conservan timer/checklist e incorporan eliminación lógica de actividades. El formulario de actividad usa minutos y archivos en un diálogo. Requiere desplegar PanelWorkActions actualizado; no hay migración nueva.

Actualización 15 de septiembre: gateway 1.0.5 añade actividades y reapertura y conserva timer/checklist de 1.0.4. La sincronización anterior fue confirmada por el usuario; la nueva funcionalidad requiere desplegar PanelWorkActions y el paquete nuevo. El resto de este documento registra la entrega histórica 1.0.4.

Actualización posterior: gateway 1.0.6 conserva timer/checklist y admite avisos de mantenimiento completo sin trabajo hijo. Usar con Backend de asignaciones completas y [APK 1.0.17](ACTUALIZACION-1.0.17.md). No añade migraciones ni cambia los recibos de sincronización.

## Estado — 14 de septiembre de 2026

La implementación está integrada: UI, hook, repositorio offline, cola durable, HTTP/demo y comandos Backend. **APK 1.0.11/código 12 y gateway 1.0.4 publicados en los artefactos locales**, con copia idéntica del gateway en Backend. La verificación nativa acotada se completó en DEMO sobre emulador propio API 36. **El usuario debe instalar y desplegar Backend compatible + gateway 1.0.4 ANTES de instalar la app; producción sigue sin este despliegue.** Publicación local no equivale a descarga HTTP habilitada ni a validación de cuenta real.

La [verificación de release, 13:32:29.433Z](../artifacts/release-verification-1.0.11.json) acredita **69.155.859 bytes**, SHA-256 **287dc01e099766f2edf8d6ce065bb906f33079eb33e968d05542cbda5b4abf60**, paquete `com.qualitzer.field`, código 12 y el mismo certificado **06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510**. La [auditoría de APK](../artifacts/final-audit-1.0.11.json) confirma permisos añadidos `[]`, iconos y procedencia coincidentes y APK previa intacta. **78 fuentes críticas** coinciden con el bundle, incluida la corrección semanal. El [arranque](../artifacts/logs/native-release-1.0.11/push-client-startup.json) confirma hash realmente instalado y PID 3951; el [resumen nativo](../artifacts/logs/native-release-1.0.11/SUMMARY.md) registra una pausa efectiva, 3→2 pendientes y «En pausa» automático a las 13:30:25.657Z, sin refresco ni reintento y con los dos antiguos por revisar conservados. Sin cuenta real ni prueba de operaciones del servidor.

**1.0.3 fue generado, no entregado.** Su bundle incluye assignmentSchedule anterior a la corrección crítica de reconciliación semanal. Conservar intactos sus artefactos existentes en Mobile y Backend; no instalarlo, recomendarlo ni sobrescribirlo. 1.0.4 tiene pack y validación propios sobre las fuentes corregidas.

Evidencia actual:

- [Paquete local, 13:18 UTC](../artifacts/logs/fluidity-package/2026-09-14T13-18-05-719Z-q78U13/report.json): **585.030 bytes**, SHA-256 **b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae**, dos builds/packs idénticos y carga aislada Node 20.12.2 sin invocar la fábrica. 351 fuentes y 91 dependencias verificadas.
- [Última batería Mobile completa, 13:12 UTC](../artifacts/logs/durable-fluidity/2026-09-14T13-12-08-592Z/report.json): **1308 aprobadas, 1 omitida por plataforma, 0 fallos**; 556 focalizadas aprobadas y solapadas, no sumables.
- [UI repetida después del fix semanal, 13:19:59.920Z](../artifacts/logs/durable-fluidity-ui/2026-09-14T13-19-59-920Z/report.json): **18/18 escenarios React Native Web, 463 aserciones, 44 capturas y 0 errores de tipos**. Los recibos/pruebas causales son inputs de fixture: no sustituye pruebas reales del repositorio, dispositivo o MySQL.
- [Auditoría final, 13:24 UTC](../artifacts/logs/fluidity-final-audit/2026-09-14T13-23-43-233Z-ovDXbr/report.json): **10 checks aprobados**, tipos app/app+pruebas/servidor Mobile a cero, **33/33** pruebas de creación automática y consumidores de tarjetas. Revalida los hashes de las 57 fuentes UI, paquete/copia/manifiesto y dependencia/lock/integrity Backend. No repite toda la batería ni la UI; APK 1.0.10 intacta y 759 archivos observados estables durante la ejecución.

La dependencia y el lockfile Backend **ya apuntan a 1.0.4**. **Esta preparación no instaló la actualización en node_modules Backend; versión instalada no inspeccionada y despliegue remoto PENDIENTE.** No se ejecutaron tests, tipos, lint, build ni SQL del Backend. Detalle de entrega en [ACTUALIZACION-1.0.11.md](ACTUALIZACION-1.0.11.md) y [evidencia combinada](../artifacts/logs/durable-fluidity/SUMMARY.md). La página de descarga se iniciará y comprobará después de este cierre; no se anuncia todavía IP, URL ni QR.

## Comportamiento integrado

- Creaciones de tareas, respuestas, comentarios, documentos, inicio/pausa/reanudación de cronómetro y asociación de checklist se persisten antes de enviar, también con conexión. La UI reconoce el guardado local sin esperar la red ni la recarga remota; pendiente no significa confirmado.
- La sincronización trabaja separadamente de la UI **solo con conexión, sesión válida y app abierta, en primer plano y desbloqueada**. No es un daemon del sistema operativo ni se garantiza con la app cerrada, suspendida o bloqueada.
- Timer/checklist requieren trabajo canónico ejecutable, copia del día consultado, técnico/sucursal coincidentes y ausencia de revocación conocida. Un trabajo atrasado visible ese día es válido; una creación local aún no canónica no habilita ejecución. Asociar exige además una opción de catálogo guardada para ese trabajo/fecha/sucursal. El Backend revalida todo al aplicar.
- El cronómetro usa el reloj del servidor **al aplicar, no al tocar**. No reconstruye tiempo offline; inicio y pausa aplicados seguidos pueden sumar cero segundos. La UI no extrapola el reloj pendiente ni convierte una intención en tiempo confirmado.
- `applied` no prueba que el snapshot mostrado esté actualizado. La reconciliación de timers conserva con cada lectura los IDs observados ya aplicados en almacenamiento durable antes del GET; ni la fecha local ni un recibo aislado sustituyen esa prueba. Una lectura autoritativa posterior prevalece.
- La reconciliación semanal conserva por fecha exacta de consulta el trabajo completo, generatedAt y su prueba causal. No mezcla la prueba ni el estado/tiempo de otra fecha; una versión ausente no se sustituye por otra de la semana.
- Respuestas, archivos y asociaciones pendientes no inventan avance ni habilitan entrega. **Reporte, borrado de archivos, finalización/entrega e inicio de OT siguen online**, con recurso canónico y confirmación remota.

## Contratos

- [Protocolo compartido](../src/domain/offlineProtocol.ts): conserva comment/answer, documentos y recibos; añade `timer` con `status: in_progress|paused` y `baseStatus: pending|in_progress|paused`, y `checklist` con `checklistId` numérico positivo seguro. Los dos exigen `scope.workId`.
- [Router offline](../server/offline/routes.ts): misma ruta `/api/offline/commands`, autenticación y validación del actor/sucursal, JSON estricto de 64 KiB y reenvío a `/mobile-sync/commands`. Sin recibos locales, SQL ni fallback legacy en gateway; los reintentos de la cola conservan UUID y contenido.
- Nuevos errores admitidos: `MOBILE_SYNC_STATUS_CONFLICT`, `MOBILE_SYNC_INVALID_STATUS`, `MOBILE_SYNC_INVALID_CHECKLIST`. `MOBILE_SYNC_OPERATION_REUSED` sigue exigiendo revisión; un GET por UUID no demuestra igualdad del payload.
- Un timer usa el reloj del servidor al aplicar. No reconstruye tiempo transcurrido offline. Las cadenas inicio/pausa/reanudación conservan UUID y base propia, orden y dependencia; un fallo del precedente no autoriza inventar otra base.
- Un checklist vincula la plantilla existente mediante el Backend, sin inventar respuestas ni confirmar avance mientras esté pendiente.
- [Notificaciones](../server/notifications/routes.ts) de 1.0.2 retenidas: filtro estricto unreadOnly, conteos globales unreadCount/total, canDelete y DELETE del aviso propio. Se conservan las capacidades anteriores; esta entrega no verifica entrega push remota.

El [manual Backend](../../Qualitzer2.0-Backend/docs/ACTUALIZACION-FLUIDEZ-MOVIL.md) detalla contratos y concurrencia. La exclusión local por instancia Sequelize limita a una conexión retenida por timers de este módulo; necesita capacidad adicional para consultas legacy. El lock advisory MySQL por recurso coordina esta ruta entre procesos, **no los writers legacy**: no es CAS global ni garantiza exactamente una vez. Efecto y recibo son transacciones separadas; una caída puede requerir revisión.

## Despliegue manual pendiente

1. APK 1.0.11 y gateway 1.0.4 ya publicados localmente y verificados mediante los informes anteriores. No sobrescribir paquetes versionados; conservar la app instalada y sus datos hasta confirmar servidores compatibles. El usuario/operador realiza el despliegue pendiente.
2. Instalar y desplegar Backend compatible y gateway **1.0.4** como una actualización coordinada, mediante el procedimiento autorizado. Paquete, checksum, manifiesto y dependencia/lockfile locales ya están comprobados; queda la instalación real. Editar fuentes o copiar el TGZ no actualiza el gateway instalado.
3. Revisar por tenant las migraciones históricas de recibos, creaciones y notificaciones, incluida gestión de bandeja si corresponde. Aplicar solo las pendientes con respaldo y autorización. `kind` ya es STRING(20): timer/checklist **no requieren migración nueva ni cambio de esquema**. El esquema remoto no está verificado aquí; no lanzar un migrador global por esta ampliación.
4. Desplegar Backend y gateway **antes de instalar la APK**. Mantener prefijo HTTPS, backendUrl, directorio privado, claves, sesiones, colas y recibos. En modo embebido: detener, esperar el drenaje/salida y arrancar **un escritor**, sin rolling reload superpuesto.
5. Verificar salud, acceso y un piloto autorizado con MySQL real: inicio/pausa, asociación, reconexión/recibos y conflictos. Verificar capacidad del pool y límites advisory; ni RN Web ni el smoke nativo DEMO sustituyen este piloto. Un `/health` correcto no prueba soporte de comandos. Tras confirmar el despliegue, descargar 1.0.11 desde la página vigente cuando se habilite y elegir **Actualizar**, sin desinstalar ni borrar datos, caché o pendientes.

Rollback: deshabilitar productores nuevos conservando pendientes y recibos. No convertir al protocolo legacy, cambiar UUID, resetear leases o borrar datos para forzar replay.

## Empaquetado y evidencia

[Empaquetador](../scripts/pack-mobile-gateway.cjs): objetivo CommonJS Node 20.12.2, todas las dependencias productivas incluidas, dos builds y dos packs byte a byte iguales antes de publicar. El único destino Mobile nuevo es artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.4.tgz. Bloquea entradas .env y .data antes de cargarlas; no se invoca la fábrica ni se inicia un listener. Conserva los tarballs anteriores, incluido 1.0.3, y rechaza otro hash bajo la misma versión. El [manual incorporado](EMBEDDED-GATEWAY.md) también identifica 1.0.4.

[Validador nuevo](../scripts/testing/fluidity-package-validation.cjs), adaptado del [validador histórico de notificaciones](../scripts/testing/notification-package-validation.cjs):

1. Lee el tarball ya generado; calcula tamaño, SHA-256 y SHA-512/integrity. No usa un expected hash fijado antes del pack.
2. Lista exactamente los ocho archivos permitidos, rechaza enlaces/entradas no regulares y comprueba identidad, engine, export CommonJS, ausencia de dependencias externas declaradas y scripts de lifecycle.
3. Comprueba SOURCE-MANIFEST contra cada fuente actual y cada manifiesto de dependencia instalado, hash del bundle, fuentes críticas offline/server/domain —incluido assignmentSchedule corregido— y README incorporado. No carga .env ni datos privados.
4. Comprueba presencia estática de los comandos nuevos y retención de marcadores de notificaciones frente al paquete histórico 1.0.2. **No sustituye pruebas de esquema, rutas, autenticación ni MySQL.**
5. Instala únicamente en un consumidor temporal con npm offline e ignore-scripts; compara sus ocho archivos con el tarball y hace require del paquete con el ejecutable exacto Node 20.12.2. Comprueba el export createEmbeddedGateway, **sin invocarlo**; bloquea accesos comunes de red/escritura del proceso de carga. No es un sandbox de código hostil.
6. Registra hashes de las APK existentes sin abrirlas como APK, los tarballs previos, configuración de app y manifiestos/lockfiles consumidores; revalida todos los archivos observados al terminar. No los modifica ni los elimina. No analiza la instalación real de Backend.
7. Escribe un reporte nuevo bajo artifacts/logs/fluidity-package, con package, checks, preservedArtifacts y backendCopy. Un reporte pasado no significa despliegue, instalación Backend ni fuentes bloqueadas para cambios posteriores.

Sin flags no construye ni empaqueta y no escribe en Backend: únicamente crea reporte y scratch propios. Que falte la copia 1.0.4 del Backend se informa como pendiente y no invalida el paquete Mobile. Si ya existe una copia diferente bajo la misma versión, falla.

`--repro` opcional construye dos veces y ejecuta dos npm pack en scratch; exige que ambos coincidan en archivos y SHA con el tarball ya generado. No reemplaza el archivo publicado y no ejecuta el main del empaquetador.

`--copy` opcional, solamente después de validación y relectura estable, escribe en Backend/infrastructure/mobile-gateway estos tres destinos fijos: qualitzer-mobile-gateway-1.0.4.tgz, qualitzer-mobile-gateway-1.0.4.tgz.sha256 y qualitzer-mobile-gateway-1.0.4.tgz.source-manifest.json. Es copia exclusiva: existente idéntico se conserva, existente diferente se rechaza; el reporte registra hashes y qué se copió. No permite ruta arbitraria, no reemplaza paquetes antiguos y **no edita package.json/package-lock.json ni instala en Backend**. Las tres escrituras no son una transacción: un fallo puede dejar un subconjunto nuevo e idéntico; conservarlo y revisar el reporte antes de reintentar.

El contrato de reportes se conserva: artifacts/logs/fluidity-package/<fecha-UTC-con-guiones>-<sufijo-alfanumérico-de-6>/report.json. La descarga exige el último reporte, `passed: true`, `completedAt`, versión **1.0.4** y ruta/tamaño/SHA exactos del TGZ. Mantiene los mismos seis nombres obligatorios: `generated-package-hash`, `archive-structure-and-manifest`, `all-source-and-dependency-provenance`, `timer-checklist-and-retained-notifications-static`, `actual-isolated-commonjs-node20-load` y `observed-inputs-stable-at-completion`. El validador conserva además `fixed-backend-copy-manifest` y las demás comprobaciones; no renombrar checks ni reutilizar reportes 1.0.3 para desbloquear la descarga.

El empaquetado y la comprobación del consumidor requieren fuentes estables y revisión de sus reportes; una doble compilación no protege de ediciones posteriores. El manual incorporado y el empaquetador permanecen congelados desde antes del pack. No hacer una edición tardía de EMBEDDED-GATEWAY ni sobrescribir el TGZ. Las versiones, hashes y resultados se registran fuera de las entradas del paquete; el [informe final de APK](../artifacts/release-verification-1.0.11.json) ya acredita la publicación local de 1.0.11.

## Auditoría final de solo lectura

[fluidity-final-audit.cjs](../scripts/testing/fluidity-final-audit.cjs) no admite flags de copia, instalación o publicación. Recalcula los hashes del TGZ 1.0.4 y la APK previa 1.0.10; compara el TGZ Backend, su checksum y el manifiesto con el incorporado; verifica la referencia exacta y la integrity del manifiesto/lockfile Backend. No carga la dependencia instalada ni invoca la fábrica. Comprueba las fuentes y dependencias del paquete, coteja el último informe completo con su log y el último informe UI con los hashes actuales.

Ejecuta únicamente tres programas TypeScript Mobile sin emisión (app, app con todas las pruebas TypeScript cliente —incluidas creación automática y consumidores de tarjetas—, servidor Mobile con sus pruebas) y los dos archivos focalizados de creación/tarjetas. No ejecuta toda la batería, build, pack, lint, SQL, API ni operaciones de dispositivo. Escribe exclusivamente un directorio nuevo de informes/logs bajo artifacts/logs/fluidity-final-audit; no lee archivos de entorno, claves ni datos privados. El cotejo final detecta cambios en archivos observados durante la ejecución, no impide modificaciones posteriores. No crea ni sustituye el informe final de APK y no sirve como autorización de publicación.