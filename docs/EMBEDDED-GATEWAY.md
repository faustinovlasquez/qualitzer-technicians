# @qualitzer/mobile-gateway 1.0.7

Runtime Node reutilizable generado desde Qualitzer-Mobile. **El tarball es un artefacto generado: no editarlo ni modificar el bundle instalado.** Los cambios se realizan en las fuentes del móvil y se regenera con scripts/pack-mobile-gateway.cjs. No contiene Expo, React Native, sharp, QR, router de desarrollo, listener, secretos ni datos de sesiones.

**1.0.5 agrega actividades y reapertura.** Rutas de lectura, creación, completado y archivos de actividades, más reapertura explícita de trabajos entregados. Requiere los endpoints PanelWorkActions del backend. Conserva timer, checklist, notificaciones y todos los recibos existentes. No transforma reapertura ni actividades en comandos offline. 1.0.4 y sus artefactos se conservan intactos; 1.0.3 permanece descartado.

**1.0.6 admite avisos de mantenimiento completo sin trabajo hijo.** El contrato acepta `groupType: "maintenance"` y `workId: null` exclusivamente para asignaciones, no para recordatorios de cronómetro. Conserva todas las comprobaciones de destinatario, empresa y sucursal. Requiere el backend de asignaciones completas y la APK 1.0.17 para mostrar y abrir estas órdenes. Los paquetes 1.0.5 y anteriores no se sustituyen. Sin migración nueva.

## API pública
La versión 1.0.7 conserva la marca `isChecklist` y `checklistId` de los registros de actividad e incorpora `DELETE /api/assignments/:groupId/works/:workId/activities/:activityId`. Exige acceso vigente al trabajo y rechaza mutaciones de trabajos entregados o finalizados. El backend realiza borrado lógico de actividades, nunca de respuestas de checklist. Sin migración nueva. Compatible con APK 1.0.18; instalar el backend y este gateway antes de utilizar la eliminación. Se conservan los paquetes anteriores.

Exporta `createEmbeddedGateway(options): Promise<EmbeddedGatewayHandler>`. Opciones:

| Campo | Contrato |
| --- | --- |
| backendUrl | URL HTTPS fija de la API, incluido su prefijo `/api`; sin credenciales, query ni fragmentos |
| sessionFile | Ruta local persistente de `sessions.enc`, dentro de un directorio privado dedicado fuera del código desplegable |
| trustedProxyIps | Lista no vacía de IPs literales de proxies fiables; no CIDR, nombres ni comodines |
| corsOrigins | Opcional; por defecto `[]` (solo nativo). Solo origins HTTPS exactos, sin ruta ni barra final |

Tipos publicados en `index.d.ts` y `embedded-contract.d.ts`: solo importan `node:http`. `EmbeddedGatewayHandler` recibe `IncomingMessage`, `ServerResponse` y `next(error?: unknown): void`, y devuelve `void`. No necesita los tipos de Express como dependencia pública. Node mínimo **20.12.2**; bundle CommonJS con todas las dependencias de producción, incluidos Express 5 y Multer 2, sin resolver el Express 4 del host. Los tipos de Node los aporta el proyecto consumidor.

## Integración y bootstrap

La fábrica NO abre puertos, NO importa server/index, NO carga `.env`, NO cambia `process.env`, NO instala señales de cierre del listener y NO monta `/api/development`. Obtiene y valida el catálogo neutral antes de resolver la promesa; sin catálogo válido rechaza el arranque. No usa SQL ni el frontend web.

El host debe iniciar su listener **antes** de invocar la fábrica cuando backendUrl vuelve al propio servidor. Montar una capa lazy en un prefijo dedicado (por ejemplo `/mobile-gateway`), antes de parsers globales, autenticación JWT, limitadores y CORS del host. La capa lazy comparte **una única promesa de inicialización**; evita crear fábricas por request y puede devolver 503 mientras arranca. No esperar esta promesa antes de `listen()`: produciría un bloqueo al consultar el catálogo del propio backend. Nunca enrutar `/api/auth/mobile/config` de vuelta a la misma capa lazy.

El handler consume rutas relativas al montaje (`/health`, `/api/auth/...`, `/api/assignments/...`). No eliminar un segundo prefijo ni pasar el pathname externo completo. Mantener el cuerpo original sin parsear (JSON y multipart); los límites internos dependen del stream. El host configura requestTimeout=120000, headersTimeout=15000, keepAliveTimeout=5000 y maxHeadersCount=50, o límites equivalentes en el proxy.

## Transporte y seguridad

