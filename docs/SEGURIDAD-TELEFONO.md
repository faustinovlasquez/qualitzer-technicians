# Seguridad del teléfono — preparación de versión 1.0.13

La documentación incorpora la preparación de privacidad y la guía de permisos previstas para 1.0.13. **No anuncia una APK 1.0.13 publicada ni una validación física de biometría o cámara.** La versión publicada anterior es 1.0.12; consulta la [preparación de actualización](ACTUALIZACION-1.0.13.md).

## Uso

1. Ingresar normalmente con las credenciales de Qualitzer y completar la selección de empresa, si corresponde.
2. Después de verificar la sesión aparecerá **¿Vincular con la seguridad del teléfono?**. Elegir **Vincular y verificar** o **Ahora no**. La demostración y la web no solicitan esta vinculación.
3. Al vincular, el sistema operativo solicita la huella o credencial de pantalla del teléfono. Solo se activa después de una verificación correcta y de guardar la preferencia en SecureStore.
4. Al abrir de nuevo la app o regresar normalmente de segundo plano se solicita desbloqueo. La excepción limitada de cámara y selectores se explica abajo. Cancelar la autenticación mantiene la pantalla bloqueada; **Reintentar desbloqueo** vuelve a solicitarlo sin bucles automáticos.
5. Puede activarse o desactivarse en **Mi perfil → Seguridad del teléfono**. Desactivar también requiere verificación del sistema.

La oferta se recuerda por instalación/dispositivo, no por sucursal. **Ahora no** evita repetirla en cada acceso; el perfil permite activarla después. Si ya había una sesión recordada al actualizar, se ofrece al recuperar una sesión verificada online. La preferencia sigue vigente al cerrar sesión o cambiar de cuenta para no dejar sin protección este teléfono.

## Volver de cámara, galería o archivos

Con la app ya desbloqueada, abrir un selector desde Qualitzer inicia una autorización temporal para esa operación nativa concreta. Al terminar o cancelar normalmente la selección se puede volver sin repetir huella/PIN, **solo si la operación sigue siendo válida, la app está en primer plano y la protección visual de la transición actual ha confirmado que está lista**. El mero regreso a primer plano no basta. Mientras se espera, el contenido privado, los modales y sus acciones siguen protegidos.

Esta autorización vive **exclusivamente en memoria**, está ligada a la promesa del selector nativo y dura como máximo **5 minutos desde que comienza**, incluyendo la espera de regreso y privacidad. No se persiste ni se recupera al reiniciar; no desactiva el bloqueo ni concede cinco minutos de acceso libre a otras apps. No cambia la preferencia de seguridad ni las credenciales remotas.

Antes de invocar el SDK de permiso o selector, se espera la confirmación de la protección de captura y, en iOS, del selector de aplicaciones para la transición actual. Si falla la preparación o se pierde el primer plano antes de iniciar esa llamada, se revoca la autorización y no se abre el SDK. Durante la espera se mantiene una cubierta neutra, sin exponer formularios ni acciones privadas.

La regla anterior de «una segunda salida a segundo plano siempre revoca» se sustituye por fases: **solo mientras la llamada nativa ya iniciada sigue sin resolver** se toleran sus rebotes de primer/segundo plano, sin renovar el límite de cinco minutos ni mostrar contenido privado. Una vez resuelta la llamada, volver a salir revoca la autorización, incluso mientras se espera la privacidad final. El primer plano por sí solo nunca concede acceso; se necesitan resultado nativo, operación vigente y confirmación de la última revisión de privacidad.

Si la operación falla, vence o se invalida, un resultado tardío no puede desbloquear. Con la seguridad activada se mantiene o solicita el bloqueo normal. Si Android destruye la actividad/proceso y se pierde esa operación, también se requiere desbloquear: no se promete recuperar automáticamente una foto o selección aún no guardada. Desbloquear y volver a seleccionar cuando corresponda, sin borrar los datos de la app. Cancelar el selector no añade archivos; cancelar la autenticación no omite el bloqueo.

