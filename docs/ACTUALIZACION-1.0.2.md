# Qualitzer técnicos 1.0.2: estabilidad y marca de sucursal

## Qué instalar en el teléfono

Instalar el APK **1.0.2 / código 3** mediante **Actualizar**, encima de 1.0.1. Mantiene `com.qualitzer.field` y la misma firma. No desinstalar ni borrar datos, caché o la cola para corregir este problema.

La corrección del cierre de Agenda está en el APK y no requiere cambios del servidor. La marca específica de sucursal necesita además el paquete de gateway descrito abajo.

## Cierre de Agenda: causa confirmada

Reproducido en una compilación release, Android API 36 y Hermes: al pasar de Mi jornada a Agenda, `SwipeRefreshLayoutManager.setColors` invocaba `CircularProgressDrawable` con cero colores. Android lanzaba `ArrayIndexOutOfBoundsException` en el hilo principal y cerraba el proceso. El control de Agenda no tenía `colors`; el detalle de trabajo tenía el mismo riesgo. No era un error de la cuenta ni una caché corrupta.

Ambos controles ahora reciben un array de colores no vacío. Una prueba AST protege todos los controles de actualización para que no reaparezca esa omisión. Tras recompilar se verificaron Agenda día/semana, actualización por gesto/botón, detalle de trabajo, 30 transiciones entre pantallas y recuperación de primer plano después del modo avión. El proceso permaneció vivo, sin errores fatales nuevos. Datos de demostración, emulador API 36; no es una prueba del Samsung ni de sus asignaciones reales.

La variante final incluye ARM64, ARMv7 y x86_64. Se entrega el mismo APK release probado en el emulador, no un bundle de Expo Go.

## Conexión y personalización

- Una respuesta antigua de una comprobación de sesión no reemplaza una lectura válida más reciente por estado desconectado.
- La invalidación de sesión concurrente es única y las respuestas viejas no renuevan perfiles después de revocación/cambio de foco.
- Respuestas de asignaciones/JSON inválidas se rechazan con error tipado antes del merge. No se finge conexión ante errores del servidor ni se reutiliza caché para esconder 401/403/503.
- Personalización nativa evita repetir trabajo por cada nuevo objeto de tenant o cambio de foco, y contiene errores de callbacks y Recientes.
- Logos HTTPS del servidor pueden descargarse para el acceso empresarial, con TLS, DNS público, sin cookies/autorización/redirecciones y límites de tamaño/tiempo/dimensiones. Si falla se usa Qualitzer y se informa.
- El icono/nombre principal instalado permanecen **Qualitzer técnicos**. La marca empresarial en el escritorio es un acceso solicitado desde **Mi perfil → Añadir empresa a pantalla de inicio**, con confirmación Android. No se cambia automáticamente el icono del cajón.

## Actualización del servidor para la marca de sucursal

El gateway anterior leía la marca general de la empresa, no la de la sucursal elegida. El nuevo paquete, **@qualitzer/mobile-gateway 1.0.1**, consulta el detalle existente `/branches/N` sólo después de verificar la sesión y pertenencia a N. Sobrescribe nombre/logo de presentación; no cambia tenant, IDs, origen, permisos ni namespace.

El programador debe:

1. Trabajar en la entrega del backend que ya contiene `/mobile` (rama app-mobile o cambios equivalentes integrados), sin reemplazar cambios ajenos.
2. Copiar `qualitzer-mobile-gateway-1.0.1.tgz` a `infrastructure/mobile-gateway/` del backend. Conservar el tarball 1.0.0 para rollback.
3. Verificar el SHA-256 del nuevo archivo:

   `34617c1bac013baaf531a770e3cfd6e12acb56e27603ed15714b116e07e1ed91`

4. En una ventana de mantenimiento, detener sólo el proceso API y esperar su salida completa. Desde la raíz del backend instalar:

   ```bash
   npm install --ignore-scripts --no-audit --no-fund ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz
   npm ls @qualitzer/mobile-gateway --depth=0
   ```

   Debe aparecer 1.0.1. Conservar los cambios del manifiesto y lockfile en la entrega que se usa para futuros despliegues.

5. Reiniciar el mismo backend, una sola instancia PM2 fork, sin solapamiento y con `kill_timeout=40000`. No cambiar variables, clave, directorio ni contenido de sesiones. No se añaden migraciones para este ajuste.
6. Comprobar `https://api-demos-qz-v2.qualitzer.com/mobile/health`: HTTP 200, `ok:true`, `backendReachable:true`.
7. Volver a abrir la app o verificar la sucursal en una sesión autorizada. Confirmar que `/mobile/api/auth/me?companyBranchId=N` trae el nombre/logo de la sucursal correspondiente. El nuevo indicador `branchBranding` informa `APPLIED` o `FALLBACK`; no compartir el token ni respuestas con datos personales en logs.

Un logo ausente o rechazado conserva el logo general de empresa, nunca el de otra sucursal. Si sigue sin aparecer, revisar que el logo de esa sucursal exista y sea accesible en el almacenamiento del sistema. El gateway no adivina archivos por nombre.

El paquete nuevo está en [artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz](../artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz). No se modificó la rama local del backend `refactor-inventario`, que contiene trabajo ajeno; esta entrega es el paquete versionado para su instalación en la rama correcta.

## Validación y límites

Suite Mobile: 818 casos, 817 aprobados, 1 omitido Windows/POSIX, cero fallos. Tipos app/servidor sin errores. Assets 4/4. Tarball reproducible e instalado en pruebas aisladas Node 20.12.2 y 22.23.2: 18 aprobadas y 1 omitida por plataforma en cada ejecución. Branding nativo: 19 pruebas JS y 12 JVM.

Se reprodujo y corrigió el cierre de Agenda en Android nativo, no sólo en navegador. No se accedió a credenciales o datos reales del técnico ni se comprobó la carga exacta del Samsung. La señal de desconexión del usuario no se atribuye exclusivamente a la carrera corregida; red, sesión y backend deben seguir mostrando fallos reales. No se garantizan sincronización con la app cerrada ni push sin su configuración independiente.