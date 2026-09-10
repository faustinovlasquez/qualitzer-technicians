# APK standalone: configuración lista, servidor pendiente

Base pública fijada inicialmente: **https://api-demos-qz-v2.qualitzer.com/mobile**.
El despliegue manual de la fachada en el backend está pendiente. Esta configuración no prueba que el servidor esté publicado ni que el acceso real funcione.

## Compilación

- Perfil EAS: `standalone-apk` (Android APK, distribución interna, `developmentClient: false`). `preview` hereda ese perfil; `production` hereda la política de conexión pero genera AAB para tienda.
- Variables exactas para **configuración nativa y compilación del bundle**, también si se compila con Gradle fuera de EAS:
  - `EXPO_PUBLIC_GATEWAY_URL=https://api-demos-qz-v2.qualitzer.com/mobile`
  - `EXPO_PUBLIC_STANDALONE=true`
- Referencia no secreta: [.env.release.example](../.env.release.example). No sustituir [.env](../.env): permanece destinado a Expo Go y la pasarela local de desarrollo. El ejemplo no se carga automáticamente; el perfil EAS ya declara las variables.
- Mantener las variables en todo el proceso de compilación. EAS las aplica mediante el perfil; un proceso local debe suministrarlas explícitamente, sin modificar el entorno del servidor/Metro en ejecución.
- El bundle y los assets se incluyen en la app; las actualizaciones remotas están deshabilitadas en standalone. No se necesita Expo Go, Metro, QR de desarrollo ni PC para ejecutar el APK final.
- No se han ejecutado prebuild, generación nativa, firma ni build del APK en esta tarea. El agente de compilación debe usar **Release**, no Debug, y comprobar las variables antes de generar el artefacto.

## Contrato de basepath

- Montaje externo `/mobile`; rutas internas de la fachada `/api/...` sin cambios.
- Salud: `https://api-demos-qz-v2.qualitzer.com/mobile/health`.
- Inicio de sesión: `https://api-demos-qz-v2.qualitzer.com/mobile/api/auth/login/start`.
- No sustituir la base por el backend crudo terminado en `/api`, ni retirar `/mobile` al concatenar rutas.
- La validación compartida se ejecuta antes del build y antes del login. Exige HTTPS y hostname público, sin IP literal, host local, credenciales, query, fragmento, espacios, barras invertidas, segmentos `.`/`..`, barras duplicadas ni codificación `%`. Se permiten segmentos ASCII simples y se normaliza una barra final.
- La comprobación de conexión consulta la base completa sin credenciales. Un 404/503 o una respuesta inesperada no confirma el despliegue ni implica contraseña incorrecta.

## Identidad y datos existentes

- En standalone la base no es editable. No se usa la URL guardada, la IP de Expo ni localhost como fallback. Configuración pública embebida y variables, si ambas están presentes, deben coincidir.
- Un build nativo no-dev también aplica el bloqueo aunque falte el flag; sin una base pública válida no puede iniciar sesión.
- Si la sesión persistida corresponde a otra base (incluida otra ruta del mismo host), la restauración, login, demo y logout quedan bloqueados antes de construir un repositorio o modificar datos. El mensaje indica instalar una versión configurada para el servidor original. No desinstalar ni borrar datos para resolverlo: la recuperación requiere conservar esa instalación y su identidad/firma.
- Las claves existentes de URLs raíz se conservan byte por byte. `/mobile`, `/other`, `/Mobile` y la raíz tienen identidades distintas para borradores, colas y perfiles offline. No se adoptan perfiles antiguos origin-only desde una base con ruta ni se migran colas.
- Expo Go y el APK poseen almacenamientos separados de forma natural. No se trasladan pendientes del teléfono entre aplicaciones.
- La demostración sigue separada y etiquetada como datos de ejemplo; no sustituye una conexión productiva fallida.

## Validación y límites

Validación realizada: **27/27 pruebas focalizadas aprobadas** y **TypeScript móvil sin errores**. Cubren política de URL, evaluación real de configuración Expo sin prebuild, conservación de namespaces raíz, vínculo criptográfico de perfiles por ruta y ejecución del hook con dobles de almacenamiento/red para verificar bloqueo sin escrituras. No se consultó salud remota ni se probaron credenciales reales.

Pendiente tras el despliegue: validar TLS/DNS, montaje `/mobile`, autenticación nativa, persistencia de sesiones y peticiones reales en un APK firmado. La política estática valida el hostname, no resuelve DNS ni prueba que sus direcciones sean públicas; el dominio fijado debe administrarse de forma confiable. La fachada y el proxy deben mantener la misma interpretación de rutas y servir esta base sin redirecciones. El transporte existente de `HttpTechnicianRepository` no fija `redirect: "error"`; su endurecimiento queda fuera de los archivos asignados. La sonda de salud sí rechaza redirecciones. Web/cookies/CORS bajo `/mobile` son responsabilidad del servidor, no se han cambiado aquí. No se promete acceso a source maps del servidor.