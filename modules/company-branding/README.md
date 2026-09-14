# Branding Android: estabilidad y logos HTTPS

## Cambios de esta revisión

- El hook depende de escalares de sesión/tenant (id, nombre, logo, origen, entorno), gateway, sucursal y verificación. No observa foco para resincronizar.
- El controlador coalesce solicitudes iguales, incluso mientras están pendientes o si fallaron. Un cambio de nombre/logo/sucursal actualiza sin enviar primero `synchronize(null)`. Logout, pérdida de verificación y cambio real de identidad invalidan inmediatamente y restablecen branding.
- Hay solicitud automática una vez por empresa/instalación tras verificación live online y marca de sucursal preparada, sin reemplazar icono/nombre instalado. Siempre requiere confirmación del lanzador Android. El botón permite reintentar manualmente tras cancelar. Un acceso viejo abre normalmente la app sin diálogo previo, nunca autentica ni cambia de empresa.
- `CompanyPinRequests` crea un marcador vacío por ID SHA-256 en `noBackupFilesDir`, antes de solicitar el pin. Persiste cancelación/reinicio/logout sin guardar secretos ni autoridad de sesión. Pins existentes, incluso deshabilitados, se actualizan y rehabilitan sin solicitar otro. La ausencia de soporte/foco o revisión vigente impide la solicitud; fallos recuperables no bloquean el inicio normal y queda el botón manual.
- Recientes se programa por separado; sus excepciones no rechazan la sincronización. Comprueba revisión, compañía actual y Activity viva antes del cambio en Main.
- Los lanzamientos propios, callbacks del receptor y `PendingResult.finish()` contienen `Exception`, relanzando `CancellationException`. No se captura `Throwable` ni se oculta `OutOfMemoryError`.
- Descarga/decodificación serializadas con un mutex distinto del mutex de pins/receptor: logout y confirmaciones no esperan la descarga.

## Contrato de logos

`CompanyBrandingPayload.logoHttpsUrl?: string | null` complementa `logoDataUri`. Se deriva exclusivamente de `Tenant.logo` de una sesión live verificada; admite la URL de la sucursal seleccionada aunque el tenant conserve su id. No se elige otro endpoint, host ni URL de fallback.

El descargador usa OkHttp 4.9.2 ya expuesto por React Native 0.86; no añade SDK ni dependencia. Cliente privado independiente de los clientes autenticados:

- GET HTTPS, puerto 443, TLS y verificación de hostname predeterminados. Sin userinfo, fragmento, controles ni direcciones IP literales.
- DNS de conexión valida **todas** las respuestas, bloqueando loopback, RFC1918, link-local, CGNAT, multicast, rangos especiales/documentación, IPv6 ULA y mecanismos de transición. No hay preflight DNS separado de la conexión; se entregan sólo las direcciones verificadas a OkHttp.
- Sin cookies, autenticadores, proxy, caché HTTP, reintentos ni redirecciones. No se heredan headers de sesión. Se solicita `Accept-Encoding: identity`.
- Deadline de 10 segundos incluyendo espera/DNS; cancelación cancela la llamada. La resolución DNS del sistema puede seguir internamente hasta que el sistema la termine, pero no prolonga la espera del consumidor.
- Sólo 200, PNG/JPEG/WebP; MIME, firma y bounds concordantes. Límite 512 KiB aplicado a Content-Length y al stream, aunque falte o mienta el header. Máximo 2048×2048 antes de decodificar; muestreo a lado máximo aproximado de 512 px y canvas final 256×256.
- Caché de logos en memoria de **una entrada**: hash SHA-256 de URL y bytes validados + hash de contenido. Sin archivos de logos, SharedPreferences, URLs en logs ni persistencia de firmas S3. `PreparedCompany` retiene sólo etiquetas y bitmap, no la URL/base64. Los marcadores vacíos de solicitud son independientes de esta caché.
- Si falla la descarga/validación/decodificación recuperable, se usa Q y el estado nativo informa `logoUsed: "qualitzer"`. Nunca se afirma logo de empresa por haber enviado una URL.
- Una misma URL usa esa entrada mientras siga en caché. Para contenido nuevo bajo URL idéntica, el emisor debe versionarla o esperar otro proceso/evicción. Un fallo no provoca reintentos por foco; una nueva sesión o cambio de branding permite reintento.

## Evidencia y límites

Pruebas acotadas en `src/branding/tests/validate.cjs` y `modules/company-branding/tests/validate-native.cjs --all-sources`. El segundo utiliza exclusivamente JDK/JARs locales y crea resultados temporales; no ejecuta Gradle, prebuild, APK ni emulador.

La regresión JVM reproduce que el patrón anterior `runCatching` dentro de `try` **no** captura una excepción de `finally { result.finish() }`. La nueva protección contiene ese fallo, libera el mutex, mantiene operativo el scope y preserva cancelación. Esto prueba un hueco real de contención, **no** que haya sucedido en Samsung.

Los tests ejecutan las fuentes reales de política/downloader/coroutines con respuestas HTTP sintéticas; no hacen DNS real ni descargan logos de empresas. El hook real se transpila con dobles de React/nativo para comprobar recreación repetida del tenant, errores y desmontaje. Todos los archivos Kotlin actuales se compilan contra Android/Expo/React ya instalados.

Revisión 2026-09-11: 30 pruebas JS, 15 JVM y 4 pruebas de la actividad real con dobles Android aprobadas; diagnósticos TypeScript focalizados 0 y compilación de todas las fuentes Kotlin salida 0. No se generó APK ni se tocó autenticación, colas, firmas o Agenda. Pendiente nueva APK y prueba autorizada de apertura en frío, cancelar/confirmar, logout y pins antiguos en lanzador físico. La compilación JVM y sus dobles no sustituyen esa prueba; no hay garantía frente a agotamiento global de memoria o fallos del proceso Android fuera de este módulo.