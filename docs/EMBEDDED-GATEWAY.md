# @qualitzer/mobile-gateway 1.0.0

Runtime Node reutilizable generado desde Qualitzer-Mobile. **El tarball es un artefacto generado: no editarlo ni modificar el bundle instalado.** Los cambios se realizan en las fuentes del móvil y se regenera con scripts/pack-mobile-gateway.cjs. No contiene Expo, React Native, sharp, QR, router de desarrollo, listener, secretos ni datos de sesiones.

## API pública

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

Ejecutar el script desde Mobile con Node que disponga de npm CLI; usa esbuild y TypeScript ya instalados, sin npm install ni scripts de lifecycle. Genera dos builds y dos `npm pack --ignore-scripts`, exige igualdad byte a byte y copia exclusivamente `qualitzer-mobile-gateway-1.0.0.tgz` a Backend/infrastructure/mobile-gateway. No toca package.json ni src del backend.

El paquete incluye LICENSE, THIRD-PARTY-LICENSES.md y SOURCE-MANIFEST.json con nombre/versión, herramientas, versiones/licencias de dependencias, SHA-256 de cada entrada fuente y del bundle. El SHA-256 del tarball se imprime al finalizar (no se incluye dentro del propio archivo). El manifiesto permite auditar las fuentes exactas; no incluye un tarball de fuentes. Para reproducir, conservar esas fuentes y versiones instaladas exactas; ejecutar nuevamente el script y comparar hashes. No incorpora fechas, rutas absolutas ni variables de entorno en el resultado.

El consumidor puede instalar el tarball local con npm y `--ignore-scripts`. La generación no despliega el backend ni crea una APK: el coordinador debe montar/publicar la ruta HTTPS y configurar la app para ese gateway remoto. Solo entonces deja de ser necesario el proceso gateway en el PC.