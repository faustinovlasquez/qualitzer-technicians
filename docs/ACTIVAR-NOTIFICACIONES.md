# Activar notificaciones Android de Qualitzer técnicos

Guía para el responsable del servidor y la compilación. Revisada el 11-09-2026 contra el módulo de notificaciones de la rama backend app-mobile, sin cambiar de rama ni ejecutar migraciones. La captura del teléfono confirma que el servicio responde pero declara requisitos pendientes; no demuestra que falten físicamente las tablas.

**La versión 1.0.5 incorpora la configuración Android entregada por el propietario y el Project ID Expo real.** La APK 1.0.4 anterior no los contiene. Esto configura el cliente; no activa por sí solo las credenciales FCM v1 en Expo, el servidor ni el permiso del teléfono. Entrega: [ACTUALIZACION-1.0.5.md](ACTUALIZACION-1.0.5.md).

Datos públicos confirmados: Expo `be200e44-9d60-4881-9050-1c67afaeb650`, Firebase `qualitzer-7612f`, Android `com.qualitzer.field`. La clave privada de cuenta de servicio no se incorporó al APK ni al repositorio.

**Actualización del 11-09-2026, 17:24 UTC:** tras autorizar EAS CLI, se cargó y asoció la credencial **FCM v1** al proyecto `@fv24715s-team/qualitzer-tecnicos` y al paquete Android indicado. Una segunda consulta independiente confirmó la asociación. No se creó, subió ni sustituyó ningún keystore; la APK 1.0.5 permaneció intacta. El asistente web que exige un keystore puede cerrarse. Todavía deben verificarse servidor, permiso Android y recepción real.

