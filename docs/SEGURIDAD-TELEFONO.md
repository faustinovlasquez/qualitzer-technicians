# Seguridad del teléfono — versión 1.0.10

## Uso

1. Ingresar normalmente con las credenciales de Qualitzer y completar la selección de empresa, si corresponde.
2. Después de verificar la sesión aparecerá **¿Vincular con la seguridad del teléfono?**. Elegir **Vincular y verificar** o **Ahora no**. La demostración y la web no solicitan esta vinculación.
3. Al vincular, el sistema operativo solicita la huella o credencial de pantalla del teléfono. Solo se activa después de una verificación correcta y de guardar la preferencia en SecureStore.
4. Al abrir de nuevo la app o regresar de segundo plano se solicita desbloqueo. Cancelar mantiene la pantalla bloqueada; **Reintentar desbloqueo** vuelve a solicitarlo sin bucles automáticos.
5. Puede activarse o desactivarse en **Mi perfil → Seguridad del teléfono**. Desactivar también requiere verificación del sistema.

La oferta se recuerda por instalación/dispositivo, no por sucursal. **Ahora no** evita repetirla en cada acceso; el perfil permite activarla después. Si ya había una sesión recordada al actualizar, se ofrece al recuperar una sesión verificada online. La preferencia sigue vigente al cerrar sesión o cambiar de cuenta para no dejar sin protección este teléfono.

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

Se necesita una **APK nueva** porque se añaden `expo-local-authentication` y `expo-screen-capture`. No requiere cambios ni migraciones del backend. Instalar la actualización sobre la versión anterior, sin desinstalar ni borrar datos, manteniendo el paquete y firma existentes.

Las pruebas con dobles de puertos y componentes no verifican sensores físicos. Antes de dar por validada una marca de teléfono, comprobar en ella:

- Activar con huella y con PIN/patrón solamente; cancelar, error, bloqueo temporal y alternativa del sistema.
- Arranque frío, regreso de otra app, bloqueo de pantalla, selector de archivos/cámara y cancelación del PIN sin bucles.
- Volver exactamente al formulario con texto/archivos pendientes y con un modal abierto; no exponerlos antes de desbloquear ni en Recientes.
- Hacer una captura con la app desbloqueada. Repetir después de bloquear: no debe revelar el formulario privado. La revisión de APIs con dobles no sustituye esta comprobación en el teléfono.
- Pulsar una notificación con la app bloqueada; consultar el trabajo solo después de desbloquear.
- Desactivar con comprobación, cerrar sesión y verificar que la huella no permite recuperar una sesión remota revocada.
- iOS/Face ID requiere compilación y validación nativa en macOS/iPhone; no está verificado por una compilación Android en Windows.