- HTTPS obligatorio para todos los clientes. Una APK no envía Origin y es admitida con TLS válido; cualquier Origin se rechaza salvo inclusión explícita en corsOrigins. Las cookies web conservan las comprobaciones de origen y CSRF existentes.
- `X-Forwarded-Proto` solo se acepta si el socket remoto pertenece a trustedProxyIps. Confiar en loopback requiere que el puerto no sea accesible directamente por actores no fiables y que el proxy reescriba los headers forwarded; nunca reflejar headers del cliente ni marcar manualmente `req.secure`.
- Todas las respuestas llevan `Cache-Control: no-store` (cabecera base `private, no-store`; algunos routers reiteran `no-store`), sin ETag. JSON general limitado a 32 KiB; rutas especiales conservan sus límites y autenticación antes del multipart. No caché compartida de respuestas autenticadas.
- El catálogo sigue siendo propiedad del backend; la validación de portalOrigin distingue sus entornos development/production. La URL de destino de las llamadas siempre es backendUrl, no una URL recibida del cliente.

## Persistencia y escritor único

Solo la fábrica embebida habilita la generación automática en producción: crea 32 bytes criptográficos en `session.key` mediante publicación atómica, sin devolverlos, exportarlos ni registrarlos. El standalone sigue exigiendo GATEWAY_SESSION_SECRET en producción, sin cambios. Si existe sessions.enc y falta session.key, el arranque falla; nunca crear una clave nueva ni borrar sesiones para recuperarlo. Clave corrupta, snapshot alterado, binding de backend distinto o marcador `.unavailable` también fallan cerrados.

Usar un directorio dedicado por instalación/entorno en disco local persistente: POSIX directorio 0700 y archivos 0600, mismo propietario; en Windows ACL privada al usuario de servicio y SYSTEM. No symlinks, hardlinks de archivos, rutas de red ni directorios compartidos. No introducir el directorio en Git, backups públicos, assets ni imágenes. Respaldar y restaurar clave y snapshot juntos, cifrados y con el servicio detenido. Nunca copiar sesiones entre entornos o cambiar backendUrl para reutilizarlas.

Un bloqueo exclusivo `.writer.lock` por directorio impide dos inicializaciones simultáneas, incluso en procesos distintos o copias distintas del paquete. El propietario conserva el bloqueo toda la vida del proceso y lo retira al salir normalmente; si falla el bootstrap lo libera. No hay API pública de cierre/reset de sesiones. Tras SIGKILL/caída puede quedar el bloqueo: verificar que el PID propietario y todas las instancias están detenidos antes de retirarlo manualmente; nunca borrar `sessions.enc`, `session.key` ni `.unavailable` para desbloquear.

**PM2: instances=1, modo fork, sin cluster ni rolling reload con solapamiento.** Detener primero el escritor anterior antes de arrancar otro. No varios contenedores/pods con el mismo volumen; no NFS ni múltiples hosts. Aunque se usaran archivos distintos, los límites y los challenges siguen siendo memoria por proceso, por lo que no se soporta escalado horizontal. El bloqueo no sustituye un almacén distribuido.

## Empaquetado verificable

Ejecutar el script desde Mobile con Node que disponga de npm CLI (o `npm_execpath` apuntando al npm-cli.js instalado); usa esbuild y TypeScript ya instalados. Genera dos builds y dos `npm pack --ignore-scripts`, exige igualdad byte a byte y copia exclusivamente `qualitzer-mobile-gateway-1.0.7.tgz` a `Mobile/artifacts/mobile-gateway`. No instala el backend ni sobrescribe archivos históricos. Si ya existe 1.0.7 con otro hash, falla sin reemplazarlo. No modificar las entradas durante el empaquetado.

Este documento se incorpora como README y es una entrada del SOURCE-MANIFEST, igual que el empaquetador y assignmentSchedule. Su contenido queda cerrado en esta preparación: no editarlo después del pack para registrar resultados. Mantener todas las entradas congeladas durante empaquetado, validación y copia; registrar la evidencia posterior en reportes externos al paquete. El principal actualizará dependencia y lockfile Backend únicamente después de comprobar el hash del nuevo TGZ.

El paquete incluye LICENSE, THIRD-PARTY-LICENSES.md y SOURCE-MANIFEST.json con nombre/versión, herramientas, versiones/licencias de dependencias, SHA-256 de cada entrada fuente y del bundle. El SHA-256 del tarball se imprime al finalizar (no se incluye dentro del propio archivo). El manifiesto permite auditar las fuentes exactas; no incluye un tarball de fuentes. Para reproducir, conservar esas fuentes y versiones instaladas exactas; ejecutar nuevamente el script y comparar hashes. No incorpora fechas, rutas absolutas ni variables de entorno en el resultado.