[Credenciales del proyecto en Expo](https://expo.dev/accounts/fv24715s-team/projects/qualitzer-tecnicos/credentials) · [Registro de asociación sin secretos](../artifacts/logs/expo-fcm-setup/apply-2026-09-11T17-24-08-724Z.json).

## 1. Crear o utilizar los proyectos de Expo y Firebase

1. En Expo/EAS, crear o elegir el proyecto de la aplicación. Obtener su **Project ID**, un UUID público real. No es el nombre del proyecto Firebase ni su número de remitente.
2. En Firebase, crear o elegir el proyecto y registrar la aplicación Android con el identificador exacto **com.qualitzer.field**.
3. Descargar la configuración Android del cliente desde Firebase. Ya está incorporada en [../config/firebase/google-services.json](../config/firebase/google-services.json) y referenciada mediante `android.googleServicesFile`; no hay que volver a enviarla.
4. La credencial de cuenta de servicio ya está cargada y asociada a **FCM V1** en Expo. No volver a subirla ni completar el formulario de keystore. La cuenta debe tener permiso de envío **Firebase Cloud Messaging API Admin**; la recepción real comprobará también las autorizaciones del proveedor.
5. El archivo de configuración Android y la clave privada de cuenta de servicio **son distintos**. La cuenta de servicio no se incorpora al APK, no se copia a una carpeta pública, no se publica en Git ni se comparte por chat.

Flujo implementado: backend Qualitzer → servicio push de Expo → FCM → Android. No se configura una clave FCM antigua ni un segundo servicio HTTP propio. La compilación puede seguir siendo local; usar Expo para enviar push no obliga a instalar Expo Go ni a cambiar la firma Android.

Referencia oficial: [configuración FCM v1](https://docs.expo.dev/push-notifications/fcm-credentials/).

## 2. Revisar las tablas de notificaciones

En el backend que ya publica la app móvil, revisar la migración tenant **20260908160000-Create-MobileNotifications.js**. Crea `mobile_push_devices`, `mobile_push_snapshots` y `mobile_push_deliveries`, con sus columnas e índices. También presupone el esquema existente de asignaciones, mantenimiento y autenticación móvil.

Aplicar únicamente lo pendiente mediante el procedimiento habitual, con respaldo y revisión de las migraciones que ejecutará. El comando general tenant puede aplicar otras migraciones: no ejecutarlo a ciegas ni recrear tablas existentes. MySQL puede dejar cambios DDL parciales si una migración falla.

El cron recorre los tenants activos del master. Antes de declarar el esquema listo globalmente, revisar los tenants que alcanzará. **MOBILE_PUSH_MIGRATIONS_NOT_CONFIRMED significa que el indicador no está confirmado; no es por sí solo una inspección SQL de tablas.**

## 3. Variables del proceso backend

| Variable | Valor requerido |
| --- | --- |
| `MOBILE_PUSH_ENABLED` | `true`, solamente al terminar los requisitos |
| `MOBILE_PUSH_SCHEMA_READY` | `true`, solamente después de verificar las migraciones |
| `MOBILE_PUSH_ENCRYPTION_KEY` | 32 bytes aleatorios representados por **64 caracteres hexadecimales** |
| `EXPO_PROJECT_ID` | `be200e44-9d60-4881-9050-1c67afaeb650`, idéntico al de la APK 1.0.5 |
| `MOBILE_PUSH_GATEWAY_USER_AGENT` | Exactamente `Qualitzer-Mobile/1.0 (Mobile; Gateway)` |
| `EXPO_ACCESS_TOKEN` | Opcional: secreto de Expo si el proyecto exige seguridad de acceso al servicio push |

### Dónde obtener cada valor, paso a paso

**MOBILE_PUSH_ENCRYPTION_KEY — se genera, no se descarga.**

El administrador debe ejecutar `openssl rand -hex 32` en una terminal privada del servidor Linux. El resultado es una cadena de 64 caracteres: guardar esa cadena como valor de la variable, sin espacios. No usar generadores web, no enviarla al chat ni mostrarla en capturas. Generarla sólo si todavía no existe una clave válida; una clave ya utilizada debe conservarse.

**EXPO_PROJECT_ID — lo proporciona Expo.**

1. Entrar a [expo.dev](https://expo.dev/) y crear una cuenta o iniciar sesión.
2. Abrir el proyecto de Qualitzer técnicos. Si aún no existe, crear un proyecto desde el panel de Expo; esto no crea otra copia del código móvil.
3. En la configuración del proyecto, sección General, copiar **Project ID**. Es un identificador largo con guiones, no el nombre del proyecto ni un token.
4. Usar exactamente ese identificador en el servidor y en la futura compilación Android. Es público y puede compartirse con el desarrollador; no inventarlo ni generarlo con una herramienta de UUID.

**MOBILE_PUSH_GATEWAY_USER_AGENT — sólo se copia el texto fijo.**

Su valor es `Qualitzer-Mobile/1.0 (Mobile; Gateway)`. No hay que registrarse en ningún sitio ni generar una clave. El `1.0` de ese texto no debe cambiarse a la versión de la APK.

**EXPO_ACCESS_TOKEN — lo proporciona Expo, pero es opcional.**

Si no se habilitó la seguridad adicional de push en Expo, esta variable puede quedar sin definir. Para utilizar esa protección, el propietario crea un token desde [Expo → Account settings → Access tokens](https://expo.dev/settings/access-tokens) y lo guarda como secreto del servidor. Al activar la protección, las peticiones necesitan ese token válido. No es el Project ID, no es la clave de Firebase y no se comparte por chat ni se incluye en el APK.

**Importante: este módulo lee directamente process.env.** La pasarela y otros módulos del backend utilizan el proveedor de secretos, pero las notificaciones no llaman automáticamente a ese proveedor. Configurar estas variables en el entorno efectivo del proceso Node/PM2. Si se guardan en AWS Secrets Manager, el despliegue debe inyectarlas en ese entorno; añadirlas únicamente al JSON de AWS no basta con el código revisado. No cambiar `USE_ENV` para intentar resolverlo ni sustituir la configuración general de la API.

Generar la clave de cifrado en el entorno privado del servidor y guardarla en el mecanismo de secretos. No reutilizar JWT, clave de sesiones del gateway ni clave de firma Android. No imprimirla en logs ni enviarla al chat. Conservarla entre reinicios: cambiarla deja ilegibles los tokens registrados y requiere un plan de recifrado o nuevo registro.

Mantener el servicio deshabilitado mientras se prepara el esquema/proveedor. No eliminar sesiones, claves, pendientes o archivos de bloqueo para activarlo.

## 4. Preparar la actualización Android

- El proyecto Expo y la referencia Firebase se configuran estáticamente en [../app.json](../app.json). El servidor sigue necesitando su variable `EXPO_PROJECT_ID` con el mismo valor.
- El compilador mantiene el entorno restringido, sin reenviar secretos. Lee la configuración estática y comprueba que sus proyectos y paquete son los aprobados, antes de prebuild y dentro del APK. No hace falta habilitar todas las variables de entorno ni cargar archivos de secretos para compilar.
- Comprobar el resultado de configuración pública, el recurso Firebase nativo y la coherencia del projectId en el binario. No incorporar secretos de servidor ni la cuenta de servicio al APK.
- Incrementar versión/código Android y conservar **com.qualitzer.field** y la misma clave de firma existente. No permitir que un build remoto genere otra firma por defecto: impediría actualizar sobre la instalación actual.
- Instalar mediante **Actualizar**, sin desinstalar ni borrar datos.

El proyecto Expo y la configuración pública Firebase ya están incluidos en la distribución. La credencial FCM v1 también está asociada en Expo. Siguen pendientes de comprobar la habilitación del servidor y una recepción real en el teléfono. No se afirma un envío push exitoso únicamente por tener configurados el cliente y la credencial.

## 5. Reiniciar y comprobar

1. Conservar el backend existente, su URL, proxy y configuración de pasarela. Si el login ya funciona, no hay que rehacer Nginx ni desplegar otro gateway sólo por estas variables.
2. Reiniciar el proceso API con el entorno nuevo mediante **detener → esperar salida completa → iniciar**, una instancia PM2 fork y el tiempo de cierre existente de 40 segundos. No hacer un arranque solapado ni un segundo backend.
3. Confirmar la carga del cron del módulo: reconciliación cada **dos minutos** y despacho/recibos cada **un minuto**. El código lo registra desde el inicio del backend; no crear además otro cron Linux duplicado. Permitir salida HTTPS desde el servidor hacia el servicio push de Expo.
4. En la nueva APK, pulsar **Avisos → Actualizar estado**. El servicio debe indicar habilitado, sin motivos pendientes, y proyecto coincidente. Un health 200 de la pasarela no acredita notificaciones.
5. Pulsar **Activar notificaciones** y aceptar el permiso Android. Si fue denegado o bloqueado, ir a **Ajustes → Aplicaciones → Qualitzer técnicos → Notificaciones** y habilitarlo, incluido el canal Trabajos técnicos.
6. Comprobar registro activo y solicitar una prueba para ese dispositivo. Verificar recepción con la app abierta y en segundo plano. La prueba está limitada y respeta silencio/TTL; las preferencias iniciales silencian de 22:00 a 07:00 según la zona de la sucursal.

La primera reconciliación toma las asignaciones existentes como línea base silenciosa: no debe esperarse una notificación por cada trabajo anterior. La aceptación de un ticket o recibo de Expo no prueba que Android haya mostrado el aviso; restricciones de red, batería, permisos y cierre forzado pueden impedirlo.

Referencia del flujo de la app: [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md).