**El arranque frío, la salida normal a segundo plano y el bloqueo habitual del teléfono no cambian.** Los diálogos de permisos del sistema siguen siendo necesarios cuando corresponda. Esta excepción no demuestra el comportamiento físico de todos los teléfonos ni controla las pantallas de otras aplicaciones. Seleccionar una foto tampoco confirma su guardado local ni su envío al servidor.

## Permiso de cámara

La app consulta el permiso actual. Solo solicita el aviso nativo si no está concedido y el sistema permite volver a preguntar. Una denegación muestra la guía **Permiso de cámara** al terminar la interacción protegida: permite reintentar, elegir Galería o cancelar. Si el sistema no admite otro aviso, ofrece **Abrir ajustes** y explica cómo permitir Cámara para Qualitzer.

Abrir Ajustes usa el ciclo normal de bloqueo, no la excepción del selector. Al volver se desbloquea cuando corresponda y se pulsa **Volver a intentar**; no hay reintento automático ni concesión de permisos desde la guía. Un fallo de selección, privacidad o cámara no disponible no se presenta como una denegación de permiso confirmada. Se conservan los archivos y borradores existentes, sin confundir selección con guardado o envío.

## Alcance y conservación de datos

- No se registra ni transmite una huella, rostro, PIN, patrón o contraseña del dispositivo. El sistema solo devuelve si la comprobación fue correcta.
- Huella y PIN/patrón/contraseña son los métodos configurados en el teléfono. No se crea un PIN propio ni se solicita escribir el código del sistema dentro de Qualitzer.
- Android 11 o superior solicita biometría fuerte o credencial del dispositivo. Android anterior utiliza la combinación compatible con AndroidX, que también puede admitir biometría débil; se mantiene el fallback a credencial. iOS utiliza Touch ID/Face ID o código según el dispositivo.
- Una sesión vigente recordada se reutiliza: la huella no inicia una nueva sesión remota ni sustituye las credenciales después de logout, revocación o vencimiento. No convierte el bloqueo en autenticación del servidor.
- Antes del primer desbloqueo no se monta el hook de restauración de sesión. Tras iniciar, la interfaz se oculta al bloquear, sin desmontar formularios ni eliminar archivos/borradores. También se ocultan los modales y su contenido/accesibilidad.
- No se aceptan nuevos callbacks de trabajo o navegación mientras está bloqueada. Las operaciones ya enviadas pueden terminar y conservar su confirmación; no se abortan ni se repiten por el bloqueo.
- Las notificaciones no abren trabajos hasta desbloquear; siguen sujetas a validación de sesión, empresa, sucursal y acceso al recurso. Esta función no corrige el problema de despacho push investigado por separado.
- El bloqueo funciona sin Internet sobre una sesión/copia offline permitida. No borra SQLite, la cola, SecureStore, recibos ni archivos y no cambia los UUID del protocolo offline.
- Desde 1.0.10 se permiten capturas/grabaciones mientras la app está desbloqueada, sin desvincular la huella o PIN. Si el bloqueo está activado y la app se bloquea o pasa a segundo plano, el contenido se oculta y se solicita de nuevo la protección de captura. En iOS se mantiene la protección del selector de aplicaciones. La confirmación de las APIs de privacidad corresponde a la última transición, para no reutilizar un resultado anterior al volver rápidamente. La vista de Recientes puede depender del momento en que Android toma su instantánea; no se promete protección perfecta con capturas habilitadas en primer plano.
- Se mantiene bloqueado el permiso de lectura global de imágenes añadido por la biblioteca. Android 14+ requiere el permiso normal `DETECT_SCREEN_CAPTURE` al inicializar el módulo, sin diálogo de autorización; no permite leer fotos ni huellas. La app no registra listeners JavaScript de capturas ni guarda eventos de ese observador.