El consumidor puede instalar el tarball local con npm y `--ignore-scripts`. La generación no despliega el backend ni crea una APK: el coordinador debe montar/publicar la ruta HTTPS y configurar la app para ese gateway remoto. Solo entonces deja de ser necesario el proceso gateway en el PC.

## Actualización del servidor a 1.0.1 (pendiente de despliegue)

Esta versión incorpora branding de la sucursal seleccionada: después de validar usuario, trabajador y pertenencia en `/api/auth/me?companyBranchId=N`, consulta exclusivamente `GET /branches/N`. Exige un `id` numérico positivo coincidente; usa `name` y `logo` del objeto plano. Solo modifica la presentación, nunca la identidad de tenant/sesión ni el namespace offline. Devuelve `branchBranding.status` APPLIED o FALLBACK; 401/403 se propagan y los demás errores conservan la presentación global. No descarga imágenes desde el gateway.

El agente responsable del despliegue debe copiar el nuevo tarball a una ruta versionada del backend, verificar el SHA-256 publicado e instalar ese archivo con `--ignore-scripts`, actualizando manifiesto y lockfile del consumidor. No reutilizar el nombre 1.0.0 ni editar el bundle generado. Conservar el prefijo HTTPS `/mobile`, backendUrl, directorio privado, clave y sesiones existentes. Detener el escritor anterior y esperar su salida antes de iniciar el nuevo proceso; no rolling reload. No borrar datos ni regenerar claves.

Después del reinicio comprobar `/mobile/health` y, mediante una sesión autorizada de prueba, la sucursal seleccionada y su fallback. La instalación, reinicio y comprobación autenticada son pasos pendientes del responsable del servidor, no acciones realizadas por el empaquetado Mobile. No requieren reconstruir la APK por un cambio documental o del gateway.

## Actualización de notificaciones 1.0.2

Conserva las mejoras de marca de sucursal de 1.0.1 y añade filtro `unreadOnly=true`, conteos globales `unreadCount`/`total`, capacidad `canDelete` y DELETE de un aviso propio. El gateway conserva los filtros de empresa, trabajador y sucursal mediante la autorización existente, no acepta destinatarios arbitrarios ni ejecuta SQL. Los eventos nuevos incluyen una referencia numérica al destinatario para descartar presentaciones de otra cuenta en el teléfono; no sustituye la comprobación de acceso al abrir.

Primero se aplica la migración incremental de bandeja del backend y se despliega su código. Luego instalar este paquete versionado y reiniciar el proceso con el procedimiento de escritor único. La app nueva conserva la lectura básica con servicios antiguos, pero no inventa conteos a partir de una página ni habilita eliminar/filtrar cuando el servicio no publica la capacidad. La migración y el despliegue remoto no los ejecuta este empaquetador.

## Actualización de fluidez 1.0.4 — fuentes preparadas

Amplía el esquema de comandos offline con `timer` (`status`, `baseStatus`) y `checklist` (`checklistId`), ambos con `scope.workId` obligatorio. Conserva comandos comment/answer, documentos, recibos y las notificaciones 1.0.2. El router existente revalida el actor y reenvía a `/mobile-sync/commands`; no añade recibos locales, SQL, fallback legacy ni tiempos del cliente. El reloj efectivo es el del backend al aplicar, no el momento del toque offline.

Primero desplegar Backend compatible y comprobar el esquema histórico de recibos. No hay migración nueva por estos dos kinds. Un gateway antiguo puede rechazarlos: no habilitar productores nuevos hasta instalar y verificar 1.0.4. Mantener UUID, payloads, pendientes, claves y sesiones también al revertir.

La procedencia debe incluir assignmentSchedule corregido: conserva por fecha exacta de consulta el trabajo completo, generatedAt y la prueba causal, sin trasladar el estado/tiempo o la prueba de otro día al reconciliar la semana. La versión por sí sola no acredita su inclusión; se exige el hash de esa fuente actual en el manifiesto.

El coordinador ejecutará `scripts/testing/fluidity-package-validation.cjs` después del pack: verifica el hash calculado del archivo generado, manifiesto y fuentes actuales, contratos presentes y carga CommonJS aislada con Node 20.12.2 sin invocar la fábrica. No instala en Backend ni modifica su manifiesto/lockfile; `--copy` únicamente permite publicar copias idénticas en la ruta de artefactos versionada del Backend. `--repro` reconstruye dos veces en directorios aislados y compara con el paquete existente, sin sustituirlo. Estas comprobaciones no prueban rutas HTTP, MySQL, entrega push ni funcionamiento de APK.