La preferencia se guarda en una clave nueva de SecureStore; no se cambia el almacenamiento existente del token ni se usa `requireAuthentication` en él, para no invalidar la sesión y los pendientes al cambiar huellas. Es un bloqueo de acceso de la aplicación, **no cifrado adicional de la base offline ni protección contra root/jailbreak o modificación de la app**. Cualquier huella o credencial autorizada por el sistema puede desbloquear; no identifica a una persona concreta de Qualitzer.

Si el teléfono deja de tener un método seguro o falla la lectura de la preferencia, no se omite un bloqueo activo. Restablecer la seguridad del teléfono y reintentar; no borrar datos para solucionar el problema. No hay botón de salto a demo/login desde el bloqueo. Las restricciones y recuperación del PIN pertenecen al sistema operativo.

## Validación y entrega

Se incorporaron pruebas del controlador, adaptador, ciclo de vida, cancelación, fallos de almacenamiento, doble pulsación, modales, notificaciones y callbacks retenidos. El validador [device-security-validation.cjs](../scripts/testing/device-security-validation.cjs) deja informes por ejecución en la carpeta de artefactos.

Las bibliotecas de autenticación local y protección de captura ya estaban incorporadas en las versiones anteriores. Para recibir los cambios de 1.0.13 se necesita una **APK nueva, aún no publicada en esta preparación**, sin añadir permisos ni bibliotecas por este ajuste. Instalarla solo cuando esté verificada y disponible, sobre la versión anterior, sin desinstalar ni borrar datos, manteniendo el paquete y firma existentes. Esta preparación de fuentes no ejecuta pruebas ni acredita los cambios con una captura anterior.

La excepción de selectores no requiere backend nuevo ni migraciones nuevas. **Se mantiene el requisito anterior de backend compatible con timer/checklist + gateway 1.0.4 para enviar acciones pendientes.** Sustituir un código técnico por un mensaje de soporte no corrige el servidor ni demuestra que funcione. Soporte debe comprobar el despliegue y el flujo mediante el [procedimiento existente](../../Qualitzer2.0-Backend/docs/ACTUALIZACION-FLUIDEZ-MOVIL.md).

Las pruebas con dobles de puertos y componentes no verifican sensores físicos. Antes de dar por validada una marca de teléfono, comprobar en ella:

- Activar con huella y con PIN/patrón solamente; cancelar, error, bloqueo temporal y alternativa del sistema.
- Arranque frío, regreso normal de otra app, bloqueo de pantalla y cancelación del PIN sin bucles: siguen requiriendo el desbloqueo habitual.
- Cámara, galería y archivos iniciados desde la app desbloqueada: confirmar y cancelar dentro del plazo sin repetir huella/PIN, sin exponer la interfaz antes de terminar la operación, regresar a primer plano y completar la protección visual.
- Preparación de privacidad pendiente: salir antes de iniciar el SDK debe revocar y evitar su apertura. Con SDK ya pendiente, comprobar varios rebotes sin desbloqueo anticipado; tras resolver el callback, una nueva salida debe revocar de nuevo.
- Permiso concedido, denegado con reintento y denegado sin posibilidad de preguntar: aviso nativo solo cuando corresponde, guía posterior, Ajustes con bloqueo normal y reintento explícito; Galería y Cancelar conservan borradores.
- Vencimiento de 5 minutos, error del selector, fallo de privacidad y destrucción de actividad/proceso en Android: mantener el bloqueo, rechazar resultados tardíos y no prometer recuperar la selección aún no guardada.
- Volver exactamente al formulario con texto/archivos pendientes y con un modal abierto; no exponerlos antes de desbloquear ni en Recientes.
- Hacer una captura con la app desbloqueada. Repetir después de bloquear: no debe revelar el formulario privado. La revisión de APIs con dobles no sustituye esta comprobación en el teléfono.
- Pulsar una notificación con la app bloqueada; consultar el trabajo solo después de desbloquear.
- Desactivar con comprobación, cerrar sesión y verificar que la huella no permite recuperar una sesión remota revocada.
- iOS/Face ID requiere compilación y validación nativa en macOS/iPhone; no está verificado por una compilación Android en Windows.